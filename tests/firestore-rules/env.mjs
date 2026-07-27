import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds
} from "@firebase/rules-unit-testing";
import { REPO_ROOT, RULES_TEST_PROJECT_ID, assertRulesTestGuards } from "./guards.mjs";

export { assertFails, assertSucceeds, RULES_TEST_PROJECT_ID };

const PRODUCTION_RULES_PATH = resolve(REPO_ROOT, "firestore.rules");
const RULES_TEST_CFG = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "firebase.rules-test.json"), "utf8")
);

const FIRESTORE_HOST = RULES_TEST_CFG.emulators.firestore.host || "127.0.0.1";
const FIRESTORE_PORT = RULES_TEST_CFG.emulators.firestore.port;
const AUTH_HOST = RULES_TEST_CFG.emulators.auth.host || "127.0.0.1";
const AUTH_PORT = RULES_TEST_CFG.emulators.auth.port;

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment | null} */
let sharedEnv = null;

/**
 * Production firestore.rules ile RulesTestEnvironment (harici emulator, firebase.rules-test.json).
 */
export async function getProductionRulesTestEnv() {
    assertRulesTestGuards({ projectId: RULES_TEST_PROJECT_ID });

    if (!sharedEnv) {
        const rules = readFileSync(PRODUCTION_RULES_PATH, "utf8");
        sharedEnv = await initializeTestEnvironment({
            projectId: RULES_TEST_PROJECT_ID,
            firestore: {
                rules,
                host: FIRESTORE_HOST,
                port: FIRESTORE_PORT
            }
        });
    }

    return sharedEnv;
}

export async function cleanupProductionRulesTestEnv() {
    if (sharedEnv) {
        await sharedEnv.cleanup();
        sharedEnv = null;
    }
}

export function productionRulesPath() {
    return PRODUCTION_RULES_PATH;
}
