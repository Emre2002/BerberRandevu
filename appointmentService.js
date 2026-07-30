import { db, isForceClientBookingQuery } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { upsertCustomerOnAppointment, normalizePhone } from "./customerService.js";
import { notifyNewAppointment } from "./notificationService.js";
import { submitPublicAppointment, PUBLIC_APPOINTMENT_ERROR_MESSAGES, formatRateLimitMessage } from "./publicAppointmentClient.js";
import { createOwnerAppointmentViaApi } from "./privilegedApiClient.js";

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled",
    "canceled",
    "iptal",
    "deleted",
    "pasif",
    "inactive"
]);

export function isServerApiBookingEnabled() {
    return shouldUseServerApiBooking({ forceOwner: false });
}

/** @deprecated use isServerApiBookingEnabled */
export function isCfBookingEnabled() {
    return isServerApiBookingEnabled();
}

export function shouldUseServerApiBooking({ forceOwner = false } = {}) {
    if (forceOwner) return false;
    if (typeof window === "undefined") return true;
    if (isForceClientBookingQuery()) return false;
    return true;
}

export const BOOKING_ERROR_MESSAGES = {
    invalid_request: "Randevu oluşturulamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
    invalid_phone: "Geçerli bir Türk cep telefonu numarası girin.",
    invalid_service: "Seçilen hizmet bu işletme için geçerli değil.",
    invalid_slot: "Seçilen saat geçerli değil.",
    invalid_time: "Seçilen saat geçerli değil.",
    shop_not_found: "İşletme bulunamadı.",
    shop_passive: "Bu işletme geçici olarak hizmet vermemektedir.",
    booking_closed: "Bu işletmenin online randevu sistemi geçici olarak kapalıdır.",
    slot_taken: "Bu saat kısa süre önce doldu. Lütfen farklı bir saat seçin.",
    slot_blocked: "Seçilen saat kapalıdır.",
    day_closed: "Berberimiz bu gün izinlidir. Lütfen başka bir gün seçiniz.",
    duplicate_phone_day:
        "Bu telefon numarası ile bugün için zaten bir randevu bulunmaktadır. Gün içerisinde yalnızca 1 randevu oluşturabilirsiniz.",
    spam_detected: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    phone_rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    ip_barber_rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    ip_global_rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    rate_limit_error: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    slot_unavailable: "Bu saat kısa süre önce doldu. Lütfen farklı bir saat seçin.",
    business_not_found: "İşletme bulunamadı.",
    internal: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    booking_failed: "Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."
};

/** @deprecated use BOOKING_ERROR_MESSAGES */
export const CF_BOOKING_ERROR_MESSAGES = BOOKING_ERROR_MESSAGES;

function toUserFacingError(error) {
    const code = String(error?.code || "");
    if (code === "rate_limited" && Number.isFinite(error?.retryAfterSeconds)) {
        const mapped = new Error(formatRateLimitMessage(error.retryAfterSeconds));
        mapped.code = code;
        mapped.retryAfterSeconds = error.retryAfterSeconds;
        return mapped;
    }
    if (code && BOOKING_ERROR_MESSAGES[code]) {
        const mapped = new Error(BOOKING_ERROR_MESSAGES[code]);
        mapped.code = code;
        return mapped;
    }
    if (code && PUBLIC_APPOINTMENT_ERROR_MESSAGES[code]) {
        const mapped = new Error(PUBLIC_APPOINTMENT_ERROR_MESSAGES[code]);
        mapped.code = code;
        return mapped;
    }
    if (error instanceof Error && error.message) {
        return error;
    }
    const fallback = new Error(BOOKING_ERROR_MESSAGES.booking_failed);
    fallback.code = "booking_failed";
    return fallback;
}

export function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

export function findActiveAppointmentByPhoneOnDay({ appointments, phone }) {
    const targetPhone = normalizePhone(phone);
    if (!targetPhone || !appointments) return null;

    for (const appt of Object.values(appointments)) {
        if (!appt || !isActiveAppointmentStatus(appt.status)) continue;
        if (normalizePhone(appt.phone) !== targetPhone) continue;
        return appt;
    }
    return null;
}

/** Emulator-only rollback: ?forceClientBooking=1 */
export async function createAppointmentViaClient({
    barberId,
    customerName,
    phone,
    service,
    date,
    time,
    status = "confirmed",
    musteriNotu = ""
}) {
    const ref = await addDoc(collection(db, "appointments"), {
        barberId,
        customerName,
        phone,
        service,
        date,
        time,
        status,
        musteriNotu: musteriNotu || ""
    });

    const cleanPhone = phone && phone !== "—" ? phone : null;

    if (cleanPhone) {
        await upsertCustomerOnAppointment({
            barberSlug: barberId,
            customerName,
            phone: cleanPhone,
            appointmentDate: date
        });
    }

    await notifyNewAppointment({
        barberSlug: barberId,
        customerName,
        phone: cleanPhone || "—",
        date,
        time
    });

    return ref.id;
}

export async function createAppointmentViaServerApi(payload) {
    return submitPublicAppointment({
        businessSlug: payload.barberSlug || payload.barberId,
        customerName: payload.customerName,
        phone: payload.phone,
        service: payload.service,
        date: payload.date,
        time: payload.time,
        musteriNotu: payload.musteriNotu || "",
        website: payload.website || "",
        idempotencyKey: payload.idempotencyKey || ""
    });
}

export async function createAppointmentViaOwnerApi(payload) {
    const data = await createOwnerAppointmentViaApi({
        customerName: payload.customerName,
        phone: payload.phone,
        service: payload.service,
        date: payload.date,
        time: payload.time,
        musteriNotu: payload.musteriNotu || "",
        idempotencyKey: payload.idempotencyKey || ""
    });
    return data?.appointmentId || null;
}

export async function createAppointmentWithEffects(params) {
    const {
        forceOwner = false,
        website = "",
        barberId,
        idempotencyKey = "",
        ...rest
    } = params;

    const serverPayload = {
        barberId,
        barberSlug: barberId,
        ...rest,
        musteriNotu: params.musteriNotu ?? "",
        website,
        idempotencyKey
    };

    if (forceOwner) {
        try {
            return await createAppointmentViaOwnerApi(serverPayload);
        } catch (error) {
            throw toUserFacingError(error);
        }
    }

    if (!shouldUseServerApiBooking({ forceOwner: false })) {
        return createAppointmentViaClient({
            barberId,
            ...rest,
            status: params.status ?? "confirmed",
            musteriNotu: params.musteriNotu ?? ""
        });
    }

    try {
        return await createAppointmentViaServerApi(serverPayload);
    } catch (error) {
        throw toUserFacingError(error);
    }
}
