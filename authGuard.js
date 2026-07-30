/** Kullanıcı profili koleksiyonu — Auth uid anahtarı. */
export const USERS_COLLECTION = "users";

/** İşletme üyeliği — doc id = Auth uid. businessId = berberler/{slug}. */
export const BUSINESS_MEMBERSHIPS_COLLECTION = "businessMemberships";

export const MEMBERSHIP_ROLE_OWNER = "owner";
export const MEMBERSHIP_STATUS_ACTIVE = "active";
export const MEMBERSHIP_STATUS_PENDING = "pending";
export const MEMBERSHIP_STATUS_DISABLED = "disabled";

export const AUTH_MIGRATION_STATUS = {
    LEGACY: "legacy",
    PENDING_RESET: "pending_reset",
    AUTH_READY: "auth_ready"
};

/**
 * @param {unknown} data
 * @param {string} uid
 * @returns {{ uid: string, businessId: string, role: 'owner', status: string }|null}
 */
export function parseOwnerMembership(data, uid) {
    if (!data || typeof data !== "object" || !uid) return null;

    const businessId = typeof data.businessId === "string" ? data.businessId.trim() : "";
    const role = data.role;
    const status = data.status;
    const docUid = typeof data.uid === "string" ? data.uid : uid;

    if (docUid !== uid) return null;
    if (role !== MEMBERSHIP_ROLE_OWNER) return null;
    if (!businessId) return null;
    if (status !== MEMBERSHIP_STATUS_ACTIVE) return null;

    return { uid, businessId, role: MEMBERSHIP_ROLE_OWNER, status };
}

export const AUTH_GUARD_STATE = {
    LOADING: "loading",
    UNAUTHENTICATED: "unauthenticated",
    LEGACY_ONLY: "legacy_only",
    AUTHENTICATED_WITHOUT_MEMBERSHIP: "authenticated_without_membership",
    AUTHENTICATED_OWNER: "authenticated_owner",
    ERROR: "error"
};

/**
 * @param {Object} input
 * @returns {{ state: string, businessId?: string, uid?: string, error?: unknown }}
 */
export function evaluateAuthGuard(input) {
    const {
        authLoading = true,
        membershipLoading = false,
        firebaseUser = null,
        membership = null,
        error = null,
        legacyAuthMode = "none"
    } = input || {};

    if (error) {
        return { state: AUTH_GUARD_STATE.ERROR, error };
    }

    if (authLoading || membershipLoading) {
        return { state: AUTH_GUARD_STATE.LOADING };
    }

    if (firebaseUser?.uid) {
        const parsed = parseOwnerMembership(membership, firebaseUser.uid);
        if (parsed) {
            return {
                state: AUTH_GUARD_STATE.AUTHENTICATED_OWNER,
                businessId: parsed.businessId,
                uid: firebaseUser.uid
            };
        }
        return {
            state: AUTH_GUARD_STATE.AUTHENTICATED_WITHOUT_MEMBERSHIP,
            uid: firebaseUser.uid
        };
    }

    if (legacyAuthMode === "legacy") {
        return { state: AUTH_GUARD_STATE.LEGACY_ONLY };
    }

    return { state: AUTH_GUARD_STATE.UNAUTHENTICATED };
}

export function resolveAuthGuard(snapshot) {
    return evaluateAuthGuard(snapshot);
}
