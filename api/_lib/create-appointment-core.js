import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
    isPastAppointmentSlot,
    normalizeTimeHHmm,
    validateAppointmentDate
} from "./appointment-datetime.js";
import { generateHourlySlots } from "./availability.js";
import {
    assertSuccessQuotaAvailable,
    buildSuccessCounterWritePayload,
    enforceBookingAttemptLimit,
    enforceCreateIpBusinessBurstLimit,
    readSuccessCounterState,
    resolveSuccessQuotaRefs
} from "./booking-rate-limit.js";
import { resolvePublicBusinessSlug } from "./resolve-public-business-slug.js";
import { buildRateLimitHeaders } from "./http.js";

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled",
    "canceled",
    "iptal",
    "deleted",
    "pasif",
    "inactive"
]);

const DEFAULT_BARBER_SERVICES = [
    "Saç Kesimi & Yıkama",
    "Sakal Tıraşı (Klasik)",
    "Saç-Sakal Kesimi"
];

export const BOOKING_HTTP_MESSAGES = {
    business_not_found: "İşletme bilgileri bulunamadı.",
    slot_unavailable: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    duplicate_phone_day: "Bu telefon numarası ile bugün için zaten bir randevu bulunmaktadır. Gün içerisinde yalnızca 1 randevu oluşturabilirsiniz.",
    appointment_in_past: "Geçmiş bir tarih veya saate randevu oluşturulamaz.",
    invalid_request: "Lütfen randevu bilgilerini kontrol edin.",
    invalid_phone: "Telefon numarası geçerli değil.",
    invalid_service: "Seçilen hizmet artık kullanılamıyor.",
    rate_limited: "Çok fazla işlem yapıldı. Lütfen kısa süre sonra tekrar deneyin.",
    rate_limit_config_error: "Randevu sistemi yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
    internal_error: "Randevu oluşturulurken beklenmeyen bir hata oluştu."
};

function buildErrorBody(code, requestId = null) {
    const body = {
        ok: false,
        code,
        message: BOOKING_HTTP_MESSAGES[code] || BOOKING_HTTP_MESSAGES.internal_error
    };
    if (requestId) body.requestId = requestId;
    return body;
}

export const BOOKING_ERROR_CODES = {
    invalid_request: "invalid_request",
    business_not_found: "business_not_found",
    shop_passive: "invalid_request",
    booking_closed: "invalid_request",
    invalid_phone: "invalid_request",
    invalid_service: "invalid_request",
    invalid_slot: "invalid_request",
    day_closed: "slot_unavailable",
    slot_blocked: "slot_unavailable",
    slot_taken: "slot_unavailable",
    duplicate_phone_day: "duplicate_phone_day",
    spam_detected: "invalid_request",
    rate_limited: "rate_limited",
    rate_limit_config_error: "rate_limit_config_error",
    internal_error: "internal_error"
};

function cleanDisplayName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
}

export function normalizePhone(phone) {
    if (!phone || phone === "—") return "";
    let digits = String(phone).replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

export function isValidTurkishPhone(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (/^(0?5\d{9})$/.test(digits)) return true;
    if (/^(90)(5\d{9})$/.test(digits)) return true;
    return false;
}

function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

function getWorkingHours(barber) {
    return {
        openHour: barber?.openHour || barber?.openingHour || "09:00",
        closeHour: barber?.closeHour || barber?.closingHour || "21:00"
    };
}

function getAllowedServices(barber) {
    const raw = barber?.selectedServices;
    if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((s) => typeof s === "string" && s.trim());
    }
    return [...DEFAULT_BARBER_SERVICES];
}

function blockedSlotId(date, time) {
    return `${date}_${time}`;
}

function slotLockId(businessId, date, time) {
    return `${businessId}__${date}__${time}`;
}

function hashIdempotencyKey(key) {
    return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 40);
}

