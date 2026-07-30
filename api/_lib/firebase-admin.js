import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_PROJECT_ID = "berberrandevu-20a3e";

function readServiceAccount() {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
    if (rawJson) {
        return JSON.parse(rawJson);
    }

    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    if (privateKey && clientEmail) {
        return {
            project_id: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, "\n")
        };
    }

    throw new Error("firebase_admin_credentials_missing");
}

export function getAdminApp() {
    if (getApps().length) {
        return getApps()[0];
    }

    const serviceAccount = readServiceAccount();
    return initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id || DEFAULT_PROJECT_ID
    });
}

export function getAdminDb() {
    getAdminApp();
    return getFirestore();
}

export function getAdminAuth() {
    getAdminApp();
    return getAuth();
}
