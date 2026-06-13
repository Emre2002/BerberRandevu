import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