async function loadBlockedState(db, businessId, date, slots) {
    const blocked = new Set();
    let dayClosed = false;

    const snap = await db
        .collection("berberler")
        .doc(businessId)
        .collection("blockedSlots")
        .where("date", "==", date)
        .get();

    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.time === "ALL") {
            dayClosed = true;
            slots.forEach((t) => blocked.add(t));
        } else if (data.time) {
            blocked.add(data.time);
        }
    });

    if (!dayClosed) {
        const allSnap = await db
            .collection("berberler")
            .doc(businessId)
            .collection("blockedSlots")
            .doc(blockedSlotId(date, "ALL"))
            .get();
        if (allSnap.exists) {
            dayClosed = true;
            slots.forEach((t) => blocked.add(t));
        }
    }

    return { blocked, dayClosed };
}

async function isLegacySlotTaken(db, businessId, date, time) {
    const legacySnap = await db
        .collection("berberler")
        .doc(businessId)
        .collection("appointments")
        .doc(date)
        .get();
    if (!legacySnap.exists) return false;

    const data = legacySnap.data();
    if (data.ALL === "BLOCKED") return true;

    for (const [key, value] of Object.entries(data)) {
        if (key === "ALL") continue;
        const slotTime = /^(\d{2}:\d{2})/.exec(key)?.[1];
        if (slotTime === time && typeof value === "string" && value.trim()) {
            return true;
        }
    }
    return false;
}

async function upsertCustomerOnAppointment(db, { businessId, customerName, phone, appointmentDate }) {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    const customerId = `${businessId}_${normalized}`;
    const ref = db.collection("customers").doc(customerId);
    const snap = await ref.get();
    const variantName = cleanDisplayName(customerName);

    if (snap.exists) {
        await ref.update({
            displayName: variantName || snap.data()?.displayName || "",
            phone: normalized,
            lastAppointmentDate: appointmentDate,
            totalAppointments: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        });
    } else {
        await ref.set({
            barberSlug: businessId,
            displayName: variantName,
            phone: normalized,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            totalAppointments: 1,
            lastAppointmentDate: appointmentDate
        });
    }
}

async function createNotification(db, { businessId, customerName, phone, date, time }) {
    await db.collection("notifications").add({
        type: "newAppointment",
        barberSlug: businessId,
        customerName,
        phone: phone || "—",
        date,
        time,
        read: false,
        createdAt: FieldValue.serverTimestamp()
    });
}

