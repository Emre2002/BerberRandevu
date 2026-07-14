#!/usr/bin/env node
/**
 * Production READ-ONLY username collector.
 *
 * !!! BU GÖREVDE ÇALIŞTIRILMAZ. Production'a bağlanmaz. !!!
 *
 * Güvenlik modeli:
 *  - Yalnız üç guard birlikte sağlanırsa bağlanır:
 *      --production-readonly --project=<id> --confirm-project=<id>
 *  - Sabit collection: "berberler" (generic --collection YOK)
 *  - Yalnız `username` projection okunur (password/phone/email vb. OKUNMAZ)
 *  - Hiçbir write API import/kullanım YOK
 *  - Raw slug/username diske veya stdout'a YAZILMAZ; yalnız maskeli özet
 *  - ADC (Application Default Credentials); repo'da service-account YOK
 */

import { createHash } from "node:crypto";
import { runUsernameDryRun } from "../usernameMigration.js";

export const EXPECTED_PROJECT_ID = "berberrandevu-20a3e";
export const FIXED_COLLECTION = "berberler";
export const PROJECTION_FIELDS = Object.freeze(["username"]);

/**
 * CLI argümanlarını ayrıştırır. Generic --collection kabul edilmez.
 * @param {string[]} argv
 */
export function parseCollectorArgs(argv) {
    const args = {
        productionReadonly: false,
        project: null,
        confirmProject: null
    };
    for (const token of argv.slice(2)) {
        if (token === "--production-readonly") {
            args.productionReadonly = true;
        } else if (token.startsWith("--project=")) {
            args.project = token.slice("--project=".length);
        } else if (token.startsWith("--confirm-project=")) {
            args.confirmProject = token.slice("--confirm-project=".length);
        }
        // Bilinmeyen/generic flag'ler (ör. --collection) yok sayılır.
    }
    return args;
}

/**
 * Üç kaynağın (sabit + CLI + runtime credential) tümü eşit olmalı.
 * @param {{ productionReadonly: boolean, project: string|null, confirmProject: string|null }} args
 * @param {string|null} runtimeProjectId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateProjectGuard(args, runtimeProjectId) {
    if (!args || args.productionReadonly !== true) {
        return { ok: false, reason: "missing_production_flag" };
    }
    if (!args.project || !args.confirmProject) {
        return { ok: false, reason: "missing_project_flags" };
    }
    if (args.project !== EXPECTED_PROJECT_ID) {
        return { ok: false, reason: "project_flag_mismatch" };
    }
    if (args.confirmProject !== EXPECTED_PROJECT_ID) {
        return { ok: false, reason: "confirm_project_mismatch" };
    }
    if (!runtimeProjectId) {
        return { ok: false, reason: "missing_runtime_project" };
    }
    if (runtimeProjectId !== EXPECTED_PROJECT_ID) {
        return { ok: false, reason: "runtime_project_mismatch" };
    }
    return { ok: true };
}

/**
 * Belge anlık görüntülerini {slug, username} kayıtlarına indirger.
 * Yalnız id (slug) ve username okunur; başka alan alınmaz.
 * @param {Array<{ id: string, get?: (f: string) => unknown, data?: () => object }>} docs
 */
export function mapDocsToRecords(docs) {
    const list = Array.isArray(docs) ? docs : [];
    return list.map((doc) => {
        const slug = String(doc?.id ?? "");
        let username;
        if (typeof doc?.get === "function") {
            const value = doc.get("username");
            if (typeof value === "string") username = value;
        } else if (typeof doc?.data === "function") {
            const value = doc.data()?.username;
            if (typeof value === "string") username = value;
        }
        return username === undefined ? { slug } : { slug, username };
    });
}

function maskUsernameValue(value) {
    if (!value || typeof value !== "string") return "(missing)";
    if (value.length <= 2) return "*".repeat(value.length);
    return `${value[0]}${"*".repeat(Math.min(value.length - 2, 6))}${value[value.length - 1]}`;
}

function hashSlug(slug) {
    return createHash("sha256").update(String(slug)).digest("hex").slice(0, 12);
}

/**
 * Dry-run raporunu yalnız maskeli referanslara dönüştürür.
 * Raw slug/username DÖNMEZ.
 * @param {Array<{slug: string, username?: string}>} records
 */
