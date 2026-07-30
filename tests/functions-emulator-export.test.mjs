import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const handler = require("../functions/lib/resolveAuthIdentifierCallable.js");

/**
 * functions/index.js'i izole child process'te yükler (Admin init cache çakışması yok).
 * @param {string|undefined} functionsEmulatorValue
 */
function probeFunctionsExports(functionsEmulatorValue) {
    const indexPath = resolve(ROOT, "functions/index.js");
    const envSetup =
        functionsEmulatorValue === undefined
            ? "delete process.env.FUNCTIONS_EMULATOR;"
            : `process.env.FUNCTIONS_EMULATOR = ${JSON.stringify(functionsEmulatorValue)};`;

    const code = `
        const path = require("path");
        ${envSetup}
        const indexPath = ${JSON.stringify(indexPath)};
        const functionsDir = path.dirname(indexPath);
        const callablePath = require.resolve("./lib/resolveAuthIdentifierCallable", {
            paths: [functionsDir]
        });
        const m = require(indexPath);
        const callableLoaded = Object.prototype.hasOwnProperty.call(require.cache, callablePath);
        console.log(JSON.stringify({
            resolveType: typeof m.resolveAuthIdentifierForEmulator,
            createType: typeof m.createAppointment,
            callableModuleLoaded: callableLoaded
        }));
    `;

    const res = spawnSync(process.execPath, ["-e", code], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env }
    });

    if (res.status !== 0) {
        throw new Error(`functions/index probe failed: ${res.stderr || res.stdout}`);
    }

    return JSON.parse(res.stdout.trim());
}

describe("functions/index.js — emulator-only export", () => {
    it("FUNCTIONS_EMULATOR tanımsızken resolveAuthIdentifierForEmulator export edilmez", () => {
        const exp = probeFunctionsExports(undefined);
        assert.equal(exp.resolveType, "undefined");
        assert.equal(exp.createType, "undefined");
        assert.equal(exp.callableModuleLoaded, false);
    });

    it('FUNCTIONS_EMULATOR="false" iken export edilmez', () => {
        const exp = probeFunctionsExports("false");
        assert.equal(exp.resolveType, "undefined");
        assert.equal(exp.createType, "undefined");
        assert.equal(exp.callableModuleLoaded, false);
    });

    it('FUNCTIONS_EMULATOR="true" iken handler modülü yüklenir ve export function olur', () => {
        const exp = probeFunctionsExports("true");
        assert.equal(exp.resolveType, "function");
        assert.equal(exp.createType, "undefined");
        assert.equal(exp.callableModuleLoaded, true);
    });
});

describe("resolveAuthIdentifier callable handler — password reddi", () => {
    let prevEmulator;

    beforeEach(() => {
        prevEmulator = process.env.FUNCTIONS_EMULATOR;
        process.env.FUNCTIONS_EMULATOR = "true";
    });

    afterEach(() => {
        if (prevEmulator === undefined) {
            delete process.env.FUNCTIONS_EMULATOR;
        } else {
            process.env.FUNCTIONS_EMULATOR = prevEmulator;
        }
    });

    it("password alanı içeren payload reddedilir", async () => {
        await assert.rejects(
            () =>
                handler.handleResolveAuthIdentifierForEmulator({
                    data: { username: "emulator_owner", password: "secret" }
                }),
            (err) => {
                assert.equal(err.code, "invalid-argument");
                return true;
            }
        );
    });
});
