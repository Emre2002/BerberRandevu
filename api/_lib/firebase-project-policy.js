const PRODUCTION_PROJECT_ID = "berberrandevu-20a3e";
const DEVELOPMENT_PROJECT_ID = "berberrandevu-dev-emre2002";

export function resolveExpectedProjectId(env = process.env) {
    const vercelEnvironment = String(env.VERCEL_ENV || "").trim();
    const configuredProjectId = String(env.FIREBASE_PROJECT_ID || "").trim();
    const expectedProjectId = vercelEnvironment === "production"
        ? PRODUCTION_PROJECT_ID
        : DEVELOPMENT_PROJECT_ID;

    if (vercelEnvironment && !["production", "preview", "development"].includes(vercelEnvironment)) {
        throw new Error("firebase_admin_environment_invalid");
    }
    if (vercelEnvironment !== "production" && !configuredProjectId) {
        throw new Error("firebase_admin_project_missing");
    }
    if (configuredProjectId && configuredProjectId !== expectedProjectId) {
        throw new Error("firebase_admin_project_mismatch");
    }
    return expectedProjectId;
}

export function validateServiceAccountProjectId(serviceAccount, expectedProjectId) {
    if (!serviceAccount?.project_id || serviceAccount.project_id !== expectedProjectId) {
        throw new Error("firebase_admin_credential_project_mismatch");
    }
}