export function buildSanitizedOutput(records) {
    const report = runUsernameDryRun(records);

    const collisionGroupIds = new Map();
    let counter = 0;
    for (const group of report.collisionGroups) {
        counter += 1;
        const id = `CG-${String(counter).padStart(3, "0")}`;
        for (const slug of group.slugs) collisionGroupIds.set(slug, id);
    }

    const legacyDiffSlugs = new Set(report.legacyDiffers.map((d) => d.slug));
    const manualBySlug = new Map(report.requiresManualReview.map((r) => [r.slug, r.reasons]));

    const maskedReferences = records.map((rec) => ({
        slugHash: hashSlug(rec.slug),
        usernameMask: maskUsernameValue(rec.username),
        canonicalChanged: legacyDiffSlugs.has(rec.slug),
        collisionGroupId: collisionGroupIds.get(rec.slug) || null,
        manualReview: manualBySlug.has(rec.slug),
        reasons: manualBySlug.get(rec.slug) || []
    }));

    return {
        summary: report.summary,
        maskedReferences,
        _sensitiveFieldsExcluded: report._sensitiveFieldsExcluded
    };
}

/**
 * Çıktının hassas ham veri içermediğini doğrular (sanitization guard).
 * @param {object} output
 * @param {Array<{slug: string, username?: string}>} records
 */
export function assertOutputSanitized(output, records) {
    const json = JSON.stringify(output);
    for (const rec of records) {
        if (rec.slug && json.includes(`"${rec.slug}"`)) {
            throw new Error("sanitization_error: raw slug leaked");
        }
        if (typeof rec.username === "string" && rec.username.length > 2 && json.includes(rec.username)) {
            throw new Error("sanitization_error: raw username leaked");
        }
    }
    return true;
}

/**
 * Exit karar mantığı. Collision/invalid/missing → non-zero.
 * @param {object} output
 */
export function decideExitCode(output) {
    const s = output?.summary;
    if (!s) return 1;
    if (s.collisionGroupCount > 0) return 3;
    if (s.invalidCount > 0) return 4;
    if (s.missingUsernameCount > 0) return 5;
    if (!s.migrationSafeToApply) return 6;
    return 0;
}

/* c8 ignore start — production bağlantı yolu; bu görevde çalıştırılmaz ve test edilmez */
async function connectAndCollect() {
    // ADC ile firebase-admin; yalnız guard'lar geçtikten SONRA import edilir.
    const { initializeApp, applicationDefault } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");

    const app = initializeApp({
        credential: applicationDefault(),
        projectId: EXPECTED_PROJECT_ID
    });
    const db = getFirestore(app);

    // Yalnız username projection; tam belge getirilmez.
    const snap = await db.collection(FIXED_COLLECTION).select(...PROJECTION_FIELDS).get();
    return snap.docs;
}

function resolveRuntimeProjectId() {
    return (
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        null
    );
}

async function main() {
    const args = parseCollectorArgs(process.argv);
    const runtimeProjectId = resolveRuntimeProjectId();

    const guard = validateProjectGuard(args, runtimeProjectId);
    if (!guard.ok) {
        console.error(`[collector] guard failed: ${guard.reason}`);
        console.error(`Expected project: ${EXPECTED_PROJECT_ID}`);
        process.exit(2);
    }

    let records;
    try {
        const docs = await connectAndCollect();
        records = mapDocsToRecords(docs);
    } catch (err) {
        console.error(`[collector] query failed: ${err?.code || "error"}`);
        process.exit(7);
    }

    let output;
    try {
        output = buildSanitizedOutput(records);
        assertOutputSanitized(output, records);
    } catch (err) {
        console.error(`[collector] ${err?.message || "sanitization_error"}`);
        process.exit(8);
    }

    console.log(JSON.stringify({ meta: { productionAccess: true, writesPossible: false }, summary: output.summary, maskedReferenceCount: output.maskedReferences.length }, null, 2));
    process.exit(decideExitCode(output));
}
/* c8 ignore stop */

const isDirectRun =
    typeof process !== "undefined" &&
    process.argv[1] &&
    process.argv[1].endsWith("username-production-readonly.mjs");

if (isDirectRun) {
    main();
}
