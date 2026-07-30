import { getAuthInstance } from "./firebase-config.js";
import { fetchMembershipForUid } from "./membershipService.js";
import { detectLegacyAuthMode, isLocalDevHost } from "./legacyAuthCompat.js";
import { createAuthStateMachine } from "./authStateMachine.js";

let machine = null;
let initPromise = null;
let unsubscribeAuth = null;
let authStateKnown = false;

/** @returns {ReturnType<typeof createAuthStateMachine>} */
function getMachine() {
    if (!machine) {
        machine = createAuthStateMachine({
            fetchMembership: fetchMembershipForUid,
            authAdapter: {
                signOut: async () => {
                    const auth = await getAuthInstance();
                    const { signOut } = await import(
                        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
                    );
                    await signOut(auth);
                }
            },
            legacyModeProvider: () => detectLegacyAuthMode().authMode
        });
    }
    return machine;
}

/**
 * Firebase Auth foundation — pasif/paralel init.
 * Init sırası: app → auth instance → (emulator) → persistence → listener.
 * Duplicate listener ve persistence-öncesi listener'ı engeller.
 * @returns {Promise<void>}
 */
export async function ensureAuthFoundationInitialized() {
    if (typeof window === "undefined") return;
    if (unsubscribeAuth) return;
    if (initPromise) return initPromise;

    const m = getMachine();

    initPromise = (async () => {
        const auth = await getAuthInstance();
        const { onAuthStateChanged, setPersistence, browserLocalPersistence } = await import(
            "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
        );

        // Persistence listener'dan ÖNCE kurulur; hata gizlenmez.
        await setPersistence(auth, browserLocalPersistence);

        unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            authStateKnown = true;
            m.handleAuthUser(user);
        });
    })().catch((err) => {
        initPromise = null;
        authStateKnown = true;
        // Persistence/listener kurulamadı → owner yetkisi verilmez.
        m.handleAuthUser(null);
        throw err;
    });

    return initPromise;
}

/**
 * Pasif Auth foundation bootstrap — frontend entry point'lerden çağrılır.
 * Legacy login/guard akışını değiştirmez; init hatası uygulamayı çökertmez.
 */
export function bootstrapPassiveAuthFoundation() {
    if (typeof window === "undefined") return;

    ensureAuthFoundationInitialized().catch(() => {
        if (isLocalDevHost(window.location?.hostname)) {
            console.info("[auth-bootstrap] passive init unavailable (legacy login unaffected)");
        }
    });
}

/**
 * @returns {object}
 */
export function getAuthStateSnapshot() {
    return getMachine().getSnapshot();
}

/**
 * @param {(snapshot: object) => void} listener
 * @returns {() => void}
 */
export function subscribeAuthState(listener) {
    const unsub = getMachine().subscribe(listener);
    ensureAuthFoundationInitialized().catch(() => {
        /* hata snapshot.error ile listener'a yansır */
    });
    return unsub;
}

/**
 * Firebase Auth signOut. Legacy sessionStorage/super-admin localStorage
 * KASITLI olarak temizlenmez (migration kararı) — bu nedenle logout sonrası
 * yalnız legacy_only durumu oluşabilir, authenticated_owner asla.
 * @returns {Promise<void>}
 */
export async function authSignOut() {
    return getMachine().signOut();
}

/**
 * Test/teardown için listener temizliği.
 */
export function teardownAuthFoundation() {
    if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
    }
    unsubscribeAuth = null;
    initPromise = null;
    machine = null;
    authStateKnown = false;
}

/**
 * İlk onAuthStateChanged callback'i alındı mı (persisted session restore dahil).
 * @returns {boolean}
 */
export function isAuthStateKnown() {
    return authStateKnown;
}

/**
 * @returns {boolean}
 */
export function isAuthFoundationReady() {
    const snap = getMachine().getSnapshot();
    return Boolean(unsubscribeAuth) && !snap.authLoading;
}
