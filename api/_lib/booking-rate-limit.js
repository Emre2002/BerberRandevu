import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Public booking rate limits — Firestore-backed, privacy-safe keys.
 *
 * Layer 1 (burst): route + HMAC(IP), short window — all POST/GET hits on public routes.
 * Layer 2 (attempt): resolved businessId + HMAC(phone), after structural validation.
 * Layer 3 (success): resolved businessId + HMAC(phone) + Istanbul calendar day — new commits only.
 *
 * Defaults are tuned so ordinary customers (including CGNAT/office) can book once or twice
 * without hitting 429, while floods and repeated abuse remain blocked.
 */
export function getBookingRateLimitConfig() {
    return {
        BOOKING_BURST_WINDOW_SECONDS: readEnvInt("BOOKING_BURST_WINDOW_SECONDS", 60),
        BOOKING_BURST_MAX: readEnvInt("BOOKING_BURST_MAX", 40),
        BOOKING_ATTEMPT_WINDOW_SECONDS: readEnvInt("BOOKING_ATTEMPT_WINDOW_SECONDS", 3600),
        BOOKING_ATTEMPT_MAX: readEnvInt("BOOKING_ATTEMPT_MAX", 12),
        BOOKING_SUCCESS_WINDOW_SECONDS: readEnvInt("BOOKING_SUCCESS_WINDOW_SECONDS", 86400),
        BOOKING_SUCCESS_MAX: readEnvInt("BOOKING_SUCCESS_MAX", 3),
        AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS: readEnvInt("AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS", 60),
        AVAILABILITY_RATE_LIMIT_MAX: readEnvInt("AVAILABILITY_RATE_LIMIT_MAX", 120)
    };
}

function readEnvInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getNamespace() {
    const explicit = String(process.env.RATE_LIMIT_NAMESPACE || "").trim();
    if (explicit) return explicit.slice(0, 32);
    const vercelEnv = String(process.env.VERCEL_ENV || "").trim();
    if (vercelEnv) return vercelEnv.slice(0, 32);
    return String(process.env.NODE_ENV || "production").slice(0, 32);
}

function getIdentitySecret(kind) {
    const envKey = kind === "phone" ? "RATE_LIMIT_PHONE_HMAC_SECRET" : "RATE_LIMIT_IP_HMAC_SECRET";
    const value = process.env[envKey] || process.env.RATE_LIMIT_HMAC_SECRET;
    if (value) return value;
    const salt = process.env.RATE_LIMIT_IP_SALT;
    if (salt) return salt;
    return "berberrandevu-dev-hmac-secret-change-before-production";
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildRateLimitError(meta) {
    const err = new Error("rate_limited");
    err.code = "rate_limited";
    err.retryAfterSeconds = meta.retryAfterSeconds;
    err.rateLimitLimit = meta.limit;
    err.rateLimitRemaining = 0;
    err.rateLimitReset = meta.resetAtSeconds;
    return err;
}

function docPrefix() {
    return `rl_${getNamespace()}`;
}

export function normalizeTrustedClientIp(raw) {
    let ip = String(raw || "unknown").trim().toLowerCase();
    if (!ip || ip === "unknown") return "unknown";

    if (ip.includes(",")) {
        ip = ip.split(",")[0].trim();
    }

    if (ip.startsWith("::ffff:")) {
        ip = ip.slice("::ffff:".length);
    }

    if (ip.startsWith("[") && ip.endsWith("]")) {
        ip = ip.slice(1, -1);
    }

    return ip || "unknown";
}

/** @deprecated use normalizeTrustedClientIp */
export function hashIp(ip) {
    return hashIpIdentity(ip);
}

export function hashIpIdentity(ip) {
    const normalized = normalizeTrustedClientIp(ip);
    return crypto
        .createHmac("sha256", getIdentitySecret("ip"))
        .update(normalized)
        .digest("hex")
        .slice(0, 24);
}

export function hashPhoneIdentity(phoneNorm, businessId) {
    const phone = String(phoneNorm || "").trim();
    const tenant = String(businessId || "").trim();
    return crypto
        .createHmac("sha256", getIdentitySecret("phone"))
        .update(`${tenant}:${phone}`)
        .digest("hex")
        .slice(0, 24);
}

export function getIstanbulDayBucket(now = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    const parts = formatter.formatToParts(now);
    const pick = (type) => parts.find((p) => p.type === type)?.value || "00";
    return `${pick("year")}${pick("month")}${pick("day")}`;
}

/** @deprecated hour buckets replaced by rolling resetAt windows */
export function getHourBucket(now = new Date()) {
    return getIstanbulDayBucket(now);
}

function burstDocId(routeName, ipIdentity) {
    return `${docPrefix()}_burst_${routeName}_${ipIdentity}`.slice(0, 1500);
}

function attemptDocId(businessId, phoneIdentity) {
    return `${docPrefix()}_attempt_${businessId}_${phoneIdentity}`.slice(0, 1500);
}

function successDocId(businessId, phoneIdentity, dayBucket) {
    return `${docPrefix()}_success_${businessId}_${phoneIdentity}_${dayBucket}`.slice(0, 1500);
}

async function consumeCounter(db, docId, { limit, windowSeconds, type, metadata = {} }) {
    const nowMs = Date.now();
    const windowMs = windowSeconds * 1000;
    const ref = db.collection("rateLimits").doc(docId);

    const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let count = 0;
        let resetAtMs = nowMs + windowMs;

        if (snap.exists) {
            const data = snap.data() || {};
            const storedResetMs = toMillis(data.resetAt);
            if (storedResetMs > nowMs) {
                count = Number(data.count || 0);
                resetAtMs = storedResetMs;
            }
        }

        if (count >= limit) {
            const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
            return {
                allowed: false,
                retryAfterSeconds,
                limit,
                remaining: 0,
                resetAtSeconds: Math.ceil(resetAtMs / 1000)
            };
        }

        const nextCount = count + 1;
        const effectiveResetMs = snap.exists && toMillis(snap.data()?.resetAt) > nowMs
            ? resetAtMs
            : nowMs + windowMs;

        tx.set(
            ref,
            {
                count: nextCount,
                limit,
                type,
                namespace: getNamespace(),
                resetAt: Timestamp.fromMillis(effectiveResetMs),
                expiresAt: Timestamp.fromMillis(effectiveResetMs + windowMs * 2),
                updatedAt: FieldValue.serverTimestamp(),
                ...metadata
            },
            { merge: true }
        );

        return {
            allowed: true,
            limit,
            remaining: Math.max(0, limit - nextCount),
            resetAtSeconds: Math.ceil(effectiveResetMs / 1000)
        };
    });

    if (!outcome.allowed) {
        throw buildRateLimitError(outcome);
    }

    return outcome;
}

