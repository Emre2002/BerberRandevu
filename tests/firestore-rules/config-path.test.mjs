import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Phase 4A rules test config separation", () => {
    const prodCfg = JSON.parse(readFileSync(resolve(ROOT, "firebase.json"), "utf8"));
    const emuCfg = JSON.parse(readFileSync(resolve(ROOT, "firebase.emulator.json"), "utf8"));
    const rulesTestCfg = JSON.parse(readFileSync(resolve(ROOT, "firebase.rules-test.json"), "utf8"));

    it("firebase.json production firestore.rules yolunu korur", () => {
        assert.equal(prodCfg.firestore.rules, "firestore.rules");
    });

    it("firebase.emulator.json Phase 3 firestore.emulator.rules kullanır", () => {
        assert.equal(emuCfg.firestore.rules, "firestore.emulator.rules");
    });

    it("firebase.rules-test.json production firestore.rules kullanır", () => {
        assert.equal(rulesTestCfg.firestore.rules, "firestore.rules");
    });

    it("firebase.rules-test.json hosting/functions içermez", () => {
        assert.equal(rulesTestCfg.functions, undefined);
        assert.equal(rulesTestCfg.hosting, undefined);
    });

    it("rules test env sentetik project ID kullanır", () => {
        const guards = readFileSync(resolve(ROOT, "tests/firestore-rules/guards.mjs"), "utf8");
        assert.match(guards, /berberrandevu-rules-test/);
        assert.match(guards, /berberrandevu-20a3e/);
    });
});
