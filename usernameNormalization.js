/**
 * Merkezi username normalizasyonu (Phase 1).
 * Phase 2'de berber login ve güvenilir CF ile aynı sonucu üretmeli.
 * Sentetik e-posta üretimi burada yapılmaz — yalnız Admin SDK/CF (Phase 2).
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/** İzin verilen karakterler: a-z, 0-9, . _ - */
export const USERNAME_ALLOWED_PATTERN = /^[a-z0-9._-]+$/;

/**
 * Deterministik normalizasyon: trim, NFKC, tr-TR lowercase (I→ı, İ→i).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeUsername(raw) {
    if (raw == null) return "";
    const trimmed = String(raw).trim().normalize("NFKC");
    if (!trimmed) return "";
    return trimmed.toLocaleLowerCase("tr-TR");
}

/**
 * @param {string} normalized
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateNormalizedUsername(normalized) {
    if (!normalized) return { ok: false, reason: "empty" };
    if (normalized.length < USERNAME_MIN_LENGTH) return { ok: false, reason: "too_short" };
    if (normalized.length > USERNAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
    if (!USERNAME_ALLOWED_PATTERN.test(normalized)) return { ok: false, reason: "invalid_chars" };
    return { ok: true };
}

/**
 * @param {unknown} raw
 * @returns {{ normalized: string, ok: boolean, reason?: string }}
 */
export function normalizeAndValidateUsername(raw) {
    const normalized = normalizeUsername(raw);
    const validation = validateNormalizedUsername(normalized);
    if (!validation.ok) {
        return { normalized, ok: false, reason: validation.reason };
    }
    return { normalized, ok: true };
}
