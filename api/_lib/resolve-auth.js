import { getAdminDb, getAdminAuth } from "./firebase-admin.js";
import { normalizeAndValidateUsername, normalizeUsername } from "./normalize-username.js";
import { normalizeSlug } from "./normalize-slug.js";

const SYNTHETIC_EMAIL_DOMAIN = "users.berberrandevu.internal";
const GENERIC_AUTH_ERROR = "auth_failed";
const SUPER_ADMIN_USERNAME = "superadmin";

function normalizeBusinessId(raw) {
    const normalized = normalizeSlug(String(raw || "").trim());
    return normalized || String(raw || "").trim();
}

function buildSyntheticEmail(normalizedUsername) {
    return `${normalizedUsername}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function legacyNormalizeUsername(raw) {
    if (raw == null) return "";
    return String(raw).trim().toLowerCase();
}

function usernameMatchesStored(normalized, rawStored) {
    if (rawStored == null || rawStored === "") return false;
    const stored = String(rawStored);
    return (
        normalizeUsername(stored) === normalized
        || legacyNormalizeUsername(stored) === normalized
        || stored.trim() === normalized
    );
}

function resolveFromIndexDoc(data, opts) {
    const authEmail = String(data?.authEmail || "").trim();
    const businessId = String(data?.businessId || "").trim();
    const role = String(data?.role || "owner").trim();

    if (!authEmail) return { ok: false, code: GENERIC_AUTH_ERROR };
    if (opts.roleHint === "superAdmin" && role !== "superAdmin") {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }
    if (opts.roleHint === "owner" && role !== "owner") {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    if (role === "superAdmin") {
        return {
            ok: true,
            authEmail,
            role: "superAdmin",
            businessId: businessId ? normalizeBusinessId(businessId) : null
        };
    }

    if (!businessId) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    return { ok: true, authEmail, role: "owner", businessId: normalizeBusinessId(businessId) };
}

async function resolveOwnerViaAuthMembership(db, normalized) {
    const authEmail = buildSyntheticEmail(normalized);
    try {
        const authUser = await getAdminAuth().getUserByEmail(authEmail);
        const membershipSnap = await db.collection("businessMemberships").doc(authUser.uid).get();
        if (!membershipSnap.exists) return null;

        const data = membershipSnap.data() || {};
        const businessId = String(data.businessId || "").trim();
        const role = String(data.role || "").trim();
        const status = String(data.status || "").trim();

        if (role !== "owner" || status !== "active" || !businessId) {
            return null;
        }

        return { authEmail, businessId: normalizeBusinessId(businessId) };
    } catch {
        return null;
    }
}

/**
 * Resolve owner businessId when authLoginIndex is missing or incomplete.
 */
export async function findOwnerBusinessIdByUsername(db, normalized) {
    const indexed = await db
        .collection("berberler")
        .where("username", "==", normalized)
        .limit(1)
        .get();

    if (!indexed.empty) {
        return indexed.docs[0].id;
    }

    const slugDoc = await db.collection("berberler").doc(normalized).get();
    if (slugDoc.exists) {
        return slugDoc.id;
    }

    const allBarbers = await db.collection("berberler").select("username").get();
    for (const doc of allBarbers.docs) {
        if (usernameMatchesStored(normalized, doc.data()?.username)) {
            return doc.id;
        }
    }

    return null;
}

function resolveSuperAdminFallback(normalized) {
    if (normalized !== SUPER_ADMIN_USERNAME) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }
    return {
        ok: true,
        authEmail: buildSyntheticEmail(normalized),
        role: "superAdmin",
        businessId: null
    };
}

/**
 * Resolve username to Auth email + role using authLoginIndex, with production fallbacks.
 * @param {string} rawUsername
 * @param {{ roleHint?: "owner"|"superAdmin" }} [opts]
 */
export async function resolveAuthIdentifier(rawUsername, opts = {}) {
    const validated = normalizeAndValidateUsername(rawUsername);
    if (!validated.ok) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    const db = getAdminDb();
    const indexSnap = await db.collection("authLoginIndex").doc(validated.normalized).get();

    if (indexSnap.exists) {
        const fromIndex = resolveFromIndexDoc(indexSnap.data() || {}, opts);
        if (fromIndex.ok) {
            return fromIndex;
        }
    }

    if (opts.roleHint === "superAdmin") {
        return resolveSuperAdminFallback(validated.normalized);
    }

    const businessId = await findOwnerBusinessIdByUsername(db, validated.normalized);
    if (businessId) {
        return {
            ok: true,
            authEmail: buildSyntheticEmail(validated.normalized),
            role: "owner",
            businessId: normalizeBusinessId(businessId)
        };
    }

    const fromMembership = await resolveOwnerViaAuthMembership(db, validated.normalized);
    if (fromMembership) {
        return {
            ok: true,
            authEmail: fromMembership.authEmail,
            role: "owner",
            businessId: fromMembership.businessId
        };
    }

    return { ok: false, code: GENERIC_AUTH_ERROR };
}

export { GENERIC_AUTH_ERROR };
