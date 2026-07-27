#!/usr/bin/env node
/**
 * Emulator-only Auth user + businessMemberships seed aracı.
 * Production'a bağlanmaz; FIREBASE_AUTH_EMULATOR_HOST ve FIRESTORE_EMULATOR_HOST zorunludur.
 *
 * Kullanım (emulator çalışırken):
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   EMULATOR_OWNER_PASSWORD=<yerel-şifre> \
 *   node scripts/seed-emulator-membership.js \
 *     --emulator-only --confirm-project=berberrandevu-20a3e
 */

const fs = require("fs");
const path = require("path");
const { normalizeAndValidateUsername } = require("../lib/usernameNormalization");
const {
    BUSINESS_MEMBERSHIPS_COLLECTION,
    MEMBERSHIP_ROLE_OWNER,
    MEMBERSHIP_STATUS_ACTIVE,
    parseOwnerMembership
} = require("../lib/authGuard.cjs");

const EXPECTED_PROJECT_ID = "berberrandevu-20a3e";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FIXTURE_PATH = path.join(__dirname, "..", "..", "fixtures", "auth-emulator-users.json");

/**
 * @param {string[]} argv
 */
function parseSeedArgs(argv) {
    const args = {
        emulatorOnly: false,
        confirmProject: null
    };
    for (const token of argv.slice(2)) {
        if (token === "--emulator-only") {
            args.emulatorOnly = true;
        } else if (token.startsWith("--confirm-project=")) {
            args.confirmProject = token.slice("--confirm-project=".length);
        }
    }
    return args;
}

/**
 * @param {string|null|undefined} hostValue
 * @returns {{ ok: boolean, reason?: string, host?: string, port?: string }}
 */
function parseEmulatorHost(hostValue) {
    if (!hostValue || typeof hostValue !== "string") {
        return { ok: false, reason: "missing_host" };
    }
    const trimmed = hostValue.trim();
    if (!trimmed) return { ok: false, reason: "missing_host" };

    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon <= 0) {
        return { ok: false, reason: "invalid_host_format" };
    }

    const host = trimmed.slice(0, lastColon).replace(/^\[/, "").replace(/\]$/, "");
    const port = trimmed.slice(lastColon + 1);

    if (!LOCAL_HOSTS.has(host)) {
        return { ok: false, reason: "non_local_host" };
    }
    if (!/^\d+$/.test(port)) {
        return { ok: false, reason: "invalid_port" };
    }

    return { ok: true, host, port };
}

/**
 * @param {ReturnType<typeof parseSeedArgs>} args
 * @param {{ authEmulatorHost?: string|null, firestoreEmulatorHost?: string|null }} env
 */
