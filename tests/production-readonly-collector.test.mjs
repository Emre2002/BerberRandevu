import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    EXPECTED_PROJECT_ID,
    FIXED_COLLECTION,
    PROJECTION_FIELDS,
    parseCollectorArgs,
    validateProjectGuard,
    mapDocsToRecords,
    buildSanitizedOutput,
    assertOutputSanitized,
    decideExitCode
} from "../scripts/username-production-readonly.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLLECTOR_SRC = resolve(__dirname, "../scripts/username-production-readonly.mjs");

function makeDoc(id, fields) {
    return {
        id,
        get: (f) => fields[f],
        data: () => {
            throw new Error("full-document read is forbidden");
        }
    };
}

const okArgs = {
    productionReadonly: true,
    project: EXPECTED_PROJECT_ID,
    confirmProject: EXPECTED_PROJECT_ID
};

describe("collector project guard", () => {
    it("flag olmadan guard fail (bağlantı çağrılmaz)", () => {
        const g = validateProjectGuard({ productionReadonly: false }, EXPECTED_PROJECT_ID);
        assert.equal(g.ok, false);
        assert.equal(g.reason, "missing_production_flag");
    });

    it("yanlış --project ile guard fail", () => {
        const g = validateProjectGuard({ ...okArgs, project: "other-project" }, EXPECTED_PROJECT_ID);
        assert.equal(g.ok, false);
        assert.equal(g.reason, "project_flag_mismatch");
    });

    it("confirm-project eksikse guard fail (sorgu yapılmaz)", () => {
        const g = validateProjectGuard({ ...okArgs, confirmProject: null }, EXPECTED_PROJECT_ID);
        assert.equal(g.ok, false);
        assert.equal(g.reason, "missing_project_flags");
    });

    it("runtime credential project mismatch fail-closed", () => {
        const g = validateProjectGuard(okArgs, "some-other-runtime-project");
        assert.equal(g.ok, false);
        assert.equal(g.reason, "runtime_project_mismatch");
    });

    it("credential yoksa (runtime project null) fail-closed", () => {
        const g = validateProjectGuard(okArgs, null);
        assert.equal(g.ok, false);
        assert.equal(g.reason, "missing_runtime_project");
    });

    it("üç kaynak da eşitse guard geçer", () => {
        const g = validateProjectGuard(okArgs, EXPECTED_PROJECT_ID);
        assert.equal(g.ok, true);
    });
});

describe("collector arg parsing", () => {
    it("generic --collection kabul edilmez", () => {
        const args = parseCollectorArgs([
            "node",
            "collector",
            "--production-readonly",
            `--project=${EXPECTED_PROJECT_ID}`,
            `--confirm-project=${EXPECTED_PROJECT_ID}`,
            "--collection=customers"
        ]);
        assert.equal(Object.prototype.hasOwnProperty.call(args, "collection"), false);
        assert.equal(args.project, EXPECTED_PROJECT_ID);
    });
});

describe("collector fixed collection & projection", () => {
    it("yalnız berberler collection sabiti bulunur", () => {
        assert.equal(FIXED_COLLECTION, "berberler");
    });

    it("projection yalnız username alanını içerir", () => {
        assert.deepEqual([...PROJECTION_FIELDS], ["username"]);
    });
});

describe("collector doc mapping (min data)", () => {
    it("yalnız id ve username okur, data() çağırmaz", () => {
        const docs = [makeDoc("shop-1", { username: "Ahmet", password: "SECRET", phone: "555" })];
        const records = mapDocsToRecords(docs);
        assert.deepEqual(records, [{ slug: "shop-1", username: "Ahmet" }]);
    });
});

