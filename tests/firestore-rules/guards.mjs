import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../..");

/** Sentetik test project ID — production ile karışmamalı. */
export const RULES_TEST_PROJECT_ID = "berberrandevu-rules-test";

const BLOCKED_PROJECT_IDS = new Set([
    "berberrandevu-20a3e",
    "berberrandevu",
    "default"
]);

const LOCAL_EMULATOR_HOST = /^(127\.0\.0\.1|localhost):\d+$/i;

/**
 * Fail-closed guard — rules testleri production'a bağlanmamalı.
 * @param {{ projectId?: string }} [opts]
 */
export function assertRulesTestGuards(opts = {}) {
    const projectId = opts.projectId || RULES_TEST_PROJECT_ID;

    if (BLOCKED_PROJECT_IDS.has(projectId)) {
        throw new Error(
            `[rules-test] blocked: production project ID "${projectId}" is not allowed`
        );
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error(
            "[rules-test] blocked: GOOGLE_APPLICATION_CREDENTIALS must not be set"
        );
    }

    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost && !LOCAL_EMULATOR_HOST.test(emulatorHost)) {
        throw new Error(
            `[rules-test] blocked: FIRESTORE_EMULATOR_HOST must be localhost (${emulatorHost})`
        );
    }

    const gcloudProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (gcloudProject && BLOCKED_PROJECT_IDS.has(gcloudProject)) {
        throw new Error(
            `[rules-test] blocked: cloud project env points to production (${gcloudProject})`
        );
    }
}
