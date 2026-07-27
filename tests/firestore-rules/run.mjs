/**
 * Rules test runner — env temizler, firebase.rules-test.json emulator'ını yönetir.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const target = process.argv[2];

const TEST_FILES = {
    config: resolve(__dirname, "config-path.test.mjs"),
    current: resolve(__dirname, "current-characterization.test.mjs"),
    target: resolve(__dirname, "target-requirements.test.mjs")
};

const RULES_TEST_CFG = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "firebase.rules-test.json"), "utf8")
);

const FIRESTORE_PORT = RULES_TEST_CFG.emulators.firestore.port;
const AUTH_PORT = RULES_TEST_CFG.emulators.auth.port;

const file = TEST_FILES[target];
if (!file) {
    console.error(`[rules-test] unknown target: ${target}`);
    process.exit(2);
}

function buildSanitizedEnv() {
    const env = { ...process.env };
    const UNSET_KEYS = [
        "GCLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "FIREBASE_AUTH_EMULATOR_HOST",
        "FIRESTORE_EMULATOR_HOST",
        "FIREBASE_STORAGE_EMULATOR_HOST",
        "FIREBASE_DATABASE_EMULATOR_HOST"
    ];
    for (const key of UNSET_KEYS) {
        delete env[key];
    }
    env.RULES_TEST_SANITIZED = "1";
    env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
    env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
    return env;
}

function waitForPort(port, timeoutMs = 120000) {
    return new Promise((resolvePromise, reject) => {
        const start = Date.now();
        const tryConnect = () => {
            const socket = net.connect({ host: "127.0.0.1", port }, () => {
                socket.end();
                resolvePromise();
            });
            socket.on("error", () => {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error(`[rules-test] emulator port ${port} not ready`));
                } else {
                    setTimeout(tryConnect, 500);
                }
            });
        };
        tryConnect();
    });
}

async function runWithEmulator(testFile) {
    const env = buildSanitizedEnv();
    const emu = spawn(
        "firebase",
        [
            "emulators:start",
            "--config",
            "firebase.rules-test.json",
            "--only",
            "firestore,auth",
            "--project",
            "berberrandevu-rules-test"
        ],
        { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], shell: true }
    );

    const killEmu = () => {
        if (!emu.killed) {
            emu.kill("SIGINT");
        }
    };
    process.on("SIGINT", killEmu);
    process.on("SIGTERM", killEmu);

    try {
        await waitForPort(FIRESTORE_PORT);
        await waitForPort(AUTH_PORT);

        const result = spawnSync(process.execPath, ["--test", testFile], {
            stdio: "inherit",
            env,
            cwd: REPO_ROOT
        });
        return result.status ?? 1;
    } finally {
        killEmu();
        await new Promise((r) => setTimeout(r, 1500));
    }
}

if (target === "config") {
    const env = buildSanitizedEnv();
    delete env.FIRESTORE_EMULATOR_HOST;
    delete env.FIREBASE_AUTH_EMULATOR_HOST;
    const result = spawnSync(process.execPath, ["--test", file], {
        stdio: "inherit",
        env,
        cwd: REPO_ROOT
    });
    process.exit(result.status ?? 1);
}

const exitCode = await runWithEmulator(file);
process.exit(exitCode);
