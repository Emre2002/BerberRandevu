import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/** URL parametrelerini okur (müşteri randevu sayfası). */
function getBookingUrlParams() {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
}

/** Eski client-side yol zorunlu mu? (?cfBooking=0 veya ?forceClientBooking=1) */
export function isForceClientBookingQuery() {
    const params = getBookingUrlParams();
    if (params.get("forceClientBooking") === "1" || params.get("forceClientBooking") === "true") {
        return true;
    }
    if (params.get("cfBooking") === "0" || params.get("cfBooking") === "false") {
        return true;
    }
    return false;
}

/**
 * Müşteri randevu yolu: varsayılan Cloud Function (Faz 5C-C4).
 * Admin paneli createAppointmentWithEffects({ forceClient: true }) ile client yolunu kullanır.
 */
export function shouldUseCallableBooking({ forceClient = false } = {}) {
    if (forceClient) return false;
    if (typeof window === "undefined") return true;
    if (isForceClientBookingQuery()) return false;
    return true;
}

/** Geriye dönük uyumluluk — C4 sonrası varsayılan CF. */
export function isCfBookingQueryEnabled() {
    return shouldUseCallableBooking({ forceClient: false });
}

let createAppointmentCallablePromise = null;

/**
 * Callable createAppointment — lazy import.
 * @returns {Promise<import('firebase/functions').HttpsCallable|null>}
 */
export async function getCreateAppointmentCallable({ forceClient = false } = {}) {
    if (!shouldUseCallableBooking({ forceClient })) return null;

    if (!createAppointmentCallablePromise) {
        createAppointmentCallablePromise = (async () => {
            const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import(
                "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js"
            );
            const functions = getFunctions(app);
            if (
                typeof location !== "undefined" &&
                (location.hostname === "localhost" || location.hostname === "127.0.0.1")
            ) {
                try {
                    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
                } catch {
                    /* emulator zaten bağlı */
                }
            }
            return httpsCallable(functions, "createAppointment");
        })();
    }

    return createAppointmentCallablePromise;
}

export const FIREBASE_CONFIG_STORAGE_KEY = "berberFirebaseConfig";

export const firebaseConfig = {
    apiKey: "AIzaSyBTPR4IrARQWvmN6eOMMouse3ipz0zcns0",
    authDomain: "berberrandevu-20a3e.firebaseapp.com",
    projectId: "berberrandevu-20a3e",
    storageBucket: "berberrandevu-20a3e.appspot.com",
    messagingSenderId: "22655326053",
    appId: "1:22655326053:web:e0a116cabb6228363cf38c",
    measurementId: "G-C0NKCG9TVQ"
};

function loadStoredConfig() {
    try {
        const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function buildFirebaseConfig() {
    const stored = loadStoredConfig();
    if (stored?.apiKey) {
        return { ...firebaseConfig, ...stored };
    }
    return { ...firebaseConfig };
}

export function saveFirebaseConfig(config) {
    const cleaned = {
        apiKey: (config.apiKey || "").trim(),
        authDomain: (config.authDomain || "").trim(),
        projectId: (config.projectId || "").trim(),
        storageBucket: (config.storageBucket || "").trim(),
        messagingSenderId: (config.messagingSenderId || "").trim(),
        appId: (config.appId || "").trim(),
        measurementId: (config.measurementId || "").trim()
    };

    if (!cleaned.apiKey || !cleaned.authDomain || !cleaned.projectId || !cleaned.appId) {
        throw new Error("apiKey, authDomain, projectId ve appId zorunludur.");
    }

    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
}

export function hasFirebaseConfig() {
    return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// =============================================================================
// App Check — MONITOR MODE (Faz 5C-C3)
// Enforce yok. Yalnızca ?appCheck=1 ile opt-in test.
// Site key: Firebase Console → App Check → reCAPTCHA v3
// Detay: APP_CHECK_SETUP.md
// =============================================================================

/** reCAPTCHA v3 site key — boş bırakılırsa monitor init atlanır. */
export const APP_CHECK_RECAPTCHA_SITE_KEY = "";

/** App Check monitor — yalnızca ?appCheck=1 ile test. Production zorunlu değil. */
export function isAppCheckMonitorEnabled() {
    if (typeof window === "undefined") return false;
    const value = new URLSearchParams(window.location.search).get("appCheck");
    return value === "1" || value === "true";
}

let appCheckInitPromise = null;

/**
 * App Check token üretimini dener (monitor). Hata durumunda uygulamayı kırmaz.
 * @returns {Promise<import('firebase/app-check').AppCheck|null>}
 */
export async function initAppCheckMonitor() {
    if (!isAppCheckMonitorEnabled()) return null;

    if (!APP_CHECK_RECAPTCHA_SITE_KEY) {
        console.info(
            "[App Check Monitor] Site key tanımlı değil — APP_CHECK_SETUP.md adımlarını izleyin."
        );
        return null;
    }

    if (!appCheckInitPromise) {
        appCheckInitPromise = (async () => {
            try {
                const { initializeAppCheck, ReCaptchaV3Provider } = await import(
                    "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js"
                );
                const appCheck = initializeAppCheck(app, {
                    provider: new ReCaptchaV3Provider(APP_CHECK_RECAPTCHA_SITE_KEY),
                    isTokenAutoRefreshEnabled: true
                });
                console.info("[App Check Monitor] Client token üretimi başlatıldı (enforce yok).");
                return appCheck;
            } catch (err) {
                console.warn("[App Check Monitor] Init başarısız:", err?.message || err);
                return null;
            }
        })();
    }

    return appCheckInitPromise;
}

if (typeof window !== "undefined" && isAppCheckMonitorEnabled()) {
    initAppCheckMonitor();
}