async function maybeSendTelegram(db, { businessId, customerName, phone, date, time }) {
    const barberSnap = await db.collection("berberler").doc(businessId).get();
    const chatId = barberSnap.exists ? barberSnap.data()?.telegramChatId : null;
    if (!chatId) return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const barberName = barberSnap.data()?.name || businessId;
    const text = `Yeni Randevu\nBerber: ${barberName}\nMusteri: ${customerName}\nTelefon: ${phone}\nTarih: ${date}\nSaat: ${time}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
    });
}

async function runBestEffortSideEffects(db, payload) {
    try {
        await upsertCustomerOnAppointment(db, payload);
    } catch (err) {
        console.warn("[create-appointment] customer upsert failed:", err?.code || "internal");
    }

    try {
        await createNotification(db, payload);
    } catch (err) {
        console.warn("[create-appointment] notification failed:", err?.code || "internal");
    }

    try {
        await maybeSendTelegram(db, payload);
    } catch (err) {
        console.warn("[create-appointment] telegram failed:", err?.code || "internal");
    }
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function createPublicAppointment(db, input, { clientIp = "unknown", ownerContext = false } = {}) {
    const rawSlug = String(input.dukkan || input.shop || input.barberSlug || input.businessId || "").trim();
    const customerName = cleanDisplayName(input.customerName);
    const phoneRaw = String(input.phone || "").trim();
    const service = String(input.service || "").trim();
    const date = String(input.date || "").trim();
    const time = normalizeTimeHHmm(String(input.time || "").trim());
    const musteriNotu = String(input.musteriNotu || "").trim();
    const website = String(input.website || "").trim();
    const idempotencyKey = String(input.idempotencyKey || input.requestId || "").trim();

    if (website) {
        const err = new Error("invalid_request");
        err.code = "spam_detected";
        throw err;
    }

    if (!rawSlug) {
        const err = new Error("invalid_request");
        err.code = "invalid_request";
        throw err;
    }

    const businessId = await resolvePublicBusinessSlug(db, rawSlug);
    if (!businessId) {
        const err = new Error("business_not_found");
        err.code = "business_not_found";
        throw err;
    }

    if (!ownerContext) {
        await enforceCreateIpBusinessBurstLimit(db, businessId, clientIp);
    }

    const idempotencyDocId = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : null;
    if (idempotencyDocId) {
        const idemSnap = await db.collection("appointmentIdempotency").doc(idempotencyDocId).get();
        if (idemSnap.exists) {
            const idemData = idemSnap.data() || {};
            const existingId = String(idemData.appointmentId || "").trim();
            const idemBusinessId = String(idemData.businessId || "").trim();
            if (existingId && idemBusinessId === businessId) {
                return {
                    ok: true,
                    appointmentId: existingId,
                    businessId,
                    date: String(idemData.date || date),
                    time: normalizeTimeHHmm(String(idemData.time || time)),
                    status: "confirmed",
                    idempotentReplay: true
                };
            }
        }
    }

    if (customerName.length < 2 || customerName.length > 80) {
        const err = new Error("invalid_request");
        err.code = "invalid_request";
        throw err;
    }

    const phoneOptional = ownerContext && (!phoneRaw || phoneRaw === "—");
    if (!phoneOptional && !isValidTurkishPhone(phoneRaw)) {
        const err = new Error("invalid_request");
        err.code = "invalid_phone";
        throw err;
    }

    const dateCheck = validateAppointmentDate(date);
    if (!dateCheck.ok) {
        const err = new Error("invalid_request");
        if (dateCheck.code === "past_date") {
            err.code = "appointment_in_past";
        } else {
            err.code = "invalid_request";
        }
        throw err;
    }

    if (!time) {
        const err = new Error("invalid_request");
        err.code = "invalid_slot";
        throw err;
    }

    if (isPastAppointmentSlot(date, time)) {
        const err = new Error("invalid_request");
        err.code = "appointment_in_past";
        throw err;
    }

    if (!service) {
        const err = new Error("invalid_request");
        err.code = "invalid_service";
        throw err;
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    const displayPhone = phoneOptional ? "—" : phoneRaw.replace(/\s/g, "");

    if (!ownerContext) {
        await enforceBookingAttemptLimit(db, businessId, normalizedPhone);
    }

    const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
    const publicBarber = publicSnap.data() || {};

    if (publicBarber.status === "passive") {
        const err = new Error("invalid_request");
        err.code = "shop_passive";
        throw err;
    }

    if (!ownerContext && publicBarber.bookingOpen !== true) {
        const err = new Error("invalid_request");
        err.code = "booking_closed";
        throw err;
    }

    const allowedServices = getAllowedServices(publicBarber);
    if (!allowedServices.includes(service)) {
        const err = new Error("invalid_request");
        err.code = "invalid_service";
        throw err;
    }

    const { openHour, closeHour } = getWorkingHours(publicBarber);
    const validSlots = generateHourlySlots(openHour, closeHour);
    if (!validSlots.includes(time)) {
        const err = new Error("invalid_request");
        err.code = "invalid_slot";
        throw err;
    }

    const { blocked, dayClosed } = await loadBlockedState(db, businessId, date, validSlots);
    if (dayClosed || blocked.has(time)) {
        const err = new Error("slot_unavailable");
        err.code = dayClosed ? "day_closed" : "slot_blocked";
        throw err;
    }

    if (await isLegacySlotTaken(db, businessId, date, time)) {
        const err = new Error("slot_unavailable");
        err.code = "slot_taken";
        throw err;
    }

    const lockId = slotLockId(businessId, date, time);
    const lockRef = db.collection("appointmentSlotLocks").doc(lockId);
    const appointmentRef = db.collection("appointments").doc();
    const idempotencyRef = idempotencyDocId
        ? db.collection("appointmentIdempotency").doc(idempotencyDocId)
        : null;
    const quota = !ownerContext
        ? resolveSuccessQuotaRefs(db, businessId, normalizedPhone, clientIp)
        : null;

    let committedAppointmentId = appointmentRef.id;

    try {
        const txnResult = await db.runTransaction(async (tx) => {
            const reads = [
                tx.get(lockRef),
                idempotencyRef ? tx.get(idempotencyRef) : Promise.resolve({ exists: false, data: () => ({}) }),
                tx.get(
                    db.collection("appointments")
                        .where("barberId", "==", businessId)
                        .where("date", "==", date)
                )
            ];

            if (quota) {
                reads.push(tx.get(quota.phone.ref), tx.get(quota.ip.ref));
            }

            const [
                lockSnap,
                idemSnap,
                appointmentsSnap,
                phoneSuccessSnap,
                ipSuccessSnap
            ] = await Promise.all(reads);

            if (idempotencyRef && idemSnap.exists) {
                const existingId = String(idemSnap.data()?.appointmentId || "").trim();
                if (existingId) {
                    return { kind: "replay", appointmentId: existingId };
                }
            }

            let phoneState = null;
            let ipState = null;

            if (quota) {
                phoneState = readSuccessCounterState(phoneSuccessSnap, {
                    limit: quota.phone.limit,
                    requestDay: quota.requestDay,
                    resetAtMs: quota.resetAtMs,
                    nowMs: quota.nowMs,
                    scope: quota.phone.scope
                });
                assertSuccessQuotaAvailable(phoneState, quota.nowMs);

                ipState = readSuccessCounterState(ipSuccessSnap, {
                    limit: quota.ip.limit,
                    requestDay: quota.requestDay,
                    resetAtMs: quota.resetAtMs,
                    nowMs: quota.nowMs,
                    scope: quota.ip.scope
                });
                assertSuccessQuotaAvailable(ipState, quota.nowMs);
            }

            if (lockSnap.exists) {
                const lockData = lockSnap.data() || {};
                const linkedId = String(lockData.appointmentId || "").trim();
                let lockIsActive = false;
                if (linkedId) {
                    const linkedSnap = await tx.get(db.collection("appointments").doc(linkedId));
                    lockIsActive = linkedSnap.exists
                        && isActiveAppointmentStatus(linkedSnap.data()?.status);
                }
                if (lockIsActive) {
                    const err = new Error("slot_unavailable");
                    err.code = "slot_taken";
                    throw err;
                }
                tx.delete(lockRef);
            }

            for (const docSnap of appointmentsSnap.docs) {
                const appt = docSnap.data();
                if (normalizeTimeHHmm(appt.time) === time && isActiveAppointmentStatus(appt.status)) {
                    const err = new Error("slot_unavailable");
                    err.code = "slot_taken";
                    throw err;
                }
                if (
                    !ownerContext
                    && normalizedPhone
                    && isActiveAppointmentStatus(appt.status)
                    && normalizePhone(appt.phone) === normalizedPhone
                ) {
                    const err = new Error("slot_unavailable");
                    err.code = "duplicate_phone_day";
                    throw err;
                }
            }

            if (quota && phoneState && ipState) {
                tx.set(quota.phone.ref, buildSuccessCounterWritePayload({
                    count: phoneState.count + 1,
                    limit: quota.phone.limit,
                    scope: quota.phone.scope,
                    type: quota.phone.type,
                    requestDay: quota.requestDay,
                    resetAtMs: phoneState.resetAtMs,
                    businessId
                }), { merge: true });

                tx.set(quota.ip.ref, buildSuccessCounterWritePayload({
                    count: ipState.count + 1,
                    limit: quota.ip.limit,
                    scope: quota.ip.scope,
                    type: quota.ip.type,
                    requestDay: quota.requestDay,
                    resetAtMs: ipState.resetAtMs,
                    businessId
                }), { merge: true });
            }

            tx.set(lockRef, {
                businessId,
                date,
                time,
                appointmentId: appointmentRef.id,
                createdAt: FieldValue.serverTimestamp()
            });

            tx.set(appointmentRef, {
                barberId: businessId,
                customerName,
                phone: displayPhone,
                service,
                date,
                time,
                status: "confirmed",
                musteriNotu: musteriNotu || "",
                createdAt: FieldValue.serverTimestamp()
            });

            if (idempotencyRef) {
                tx.set(idempotencyRef, {
                    appointmentId: appointmentRef.id,
                    businessId,
                    date,
                    time,
                    createdAt: FieldValue.serverTimestamp()
                });
            }

            return { kind: "created", appointmentId: appointmentRef.id };
        });

        if (txnResult?.kind === "replay") {
            return {
                ok: true,
                appointmentId: txnResult.appointmentId,
                businessId,
                date,
                time,
                status: "confirmed",
                idempotentReplay: true
            };
        }

        committedAppointmentId = txnResult?.appointmentId || appointmentRef.id;
    } catch (err) {
        if (err?.code) throw err;
        const wrapped = new Error("internal_error");
        wrapped.code = "internal_error";
        throw wrapped;
    }

    await runBestEffortSideEffects(db, {
        businessId,
        customerName,
        phone: displayPhone,
        appointmentDate: date,
        date,
        time
    });

    return {
        ok: true,
        appointmentId: committedAppointmentId,
        businessId,
        date,
        time,
        status: "confirmed",
        notificationQueued: !ownerContext
    };
}

export function mapBookingErrorToHttp(err, { requestId = null } = {}) {
    const code = err?.code || "internal_error";
    if (code === "business_not_found") {
        return { status: 404, body: buildErrorBody("business_not_found", requestId) };
    }
    if (code === "rate_limit_config_error") {
        return { status: 503, body: buildErrorBody("rate_limit_config_error", requestId) };
    }
    if (code === "rate_limited") {
        const retryAfterSeconds = Number.isFinite(err?.retryAfterSeconds)
            ? err.retryAfterSeconds
            : null;
        const headers = buildRateLimitHeaders({
            limit: err?.rateLimitLimit,
            remaining: 0,
            retryAfterSeconds,
            resetAtSeconds: err?.rateLimitReset
        });
        return {
            status: 429,
            headers,
            body: {
                ...buildErrorBody("rate_limited", requestId),
                scope: err?.rateLimitScope || null,
                limit: err?.rateLimitLimit ?? null,
                remaining: 0,
                retryAfterSeconds
            }
        };
    }
    if (code === "duplicate_phone_day") {
        return { status: 409, body: buildErrorBody("duplicate_phone_day", requestId) };
    }
    if (
        code === "slot_taken"
        || code === "slot_blocked"
        || code === "day_closed"
    ) {
        return { status: 409, body: buildErrorBody("slot_unavailable", requestId) };
    }
    if (code === "appointment_in_past") {
        return { status: 400, body: buildErrorBody("appointment_in_past", requestId) };
    }
    if (code === "invalid_phone") {
        return { status: 400, body: buildErrorBody("invalid_phone", requestId) };
    }
    if (code === "invalid_service") {
        return { status: 400, body: buildErrorBody("invalid_service", requestId) };
    }
    if (
        code === "invalid_request"
        || code === "invalid_slot"
        || code === "shop_passive"
        || code === "booking_closed"
        || code === "spam_detected"
    ) {
        return { status: 400, body: buildErrorBody("invalid_request", requestId) };
    }
    return { status: 500, body: buildErrorBody("internal_error", requestId) };
}
