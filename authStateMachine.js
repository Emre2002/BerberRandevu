import { evaluateAuthGuard } from "./authGuard.js";

/**
 * Saf, test edilebilir auth state makinesi (CDN/Firebase importu yok).
 * Generation guard ile stale membership overwrite'ı engeller; fail-closed.
 *
 * @param {Object} deps
 * @param {(uid: string) => Promise<unknown>} deps.fetchMembership
 * @param {{ signOut: () => Promise<void> }} [deps.authAdapter]
 * @param {() => string} [deps.legacyModeProvider] "legacy"|"none"
 */
export function createAuthStateMachine({ fetchMembership, authAdapter, legacyModeProvider } = {}) {
    if (typeof fetchMembership !== "function") {
        throw new Error("createAuthStateMachine: fetchMembership gerekli");
    }

    const listeners = new Set();
    let generation = 0;

    const state = {
        authLoading: true,
        membershipLoading: false,
        firebaseUser: null,
        membership: null,
        error: null
    };

    function currentLegacyMode() {
        try {
            return typeof legacyModeProvider === "function" ? legacyModeProvider() : "none";
        } catch {
            return "none";
        }
    }

    function buildSnapshot() {
        const legacyAuthMode = currentLegacyMode();
        return {
            authLoading: state.authLoading,
            membershipLoading: state.membershipLoading,
            firebaseUser: state.firebaseUser,
            membership: state.membership,
            error: state.error,
            legacyAuthMode,
            guard: evaluateAuthGuard({
                authLoading: state.authLoading,
                membershipLoading: state.membershipLoading,
                firebaseUser: state.firebaseUser,
                membership: state.membership,
                error: state.error,
                legacyAuthMode
            })
        };
    }

    function notify() {
        const snapshot = buildSnapshot();
        for (const listener of listeners) {
            try {
                listener(snapshot);
            } catch (err) {
                console.warn("[authStateMachine] listener error:", err);
            }
        }
    }

    /**
     * Firebase Auth kullanıcı değişimini işler. Her çağrı generation'ı artırır;
     * önceki uçuşta olan membership isteği stale olur ve state'i yazamaz.
     * @param {{ uid: string }|null} user
     */
    async function handleAuthUser(user) {
        const gen = ++generation;

        // Kullanıcı değişiminde önceki membership/businessId derhal temizlenir.
        state.authLoading = false;
        state.firebaseUser = user || null;
        state.membership = null;
        state.error = null;

        if (!user?.uid) {
            state.membershipLoading = false;
            notify();
            return;
        }

        state.membershipLoading = true;
        notify();

        try {
            const membership = await fetchMembership(user.uid);
            if (gen !== generation) return; // stale — yeni kullanıcı/sign-out oldu
            state.membership = membership || null;
            state.error = null;
        } catch (err) {
            if (gen !== generation) return; // stale
            state.error = err; // fail-closed: guard ERROR döner
            state.membership = null;
        } finally {
            if (gen === generation) {
                state.membershipLoading = false;
                notify();
            }
        }
    }

    /**
     * Firebase signOut çağırır. Başarısızlıkta fail-closed: hata state'e yazılır,
     * owner yetkisi üretilmez; state.error nedeniyle guard ERROR olur.
     */
    async function signOut() {
        if (!authAdapter?.signOut) {
            throw new Error("authAdapter.signOut tanımlı değil");
        }
        try {
            await authAdapter.signOut();
            // Gerçek Firebase'de onAuthStateChanged(null) tetiklenir → handleAuthUser(null).
        } catch (err) {
            state.error = err;
            notify();
            throw err;
        }
    }

    function subscribe(listener) {
        listeners.add(listener);
        listener(buildSnapshot());
        return () => listeners.delete(listener);
    }

    return {
        handleAuthUser,
        signOut,
        subscribe,
        getSnapshot: buildSnapshot,
        getGeneration: () => generation
    };
}
