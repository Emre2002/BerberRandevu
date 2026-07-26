import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const FIXTURE_PATH = resolve(ROOT, "fixtures/username-normalization-golden.json");
const clientMod = await import(pathToFileURL(resolve(ROOT, "usernameNormalization.js")).href);
const functionsNorm = require("../functions/lib/usernameNormalization.js");

const { vectors } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function runClient(input) {
    return clientMod.normalizeAndValidateUsername(input);
}

function runFunctions(input) {
    return functionsNorm.normalizeAndValidateUsername(input);
}

describe("username normalization parity — client vs functions", () => {
    for (const vector of vectors) {
        it(`${vector.id}: normalized/ok/reason eşleşir`, () => {
            const clientResult = runClient(vector.input);
            const functionsResult = runFunctions(vector.input);

            assert.equal(
                clientResult.normalized,
                functionsResult.normalized,
                `normalized mismatch for ${vector.id}`
            );
            assert.equal(clientResult.ok, functionsResult.ok, `ok mismatch for ${vector.id}`);
            assert.equal(
                clientResult.reason,
                functionsResult.reason,
                `reason mismatch for ${vector.id}`
            );

            assert.equal(clientResult.normalized, vector.normalized, `fixture normalized for ${vector.id}`);
            assert.equal(clientResult.ok, vector.ok, `fixture ok for ${vector.id}`);
            if (!vector.ok) {
                assert.equal(clientResult.reason, vector.reason, `fixture reason for ${vector.id}`);
            }
        });
    }
});

describe("username normalization parity — cross-implementation snapshot", () => {
    it("tüm vektörlerde client ve functions çıktıları birebir aynı", () => {
        const clientOut = vectors.map((v) => runClient(v.input));
        const functionsOut = vectors.map((v) => runFunctions(v.input));
        assert.deepEqual(clientOut, functionsOut);
    });
});