async function readCounterAtLimit(db, docId, { limit, windowSeconds }) {
    const nowMs = Date.now();
    const snap = await db.collection("rateLimits").doc(docId).get();
    if (!snap.exists) return;

    const data = snap.data() || {};
    const resetAtMs = toMillis(data.resetAt);
    if (resetAtMs <= nowMs) return;

    const count = Number(data.count || 0);
    if (count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
        throw buildRateLimitError({
            retryAfterSeconds,
            limit,
            remaining: 0,
            resetAtSeconds: Math.ceil(resetAtMs / 1000)
        });
    }
}

export async function enforcePublicRouteBurstLimit(db, routeName, clientIp) {
    const cfg = getBookingRateLimitConfig();
    const ipIdentity = hashIpIdentity(clientIp);
    const docId = burstDocId(routeName, ipIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_BURST_MAX,
        windowSeconds: cfg.BOOKING_BURST_WINDOW_SECONDS,
        type: "public_burst",
        metadata: { route: routeName }
    });
}

export async function enforceAvailabilityBurstLimit(db, clientIp) {
    const cfg = getBookingRateLimitConfig();
    const ipIdentity = hashIpIdentity(clientIp);
    const docId = burstDocId("public-availability", ipIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.AVAILABILITY_RATE_LIMIT_MAX,
        windowSeconds: cfg.AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS,
        type: "availability_burst",
        metadata: { route: "public-availability" }
    });
}

export async function enforceBookingAttemptLimit(db, businessId, phoneNorm) {
    const cfg = getBookingRateLimitConfig();
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const docId = attemptDocId(businessId, phoneIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_ATTEMPT_MAX,
        windowSeconds: cfg.BOOKING_ATTEMPT_WINDOW_SECONDS,
        type: "booking_attempt",
        metadata: { businessId }
    });
}

export async function checkBookingSuccessLimit(db, businessId, phoneNorm, date) {
    const cfg = getBookingRateLimitConfig();
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const dayBucket = String(date || "").replace(/-/g, "") || getIstanbulDayBucket();
    const docId = successDocId(businessId, phoneIdentity, dayBucket);
    await readCounterAtLimit(db, docId, {
        limit: cfg.BOOKING_SUCCESS_MAX,
        windowSeconds: cfg.BOOKING_SUCCESS_WINDOW_SECONDS
    });
}

export async function incrementBookingSuccessLimit(db, businessId, phoneNorm, date) {
    const cfg = getBookingRateLimitConfig();
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const dayBucket = String(date || "").replace(/-/g, "") || getIstanbulDayBucket();
    const docId = successDocId(businessId, phoneIdentity, dayBucket);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_SUCCESS_MAX,
        windowSeconds: cfg.BOOKING_SUCCESS_WINDOW_SECONDS,
        type: "booking_success",
        metadata: { businessId }
    });
}

export function buildRateLimitDocIdsForTests({ routeName, businessId, phoneNorm, clientIp, date }) {
    const ipIdentity = hashIpIdentity(clientIp);
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const dayBucket = String(date || "").replace(/-/g, "") || getIstanbulDayBucket();
    return {
        burstCreate: burstDocId(routeName, ipIdentity),
        burstAvailability: burstDocId("public-availability", ipIdentity),
        attempt: attemptDocId(businessId, phoneIdentity),
        success: successDocId(businessId, phoneIdentity, dayBucket)
    };
}
