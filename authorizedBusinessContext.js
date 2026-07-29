import {
    AUTH_GUARD_STATE,
    BUSINESS_MEMBERSHIPS_COLLECTION,
    parseOwnerMembership
} from "./authGuard.js";
import {
    ensureAuthFoundationInitialized,
    getAuthStateSnapshot,
    subscribeAuthState
} from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";

let cachedContext = null;
let cachedUid = null;

function clearCachedContext() {
    cachedContext = null;
    cachedUid = null;
}

function contextFromSnapshot(snapshot) {
    const guard = snapshot?.guard || {};
    if (guard.state !== AUTH_GUARD_STATE.AUTHENTICATED_OWNER) return null;

    const membership = parseOwnerMembership(snapshot.membership, snapshot.firebaseUser?.uid);
    if (!membership) return null;

    return Object.freeze({
        uid: membership.uid,
        businessId: membership.businessId,
        role: membership.role,
        status: membership.status,
        membershipPath: `${BUSINESS_MEMBERSHIPS_COLLECTION}/${membership.uid}`
    });
}

/**
 * Firebase Auth ve membership doğrulanmadan private tenant sorgusu başlatmaz.
 * URL, storage veya client global state bu çözümlemede asla kullanılmaz.
 */
export async function getAuthorizedBusinessContext({ expectedBusinessId } = {}) {
    await ensureAuthFoundationInitialized();

    const snapshot = await waitForSettledAuthState();
    const context = contextFromSnapshot(snapshot);
    if (!context) {
        clearCachedContext();
        throw new Error("authorized_business_context_required");
    }

    if (expectedBusinessId && expectedBusinessId !== context.businessId) {
        throw new Error("authorized_business_context_mismatch");
    }

    cachedContext = context;
    cachedUid = context.uid;
    return context;
}

/**
 * Auth token yenilemesi başarısızsa fail-closed davranır.
 */
export async function getAuthorizedBusinessContextWithFreshToken(options) {
    const auth = await getAuthInstance();
    if (!auth.currentUser) {
        clearCachedContext();
        throw new Error("authorized_business_context_required");
    }

    try {
        await auth.currentUser.getIdToken(true);
        await auth.currentUser.reload();
    } catch {
        clearCachedContext();
        throw new Error("authorized_business_token_refresh_failed");
    }

    return getAuthorizedBusinessContext(options);
}

export function clearAuthorizedBusinessContext() {
    clearCachedContext();
}

export function getCachedAuthorizedBusinessContext() {
    return cachedContext;
}

export function subscribeAuthorizedBusinessContext(listener) {
    return subscribeAuthState((snapshot) => {
        const context = contextFromSnapshot(snapshot);
        const uid = snapshot?.firebaseUser?.uid || null;

        if (!context || cachedUid !== uid || cachedContext?.businessId !== context.businessId) {
            clearCachedContext();
        }

        if (context) {
            cachedContext = context;
            cachedUid = context.uid;
        }

        listener(context, snapshot);
    });
}

function waitForSettledAuthState() {
    const initial = getAuthStateSnapshot();
    if (!initial.authLoading && !initial.membershipLoading) {
        return Promise.resolve(initial);
    }

    return new Promise((resolve) => {
        const unsubscribe = subscribeAuthState((snapshot) => {
            if (!snapshot.authLoading && !snapshot.membershipLoading) {
                unsubscribe();
                resolve(snapshot);
            }
        });
    });
}
