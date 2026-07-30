#!/usr/bin/env node
/**
 * Production owner archive E2E — synthetic appointment create + archive + cleanup.
 * Reads credentials only from ignored .local-private files. Never logs passwords or tokens.
 */
import crypto from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminDb } from "../api/_lib/firebase-admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const ownerUsername = process.env.SMOKE_OWNER_USERNAME || "bedirhan";
const ARTIFACT_DIR = resolve(ROOT, ".local-private/validation-artifacts/archive-appointment");

function readProductionApiKey() {
    const text = readFileSync(resolve(ROOT, "firebase-config.js"), "utf8");
    const match = text.match(/apiKey:\s*"([^"]+)"/);
    if (!match?.[1]) throw new Error("production_firebase_api_key_missing");
    return match[1];
}

function loadOwnerPassword(username) {
    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");
    if (!existsSync(csvFile)) return null;
    const lines = readFileSync(csvFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        if (/^businessname/i.test(line)) continue;
        const cols = line.split(",").map((s) => s.trim());
        if (cols[1] === username && cols[2]) return cols[2];
    }
    return null;
}

function addDaysYmd(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

async function resolveOwnerAuthEmail(username) {
    const resp = await fetch(`${BASE}/api/resolve-auth-identifier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, roleHint: "owner" })
    });
    const body = await resp.json().catch(() => null);
    if (resp.status !== 200 || !body?.authEmail) {
        throw new Error("owner_resolver_failed");
    }
    return { authEmail: body.authEmail, businessId: body.businessId };
}

async function signInOwner(authEmail, password) {
    const apiKey = readProductionApiKey();
    const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: authEmail, password, returnSecureToken: true })
        }
    );
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.idToken) {
        throw new Error("owner_sign_in_failed");
    }
    return body.idToken;
}

async function fetchAvailability(date, dukkan) {
    const url = `${BASE}/api/public/availability?dukkan=${encodeURIComponent(dukkan)}&date=${date}`;
    const resp = await fetch(url);
    const body = await resp.json().catch(() => null);
    return { status: resp.status, body };
}

async function findOpenSlot(dukkan) {
    for (let offset = 1; offset <= 14; offset += 1) {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        const date = d.toISOString().slice(0, 10);
        const avail = await fetchAvailability(date, dukkan);
        if (avail.status === 200 && avail.body?.availableSlots?.length) {
            return { date, time: avail.body.availableSlots[0] };
        }
    }
    throw new Error("availability_not_found");
}

const report = {
    ok: false,
    stage: "owner_archive_e2e",
    createStatus: null,
    archiveStatus: null,
    sourceRemoved: false,
    archiveVerified: false,
    cleanedUp: false,
    businessId: null,
    appointmentId: null,
    archiveId: null
};

let idToken = null;
let appointmentId = null;
let archiveId = null;
let businessId = null;
let date = null;
let time = null;
let lockId = null;

try {
    const password = loadOwnerPassword(ownerUsername);
    if (!password) throw new Error("missing_local_owner_credentials");

    const resolved = await resolveOwnerAuthEmail(ownerUsername);
    businessId = resolved.businessId;
    report.businessId = businessId;

    idToken = await signInOwner(resolved.authEmail, password);

    const slot = await findOpenSlot(businessId);
    date = slot.date;
    time = slot.time;

    const db = getAdminDb();
    const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
    const services = publicSnap.data()?.selectedServices;
    const service = Array.isArray(services) && services.length ? services[0] : "Saç Kesimi";
    const idempotencyKey = crypto.randomUUID();

    const createResp = await fetch(`${BASE}/api/owner/create-appointment`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            customerName: "Archive E2E Test",
            phone: "05551112233",
            service,
            date,
            time,
            musteriNotu: "owner-archive-e2e",
            idempotencyKey
        })
    });

    report.createStatus = createResp.status;
    const createBody = await createResp.json().catch(() => null);
    if (createResp.status !== 201 || !createBody?.appointmentId) {
        throw new Error(`create_${createResp.status}`);
    }

    appointmentId = createBody.appointmentId;
    report.appointmentId = appointmentId;
    lockId = `${businessId}__${date}__${time}`;

    const archiveResp = await fetch(`${BASE}/api/owner/archive-appointment`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            appointmentId,
            deletedBy: ownerUsername,
            deletedByMode: "e2e-test"
        })
    });

    report.archiveStatus = archiveResp.status;
    const archiveBody = await archiveResp.json().catch(() => null);
    if (archiveResp.status !== 200 || archiveBody?.state !== "archived") {
        throw new Error(`archive_${archiveResp.status}`);
    }

    archiveId = archiveBody.archiveId || null;
    report.archiveId = archiveId;

    const sourceSnap = await db.collection("appointments").doc(appointmentId).get();
    report.sourceRemoved = !sourceSnap.exists;

    const archiveQuery = await db
        .collection("deletedAppointments")
        .where("barberSlug", "==", businessId)
        .where("originalAppointmentId", "==", appointmentId)
        .limit(1)
        .get();
    report.archiveVerified = !archiveQuery.empty;

    report.ok = report.sourceRemoved && report.archiveVerified;
} catch (err) {
    report.failureReason = String(err?.message || "internal_error").slice(0, 64);
} finally {
    try {
        const db = getAdminDb();
        let cleaned = true;

        if (appointmentId) {
            await db.collection("appointments").doc(appointmentId).delete().catch(() => {});
            const stillActive = (await db.collection("appointments").doc(appointmentId).get()).exists;
            if (stillActive) cleaned = false;
        }

        if (archiveId) {
            await db.collection("deletedAppointments").doc(archiveId).delete().catch(() => {});
        } else if (appointmentId && businessId) {
            const q = await db
                .collection("deletedAppointments")
                .where("barberSlug", "==", businessId)
                .where("originalAppointmentId", "==", appointmentId)
                .limit(3)
                .get();
            for (const docSnap of q.docs) {
                await docSnap.ref.delete().catch(() => {});
            }
        }

        if (lockId) {
            await db.collection("appointmentSlotLocks").doc(lockId).delete().catch(() => {});
        }

        report.cleanedUp = cleaned;
        report.ok = report.ok && report.cleanedUp;
    } catch {
        report.cleanedUp = false;
        report.ok = false;
    }

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
        resolve(ARTIFACT_DIR, `owner-archive-e2e-${Date.now()}.json`),
        JSON.stringify(report, null, 2),
        "utf8"
    );

    console.log(JSON.stringify(report));
    process.exit(report.ok ? 0 : 1);
}
