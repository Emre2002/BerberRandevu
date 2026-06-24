const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");

/** Saatlik limitler — Europe/Istanbul bucket. */
const LIMITS = {
    PHONE_ATTEMPTS_PER_HOUR: 3,
    IP_BARBER_SUCCESS_PER_HOUR: 5,
    IP_GLOBAL_REQUESTS_PER_HOUR: 20
};

const HOURLY_EXPIRES_HOURS = 2;

/**
 * Production'da RATE_LIMIT_IP_SALT env zorunlu olmalı.
 * TODO: Firebase secrets — firebase functions:secrets:set RATE_LIMIT_IP_SALT
 */
function getIpHashSalt() {
    return (
        process.env.RATE_LIMIT_IP_SALT ||
        "berberrandevu-dev-salt-change-before-production"
    );
}

/**
 * Saatlik bucket: yyyyMMddHH
 * Europe/Istanbul timezone (TR yaz/kış saati dahil).
 */
function getHourBucket(now = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const pick = (type) => parts.find((p) => p.type === type)?.value || "00";
    return `${pick("year")}${pick("month")}${pick("day")}${pick("hour")}`;
}

function hashIp(ip) {
    const normalized = String(ip || "unknown").trim() || "unknown";
    return crypto
        .createHash("sha256")
        .update(`${normalized}:${getIpHashSalt()}`)
        .digest("hex")
        .slice(0, 16);
}

function hashPhone(normalizedPhone) {
    return crypto
        .createHash("sha256")
        .update(`${normalizedPhone}:${getIpHashSalt()}`)
        .digest("hex")
        .slice(0, 16);
}

function expiresAtHoursFromNow(hours = HOURLY_EXPIRES_HOURS) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function extractClientIp(request) {
    const raw = request?.rawRequest;
    if (!raw) return "unknown";
    const forwarded = raw.headers?.["x-forwarded-for"];
    if (forwarded) {
        return String(forwarded).split(",")[0].trim() || "unknown";
    }
    return raw.ip || raw.socket?.remoteAddress || "unknown";
}

function docIds({ barberSlug, phoneNorm, ipHash, bucket }) {
    return {
        phoneAttempts: `pa_${barberSlug}_${phoneNorm}_${bucket}`,
        ipBarberSuccess: `ip_${barberSlug}_${ipHash}_${bucket}`,
        ipGlobal: `ipg_${ipHash}_${bucket}`
    };
}

/**
 * Sayaç okur; limit aşıldıysa false. Aksi halde atomik artırır.
 */
async function incrementCounter(db, docId, { max, field, type, extra = {} }) {
    const ref = db.collection("rateLimits").doc(docId);
    const expiresAt = expiresAtHoursFromNow(HOURLY_EXPIRES_HOURS);

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? Number(snap.data()[field] || 0) : 0;

        if (current >= max) {
            return { allowed: false, current };
        }

        const next = current + 1;
        const payload = {
            [field]: next,
            type,
            bucket: docId.split("_").pop(),
            updatedAt: FieldValue.serverTimestamp(),
            expiresAt
        };

        if (snap.exists) {
            tx.update(ref, payload);
        } else {
            tx.set(ref, {
                ...payload,
                ...extra,
                createdAt: FieldValue.serverTimestamp()
            });
        }

        return { allowed: true, current: next };
    });
}

async function readCounter(db, docId, field = "successCount") {
    const snap = await db.collection("rateLimits").doc(docId).get();
    return snap.exists ? Number(snap.data()[field] || 0) : 0;
}

async function enforceGlobalIpLimit(db, ipHash, bucket) {
    const docId = docIds({ ipHash, bucket }).ipGlobal;
    const result = await incrementCounter(db, docId, {
        max: LIMITS.IP_GLOBAL_REQUESTS_PER_HOUR,
        field: "requestCount",
        type: "ip_global"
    });
    if (!result.allowed) {
        const err = new Error("ip_global_rate_limited");
        err.code = "ip_global_rate_limited";
        throw err;
    }
}

async function enforcePhoneAttemptLimit(db, barberSlug, phoneNorm, bucket) {
    const docId = docIds({ barberSlug, phoneNorm, bucket }).phoneAttempts;
    const result = await incrementCounter(db, docId, {
        max: LIMITS.PHONE_ATTEMPTS_PER_HOUR,
        field: "attempts",
        type: "phone_attempts",
        extra: { barberSlug }
    });
    if (!result.allowed) {
        const err = new Error("phone_rate_limited");
        err.code = "phone_rate_limited";
        throw err;
    }
}

async function checkIpBarberSuccessLimit(db, barberSlug, ipHash, bucket) {
    const docId = docIds({ barberSlug, ipHash, bucket }).ipBarberSuccess;
    const current = await readCounter(db, docId, "successCount");
    if (current >= LIMITS.IP_BARBER_SUCCESS_PER_HOUR) {
        const err = new Error("ip_barber_rate_limited");
        err.code = "ip_barber_rate_limited";
        throw err;
    }
}

async function incrementIpBarberSuccess(db, barberSlug, ipHash, bucket) {
    const docId = docIds({ barberSlug, ipHash, bucket }).ipBarberSuccess;
    const expiresAt = expiresAtHoursFromNow(HOURLY_EXPIRES_HOURS);
    const ref = db.collection("rateLimits").doc(docId);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? Number(snap.data().successCount || 0) : 0;
        const payload = {
            successCount: current + 1,
            type: "ip_barber_success",
            barberSlug,
            updatedAt: FieldValue.serverTimestamp(),
            expiresAt
        };

        if (snap.exists) {
            tx.update(ref, payload);
        } else {
            tx.set(ref, {
                ...payload,
                createdAt: FieldValue.serverTimestamp()
            });
        }
    });
}

const LOGGED_REJECT_REASONS = new Set([
    "phone_rate_limited",
    "ip_barber_rate_limited",
    "ip_global_rate_limited",
    "spam_detected",
    "duplicate_phone_day",
    "slot_taken",
    "rate_limit_error"
]);

async function logRejectedAttempt(db, { barberSlug, phoneNorm, ipHash, reason }) {
    if (!LOGGED_REJECT_REASONS.has(reason)) return;

    try {
        await db.collection("appointmentAttempts").add({
            barberSlug: barberSlug || "",
            phoneHash: phoneNorm ? hashPhone(phoneNorm) : null,
            ipHash: ipHash || null,
            reason,
            createdAt: FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn("[appointmentAttempts]", err.message);
    }
}

function logAppCheckMonitor(request, meta = {}) {
    const hasAppCheck = Boolean(request?.app);
    const payload = {
        status: hasAppCheck ? "present" : "missing",
        appId: request?.app?.appId || null,
        enforce: false,
        function: "createAppointment",
        at: new Date().toISOString(),
        ...meta
    };
    console.info("[App Check Monitor]", payload.status, payload);
    return payload;
}

module.exports = {
    LIMITS,
    getHourBucket,
    hashIp,
    hashPhone,
    extractClientIp,
    enforceGlobalIpLimit,
    enforcePhoneAttemptLimit,
    checkIpBarberSuccessLimit,
    incrementIpBarberSuccess,
    logRejectedAttempt,
    logAppCheckMonitor
};
