import { buildRateLimitHeaders } from "./http.js";

export const OWNER_BOOKING_ERROR_MESSAGES = {
    APPOINTMENT_IN_PAST: "Geçmiş bir tarih veya saate randevu oluşturulamaz.",
    VALIDATION_ERROR: "Lütfen randevu bilgilerini kontrol edin.",
    INVALID_PHONE: "Telefon numarası geçerli değil.",
    INVALID_SERVICE: "Seçilen hizmet artık kullanılamıyor.",
    SLOT_UNAVAILABLE: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    UNAUTHENTICATED: "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
    FORBIDDEN: "Bu işletme için randevu oluşturma yetkiniz yok.",
    RATE_LIMITED: "Çok fazla işlem yapıldı. Lütfen kısa süre sonra tekrar deneyin.",
    INTERNAL_ERROR: "Randevu oluşturulurken beklenmeyen bir hata oluştu."
};

const INTERNAL_TO_OWNER = {
    appointment_in_past: "APPOINTMENT_IN_PAST",
    invalid_request: "VALIDATION_ERROR",
    invalid_phone: "INVALID_PHONE",
    invalid_service: "INVALID_SERVICE",
    invalid_slot: "VALIDATION_ERROR",
    shop_passive: "VALIDATION_ERROR",
    booking_closed: "VALIDATION_ERROR",
    slot_taken: "SLOT_UNAVAILABLE",
    slot_blocked: "SLOT_UNAVAILABLE",
    day_closed: "SLOT_UNAVAILABLE",
    duplicate_phone_day: "SLOT_UNAVAILABLE",
    rate_limited: "RATE_LIMITED",
    business_not_found: "FORBIDDEN",
    internal_error: "INTERNAL_ERROR"
};

export function mapOwnerAuthError(authResult, requestId) {
    if (authResult.status === 401) {
        return {
            status: 401,
            body: {
                ok: false,
                code: "UNAUTHENTICATED",
                message: OWNER_BOOKING_ERROR_MESSAGES.UNAUTHENTICATED,
                requestId
            }
        };
    }
    return {
        status: 403,
        body: {
            ok: false,
            code: "FORBIDDEN",
            message: OWNER_BOOKING_ERROR_MESSAGES.FORBIDDEN,
            requestId
        }
    };
}

export function mapOwnerBookingErrorToHttp(err, requestId) {
    const internalCode = String(err?.code || "internal_error");
    const ownerCode = INTERNAL_TO_OWNER[internalCode] || "INTERNAL_ERROR";
    const message = OWNER_BOOKING_ERROR_MESSAGES[ownerCode] || OWNER_BOOKING_ERROR_MESSAGES.INTERNAL_ERROR;

    if (ownerCode === "RATE_LIMITED") {
        const retryAfterSeconds = Number.isFinite(err?.retryAfterSeconds)
            ? err.retryAfterSeconds
            : null;
        return {
            status: 429,
            headers: buildRateLimitHeaders({
                limit: err?.rateLimitLimit,
                remaining: 0,
                retryAfterSeconds,
                resetAtSeconds: err?.rateLimitReset
            }),
            body: {
                ok: false,
                code: ownerCode,
                message: OWNER_BOOKING_ERROR_MESSAGES.RATE_LIMITED,
                retryAfterSeconds,
                requestId
            }
        };
    }

    if (ownerCode === "SLOT_UNAVAILABLE") {
        return {
            status: 409,
            body: { ok: false, code: ownerCode, message, requestId }
        };
    }

    if (ownerCode === "INTERNAL_ERROR") {
        return {
            status: 500,
            body: { ok: false, code: ownerCode, message, requestId }
        };
    }

    return {
        status: 400,
        body: { ok: false, code: ownerCode, message, requestId }
    };
}