describe("collector sanitized output", () => {
    it("temiz veri success (exit 0), yalnız maskeli referans", () => {
        const records = [
            { slug: "shop-1", username: "ahmet" },
            { slug: "shop-2", username: "mehmet" }
        ];
        const out = buildSanitizedOutput(records);
        assert.equal(decideExitCode(out), 0);
        for (const ref of out.maskedReferences) {
            assert.equal(Object.prototype.hasOwnProperty.call(ref, "slug"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(ref, "username"), false);
            assert.match(ref.slugHash, /^[0-9a-f]{12}$/);
        }
        assert.doesNotThrow(() => assertOutputSanitized(out, records));
    });

    it("collision non-zero exit üretir", () => {
        const records = [
            { slug: "a", username: "JOHN" },
            { slug: "b", username: "john" }
        ];
        const out = buildSanitizedOutput(records);
        assert.ok(out.summary.collisionGroupCount > 0);
        assert.notEqual(decideExitCode(out), 0);
        assert.equal(out.summary.migrationSafeToApply, false);
    });

    it("invalid kayıt non-zero exit üretir", () => {
        const records = [{ slug: "x", username: "a" }];
        const out = buildSanitizedOutput(records);
        assert.ok(out.summary.invalidCount > 0);
        assert.notEqual(decideExitCode(out), 0);
    });

    it("raw username/slug/password stdout JSON'da yok", () => {
        const records = [{ slug: "gizli-slug", username: "GizliKullanici" }];
        const out = buildSanitizedOutput(records);
        const json = JSON.stringify(out);
        assert.equal(json.includes("gizli-slug"), false);
        assert.equal(json.includes("GizliKullanici"), false);
        // password bir veri anahtarı olarak çıktıda bulunmamalı (yalnız excluded listesinde referans olabilir)
        assert.equal(/"password"\s*:/.test(json), false);
    });

    it("sanitization guard leak'te throw eder", () => {
        const records = [{ slug: "shop-leak", username: "leakuser" }];
        const bad = { summary: {}, leaked: "shop-leak" };
        assert.throws(() => assertOutputSanitized(bad, records), /sanitization_error/);
    });
});

describe("collector static write-surface check", () => {
    /** Map.set / crypto Hash.update gibi false positive üretmeyen Firestore write kalıpları */
    const FIRESTORE_WRITE_PATTERNS = [
        /\bdb\.batch\s*\(/,
        /\bdb\.bulkWriter\s*\(/,
        /\bdb\.runTransaction\s*\(/,
        /\bbatch\.(set|update|delete|commit)\s*\(/,
        /\btransaction\.(set|update|delete)\s*\(/,
        /\.doc\([^)]*\)\.(set|update|delete)\s*\(/,
        /\.collection\([^)]*\)\.add\s*\(/,
        /\.collection\([^)]*\)\.doc\([^)]*\)\.(set|update|delete)\s*\(/
    ];

    it("kaynak kodda hedefli Firestore write yüzeyi bulunmaz", () => {
        const src = readFileSync(COLLECTOR_SRC, "utf8");
        for (const re of FIRESTORE_WRITE_PATTERNS) {
            assert.equal(re.test(src), false, `Firestore write yüzeyi: ${re}`);
        }
    });

    it("Firestore erişimi yalnız read/query (collection + select + get)", () => {
        const src = readFileSync(COLLECTOR_SRC, "utf8");
        assert.match(src, /getFirestore/);
        assert.match(src, /\.collection\s*\(/);
        assert.match(src, /\.select\s*\(/);
        assert.match(src, /\.get\s*\(/);
        assert.doesNotMatch(src, /^import\s+.*firebase-admin/m);
    });

    it("write-capable adapter veya db parametresi yok", () => {
        const src = readFileSync(COLLECTOR_SRC, "utf8");
        assert.equal(/\bwriteAdapter\b/.test(src), false);
        assert.equal(/\bfirestoreAdapter\b/.test(src), false);
        assert.equal(/export\s+async\s+function\s+\w+\s*\([^)]*\bdb\b/.test(src), false);
    });

    it("kaynak kodda repo'ya yazma (writeFile/createWriteStream) yok", () => {
        const src = readFileSync(COLLECTOR_SRC, "utf8");
        assert.equal(src.includes("writeFileSync"), false);
        assert.equal(src.includes("createWriteStream"), false);
        assert.equal(src.includes("writeFile("), false);
    });
});
