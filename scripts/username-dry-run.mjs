#!/usr/bin/env node
/**
 * Username migration dry-run CLI — READ-ONLY.
 * Varsayılan: sanitised JSON fixture. Production modu bu görevde çalıştırılmaz.
 *
 * Kullanım:
 *   node scripts/username-dry-run.mjs
 *   node scripts/username-dry-run.mjs --fixture path/to/sanitized.json
 *
 * Production (manuel onay gerekir — bu görevde KULLANILMAZ):
 *   node scripts/username-dry-run.mjs --production-readonly
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    runUsernameDryRun,
    parseSanitizedFixture
} from "../usernameMigration.js";

const EXPECTED_PROJECT_ID = "berberrandevu-20a3e";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(__dirname, "../fixtures/berberler-sanitized.sample.json");

const FORBIDDEN_WRITE_METHODS = new Set([
    "set", "update", "delete", "create", "add", "setDoc", "updateDoc", "deleteDoc", "addDoc", "writeBatch", "runTransaction"
]);

function parseArgs(argv) {
    const args = { fixture: DEFAULT_FIXTURE, productionReadonly: false };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--fixture" && argv[i + 1]) {
            args.fixture = resolve(argv[++i]);
        } else if (argv[i] === "--production-readonly") {
            args.productionReadonly = true;
        }
    }
    return args;
}

function loadFixture(path) {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    return parseSanitizedFixture(data);
}

function assertNoWriteApi() {
    if (FORBIDDEN_WRITE_METHODS.size > 0) {
        return { writesPossible: false, mode: "fixture-readonly" };
    }
    return { writesPossible: false, mode: "unknown" };
}

function main() {
    const args = parseArgs(process.argv);

    if (args.productionReadonly) {
        console.error(
            "[username-dry-run] --production-readonly modu tanımlı ancak bu görevde çalıştırılmaz."
        );
        console.error(`Beklenen project ID: ${EXPECTED_PROJECT_ID}`);
        console.error("Manuel onay + service account (repo dışı) gerekir. Çıkılıyor.");
        process.exit(2);
    }

    const records = loadFixture(args.fixture);
    const report = runUsernameDryRun(records);
    const safety = assertNoWriteApi();

    const output = {
        meta: {
            dataSource: "sanitized-fixture",
            fixturePath: args.fixture,
            projectId: null,
            productionAccess: false,
            ...safety
        },
        summary: report.summary
    };

    console.log(JSON.stringify(output, null, 2));
}

main();
