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
const CANDIDATE_RULES_PATH = resolve(REPO_ROOT, "firestore.phase4b.rules");

function loadCfg(configFile) {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, configFile), "utf8"));
}

const PROD_CFG = loadCfg("firebase.rules-test.json");
const CANDIDATE_CFG = loadCfg("firebase.rules-phase4b.json");

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment | null} */
let productionEnv = null;
/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment | null} */
let candidateEnv = null;

export async function getProductionRulesTestEnv() {
    assertRulesTestGuards({ projectId: RULES_TEST_PROJECT_ID });

    if (!productionEnv) {
        const rules = readFileSync(PRODUCTION_RULES_PATH, "utf8");
        productionEnv = await initializeTestEnvironment({
            projectId: RULES_TEST_PROJECT_ID,
            firestore: {
                rules,
                host: PROD_CFG.emulators.firestore.host || "127.0.0.1",
                port: PROD_CFG.emulators.firestore.port
            }
        });
    }

    return productionEnv;
}

export async function getCandidateRulesTestEnv() {
    assertRulesTestGuards({ projectId: RULES_TEST_PROJECT_ID });

    if (!candidateEnv) {
        const rules = readFileSync(CANDIDATE_RULES_PATH, "utf8");
        candidateEnv = await initializeTestEnvironment({
            projectId: RULES_TEST_PROJECT_ID,
            firestore: {
                rules,
                host: CANDIDATE_CFG.emulators.firestore.host || "127.0.0.1",
                port: CANDIDATE_CFG.emulators.firestore.port
            }
        });
    }

    return candidateEnv;
}

export async function cleanupProductionRulesTestEnv() {
    if (productionEnv) {
        await productionEnv.cleanup();
        productionEnv = null;
    }
}

export async function cleanupCandidateRulesTestEnv() {
    if (candidateEnv) {
        await candidateEnv.cleanup();
        candidateEnv = null;
    }
}

export function productionRulesPath() {
    return PRODUCTION_RULES_PATH;
}

export function candidateRulesPath() {
    return CANDIDATE_RULES_PATH;
}

export function candidateConfigPath() {
    return resolve(REPO_ROOT, "firebase.rules-phase4b.json");
}
