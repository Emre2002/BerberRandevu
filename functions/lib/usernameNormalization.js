/**
 * Canonical username normalizasyonu — client usernameNormalization.js ile aynı algoritma.
 * Sentetik e-posta üretimi bu modülde yapılmaz.
 */

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const USERNAME_ALLOWED_PATTERN = /^[a-z0-9._-]+$/;

function normalizeUsername(raw) {
    if (raw == null) return "";
    const trimmed = String(raw).trim().normalize("NFKC");
    if (!trimmed) return "";
    return trimmed.toLocaleLowerCase("tr-TR");
}

function validateNormalizedUsername(normalized) {
    if (!normalized) return { ok: false, reason: "empty" };
    if (normalized.length < USERNAME_MIN_LENGTH) return { ok: false, reason: "too_short" };
    if (normalized.length > USERNAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
    if (!USERNAME_ALLOWED_PATTERN.test(normalized)) return { ok: false, reason: "invalid_chars" };
    return { ok: true };
}

function normalizeAndValidateUsername(raw) {
    const normalized = normalizeUsername(raw);
    const validation = validateNormalizedUsername(normalized);
    if (!validation.ok) {
        return { normalized, ok: false, reason: validation.reason };
    }
    return { normalized, ok: true };
}

module.exports = {
    USERNAME_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    USERNAME_ALLOWED_PATTERN,
    normalizeUsername,
    validateNormalizedUsername,
    normalizeAndValidateUsername
};
