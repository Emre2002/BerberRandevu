import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import {
    BUSINESS_MEMBERSHIPS_COLLECTION,
    parseOwnerMembership
} from "./authGuard.js";

export {
    USERS_COLLECTION,
    BUSINESS_MEMBERSHIPS_COLLECTION,
    MEMBERSHIP_ROLE_OWNER,
    MEMBERSHIP_STATUS_ACTIVE,
    MEMBERSHIP_STATUS_PENDING,
    MEMBERSHIP_STATUS_DISABLED,
    AUTH_MIGRATION_STATUS,
    parseOwnerMembership
} from "./authGuard.js";

/**
 * @param {string} uid Firebase Auth uid
 * @returns {Promise<import('./authGuard.js').ReturnType<typeof parseOwnerMembership>>}
 */
export async function fetchMembershipForUid(uid) {
    if (!uid) return null;

    const ref = doc(db, BUSINESS_MEMBERSHIPS_COLLECTION, uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    return parseOwnerMembership(snap.data(), uid);
}
