import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { resolveExpectedProjectId, validateServiceAccountProjectId } from "./firebase-project-policy.js";


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
    const expectedProjectId = resolveExpectedProjectId();
    if (getApps().length) {
        const existingApp = getApps()[0];
        if (existingApp.options.projectId !== expectedProjectId) {
            throw new Error("firebase_admin_existing_app_project_mismatch");
        }
        return existingApp;
    }

    const serviceAccount = readServiceAccountJson();
    if (serviceAccount) {
        validateServiceAccountProjectId(serviceAccount, expectedProjectId);
        return initializeApp({
            credential: cert(serviceAccount),
            projectId: expectedProjectId
        });
    }

    if (process.env.VERCEL_ENV === "preview") {
        throw new Error("firebase_admin_credentials_missing");
    }

    try {
        return initializeApp({
            credential: applicationDefault(),
            projectId: expectedProjectId
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
