import { isLocalDevHost } from "./legacyAuthCompat.js";

export const PRODUCTION_PROJECT_ID = "berberrandevu-20a3e";
export const DEVELOPMENT_PROJECT_ID = "berberrandevu-dev-emre2002";

const productionFirebaseConfig = {
    apiKey: "AIzaSyBTPR4IrARQWvmN6eOMMouse3ipz0zcns0",
    authDomain: "berberrandevu-20a3e.firebaseapp.com",
    projectId: PRODUCTION_PROJECT_ID,
    storageBucket: "berberrandevu-20a3e.appspot.com",
    messagingSenderId: "22655326053",
    appId: "1:22655326053:web:e0a116cabb6228363cf38c",
    measurementId: "G-C0NKCG9TVQ"
};

const developmentFirebaseConfig = {
    apiKey: "AIzaSyBn0n6oJ9pEwc8uDr_WeYCRqqDIfFinqM4",
    authDomain: "berberrandevu-dev-emre2002.firebaseapp.com",
    projectId: DEVELOPMENT_PROJECT_ID,
    storageBucket: "berberrandevu-dev-emre2002.firebasestorage.app",
    messagingSenderId: "72763694683",
    appId: "1:72763694683:web:46c0507465da1b9fdb297e"
};

export function selectFirebaseConfig(environment, hostname = typeof window === "undefined" ? "" : window.location.hostname) {
    let config;
    if (environment === "production" && !isLocalDevHost(hostname)) {
        config = productionFirebaseConfig;
    } else if (environment === "preview" || environment === "development") {
        config = developmentFirebaseConfig;
    } else {
        throw new Error("Firebase client environment is not configured safely");
    }

    const expectedProjectId = environment === "production"
        ? PRODUCTION_PROJECT_ID
        : DEVELOPMENT_PROJECT_ID;
    if (config.projectId !== expectedProjectId) {
        throw new Error("Firebase client project mismatch");
    }
    return config;
}
