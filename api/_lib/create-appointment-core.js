import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
    generateHourlySlots,
    validateAvailabilityDate
} from "./availability.js";
import {
    checkIpBarberSuccessLimit,
    enforceGlobalIpLimit,
    enforcePhoneAttemptLimit,
    getHourBucket,
    hashIp,
    incrementIpBarberSuccess
} from "./booking-rate-limit.js";
import { resolvePublicBusinessSlug } from "./resolve-public-business-slug.js";

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
    duplicate_phone_day: "slot_unavailable",
    spam_detected: "invalid_request",
    rate_limited: "rate_limited",
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

function istanbulNowParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const pick = (type) => parts.find((p) => p.type === type)?.value || "00";
    return {
        date: `${pick("year")}-${pick("month")}-${pick("day")}`,
        hour: pick("hour"),
        minute: pick("minute")
    };
}

function isPastSlot(date, time) {
    const now = istanbulNowParts();
    if (date < now.date) return true;
    if (date > now.date) return false;
    const [h, m] = time.split(":").map(Number);
    const nowMinutes = Number(now.hour) * 60 + Number(now.minute);
    return h * 60 + m <= nowMinutes;
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
export async function createPublicAppointment(db, input, { clientIp = "unknown" } = {}) {
    const rawSlug = String(input.dukkan || input.shop || input.barberSlug || input.businessId || "").trim();
    const customerName = cleanDisplayName(input.customerName);
    const phoneRaw = String(input.phone || "").trim();
    const service = String(input.service || "").trim();
    const date = String(input.date || "").trim();
    const time = String(input.time || "").trim();
    const musteriNotu = String(input.musteriNotu || "").trim();
    const website = String(input.website || "").trim();
    const idempotencyKey = String(input.idempotencyKey || input.requestId || "").trim();

    const ipHash = hashIp(clientIp);
    const hourBucket = getHourBucket();

    await enforceGlobalIpLimit(db, ipHash, hourBucket);

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

    if (customerName.length < 2 || customerName.length > 80) {
        const err = new Error("invalid_request");
        err.code = "invalid_request";
        throw err;
    }

    if (!isValidTurkishPhone(phoneRaw)) {
        const err = new Error("invalid_request");
        err.code = "invalid_phone";
        throw err;
    }

    const dateCheck = validateAvailabilityDate(date);
    if (!dateCheck.ok) {
        const err = new Error("invalid_request");
        err.code = "invalid_request";
        throw err;
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
        const err = new Error("invalid_request");
        err.code = "invalid_slot";
        throw err;
    }

    if (isPastSlot(date, time)) {
        const err = new Error("invalid_request");
        err.code = "invalid_slot";
        throw err;
    }

    if (!service) {
        const err = new Error("invalid_request");
        err.code = "invalid_service";
        throw err;
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    const displayPhone = phoneRaw.replace(/\s/g, "");

    await enforcePhoneAttemptLimit(db, businessId, normalizedPhone, hourBucket);

    const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
    const publicBarber = publicSnap.data() || {};

    if (publicBarber.status === "passive") {
        const err = new Error("invalid_request");
        err.code = "shop_passive";
        throw err;
    }

    if (publicBarber.bookingOpen !== true) {
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

    await checkIpBarberSuccessLimit(db, businessId, ipHash, hourBucket);

    const idempotencyDocId = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : null;
    if (idempotencyDocId) {
        const idemSnap = await db.collection("appointmentIdempotency").doc(idempotencyDocId).get();
        if (idemSnap.exists) {
            const existingId = String(idemSnap.data()?.appointmentId || "").trim();
            if (existingId) {
                return {
                    ok: true,
                    appointmentId: existingId,
                    businessId,
                    idempotentReplay: true
                };
            }
        }
    }

    const lockId = slotLockId(businessId, date, time);
    const lockRef = db.collection("appointmentSlotLocks").doc(lockId);
    const appointmentRef = db.collection("appointments").doc();
    const idempotencyRef = idempotencyDocId
        ? db.collection("appointmentIdempotency").doc(idempotencyDocId)
        : null;

    try {
        await db.runTransaction(async (tx) => {
            const lockSnap = await tx.get(lockRef);
            if (lockSnap.exists) {
                const err = new Error("slot_unavailable");
                err.code = "slot_taken";
                throw err;
            }

            if (idempotencyRef) {
                const idemSnap = await tx.get(idempotencyRef);
                if (idemSnap.exists) {
                    const existingId = String(idemSnap.data()?.appointmentId || "").trim();
                    if (existingId) {
                        return existingId;
                    }
                }
            }

            const appointmentsSnap = await tx.get(
                db.collection("appointments")
                    .where("barberId", "==", businessId)
                    .where("date", "==", date)
            );

            for (const docSnap of appointmentsSnap.docs) {
                const appt = docSnap.data();
                if (appt.time === time && isActiveAppointmentStatus(appt.status)) {
                    const err = new Error("slot_unavailable");
                    err.code = "slot_taken";
                    throw err;
                }
                if (
                    isActiveAppointmentStatus(appt.status)
                    && normalizePhone(appt.phone) === normalizedPhone
                ) {
                    const err = new Error("slot_unavailable");
                    err.code = "duplicate_phone_day";
                    throw err;
                }
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
        });
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

    try {
        await incrementIpBarberSuccess(db, businessId, ipHash, hourBucket);
    } catch (err) {
        console.warn("[create-appointment] success counter failed:", err?.code || "internal");
    }

    return {
        ok: true,
        appointmentId: appointmentRef.id,
        businessId,
        notificationQueued: true
    };
}

export function mapBookingErrorToHttp(err) {
    const code = err?.code || "internal_error";
    if (code === "business_not_found") {
        return { status: 404, body: { ok: false, code: "business_not_found" } };
    }
    if (code === "rate_limited") {
        return { status: 429, body: { ok: false, code: "rate_limited" } };
    }
    if (
        code === "slot_taken"
        || code === "slot_blocked"
        || code === "day_closed"
        || code === "duplicate_phone_day"
    ) {
        return { status: 409, body: { ok: false, code: "slot_unavailable" } };
    }
    if (
        code === "invalid_request"
        || code === "invalid_phone"
        || code === "invalid_service"
        || code === "invalid_slot"
        || code === "shop_passive"
        || code === "booking_closed"
        || code === "spam_detected"
    ) {
        return { status: 400, body: { ok: false, code: "invalid_request" } };
    }
    return { status: 500, body: { ok: false, code: "internal_error" } };
}
