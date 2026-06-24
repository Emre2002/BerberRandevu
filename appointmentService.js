import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, getCreateAppointmentCallable, shouldUseCallableBooking } from "./firebase-config.js";
import { upsertCustomerOnAppointment, normalizePhone } from "./customerService.js";
import { notifyNewAppointment } from "./notificationService.js";

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled",
    "canceled",
    "iptal",
    "deleted",
    "pasif",
    "inactive"
]);

/** Müşteri randevu varsayılan CF yolu aktif mi? */
export function isCfBookingEnabled() {
    return shouldUseCallableBooking({ forceClient: false });
}

/** CF başarısız olunca client fallback yapılmaması gereken iş/güvenlik kodları. */
const NO_FALLBACK_BOOKING_CODES = new Set([
    "invalid_request",
    "invalid_phone",
    "invalid_service",
    "invalid_slot",
    "invalid_time",
    "shop_not_found",
    "shop_passive",
    "booking_closed",
    "slot_taken",
    "slot_blocked",
    "day_closed",
    "duplicate_phone_day",
    "spam_detected",
    "phone_rate_limited",
    "ip_barber_rate_limited",
    "ip_global_rate_limited",
    "rate_limit_error",
    "permission-denied"
]);

/** Yalnızca bu teknik hatalarda client fallback denenir. */
const TECHNICAL_FALLBACK_FN_CODES = new Set([
    "functions/unavailable",
    "functions/internal",
    "functions/deadline-exceeded",
    "functions/not-found",
    "functions_unavailable",
    "network-request-failed",
    "deadline-exceeded"
]);

export const CF_BOOKING_ERROR_MESSAGES = {
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
    internal: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    functions_unavailable: "Randevu servisi şu an kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
    booking_failed: "Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."
};

function extractBookingCode(error) {
    if (error?.code && NO_FALLBACK_BOOKING_CODES.has(error.code)) {
        return error.code;
    }
    const details = error?.details;
    if (typeof details === "object" && details?.code) {
        return details.code;
    }
    if (typeof details === "string" && CF_BOOKING_ERROR_MESSAGES[details]) {
        return details;
    }
    return null;
}

function mapCallableBookingError(error) {
    const bookingCode = extractBookingCode(error);

    if (bookingCode && CF_BOOKING_ERROR_MESSAGES[bookingCode]) {
        const mapped = new Error(CF_BOOKING_ERROR_MESSAGES[bookingCode]);
        mapped.code = bookingCode;
        return mapped;
    }

    if (error?.message && CF_BOOKING_ERROR_MESSAGES[error.message]) {
        const mapped = new Error(CF_BOOKING_ERROR_MESSAGES[error.message]);
        mapped.code = error.message;
        return mapped;
    }

    return error;
}

function isNonFallbackBookingError(error) {
    const bookingCode = extractBookingCode(error);
    if (bookingCode && NO_FALLBACK_BOOKING_CODES.has(bookingCode)) {
        return true;
    }

    const fnCode = String(error?.code || "");
    if (fnCode === "permission-denied" || fnCode === "functions/permission-denied") {
        return true;
    }
    if (fnCode === "functions/failed-precondition") {
        return true;
    }

    return false;
}

function isTechnicalFallbackEligible(error) {
    if (isNonFallbackBookingError(error)) {
        return false;
    }

    const fnCode = String(error?.code || "");
    if (TECHNICAL_FALLBACK_FN_CODES.has(fnCode)) {
        return true;
    }

    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("timeout")) {
        return true;
    }

    return false;
}

function toUserFacingError(error) {
    if (error instanceof Error && error.message && !String(error.code || "").startsWith("functions/")) {
        return error;
    }
    const mapped = mapCallableBookingError(error);
    if (mapped instanceof Error && mapped.message) {
        return mapped;
    }
    const fallback = new Error(CF_BOOKING_ERROR_MESSAGES.booking_failed);
    fallback.code = "booking_failed";
    return fallback;
}

/** Silinmiş / iptal edilmiş randevular hariç aktif kabul edilir. */
export function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

/**
 * Aynı gün için önceden yüklenmiş randevu haritasında telefon eşleşmesi arar.
 * Ek Firestore read gerektirmez; barberId + date filtresi getDayData tarafından sağlanır.
 */
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

/** Mevcut client-side Firestore yazma yolu. */
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

/** Cloud Function createAppointment callable yolu. */
export async function createAppointmentViaCallable({
    barberId,
    barberSlug,
    customerName,
    phone,
    service,
    date,
    time,
    musteriNotu = "",
    website = ""
}) {
    const callable = await getCreateAppointmentCallable({ forceClient: false });
    if (!callable) {
        const err = new Error(CF_BOOKING_ERROR_MESSAGES.functions_unavailable);
        err.code = "functions_unavailable";
        throw err;
    }

    try {
        const result = await callable({
            barberSlug: barberSlug || barberId,
            customerName,
            phone,
            service,
            date,
            time,
            musteriNotu: musteriNotu || "",
            website: website || ""
        });
        return result.data?.appointmentId || null;
    } catch (error) {
        if (isNonFallbackBookingError(error)) {
            throw mapCallableBookingError(error);
        }
        throw error;
    }
}

const clientPayloadKeys = [
    "barberId",
    "customerName",
    "phone",
    "service",
    "date",
    "time",
    "status",
    "musteriNotu"
];

function pickClientPayload(params) {
    const payload = {};
    for (const key of clientPayloadKeys) {
        if (params[key] !== undefined) payload[key] = params[key];
    }
    return payload;
}

/**
 * Randevu oluşturur; müşteri DB, bildirim ve Telegram yan etkilerini tetikler.
 * Varsayılan (Faz 5C-C4): Cloud Function. Rollback: ?cfBooking=0 veya ?forceClientBooking=1
 * Admin paneli: forceClient: true ile her zaman client yolu.
 */
export async function createAppointmentWithEffects(params) {
    const {
        forceClient = false,
        website = "",
        barberId,
        ...rest
    } = params;

    const clientPayload = pickClientPayload({
        barberId,
        ...rest,
        status: params.status ?? "confirmed",
        musteriNotu: params.musteriNotu ?? ""
    });

    const callablePayload = {
        barberId,
        barberSlug: barberId,
        ...rest,
        musteriNotu: params.musteriNotu ?? "",
        website
    };

    const useCallable = shouldUseCallableBooking({ forceClient });

    if (!useCallable) {
        return createAppointmentViaClient(clientPayload);
    }

    try {
        return await createAppointmentViaCallable(callablePayload);
    } catch (error) {
        if (!isTechnicalFallbackEligible(error)) {
            throw toUserFacingError(error);
        }

        console.info("[Booking] CF unavailable, falling back to client path");

        try {
            return await createAppointmentViaClient(clientPayload);
        } catch (clientError) {
            console.warn("[Booking] Client fallback failed:", clientError?.message || clientError);
            const failed = new Error(CF_BOOKING_ERROR_MESSAGES.booking_failed);
            failed.code = "booking_failed";
            throw failed;
        }
    }
}
