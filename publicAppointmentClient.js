import { PRODUCTION_BASE_URL } from "./linkService.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";

function getApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
}

const GENERIC_RATE_LIMIT_MESSAGE =
    "Kısa sürede çok fazla işlem yapıldı. Lütfen bir süre sonra tekrar deneyin.";

export function formatRateLimitMessage(retryAfterSeconds) {
    const seconds = Number(retryAfterSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return GENERIC_RATE_LIMIT_MESSAGE;
    }
    if (seconds <= 60) {
        return `Çok fazla deneme yapıldı. Yaklaşık ${Math.ceil(seconds)} saniye sonra tekrar deneyin.`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `Çok fazla deneme yapıldı. Yaklaşık ${minutes} dakika sonra tekrar deneyin.`;
}

const API_ERROR_MESSAGES = {
    invalid_request: "Randevu oluşturulamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
    business_not_found: "İşletme bulunamadı.",
    slot_unavailable: "Bu saat kısa süre önce doldu. Lütfen farklı bir saat seçin.",
    rate_limited: GENERIC_RATE_LIMIT_MESSAGE,
    internal_error: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    booking_failed: "Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."
};

function mapApiError(code, payload = {}) {
    let message = API_ERROR_MESSAGES[code] || API_ERROR_MESSAGES.booking_failed;
    if (code === "rate_limited") {
        message = formatRateLimitMessage(payload.retryAfterSeconds);
    }
    const err = new Error(message);
    err.code = code || "booking_failed";
    if (Number.isFinite(payload.retryAfterSeconds)) {
        err.retryAfterSeconds = payload.retryAfterSeconds;
    }
    return err;
}

/**
 * Public booking — secure server-side appointment creation.
 * @param {object} payload
 * @param {string} payload.businessSlug
 * @param {string} payload.customerName
 * @param {string} payload.phone
 * @param {string} payload.service
 * @param {string} payload.date YYYY-MM-DD
 * @param {string} payload.time HH:mm
 * @param {string} [payload.musteriNotu]
 * @param {string} [payload.website] honeypot
 * @param {string} [payload.idempotencyKey]
 */
export async function submitPublicAppointment(payload) {
    const url = `${getApiBaseUrl()}/api/public/create-appointment`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify({
            dukkan: payload.businessSlug,
            customerName: payload.customerName,
            phone: payload.phone,
            service: payload.service,
            date: payload.date,
            time: payload.time,
            musteriNotu: payload.musteriNotu || "",
            website: payload.website || "",
            idempotencyKey: payload.idempotencyKey || ""
        })
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw mapApiError(data?.code || "booking_failed", data || {});
    }

    if (!data?.ok || !data?.appointmentId) {
        throw mapApiError("booking_failed");
    }

    return data.appointmentId;
}

export { API_ERROR_MESSAGES as PUBLIC_APPOINTMENT_ERROR_MESSAGES };
