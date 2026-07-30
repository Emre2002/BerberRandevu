import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Public booking rate limits — Firestore-backed, privacy-safe keys.
 *
 * Success quota policy (phone_business_success, ip_business_success):
 * - Bucket key uses Europe/Istanbul REQUEST day (when the booking is submitted).
 * - resetAt aligns to the next Istanbul midnight (calendar day), not a rolling 24h window.
 * - Appointment date is NOT used for success abuse limits (duplicate_phone_day covers that).
 *
 * Attempt/burst policies continue to use rolling windows.
 */
export const RATE_LIMIT_SCOPES = {
    IP_ROUTE_BURST: "ip_route_burst",
    IP_BUSINESS_CREATE_BURST: "ip_business_create_burst",
    PHONE_BUSINESS_ATTEMPT: "phone_business_attempt",
    PHONE_BUSINESS_SUCCESS: "phone_business_success",
    IP_BUSINESS_SUCCESS: "ip_business_success",
    IP_BUSINESS_AVAILABILITY: "ip_business_availability"
};

const DEV_HMAC_FALLBACK = "berberrandevu-dev-hmac-secret-change-before-production";

export function isProductionRuntime() {
    return String(process.env.VERCEL_ENV || "").trim() === "production";
}

export function getBookingRateLimitConfig() {
    return {
        BOOKING_ROUTE_BURST_WINDOW_SECONDS: readEnvInt("BOOKING_ROUTE_BURST_WINDOW_SECONDS", 60),
        BOOKING_ROUTE_BURST_MAX: readEnvInt("BOOKING_ROUTE_BURST_MAX", 30),
        BOOKING_BURST_WINDOW_SECONDS: readEnvInt("BOOKING_BURST_WINDOW_SECONDS", 600),
        BOOKING_BURST_MAX: readEnvInt("BOOKING_BURST_MAX", 10),
        BOOKING_ATTEMPT_WINDOW_SECONDS: readEnvInt("BOOKING_ATTEMPT_WINDOW_SECONDS", 3600),
        BOOKING_ATTEMPT_MAX: readEnvInt("BOOKING_ATTEMPT_MAX", 10),
        BOOKING_SUCCESS_MAX: readEnvInt("BOOKING_SUCCESS_MAX", 5),
        BOOKING_IP_SUCCESS_MAX: readEnvInt("BOOKING_IP_SUCCESS_MAX", 25),
        AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS: readEnvInt("AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS", 60),
        AVAILABILITY_RATE_LIMIT_MAX: readEnvInt("AVAILABILITY_RATE_LIMIT_MAX", 60)
    };
}

export function getPolicyMatrix() {
    const cfg = getBookingRateLimitConfig();
    return [
        {
            scope: RATE_LIMIT_SCOPES.IP_ROUTE_BURST,
            key: "route + HMAC(IP)",
            limit: cfg.BOOKING_ROUTE_BURST_MAX,
            windowSeconds: cfg.BOOKING_ROUTE_BURST_WINDOW_SECONDS,
            counts: "route_hits",
            resetPolicy: "rolling"
        },
        {
            scope: RATE_LIMIT_SCOPES.IP_BUSINESS_CREATE_BURST,
            key: "businessId + HMAC(IP)",
            limit: cfg.BOOKING_BURST_MAX,
            windowSeconds: cfg.BOOKING_BURST_WINDOW_SECONDS,
            counts: "create_requests",
            resetPolicy: "rolling"
        },
        {
            scope: RATE_LIMIT_SCOPES.PHONE_BUSINESS_ATTEMPT,
            key: "businessId + HMAC(phone)",
            limit: cfg.BOOKING_ATTEMPT_MAX,
            windowSeconds: cfg.BOOKING_ATTEMPT_WINDOW_SECONDS,
            counts: "validated_attempts",
            resetPolicy: "rolling"
        },
        {
            scope: RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS,
            key: "businessId + HMAC(phone) + Istanbul request day",
            limit: cfg.BOOKING_SUCCESS_MAX,
            windowSeconds: 86400,
            counts: "committed_bookings",
            resetPolicy: "istanbul_midnight"
        },
        {
            scope: RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS,
            key: "businessId + HMAC(IP) + Istanbul request day",
            limit: cfg.BOOKING_IP_SUCCESS_MAX,
            windowSeconds: 86400,
            counts: "committed_bookings",
            resetPolicy: "istanbul_midnight"
        },
        {
            scope: RATE_LIMIT_SCOPES.IP_BUSINESS_AVAILABILITY,
            key: "businessId + HMAC(IP)",
            limit: cfg.AVAILABILITY_RATE_LIMIT_MAX,
            windowSeconds: cfg.AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS,
            counts: "availability_requests",
            resetPolicy: "rolling"
        }
    ];
}

function readEnvInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getNamespace() {
    const explicit = String(process.env.RATE_LIMIT_NAMESPACE || "").trim();
    if (explicit) return explicit.slice(0, 32);
    const vercelEnv = String(process.env.VERCEL_ENV || "").trim();
    if (vercelEnv) return vercelEnv.slice(0, 32);
    return String(process.env.NODE_ENV || "production").slice(0, 32);
}

export function requireProductionRateLimitSecrets() {
    if (!isProductionRuntime()) return;

    const phoneSecret = process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
    const ipSecret = process.env.RATE_LIMIT_IP_HMAC_SECRET;

    if (!phoneSecret || !ipSecret) {
        const err = new Error("rate_limit_config_error");
        err.code = "rate_limit_config_error";
        throw err;
    }

    if (phoneSecret === DEV_HMAC_FALLBACK || ipSecret === DEV_HMAC_FALLBACK) {
        const err = new Error("rate_limit_config_error");
        err.code = "rate_limit_config_error";
        throw err;
    }

    if (process.env.RATE_LIMIT_IP_SALT) {
        const err = new Error("rate_limit_config_error");
        err.code = "rate_limit_config_error";
        throw err;
    }
}

function getIdentitySecret(kind) {
    requireProductionRateLimitSecrets();

    const envKey = kind === "phone" ? "RATE_LIMIT_PHONE_HMAC_SECRET" : "RATE_LIMIT_IP_HMAC_SECRET";
    const dedicated = process.env[envKey];
    if (dedicated) return dedicated;

    if (isProductionRuntime()) {
        const err = new Error("rate_limit_config_error");
        err.code = "rate_limit_config_error";
        throw err;
    }

    const shared = process.env.RATE_LIMIT_HMAC_SECRET;
    if (shared) return shared;

    return DEV_HMAC_FALLBACK;
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
    err.rateLimitScope = meta.scope;
    return err;
}

export function logRateLimitEvent(scope, meta = {}) {
    console.warn("[rate-limit]", {
        scope,
        requestId: meta.requestId || null,
        limit: meta.limit ?? null,
        remaining: meta.remaining ?? 0,
        retryAfterSeconds: meta.retryAfterSeconds ?? null,
        elapsedMs: meta.elapsedMs ?? null
    });
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

/** Success quota buckets always use the Istanbul request day. */
export function getRequestDayBucket(now = new Date()) {
    return getIstanbulDayBucket(now);
}

/** Next Istanbul midnight — calendar reset for success quotas. */
export function getNextIstanbulMidnightMs(now = new Date()) {
    const nowMs = now.getTime();
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(now);

    const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    const hour = pick("hour") % 24;
    const minute = pick("minute");
    const second = pick("second");
    const elapsedTodayMs = ((hour * 3600) + (minute * 60) + second) * 1000;
    const dayMs = 86400 * 1000;
    return nowMs - elapsedTodayMs + dayMs;
}

/** @deprecated hour buckets replaced by rolling resetAt windows */
export function getHourBucket(now = new Date()) {
    return getIstanbulDayBucket(now);
}

function routeBurstDocId(routeName, ipIdentity) {
    return `${docPrefix()}_burst_route_${routeName}_${ipIdentity}`.slice(0, 1500);
}

function createBurstDocId(businessId, ipIdentity) {
    return `${docPrefix()}_burst_create_${businessId}_${ipIdentity}`.slice(0, 1500);
}

function availabilityBurstDocId(businessId, ipIdentity) {
    return `${docPrefix()}_burst_avail_${businessId}_${ipIdentity}`.slice(0, 1500);
}

function attemptDocId(businessId, phoneIdentity) {
    return `${docPrefix()}_attempt_${businessId}_${phoneIdentity}`.slice(0, 1500);
}

function phoneSuccessDocId(businessId, phoneIdentity, requestDay) {
    return `${docPrefix()}_success_phone_${businessId}_${phoneIdentity}_${requestDay}`.slice(0, 1500);
}

function ipSuccessDocId(businessId, ipIdentity, requestDay) {
    return `${docPrefix()}_success_ip_${businessId}_${ipIdentity}_${requestDay}`.slice(0, 1500);
}

async function consumeCounter(db, docId, { limit, windowSeconds, type, scope, metadata = {} }) {
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
                resetAtSeconds: Math.ceil(resetAtMs / 1000),
                scope
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
                scope,
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
            resetAtSeconds: Math.ceil(effectiveResetMs / 1000),
            scope
        };
    });

    if (!outcome.allowed) {
        throw buildRateLimitError(outcome);
    }

    return outcome;
}

