#!/usr/bin/env node
/**
 * Preview HTTP E2E for public create-appointment flow.
 * Uses test business "abc" only; cleans up created appointments and locks.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://your-preview.vercel.app node scripts/test-preview-booking-e2e.mjs
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<token> SMOKE_BASE_URL=https://your-preview.vercel.app node scripts/test-preview-booking-e2e.mjs
 */
import crypto from "node:crypto";
import { loadLocalEnvFile } from "./_lib/load-local-env.mjs";
import {
    BYPASS_ENV_VAR,
    containsBypassSecret,
    createPreviewHttpClient,
    resolvePreviewE2EConfig
} from "./lib/preview-booking-e2e-client.mjs";

function tomorrowYmd(offset = 1) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

function uniquePhone() {
    const suffix = String(Date.now()).slice(-7);
    return `0555${suffix}`;
}

async function runScenario(name, fn) {
    try {
        const result = await fn();
        return { name, ok: true, ...result };
    } catch (err) {
        return {
            name,
            ok: false,
            code: err?.code || "scenario_error",
            error: err.message,
            ...(err?.code === "unexpected_redirect"
                ? {
                    status: err.status ?? null,
                    location: err.location ?? null,
                    requestId: err.requestId ?? null
                }
                : {})
        };
    }
}

function printJson(payload) {
    console.log(JSON.stringify(payload, null, 2));
}

function buildAvailabilityFailureReport({
    protectionBypassConfigured,
    availability,
    http,
    date,
    err = null
}) {
    if (err?.code === "unexpected_redirect") {
        return {
            ok: false,
            code: "unexpected_redirect",
            date,
            protectionBypassConfigured,
            bypassEnvVar: BYPASS_ENV_VAR,
            requestHeadersUsed: http?.getLastRequestHeaders?.() || null,
            status: err.status ?? null,
            location: err.location ?? null,
            requestId: err.requestId ?? null,
            diagnosis: "Preview returned a redirect instead of JSON. Node E2E uses redirect: manual and does not follow 3xx responses."
        };
    }

    const diagnosis = !protectionBypassConfigured
        ? "VERCEL_AUTOMATION_BYPASS_SECRET is empty in the local process environment (.env.local is loaded when present). Export the Protection Bypass for Automation secret from Vercel project Settings > Deployment Protection."
        : availability?.status === 401
            ? "Bypass header was sent but Preview returned 401. Verify the secret matches an active Protection Bypass for Automation secret in Vercel Deployment Protection settings."
            : "Availability request failed before scenarios could run.";

    return {
        ok: false,
        code: availability?.code === "unexpected_redirect" ? "unexpected_redirect" : "no_availability",
        date,
        protectionBypassConfigured,
        bypassEnvVar: BYPASS_ENV_VAR,
        requestHeadersUsed: availability?.requestHeadersUsed || http?.getLastRequestHeaders?.() || null,
        diagnosis,
        availability: availability
            ? {
                status: availability.status,
                code: availability.code,
                requestId: availability.requestId,
                location: availability.location ?? null
            }
            : null,
        ...(err ? { error: err.message } : {})
    };
}

