import { normalizeSlug } from "./normalize-slug.js";
import { normalizeUsername } from "./normalize-username.js";

/**
 * Resolve a public booking identifier to the canonical publicBarbers document ID.
 * Never ASCII-normalizes an existing canonical ID when an exact match exists.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} rawSlug
 * @returns {Promise<string|null>}
 */
export async function resolvePublicBusinessSlug(db, rawSlug) {
    const trimmed = String(rawSlug || "").trim();
    if (!trimmed) return null;

    const exactSnap = await db.collection("publicBarbers").doc(trimmed).get();
    if (exactSnap.exists) return trimmed;

    const normalized = normalizeSlug(trimmed);
    if (normalized && normalized !== trimmed) {
        const normSnap = await db.collection("publicBarbers").doc(normalized).get();
        if (normSnap.exists) return normalized;
    }

    const usernameNorm = normalizeUsername(trimmed);
    if (usernameNorm) {
        const indexSnap = await db.collection("authLoginIndex").doc(usernameNorm).get();
        if (indexSnap.exists) {
            const businessId = String(indexSnap.data()?.businessId || "").trim();
            if (businessId) {
                const pubSnap = await db.collection("publicBarbers").doc(businessId).get();
                if (pubSnap.exists) return businessId;
            }
        }

        const ownerQuery = await db
            .collection("berberler")
            .where("username", "==", usernameNorm)
            .limit(1)
            .get();
        if (!ownerQuery.empty) {
            const businessId = ownerQuery.docs[0].id;
            const pubSnap = await db.collection("publicBarbers").doc(businessId).get();
            if (pubSnap.exists) return businessId;
        }
    }

    return null;
}
