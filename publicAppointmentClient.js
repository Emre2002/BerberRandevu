import { PRODUCTION_BASE_URL } from "./linkService.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";

function getApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
}

const API_ERROR_MESSAGES = {
    invalid_request: "Randevu oluşturulamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
    business_not_found: "İşletme bulunamadı.",
    slot_unavailable: "Bu saat kısa süre önce doldu. Lütfen farklı bir saat seçin.",
    rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    internal_error: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    booking_failed: "Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."
};

function mapApiError(code) {
    const message = API_ERROR_MESSAGES[code] || API_ERROR_MESSAGES.booking_failed;
    const err = new Error(message);
    err.code = code || "booking_failed";
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
        throw mapApiError(data?.code || "booking_failed");
    }

    if (!data?.ok || !data?.appointmentId) {
        throw mapApiError("booking_failed");
    }

    return data.appointmentId;
}

export { API_ERROR_MESSAGES as PUBLIC_APPOINTMENT_ERROR_MESSAGES };
