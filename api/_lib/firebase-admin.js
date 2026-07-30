import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_PROJECT_ID = "berberrandevu-20a3e";

function normalizePrivateKey(serviceAccount) {
    if (serviceAccount?.private_key && typeof serviceAccount.private_key === "string") {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    return serviceAccount;
}

function readServiceAccountJson() {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
    if (!rawJson || !String(rawJson).trim()) {
        return null;
    }
    return normalizePrivateKey(JSON.parse(rawJson));
}

function mapAdminError(err) {
    const code = String(err?.code || err?.message || "");
    if (code.includes("insufficient-permission") || code.includes("permission_denied")) {
        return new Error("firebase_admin_permission_denied");
    }
    if (code.includes("invalid-credential") || code.includes("Could not load the default credentials")) {
        return new Error("firebase_admin_credentials_missing");
    }
    return new Error("firebase_admin_initialization_failed");
}

export function getAdminApp() {
    if (getApps().length) {
        return getApps()[0];
    }

    const serviceAccount = readServiceAccountJson();
    if (serviceAccount) {
        return initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id || DEFAULT_PROJECT_ID
        });
    }

    try {
        return initializeApp({
            credential: applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID
        });
    } catch (err) {
        throw mapAdminError(err);
    }
}

export function getAdminDb() {
    getAdminApp();
    return getFirestore();
}

export function getAdminAuth() {
    getAdminApp();
    return getAuth();
}