function validateEmulatorSeedGuards(args, env = {}) {
    if (!args || args.emulatorOnly !== true) {
        return { ok: false, reason: "missing_emulator_only_flag" };
    }
    if (!args.confirmProject) {
        return { ok: false, reason: "missing_confirm_project" };
    }
    if (args.confirmProject !== EXPECTED_PROJECT_ID) {
        return { ok: false, reason: "confirm_project_mismatch" };
    }

    const authHost = parseEmulatorHost(env.authEmulatorHost ?? process.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (!authHost.ok) {
        return { ok: false, reason: `auth_emulator_${authHost.reason}` };
    }

    const firestoreHost = parseEmulatorHost(
        env.firestoreEmulatorHost ?? process.env.FIRESTORE_EMULATOR_HOST
    );
    if (!firestoreHost.ok) {
        return { ok: false, reason: `firestore_emulator_${firestoreHost.reason}` };
    }

    return { ok: true, authHost, firestoreHost };
}

/**
 * @returns {{ syntheticEmailDomain: string, users: Array<{ username: string, businessId: string }> }}
 */
function loadEmulatorFixture() {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
    return JSON.parse(raw);
}

/**
 * @param {string} normalizedUsername
 * @param {string} domain
 */
function buildSyntheticEmail(normalizedUsername, domain) {
    return `${normalizedUsername}@${domain}`;
}

/**
 * @param {string} uid
 * @param {string} businessId
 */
function buildMembershipDoc(uid, businessId) {
    return {
        uid,
        businessId,
        role: MEMBERSHIP_ROLE_OWNER,
        status: MEMBERSHIP_STATUS_ACTIVE
    };
}

/**
 * @param {unknown} doc
 * @param {string} uid
 */
function membershipDocMatchesExpected(doc, uid, businessId) {
    const parsed = parseOwnerMembership(doc, uid);
    return parsed?.businessId === businessId;
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof parseSeedArgs>} deps.args
 * @param {string} deps.password
 * @param {{ getUserByEmail: Function, createUser: Function }} deps.auth
 * @param {{ doc: Function, set: Function, get: Function }} deps.firestore
 * @param {() => object} [deps.loadFixture]
 */
async function runEmulatorSeed({ args, password, auth, firestore, loadFixture = loadEmulatorFixture, env }) {
    const guard = validateEmulatorSeedGuards(args, env);
    if (!guard.ok) {
        const err = new Error(guard.reason);
        err.code = guard.reason;
        throw err;
    }

    if (!password || typeof password !== "string" || password.length < 6) {
        const err = new Error("missing_or_weak_password");
        err.code = "missing_or_weak_password";
        throw err;
    }

    const fixture = loadFixture();
    const domain = fixture.syntheticEmailDomain || "users.berberrandevu.internal";
    const results = [];

    for (const entry of fixture.users || []) {
        const validated = normalizeAndValidateUsername(entry?.username);
        if (!validated.ok) {
            const err = new Error("invalid_fixture_username");
            err.code = "invalid_fixture_username";
            throw err;
        }

        const businessId = String(entry.businessId || "").trim();
        if (!businessId) {
            const err = new Error("invalid_fixture_business_id");
            err.code = "invalid_fixture_business_id";
            throw err;
        }

        const authEmail = buildSyntheticEmail(validated.normalized, domain);
        let uid;

        try {
            const existing = await auth.getUserByEmail(authEmail);
            uid = existing.uid;
        } catch (err) {
            if (err?.code !== "auth/user-not-found") throw err;
            const created = await auth.createUser({
                email: authEmail,
                password,
                emailVerified: true
            });
            uid = created.uid;
        }

        const membershipRef = firestore.doc(BUSINESS_MEMBERSHIPS_COLLECTION, uid);
        const existingSnap = await firestore.get(membershipRef);
        const expectedDoc = buildMembershipDoc(uid, businessId);

        if (existingSnap.exists) {
            const data = existingSnap.data();
            if (!membershipDocMatchesExpected(data, uid, businessId)) {
                await firestore.set(membershipRef, {
                    ...expectedDoc,
                    updatedAt: new Date()
                }, { merge: true });
            }
        } else {
            await firestore.set(membershipRef, {
                ...expectedDoc,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        results.push({
            username: validated.normalized,
            businessId,
            uid,
            authEmailDomain: domain
        });
    }

    return { projectId: EXPECTED_PROJECT_ID, seeded: results };
}

async function main() {
    const args = parseSeedArgs(process.argv);
    const guard = validateEmulatorSeedGuards(args);
    if (!guard.ok) {
        console.error(`[seed-emulator] blocked: ${guard.reason}`);
        process.exit(2);
    }

    const password = process.env.EMULATOR_OWNER_PASSWORD;
    if (!password) {
        console.error("[seed-emulator] blocked: missing EMULATOR_OWNER_PASSWORD env var");
        process.exit(2);
    }

    process.env.GCLOUD_PROJECT = EXPECTED_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = EXPECTED_PROJECT_ID;

    const admin = require("firebase-admin");
    if (!admin.apps.length) {
        admin.initializeApp({ projectId: EXPECTED_PROJECT_ID });
    }

    const auth = admin.auth();
    const db = admin.firestore();

    const result = await runEmulatorSeed({
        args,
        password,
        auth: {
            getUserByEmail: (email) => auth.getUserByEmail(email),
            createUser: (data) => auth.createUser(data)
        },
        firestore: {
            doc: (collection, id) => db.collection(collection).doc(id),
            get: (ref) => ref.get(),
            set: (ref, data, opts) => ref.set(data, opts)
        }
    });

    console.log(
        JSON.stringify({
            ok: true,
            projectId: result.projectId,
            seededCount: result.seeded.length,
            usernames: result.seeded.map((r) => r.username),
            businessIds: result.seeded.map((r) => r.businessId)
        })
    );
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[seed-emulator] failed: ${err?.message || err}`);
        process.exit(1);
    });
}

module.exports = {
    EXPECTED_PROJECT_ID,
    FIXTURE_PATH,
    parseSeedArgs,
    parseEmulatorHost,
    validateEmulatorSeedGuards,
    loadEmulatorFixture,
    buildSyntheticEmail,
    buildMembershipDoc,
    membershipDocMatchesExpected,
    runEmulatorSeed
};
