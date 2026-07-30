import { normalizeTrustedClientIp } from "./booking-rate-limit.js";

const buckets = new Map();

/** Process-local burst limiter for non-booking owner/admin routes only. */
export function checkRateLimit(key, { limit = 60, windowMs = 60_000 } = {}) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return true;
    }
    entry.count += 1;
    return entry.count <= limit;
}

export function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
        return normalizeTrustedClientIp(forwarded);
    }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length) {
        return normalizeTrustedClientIp(realIp);
    }
    return normalizeTrustedClientIp(req.socket?.remoteAddress || "unknown");
}

export { normalizeTrustedClientIp };