export function readSuccessCounterState(snap, { limit, requestDay, resetAtMs, nowMs, scope }) {
    if (!snap.exists) {
        return { count: 0, resetAtMs, scope, limit };
    }

    const data = snap.data() || {};
    if (String(data.requestDay || "") !== String(requestDay)) {
        return { count: 0, resetAtMs, scope, limit };
    }

    const storedResetMs = toMillis(data.resetAt);
    if (storedResetMs <= nowMs) {
        return { count: 0, resetAtMs, scope, limit };
    }

    return {
        count: Number(data.count || 0),
        resetAtMs: storedResetMs,
        scope,
        limit
    };
}

export function assertSuccessQuotaAvailable(state, nowMs) {
    if (state.count >= state.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAtMs - nowMs) / 1000));
        throw buildRateLimitError({
            retryAfterSeconds,
            limit: state.limit,
            remaining: 0,
            resetAtSeconds: Math.ceil(state.resetAtMs / 1000),
            scope: state.scope
        });
    }
}

export function buildSuccessCounterWritePayload({
    count,
    limit,
    scope,
    type,
    requestDay,
    resetAtMs,
    businessId
}) {
    return {
        count,
        limit,
        type,
        scope,
        requestDay,
        namespace: getNamespace(),
        resetAt: Timestamp.fromMillis(resetAtMs),
        expiresAt: Timestamp.fromMillis(resetAtMs + 86400 * 1000),
        updatedAt: FieldValue.serverTimestamp(),
        businessId
    };
}

export function resolveSuccessQuotaRefs(db, businessId, phoneNorm, clientIp, now = new Date()) {
    const cfg = getBookingRateLimitConfig();
    const requestDay = getRequestDayBucket(now);
    const resetAtMs = getNextIstanbulMidnightMs(now);
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const ipIdentity = hashIpIdentity(clientIp);

    return {
        requestDay,
        resetAtMs,
        nowMs: now.getTime(),
        phone: {
            ref: db.collection("rateLimits").doc(phoneSuccessDocId(businessId, phoneIdentity, requestDay)),
            limit: cfg.BOOKING_SUCCESS_MAX,
            scope: RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS,
            type: "booking_success_phone"
        },
        ip: {
            ref: db.collection("rateLimits").doc(ipSuccessDocId(businessId, ipIdentity, requestDay)),
            limit: cfg.BOOKING_IP_SUCCESS_MAX,
            scope: RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS,
            type: "booking_success_ip"
        }
    };
}

/** Coarse IP-only guard before request body is parsed. */
export async function enforcePublicRouteBurstLimit(db, routeName, clientIp) {
    requireProductionRateLimitSecrets();
    const cfg = getBookingRateLimitConfig();
    const ipIdentity = hashIpIdentity(clientIp);
    const docId = routeBurstDocId(routeName, ipIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_ROUTE_BURST_MAX,
        windowSeconds: cfg.BOOKING_ROUTE_BURST_WINDOW_SECONDS,
        type: "public_route_burst",
        scope: RATE_LIMIT_SCOPES.IP_ROUTE_BURST,
        metadata: { route: routeName }
    });
}

/** Create burst scoped to resolved business + client IP. */
export async function enforceCreateIpBusinessBurstLimit(db, businessId, clientIp) {
    requireProductionRateLimitSecrets();
    const cfg = getBookingRateLimitConfig();
    const ipIdentity = hashIpIdentity(clientIp);
    const docId = createBurstDocId(businessId, ipIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_BURST_MAX,
        windowSeconds: cfg.BOOKING_BURST_WINDOW_SECONDS,
        type: "create_ip_business_burst",
        scope: RATE_LIMIT_SCOPES.IP_BUSINESS_CREATE_BURST,
        metadata: { businessId }
    });
}

export async function enforceAvailabilityBurstLimit(db, businessId, clientIp) {
    requireProductionRateLimitSecrets();
    const cfg = getBookingRateLimitConfig();
    const ipIdentity = hashIpIdentity(clientIp);
    const docId = availabilityBurstDocId(businessId, ipIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.AVAILABILITY_RATE_LIMIT_MAX,
        windowSeconds: cfg.AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS,
        type: "availability_burst",
        scope: RATE_LIMIT_SCOPES.IP_BUSINESS_AVAILABILITY,
        metadata: { businessId }
    });
}

export async function enforceBookingAttemptLimit(db, businessId, phoneNorm) {
    requireProductionRateLimitSecrets();
    const cfg = getBookingRateLimitConfig();
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const docId = attemptDocId(businessId, phoneIdentity);
    return consumeCounter(db, docId, {
        limit: cfg.BOOKING_ATTEMPT_MAX,
        windowSeconds: cfg.BOOKING_ATTEMPT_WINDOW_SECONDS,
        type: "booking_attempt",
        scope: RATE_LIMIT_SCOPES.PHONE_BUSINESS_ATTEMPT,
        metadata: { businessId }
    });
}

