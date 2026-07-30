import { PRODUCTION_BASE_URL } from "./linkService.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";
import {
    mapPublicBookingHttpError,
    PUBLIC_BOOKING_ERROR_MESSAGES,
    formatRateLimitMessage
} from "./publicBookingErrors.js";

export { formatRateLimitMessage };

function getApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
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
        throw mapPublicBookingHttpError(response, data);
    }

    if (!data?.ok || !data?.appointmentId) {
        throw mapPublicBookingHttpError(response, { code: "booking_failed", ...data });
    }

    return {
        appointmentId: data.appointmentId,
        appointment: data.appointment || null,
        idempotentReplay: Boolean(data.idempotentReplay)
    };
}

export { PUBLIC_BOOKING_ERROR_MESSAGES as PUBLIC_APPOINTMENT_ERROR_MESSAGES };
