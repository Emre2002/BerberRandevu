import {
    normalizeUsername,
    normalizeAndValidateUsername
} from "./usernameNormalization.js";

/** Eski algoritma — yalnız karşılaştırma (Phase 1 öncesi depolama). */
export function legacyNormalizeUsername(raw) {
    if (raw == null) return "";
    return String(raw).trim().toLowerCase();
}

const TURKISH_LETTERS = /[çğıöşüÇĞİIÖŞÜı]/;

function isAsciiOnly(value) {
    return /^[\x20-\x7E]*$/.test(value);
}

function hasTurkishLetters(value) {
    return TURKISH_LETTERS.test(value);
}

function maskUsername(value) {
    if (!value || typeof value !== "string") return "(eksik)";
    if (value.length <= 2) return "*".repeat(value.length);
    return `${value[0]}${"*".repeat(Math.min(value.length - 2, 6))}${value[value.length - 1]}`;
}

/**
 * @param {Array<{slug: string, username?: string}>} records
 */
export function planUsernameMigration(records) {
    const list = Array.isArray(records) ? records : [];
    const changes = [];
    const invalid = [];
    const unchangedList = [];
    const canonicalToSlugs = new Map();

    for (const rec of list) {
        const slug = rec?.slug ?? "";
        const from = typeof rec?.username === "string" ? rec.username : "";
        const to = normalizeUsername(from);

        if (!to) {
            invalid.push({ slug, from, reason: "empty_after_normalize" });
            continue;
        }

        if (!canonicalToSlugs.has(to)) canonicalToSlugs.set(to, []);
        canonicalToSlugs.get(to).push(slug);

        if (from === to) {
            unchangedList.push(slug);
        } else {
            changes.push({ slug, from, to });
        }
    }

    const collisions = [];
    for (const [canonical, slugs] of canonicalToSlugs.entries()) {
        if (slugs.length > 1) {
            collisions.push({ canonical, slugs: [...slugs] });
        }
    }

    return {
        total: list.length,
        unchanged: unchangedList.length,
        changes,
        invalid,
        collisions
    };
}

export function isMigrationSafeToApply(plan) {
    if (!plan) return false;
    return plan.collisions.length === 0 && plan.invalid.length === 0;
}

/**
 * Genişletilmiş dry-run envanteri (yazma yok; password alanı okunmaz/işlenmez).
 * @param {Array<{slug: string, username?: string}>} records
 */
export function runUsernameDryRun(records) {
    const list = Array.isArray(records) ? records : [];
    const base = planUsernameMigration(list);

    const missingUsername = [];
    const legacyDiffers = [];
    const validCanonical = [];
    const invalidCanonical = [];
    const asciiOnly = [];
    const withTurkishChars = [];
    const safeForAutoMigration = [];
    const requiresManualReview = [];

    const collisionSlugs = new Set();
    for (const c of base.collisions) {
        for (const s of c.slugs) collisionSlugs.add(s);
    }
    const invalidSlugs = new Set(base.invalid.map((i) => i.slug));

    for (const rec of list) {
        const slug = rec?.slug ?? "";
        const raw = rec?.username;

        if (raw == null || raw === "") {
            missingUsername.push({ slug });
            requiresManualReview.push({ slug, reasons: ["missing_username"] });
            continue;
        }

        const from = String(raw);
        const canonical = normalizeUsername(from);
        const legacy = legacyNormalizeUsername(from);
        const validated = normalizeAndValidateUsername(from);

        if (legacy !== canonical) {
            legacyDiffers.push({
                slug,
                legacy,
                canonical,
                usernameMasked: maskUsername(from)
            });
        }

        if (isAsciiOnly(from)) asciiOnly.push(slug);
        if (hasTurkishLetters(from)) withTurkishChars.push(slug);

        if (validated.ok) {
            validCanonical.push({ slug, canonical });
        } else {
            invalidCanonical.push({ slug, reason: validated.reason, usernameMasked: maskUsername(from) });
            const existing = requiresManualReview.find((r) => r.slug === slug);
            const invReason = `invalid_${validated.reason}`;
            if (existing) {
                if (!existing.reasons.includes(invReason)) existing.reasons.push(invReason);
            } else {
                requiresManualReview.push({ slug, reasons: [invReason] });
            }
        }

        const reasons = [];
        if (collisionSlugs.has(slug)) reasons.push("collision");
        if (invalidSlugs.has(slug)) reasons.push("invalid");
        if (legacy !== canonical) reasons.push("legacy_canonical_diff");

        if (reasons.length === 0 && validated.ok) {
            safeForAutoMigration.push({ slug, canonical });
        } else if (reasons.length > 0) {
            const existing = requiresManualReview.find((r) => r.slug === slug);
            if (existing) {
                for (const r of reasons) {
                    if (!existing.reasons.includes(r)) existing.reasons.push(r);
                }
            } else {
                requiresManualReview.push({ slug, reasons });
            }
        }
    }

    for (const m of missingUsername) {
        if (!requiresManualReview.some((r) => r.slug === m.slug)) {
            requiresManualReview.push({ slug: m.slug, reasons: ["missing_username"] });
        }
    }

    return {
        summary: {
            totalAccounts: list.length,
            validCanonicalCount: validCanonical.length,
            legacyDiffersCount: legacyDiffers.length,
            collisionGroupCount: base.collisions.length,
            invalidCount: base.invalid.length + invalidCanonical.length,
            missingUsernameCount: missingUsername.length,
            asciiOnlyCount: asciiOnly.length,
            withTurkishCharsCount: withTurkishChars.length,
            safeForAutoMigrationCount: safeForAutoMigration.length,
            requiresManualReviewCount: requiresManualReview.length,
            migrationSafeToApply:
                isMigrationSafeToApply(base) &&
                missingUsername.length === 0 &&
                invalidCanonical.length === 0
        },
        legacyDiffers,
        collisionGroups: base.collisions,
        invalidRecords: [...base.invalid, ...invalidCanonical.filter((i) => !base.invalid.some((b) => b.slug === i.slug))],
        missingUsername,
        asciiOnlySlugs: asciiOnly,
        turkishCharSlugs: withTurkishChars,
        safeForAutoMigration,
        requiresManualReview,
        /** Password veya hassas alan içermez */
        _sensitiveFieldsExcluded: ["password", "phone", "email", "telegramChatId"]
    };
}

/**
 * Fixture kayıtlarını yükler; yalnız slug/username alanları alınır.
 * @param {unknown} payload
 * @returns {Array<{slug: string, username?: string}>}
 */
export function parseSanitizedFixture(payload) {
    const arr = Array.isArray(payload) ? payload : payload?.records;
    if (!Array.isArray(arr)) return [];

    return arr.map((item) => ({
        slug: String(item?.slug ?? item?.id ?? ""),
        ...(typeof item?.username === "string" ? { username: item.username } : {})
    }));
}
