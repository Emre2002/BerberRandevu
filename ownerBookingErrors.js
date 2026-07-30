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

export function mapOwnerApiError(error) {
    const code = String(error?.code || "INTERNAL_ERROR");
    const message = OWNER_BOOKING_ERROR_MESSAGES[code]
        || error?.message
        || OWNER_BOOKING_ERROR_MESSAGES.INTERNAL_ERROR;
    const mapped = new Error(message);
    mapped.code = code;
    mapped.requestId = error?.requestId || null;
    mapped.status = error?.status || null;
    return mapped;
}