/** @deprecated success quotas are enforced atomically inside createPublicAppointment transaction */
export async function checkBookingSuccessLimit(db, businessId, phoneNorm, _appointmentDate, clientIp) {
    const quota = resolveSuccessQuotaRefs(db, businessId, phoneNorm, clientIp);
    const phoneSnap = await quota.phone.ref.get();
    const ipSnap = await quota.ip.ref.get();
    const phoneState = readSuccessCounterState(phoneSnap, {
        limit: quota.phone.limit,
        requestDay: quota.requestDay,
        resetAtMs: quota.resetAtMs,
        nowMs: quota.nowMs,
        scope: quota.phone.scope
    });
    assertSuccessQuotaAvailable(phoneState, quota.nowMs);
    const ipState = readSuccessCounterState(ipSnap, {
        limit: quota.ip.limit,
        requestDay: quota.requestDay,
        resetAtMs: quota.resetAtMs,
        nowMs: quota.nowMs,
        scope: quota.ip.scope
    });
    assertSuccessQuotaAvailable(ipState, quota.nowMs);
}

/** @deprecated success quotas are enforced atomically inside createPublicAppointment transaction */
export async function incrementBookingSuccessLimit(db, businessId, phoneNorm, _appointmentDate, clientIp) {
    const quota = resolveSuccessQuotaRefs(db, businessId, phoneNorm, clientIp);
    const phoneSnap = await quota.phone.ref.get();
    const ipSnap = await quota.ip.ref.get();
    const phoneState = readSuccessCounterState(phoneSnap, {
        limit: quota.phone.limit,
        requestDay: quota.requestDay,
        resetAtMs: quota.resetAtMs,
        nowMs: quota.nowMs,
        scope: quota.phone.scope
    });
    assertSuccessQuotaAvailable(phoneState, quota.nowMs);
    const ipState = readSuccessCounterState(ipSnap, {
        limit: quota.ip.limit,
        requestDay: quota.requestDay,
        resetAtMs: quota.resetAtMs,
        nowMs: quota.nowMs,
        scope: quota.ip.scope
    });
    assertSuccessQuotaAvailable(ipState, quota.nowMs);

    await quota.phone.ref.set(
        buildSuccessCounterWritePayload({
            count: phoneState.count + 1,
            limit: quota.phone.limit,
            scope: quota.phone.scope,
            type: quota.phone.type,
            requestDay: quota.requestDay,
            resetAtMs: phoneState.resetAtMs,
            businessId
        }),
        { merge: true }
    );

    await quota.ip.ref.set(
        buildSuccessCounterWritePayload({
            count: ipState.count + 1,
            limit: quota.ip.limit,
            scope: quota.ip.scope,
            type: quota.ip.type,
            requestDay: quota.requestDay,
            resetAtMs: ipState.resetAtMs,
            businessId
        }),
        { merge: true }
    );
}

export function buildRateLimitDocIdsForTests({ routeName, businessId, phoneNorm, clientIp, requestDay }) {
    const ipIdentity = hashIpIdentity(clientIp);
    const phoneIdentity = hashPhoneIdentity(phoneNorm, businessId);
    const dayBucket = requestDay || getRequestDayBucket();
    return {
        routeBurst: routeBurstDocId(routeName, ipIdentity),
        burstCreate: createBurstDocId(businessId, ipIdentity),
        burstAvailability: availabilityBurstDocId(businessId, ipIdentity),
        attempt: attemptDocId(businessId, phoneIdentity),
        phoneSuccess: phoneSuccessDocId(businessId, phoneIdentity, dayBucket),
        ipSuccess: ipSuccessDocId(businessId, ipIdentity, dayBucket)
    };
}

export async function readRateLimitBucket(db, docId) {
    const snap = await db.collection("rateLimits").doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const resetAtMs = toMillis(data.resetAt);
    const retryAfterSeconds = resetAtMs > Date.now()
        ? Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))
        : 0;
    return {
        scope: data.scope || data.type || null,
        count: Number(data.count || 0),
        limit: Number(data.limit || 0),
        requestDay: data.requestDay || null,
        resetAt: resetAtMs ? new Date(resetAtMs).toISOString() : null,
        retryAfterSeconds,
        namespace: data.namespace || null
    };
}

export async function deleteRateLimitBucket(db, docId) {
    await db.collection("rateLimits").doc(docId).delete();
}