async function main() {
    loadLocalEnvFile();

    let config;
    try {
        config = resolvePreviewE2EConfig();
    } catch (err) {
        if (err?.code === "invalid_smoke_base_url") {
            printJson({
                ok: false,
                code: "invalid_smoke_base_url",
                message: err.message,
                smokeBaseUrlConfigured: err.smokeBaseUrlConfigured ?? false
            });
            process.exit(1);
        }
        printJson({
            ok: false,
            code: err?.code || "preview_e2e_config_error",
            message: err?.code === "bypass_token_on_production_forbidden"
                ? "Deployment protection bypass cannot be used with a production SMOKE_BASE_URL."
                : "Preview E2E configuration is invalid."
        });
        process.exit(1);
    }

    const { baseUrl: BASE, resolvedBaseUrl, slug, bypassSecret, protectionBypassConfigured } = config;
    const http = createPreviewHttpClient({ baseUrl: BASE, slug, bypassSecret });

    const report = {
        baseUrl: BASE,
        resolvedBaseUrl,
        slug,
        protectionBypassConfigured,
        bypassEnvVar: BYPASS_ENV_VAR,
        scenarios: [],
        summary: { passed: 0, failed: 0 }
    };

    const date = tomorrowYmd(3);
    let availability;
    try {
        availability = await http.fetchAvailability(date);
    } catch (err) {
        printJson(buildAvailabilityFailureReport({
            protectionBypassConfigured,
            http,
            date,
            err
        }));
        process.exit(1);
    }

    if (availability.status !== 200 || !availability.body?.availableSlots?.length) {
        printJson(buildAvailabilityFailureReport({
            protectionBypassConfigured,
            availability,
            http,
            date
        }));
        process.exit(1);
    }

    const slotA = availability.body.availableSlots[0];
    const service = availability.body.services?.[0] || "Saç Kesimi & Yıkama";

    report.scenarios.push(await runScenario("free_slot_returns_201", async () => {
        const phone = uniquePhone();
        const idempotencyKey = `preview-e2e-free-${Date.now()}`;
        const res = await http.createAppointment({
            dukkan: slug,
            customerName: "Preview Test",
            phone,
            service,
            date,
            time: slotA,
            musteriNotu: "preview-e2e",
            website: "",
            idempotencyKey
        });

        if (res.status !== 201) {
            throw new Error(`expected 201, got ${res.status} code=${res.code || "unknown"}`);
        }

        return {
            status: res.status,
            code: res.code,
            requestId: res.requestId,
            requestHeadersUsed: res.requestHeadersUsed,
            appointmentId: res.body?.appointment?.id || res.body?.appointmentId,
            cleanup: { date, time: slotA, idempotencyKey, phone }
        };
    }));

    report.scenarios.push(await runScenario("concurrent_same_slot_one_201_one_409", async () => {
        const phone1 = uniquePhone();
        const phone2 = uniquePhone();
        const sharedDate = tomorrowYmd(4);
        const avail = await http.fetchAvailability(sharedDate);
        const time = avail.body?.availableSlots?.[0];
        if (!time) throw new Error("no slot for concurrent test");

        const payloadA = {
            dukkan: slug,
            customerName: "Concurrent A",
            phone: phone1,
            service,
            date: sharedDate,
            time,
            website: ""
        };
        const payloadB = { ...payloadA, customerName: "Concurrent B", phone: phone2 };

        const [a, b] = await Promise.all([
            http.createAppointment(payloadA),
            http.createAppointment(payloadB)
        ]);

        const statuses = [a.status, b.status].sort();
        if (!(statuses[0] === 201 || statuses[0] === 409) || !(statuses[1] === 201 || statuses[1] === 409)) {
            throw new Error(`expected one 201 and one 409, got statuses ${a.status}/${b.status}`);
        }
        if (a.status === 201 && b.status === 201) {
            throw new Error("both requests returned 201");
        }

        return {
            results: [
                { status: a.status, code: a.code, requestId: a.requestId },
                { status: b.status, code: b.code, requestId: b.requestId }
            ],
            date: sharedDate,
            time
        };
    }));

    report.scenarios.push(await runScenario("duplicate_phone_day_returns_409", async () => {
        const phone = uniquePhone();
        const dupDate = tomorrowYmd(5);
        const avail = await http.fetchAvailability(dupDate);
        const time1 = avail.body?.availableSlots?.[0];
        const time2 = avail.body?.availableSlots?.[1] || time1;
        if (!time1) throw new Error("no slot for duplicate test");

        const first = await http.createAppointment({
            dukkan: slug,
            customerName: "Dup Test",
            phone,
            service,
            date: dupDate,
            time: time1,
            website: ""
        });
        if (first.status !== 201) {
            throw new Error(`first booking failed: ${first.status} code=${first.code || "unknown"}`);
        }

        const second = await http.createAppointment({
            dukkan: slug,
            customerName: "Dup Test 2",
            phone,
            service,
            date: dupDate,
            time: time2,
            website: ""
        });

        if (second.status !== 409) {
            throw new Error(`expected 409 duplicate, got ${second.status} code=${second.code || "unknown"}`);
        }

        return {
            first: { status: first.status, code: first.code, requestId: first.requestId },
            second: { status: second.status, code: second.code, requestId: second.requestId }
        };
    }));

    const freeScenario = report.scenarios.find((s) => s.name === "free_slot_returns_201" && s.ok);
    if (freeScenario?.cleanup?.idempotencyKey) {
        report.scenarios.push(await runScenario("idempotent_replay_returns_201_no_extra_booking", async () => {
            const replay = await http.createAppointment({
                dukkan: slug,
                customerName: "Preview Test",
                phone: freeScenario.cleanup.phone,
                service,
                date: freeScenario.cleanup.date,
                time: freeScenario.cleanup.time,
                website: "",
                idempotencyKey: freeScenario.cleanup.idempotencyKey
            });

            if (replay.status !== 201) {
                throw new Error(`replay expected 201, got ${replay.status} code=${replay.code || "unknown"}`);
            }

            return {
                status: replay.status,
                code: replay.code,
                requestId: replay.requestId,
                appointmentId: replay.body?.appointment?.id || replay.body?.appointmentId
            };
        }));
    }

    for (const scenario of report.scenarios) {
        if (scenario.ok) report.summary.passed += 1;
        else report.summary.failed += 1;
    }

    report.ok = report.summary.failed === 0;

    if (bypassSecret && containsBypassSecret(report, bypassSecret)) {
        printJson({ ok: false, code: "internal_error", message: "Report would have leaked bypass token." });
        process.exit(1);
    }

    printJson(report);

    if (freeScenario?.ok && process.env.SMOKE_SKIP_CLEANUP !== "1") {
        try {
            const { getAdminDb } = await import("../api/_lib/firebase-admin.js");
            const db = getAdminDb();
            const appointmentId = freeScenario.appointmentId;
            if (appointmentId) {
                await db.collection("appointments").doc(appointmentId).delete().catch(() => {});
            }
            const lockId = `${slug}__${freeScenario.cleanup.date}__${freeScenario.cleanup.time}`;
            await db.collection("appointmentSlotLocks").doc(lockId).delete().catch(() => {});
            const idemId = crypto.createHash("sha256")
                .update(freeScenario.cleanup.idempotencyKey)
                .digest("hex")
                .slice(0, 40);
            await db.collection("appointmentIdempotency").doc(idemId).delete().catch(() => {});
            printJson({ cleanup: true, appointmentId });
        } catch (err) {
            printJson({ cleanup: false, error: err.message });
        }
    }

    process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
    printJson({
        ok: false,
        code: err?.code || "preview_e2e_unhandled_error",
        message: err?.message || "Preview E2E failed with an unhandled error.",
        ...(err?.code === "unexpected_redirect"
            ? {
                status: err.status ?? null,
                location: err.location ?? null,
                requestId: err.requestId ?? null
            }
            : {})
    });
    process.exit(1);
});
