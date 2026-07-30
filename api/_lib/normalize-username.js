export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_ALLOWED_PATTERN = /^[a-z0-9._-]+$/;

export function normalizeUsername(raw) {
    if (raw == null) return "";
    const trimmed = String(raw).trim().normalize("NFKC");
    if (!trimmed) return "";
    return trimmed.toLocaleLowerCase("tr-TR");
}

export function normalizeAndValidateUsername(raw) {
    const normalized = normalizeUsername(raw);
    if (!normalized) return { normalized, ok: false, reason: "empty" };
    if (normalized.length < USERNAME_MIN_LENGTH) return { normalized, ok: false, reason: "too_short" };
    if (normalized.length > USERNAME_MAX_LENGTH) return { normalized, ok: false, reason: "too_long" };
    if (!USERNAME_ALLOWED_PATTERN.test(normalized)) return { normalized, ok: false, reason: "invalid_chars" };
    return { normalized, ok: true };
}
