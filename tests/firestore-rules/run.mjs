/**
 * Rules test runner — env temizler, config'e göre emulator yönetir.
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
    target: resolve(__dirname, "target-requirements.test.mjs"),
    candidate: resolve(__dirname, "candidate", "candidate-security.test.mjs")
};

const CONFIG_BY_TARGET = {
    config: null,
    current: "firebase.rules-test.json",
    target: "firebase.rules-test.json",
    candidate: "firebase.rules-phase4b.json"
};

const file = TEST_FILES[target];
if (!file) {
    console.error(`[rules-test] unknown target: ${target}`);
    process.exit(2);
}

function loadPorts(configFile) {
    const cfg = JSON.parse(readFileSync(resolve(REPO_ROOT, configFile), "utf8"));
    return {
        firestore: cfg.emulators.firestore.port,
        auth: cfg.emulators.auth.port
    };
}

function buildSanitizedEnv(ports) {
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
    if (ports) {
        env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${ports.firestore}`;
        env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${ports.auth}`;
    }
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

async function runWithEmulator(testFile, configFile) {
    const ports = loadPorts(configFile);
    const env = buildSanitizedEnv(ports);
    const emu = spawn(
        "firebase",
        [
            "emulators:start",
            "--config",
            configFile,
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
        await waitForPort(ports.firestore);
        await waitForPort(ports.auth);

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
    const env = buildSanitizedEnv(null);
    const result = spawnSync(process.execPath, ["--test", file], {
        stdio: "inherit",
        env,
        cwd: REPO_ROOT
    });
    process.exit(result.status ?? 1);
}

const configFile = CONFIG_BY_TARGET[target];
const exitCode = await runWithEmulator(file, configFile);
process.exit(exitCode);
