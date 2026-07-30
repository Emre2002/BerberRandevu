#!/usr/bin/env node
/**
 * Emulator-only berberler/{slug} → publicBarbers/{slug} projection backfill.
 * Production'a bağlanmaz.
 *
 * Kullanım:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node scripts/backfill-emulator-public-barbers.js \
 *     --emulator-only --confirm-project=berberrandevu-20a3e
 *
 * Dry-run:
 *   ... --dry-run
 */

const path = require("path");
const { pathToFileURL } = require("url");

const EXPECTED_PROJECT_ID = "berberrandevu-20a3e";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_SLUGS = ["shop-emulator-a"];

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
    const args = {
        emulatorOnly: false,
        confirmProject: null,
        dryRun: false,
        slugs: []
    };
    for (const token of argv.slice(2)) {
        if (token === "--emulator-only") args.emulatorOnly = true;
        else if (token === "--dry-run") args.dryRun = true;
        else if (token.startsWith("--confirm-project=")) {
            args.confirmProject = token.slice("--confirm-project=".length);
        } else if (token.startsWith("--slug=")) {
            args.slugs.push(token.slice("--slug=".length));
        }
    }
    if (!args.slugs.length) args.slugs = [...DEFAULT_SLUGS];
    return args;
}

function parseEmulatorHost(hostValue) {
    if (!hostValue || typeof hostValue !== "string") {
        return { ok: false, reason: "missing_host" };
    }
    const trimmed = hostValue.trim();
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon <= 0) return { ok: false, reason: "invalid_host_format" };
    const host = trimmed.slice(0, lastColon).replace(/^\[/, "").replace(/\]$/, "");
    const port = trimmed.slice(lastColon + 1);
    if (!LOCAL_HOSTS.has(host)) return { ok: false, reason: "non_local_host" };
    if (!/^\d+$/.test(port)) return { ok: false, reason: "invalid_port" };
    return { ok: true, host, port };
}

function validateGuards(args) {
    if (!args.emulatorOnly) return { ok: false, reason: "missing_emulator_only_flag" };
    if (args.confirmProject !== EXPECTED_PROJECT_ID) {
        return { ok: false, reason: "confirm_project_mismatch" };
    }
    const fsHost = parseEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST);
    if (!fsHost.ok) return { ok: false, reason: `firestore_${fsHost.reason}` };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return { ok: false, reason: "adc_present" };
    }
    return { ok: true };
}

async function loadProjection() {
    const modPath = path.join(__dirname, "..", "..", "publicBarberProjection.js");
    return import(pathToFileURL(modPath).href);
}

async function main() {
    const args = parseArgs(process.argv);
    const guard = validateGuards(args);
    if (!guard.ok) {
        console.error(`[backfill-public-barbers] blocked: ${guard.reason}`);
        process.exit(2);
    }

    const {
        buildPublicBarberProjection,
        findLeakedSensitiveKeys,
        findUnexpectedProjectionKeys
    } = await loadProjection();

    process.env.GCLOUD_PROJECT = EXPECTED_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = EXPECTED_PROJECT_ID;

    const admin = require("firebase-admin");
    if (!admin.apps.length) {
        admin.initializeApp({ projectId: EXPECTED_PROJECT_ID });
    }
    const db = admin.firestore();

    let written = 0;
    const results = [];

    for (const slug of args.slugs) {
        const privateRef = db.collection("berberler").doc(slug);
        const privateSnap = await privateRef.get();
        if (!privateSnap.exists) {
            results.push({ slug, status: "skipped_missing_private" });
            continue;
        }

        const privateData = privateSnap.data() || {};
        const bookingOpen =
            privateData.status !== "passive" &&
            (privateData.subscriptionStatus !== "expired");

        const projection = buildPublicBarberProjection(privateData, slug, { bookingOpen });
        const leaked = findLeakedSensitiveKeys(projection);
        const unexpected = findUnexpectedProjectionKeys(projection);
        if (leaked.length || unexpected.length) {
            console.error(`[backfill-public-barbers] blocked: invalid_projection slug=${slug}`);
            process.exit(3);
        }

        if (!args.dryRun) {
            await db.collection("publicBarbers").doc(slug).set(
                { ...projection, updatedAt: new Date() },
                { merge: true }
            );
        }
        written += 1;
        results.push({ slug, status: args.dryRun ? "dry_run_would_write" : "written" });
    }

    console.log(
        JSON.stringify({
            ok: true,
            projectId: EXPECTED_PROJECT_ID,
            dryRun: args.dryRun,
            writtenCount: written,
            slugs: results.map((r) => r.slug),
            results
        })
    );
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[backfill-public-barbers] failed: ${err?.message || err}`);
        process.exit(1);
    });
}

module.exports = { parseArgs, validateGuards, parseEmulatorHost, EXPECTED_PROJECT_ID };
