import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
    runUsernameDryRun,
    planUsernameMigration,
    legacyNormalizeUsername,
    parseSanitizedFixture,
    isMigrationSafeToApply
} from "../usernameMigration.js";
import { normalizeUsername } from "../usernameNormalization.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../scripts/username-dry-run.mjs");

describe("dry-run collision", () => {
    it("aynı canonical değere düşen kayıtları gruplar", () => {
        const r = runUsernameDryRun([
            { slug: "a", username: "JOHN" },
            { slug: "b", username: "john" }
        ]);
        assert.equal(r.summary.collisionGroupCount, 1);
        assert.equal(r.collisionGroups[0].slugs.length, 2);
        assert.equal(isMigrationSafeToApply(planUsernameMigration([{ slug: "a", username: "JOHN" }, { slug: "b", username: "john" }])), false);
    });
});

describe("dry-run Turkish I/İ/ı/i", () => {
    it("legacy ve canonical farkını raporlar", () => {
        const r = runUsernameDryRun([{ slug: "t1", username: "IŞIK" }]);
        assert.equal(r.summary.legacyDiffersCount, 1);
        assert.equal(r.legacyDiffers[0].canonical, "ışık");
        assert.notEqual(r.legacyDiffers[0].legacy, r.legacyDiffers[0].canonical);
    });

    it("İstanbul canonical i ile başlar", () => {
        assert.equal(normalizeUsername("İstanbul"), "istanbul");
        assert.notEqual(legacyNormalizeUsername("İstanbul"), normalizeUsername("İstanbul"));
    });
});

describe("dry-run invalid and missing", () => {
    it("eksik username", () => {
        const r = runUsernameDryRun([{ slug: "m1" }, { slug: "m2", username: "" }]);
        assert.equal(r.summary.missingUsernameCount, 2);
        assert.ok(r.requiresManualReview.some((x) => x.reasons.includes("missing_username")));
    });

    it("geçersiz username (too_short)", () => {
        const r = runUsernameDryRun([{ slug: "i1", username: "ab" }]);
        assert.ok(r.invalidRecords.length >= 1 || r.requiresManualReview.some((x) => x.slug === "i1"));
        assert.equal(r.summary.migrationSafeToApply, false);
        assert.ok(r.requiresManualReview.some((x) => x.reasons.some((reason) => reason.startsWith("invalid_"))));
    });
});

describe("dry-run privacy and writes", () => {
    it("çıktıda password alanı yok", () => {
        const r = runUsernameDryRun([{ slug: "p1", username: "secretuser" }]);
        assert.equal(Object.prototype.hasOwnProperty.call(r, "password"), false);
        assert.equal(r.safeForAutoMigration[0]?.password, undefined);
        assert.ok(Array.isArray(r._sensitiveFieldsExcluded));
    });

    it("fixture yalnız slug/username alır", () => {
        const recs = parseSanitizedFixture([
            { slug: "x", username: "u1", password: "SHOULD_NOT_READ", phone: "555" }
        ]);
        assert.equal(recs.length, 1);
        assert.equal(recs[0].slug, "x");
        assert.equal(recs[0].username, "u1");
        assert.equal(recs[0].password, undefined);
    });
});

describe("dry-run ASCII vs Turkish", () => {
    it("ascii ve Türkçe ayrımı", () => {
        const r = runUsernameDryRun([
            { slug: "ascii", username: "john_doe" },
            { slug: "tr", username: "IŞIK" }
        ]);
        assert.ok(r.asciiOnlySlugs.includes("ascii"));
        assert.ok(r.turkishCharSlugs.includes("tr"));
    });
});

describe("dry-run safe vs manual", () => {
    it("collision olmayan geçerli kayıt auto-safe", () => {
        const r = runUsernameDryRun([{ slug: "ok", username: "valid_user" }]);
        assert.equal(r.summary.safeForAutoMigrationCount, 1);
        assert.equal(r.summary.requiresManualReviewCount, 0);
    });

    it("collision manual review", () => {
        const r = runUsernameDryRun([
            { slug: "a", username: "john" },
            { slug: "b", username: "JOHN" }
        ]);
        assert.ok(r.requiresManualReview.length >= 2);
    });
});

describe("CLI production guard", () => {
    it("--production-readonly çıkış kodu 2 (çalıştırılmaz)", () => {
        const res = spawnSync(process.execPath, [CLI, "--production-readonly"], {
            encoding: "utf8"
        });
        assert.equal(res.status, 2);
        assert.match(res.stderr, /production-readonly/);
    });

    it("varsayılan fixture ile çalışır, production erişimi yok", () => {
        const res = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
        assert.equal(res.status, 0);
        const out = JSON.parse(res.stdout);
        assert.equal(out.meta.productionAccess, false);
        assert.equal(out.meta.writesPossible, false);
        assert.ok(out.summary.totalAccounts >= 1);
    });
});

describe("sample fixture load", () => {
    it("sanitized sample fixture parse edilir", () => {
        const path = resolve(__dirname, "../fixtures/berberler-sanitized.sample.json");
        const recs = parseSanitizedFixture(JSON.parse(readFileSync(path, "utf8")));
        assert.equal(recs.length, 8);
    });
});

describe("edge-cases fixture", () => {
    it("ikinci fixture dry-run collision ve invalid üretir", () => {
        const path = resolve(__dirname, "../fixtures/berberler-sanitized.edge-cases.json");
        const recs = parseSanitizedFixture(JSON.parse(readFileSync(path, "utf8")));
        const r = runUsernameDryRun(recs);
        assert.equal(recs.length, 14);
        assert.ok(r.summary.collisionGroupCount >= 1);
        assert.ok(r.summary.missingUsernameCount >= 1);
        assert.ok(r.summary.invalidCount >= 1 || r.requiresManualReview.length >= 3);
        assert.equal(r.summary.migrationSafeToApply, false);
    });
});

describe("CLI write safety", () => {
    it("script içinde Firestore write importu yok", () => {
        const src = readFileSync(CLI, "utf8");
        assert.equal(src.includes("firebase-admin"), false);
        assert.equal(src.includes("from \"firebase"), false);
        assert.equal(/writeFileSync|createWriteStream/.test(src), false);
    });
});

describe("output privacy extended", () => {
    it("çıktıda telefon/e-posta alanı yok", () => {
        const r = runUsernameDryRun([{ slug: "fx-1", username: "user_x" }]);
        const keys = JSON.stringify(r);
        assert.equal(/\bphone\b/i.test(keys) && keys.includes('"phone":'), false);
        assert.equal(/\bemail\b/i.test(keys) && keys.includes('"email":'), false);
    });
});
