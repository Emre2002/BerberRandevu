/**
 * Public booking error mapping — safe for customer-facing pages.
 * Must never throw; must not depend on owner-only modules.
 */

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

export const PUBLIC_BOOKING_ERROR_MESSAGES = {
    SLOT_UNAVAILABLE: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    slot_unavailable: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    slot_taken: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    slot_blocked: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    day_closed: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
    duplicate_phone_day: "Bu telefon numarası ile bugün için zaten bir randevu bulunmaktadır. Gün içerisinde yalnızca 1 randevu oluşturabilirsiniz.",

    APPOINTMENT_IN_PAST: "Geçmiş bir tarih veya saate randevu oluşturulamaz.",
    appointment_in_past: "Geçmiş bir tarih veya saate randevu oluşturulamaz.",

    INVALID_PHONE: "Telefon numarası geçerli değil.",
    invalid_phone: "Telefon numarası geçerli değil.",

    INVALID_SERVICE: "Seçilen hizmet artık kullanılamıyor.",
    invalid_service: "Seçilen hizmet artık kullanılamıyor.",

    VALIDATION_ERROR: "Lütfen randevu bilgilerini kontrol edin.",
    invalid_request: "Lütfen randevu bilgilerini kontrol edin.",
    invalid_slot: "Lütfen randevu bilgilerini kontrol edin.",
    invalid_time: "Lütfen randevu bilgilerini kontrol edin.",

    RATE_LIMITED: "Çok fazla işlem yapıldı. Lütfen kısa süre sonra tekrar deneyin.",
    rate_limited: "Çok fazla işlem yapıldı. Lütfen kısa süre sonra tekrar deneyin.",

    BUSINESS_NOT_FOUND: "İşletme bilgileri bulunamadı.",
    business_not_found: "İşletme bilgileri bulunamadı.",

    INTERNAL_ERROR: "Randevu oluşturulurken beklenmeyen bir hata oluştu.",
    internal_error: "Randevu oluşturulurken beklenmeyen bir hata oluştu.",
    booking_failed: "Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."
};

const TECHNICAL_UI_PATTERN = /^(ReferenceError|TypeError|SyntaxError|Error:|FirebaseError|\[firebase)/i;

const SLOT_CONFLICT_CODES = new Set([
    "slot_unavailable",
    "slot_taken",
    "slot_blocked",
    "day_closed"
]);

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPublicSlotConflictError(err) {
    const status = Number(err?.status);
    const code = String(err?.code || "").toLowerCase();
    return status === 409 || SLOT_CONFLICT_CODES.has(code);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPublicDuplicatePhoneError(err) {
    return String(err?.code || "").toLowerCase() === "duplicate_phone_day";
}

/**
 * Always returns a safe Turkish string for customer UI.
 * @param {unknown} err
 * @returns {string}
 */
export function resolvePublicBookingUserMessage(err) {
    try {
        const code = String(err?.code || "");
        if (code && PUBLIC_BOOKING_ERROR_MESSAGES[code]) {
            let message = PUBLIC_BOOKING_ERROR_MESSAGES[code];
            const requestId = err?.requestId;
            if (requestId && (code === "internal_error" || code === "booking_failed" || code === "INTERNAL_ERROR")) {
                message += ` (Ref: ${String(requestId).slice(0, 8)})`;
            }
            return message;
        }

        const serverMessage = String(err?.message || "").trim();
        if (serverMessage && !TECHNICAL_UI_PATTERN.test(serverMessage)) {
            return serverMessage;
        }
    } catch {
        // fall through
    }
    return PUBLIC_BOOKING_ERROR_MESSAGES.booking_failed;
}

/**
 * Map a failed public create-appointment HTTP response to a structured Error.
 * @param {Response} response
 * @param {object|null} data
 * @returns {Error}
 */
export function mapPublicBookingHttpError(response, data = null) {
    const payload = data && typeof data === "object" ? data : {};
    const code = String(payload.code || payload.error || "booking_failed");
    const status = Number(response?.status) || 0;
    const requestId = payload.requestId
        || response?.headers?.get?.("x-request-id")
        || null;

    let message = String(payload.message || "").trim();
    if (!message || TECHNICAL_UI_PATTERN.test(message)) {
        message = PUBLIC_BOOKING_ERROR_MESSAGES[code]
            || PUBLIC_BOOKING_ERROR_MESSAGES.booking_failed;
    }

    if (code === "rate_limited" && Number.isFinite(payload.retryAfterSeconds)) {
        message = formatRateLimitMessage(payload.retryAfterSeconds);
    }

    const err = new Error(message);
    err.code = code;
    err.status = status;
    err.requestId = requestId;
    if (Number.isFinite(payload.retryAfterSeconds)) {
        err.retryAfterSeconds = payload.retryAfterSeconds;
    }
    return err;
}

/** @deprecated use PUBLIC_BOOKING_ERROR_MESSAGES */
export const PUBLIC_APPOINTMENT_ERROR_MESSAGES = PUBLIC_BOOKING_ERROR_MESSAGES;
