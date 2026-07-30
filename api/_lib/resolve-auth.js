import { getAdminDb } from "./firebase-admin.js";
import { normalizeAndValidateUsername } from "./normalize-username.js";

const SYNTHETIC_EMAIL_DOMAIN = "users.berberrandevu.internal";
const GENERIC_AUTH_ERROR = "auth_failed";

function buildSyntheticEmail(normalizedUsername) {
    return `${normalizedUsername}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Resolve username to Auth email + role using authLoginIndex, with synthetic fallback.
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
        const data = indexSnap.data() || {};
        const authEmail = String(data.authEmail || "").trim();
        const businessId = String(data.businessId || "").trim();
        const role = String(data.role || "owner").trim();

        if (opts.roleHint === "superAdmin" && role !== "superAdmin") {
            return { ok: false, code: GENERIC_AUTH_ERROR };
        }
        if (opts.roleHint === "owner" && role !== "owner") {
            return { ok: false, code: GENERIC_AUTH_ERROR };
        }

        if (!authEmail) {
            return { ok: false, code: GENERIC_AUTH_ERROR };
        }

        if (role === "superAdmin") {
            return { ok: true, authEmail, role: "superAdmin", businessId: businessId || null };
        }

        if (!businessId) {
            return { ok: false, code: GENERIC_AUTH_ERROR };
        }

        return { ok: true, authEmail, role: "owner", businessId };
    }

    if (opts.roleHint === "superAdmin") {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    const berberQuery = await db
        .collection("berberler")
        .where("username", "==", validated.normalized)
        .limit(1)
        .get();

    if (berberQuery.empty) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    const businessId = berberQuery.docs[0].id;
    return {
        ok: true,
        authEmail: buildSyntheticEmail(validated.normalized),
        role: "owner",
        businessId
    };
}

export { GENERIC_AUTH_ERROR };
