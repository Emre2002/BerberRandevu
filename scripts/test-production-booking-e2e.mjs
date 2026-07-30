#!/usr/bin/env node
/**
 * Production booking E2E via HTTP API + browser-free validation.
 * Reports sanitized rate-limit headers on 429; does not retry or bypass limits.
 */
import crypto from "node:crypto";
import { getAdminDb } from "../api/_lib/firebase-admin.js";
import { resolvePublicBusinessSlug } from "../api/_lib/resolve-public-business-slug.js";

const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const slug = process.env.SMOKE_PUBLIC_SLUG || "abc";

function tomorrowYmd() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Parse Retry-After as delay-seconds or HTTP-date. Returns sanitized timing only.
 * @param {string|null|undefined} raw
 */
function parseRetryAfterHeader(raw) {
    if (raw == null || raw === "") return null;

    const trimmed = String(raw).trim();
    const asSeconds = Number(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return {
            retryAfterSeconds: Math.floor(asSeconds),
            resetInSeconds: Math.floor(asSeconds)
        };
    }

    const resetMs = Date.parse(trimmed);
    if (Number.isFinite(resetMs)) {
        const resetInSeconds = Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));
        return {
            resetAt: new Date(resetMs).toISOString(),
            resetInSeconds,
            retryAfterSeconds: resetInSeconds
        };
    }

    return null;
}

/**
 * Normalize a rate-limit reset header value to epoch milliseconds.
 * Accepts unix seconds or milliseconds.
 * @param {string|null|undefined} raw
 */
function parseResetTimestamp(raw) {
    if (raw == null || raw === "") return null;

    const value = Number(String(raw).trim());
    if (!Number.isFinite(value) || value < 0) return null;

    const resetMs = value > 1_000_000_000_000 ? value : value * 1000;
    const resetInSeconds = Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));

    return {
        resetAt: new Date(resetMs).toISOString(),
        resetInSeconds,
        retryAfterSeconds: resetInSeconds
    };
}

/**
 * Extract sanitized rate-limit timing from response headers when present.
 * Never includes request bodies, tokens or customer fields.
 * @param {Response} response
 */
function extractSanitizedRateLimitInfo(response) {
    if (!response?.headers) return null;

    const headersPresent = [];
    const info = {};

    const retryAfterRaw = response.headers.get("retry-after");
    if (retryAfterRaw) {
        headersPresent.push("retry-after");
        const parsed = parseRetryAfterHeader(retryAfterRaw);
        if (parsed) {
            if (parsed.retryAfterSeconds != null) info.retryAfterSeconds = parsed.retryAfterSeconds;
            if (parsed.resetAt) info.resetAt = parsed.resetAt;
            if (parsed.resetInSeconds != null) info.resetInSeconds = parsed.resetInSeconds;
        }
    }

    for (const headerName of ["x-ratelimit-reset", "ratelimit-reset"]) {
        const raw = response.headers.get(headerName);
        if (!raw) continue;

        headersPresent.push(headerName);
        const parsed = parseResetTimestamp(raw);
        if (parsed) {
            if (!info.resetAt) info.resetAt = parsed.resetAt;
            if (info.resetInSeconds == null) info.resetInSeconds = parsed.resetInSeconds;
            if (info.retryAfterSeconds == null) info.retryAfterSeconds = parsed.retryAfterSeconds;
        }
    }

    for (const headerName of ["x-ratelimit-remaining", "ratelimit-remaining"]) {
        const raw = response.headers.get(headerName);
        if (raw == null || raw === "") continue;

        const remaining = Number(String(raw).trim());
        if (Number.isFinite(remaining) && remaining >= 0) {
            headersPresent.push(headerName);
            info.remaining = Math.floor(remaining);
        }
    }

    for (const headerName of ["x-ratelimit-limit", "ratelimit-limit"]) {
        const raw = response.headers.get(headerName);
        if (raw == null || raw === "") continue;

        const limit = Number(String(raw).trim());
        if (Number.isFinite(limit) && limit >= 0) {
            headersPresent.push(headerName);
            info.limit = Math.floor(limit);
        }
    }

    if (headersPresent.length === 0) return null;

    return {
        ...info,
        headersPresent: [...new Set(headersPresent)]
    };
}

const date = tomorrowYmd();
const availUrl = `${BASE}/api/public/availability?dukkan=${encodeURIComponent(slug)}&date=${date}`;
const availResp = await fetch(availUrl);
const availBody = await availResp.json();

if (availResp.status !== 200 || !availBody.availableSlots?.length) {
    const availabilityRateLimit = availResp.status === 429
        ? extractSanitizedRateLimitInfo(availResp)
        : null;

    console.log(JSON.stringify({
        ok: false,
        stage: "availability",
        status: availResp.status,
        ...(availabilityRateLimit ? { rateLimit: availabilityRateLimit } : {})
    }));
    process.exit(1);
}

const db = getAdminDb();
const businessId = await resolvePublicBusinessSlug(db, slug);
const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
const services = publicSnap.data()?.selectedServices;
const service = Array.isArray(services) && services.length ? services[0] : "Saç Kesimi";
const time = availBody.availableSlots[0];
const idempotencyKey = crypto.randomUUID();

const createResp = await fetch(`${BASE}/api/public/create-appointment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
        dukkan: slug,
        customerName: "Test Musteri",
        phone: "05559876543",
        service,
        date,
        time,
        musteriNotu: "e2e-test",
        idempotencyKey
    })
});

let createBody = null;
try {
    createBody = await createResp.json();
} catch {
    createBody = null;
}

const appointmentId = createBody?.appointmentId;
const createOk = createResp.status === 201 && createBody?.ok === true && appointmentId;

let verified = false;
if (createOk) {
    const snap = await db.collection("appointments").doc(appointmentId).get();
    verified = snap.exists && snap.data()?.barberId === businessId;
}

if (verified) {
    await db.collection("appointments").doc(appointmentId).delete();
    await db.collection("appointmentSlotLocks").doc(`${businessId}__${date}__${time}`).delete().catch(() => {});
    await db.collection("appointmentIdempotency").doc(
        crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)
    ).delete().catch(() => {});
}

const rateLimit = (createResp.status === 429 || createBody?.code === "rate_limited")
    ? extractSanitizedRateLimitInfo(createResp)
    : null;

const report = {
    ok: verified,
    stage: "production_http_e2e",
    createStatus: createResp.status,
    createCode: createBody?.code ?? null,
    businessId,
    appointmentId: verified ? appointmentId : null,
    cleanedUp: verified
};

if (rateLimit) {
    report.rateLimit = rateLimit;
}

if (!verified && createResp.status === 429) {
    report.failureReason = "rate_limited";
}

console.log(JSON.stringify(report));
process.exit(verified ? 0 : 1);
