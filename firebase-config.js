import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const FIREBASE_CONFIG_STORAGE_KEY = "berberFirebaseConfig";

const DEFAULT_CONFIG = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
    measurementId: ""
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
        return { ...DEFAULT_CONFIG, ...stored };
    }
    return { ...DEFAULT_CONFIG };
}

export const firebaseConfig = buildFirebaseConfig();

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

let app = null;
let db = null;

if (hasFirebaseConfig()) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} else {
    console.warn("Firebase yapılandırması eksik. Yalnızca süper admin panelinden yapılandırılabilir.");
}

export { app, db };
