import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
    shouldConnectFirestoreEmulator,
    shouldConnectAuthEmulator,
    isLocalDevHost
} from "../legacyAuthCompat.js";
import {
    evaluateAuthGuard,
    AUTH_GUARD_STATE,
    parseOwnerMembership,
    MEMBERSHIP_ROLE_OWNER,
    MEMBERSHIP_STATUS_ACTIVE
} from "../authGuard.js";
import { createAuthStateMachine } from "../authStateMachine.js";
import { resolveSafeStaticPath } from "../scripts/dev-static-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const seed = require("../functions/scripts/seed-emulator-membership.js");
const authGuardCjs = require("../functions/lib/authGuard.cjs");

const SEED_SRC = resolve(ROOT, "functions/scripts/seed-emulator-membership.js");
const FIREBASE_CONFIG_SRC = resolve(ROOT, "firebase-config.js");
const DEV_AUTH_STATE_SRC = resolve(ROOT, "dev-auth-state.js");
const FIXTURE_SRC = resolve(ROOT, "fixtures/auth-emulator-users.json");

const okSeedArgs = {
    emulatorOnly: true,
    confirmProject: seed.EXPECTED_PROJECT_ID
};

const okEnv = {
    authEmulatorHost: "127.0.0.1:9099",
    firestoreEmulatorHost: "127.0.0.1:8080"
};

function ownerDoc(uid, businessId) {
    return { uid, businessId, role: "owner", status: "active" };
}

describe("seed emulator guards — fail-closed", () => {
    it("Auth Emulator hostu yoksa blocked", () => {
        const g = seed.validateEmulatorSeedGuards(okSeedArgs, {
            authEmulatorHost: null,
            firestoreEmulatorHost: okEnv.firestoreEmulatorHost
        });
        assert.equal(g.ok, false);
        assert.match(g.reason, /^auth_emulator_/);
    });

    it("Firestore Emulator hostu yoksa blocked", () => {
        const g = seed.validateEmulatorSeedGuards(okSeedArgs, {
            authEmulatorHost: okEnv.authEmulatorHost,
            firestoreEmulatorHost: null
        });
        assert.equal(g.ok, false);
        assert.match(g.reason, /^firestore_emulator_/);
    });

    it("harici hostname reddedilir", () => {
        const g = seed.validateEmulatorSeedGuards(okSeedArgs, {
            authEmulatorHost: "example.com:9099",
            firestoreEmulatorHost: okEnv.firestoreEmulatorHost
        });
        assert.equal(g.ok, false);
        assert.equal(g.reason, "auth_emulator_non_local_host");
    });

    it("--emulator-only olmadan çalışmaz", () => {
        const g = seed.validateEmulatorSeedGuards(
            { emulatorOnly: false, confirmProject: seed.EXPECTED_PROJECT_ID },
            okEnv
        );
        assert.equal(g.ok, false);
        assert.equal(g.reason, "missing_emulator_only_flag");
    });

    it("project doğrulaması zorunlu", () => {
        const g = seed.validateEmulatorSeedGuards(
            { emulatorOnly: true, confirmProject: "wrong-project" },
            okEnv
        );
        assert.equal(g.ok, false);
        assert.equal(g.reason, "confirm_project_mismatch");
    });
});

describe("seed emulator — privacy & fixture", () => {
    it("şifre loglanmaz (kaynak kontrolü)", () => {
        const src = readFileSync(SEED_SRC, "utf8");
        assert.doesNotMatch(src, /console\.(log|info|debug|warn)\([^)]*password/i);
        assert.doesNotMatch(src, /password:\s*["'`]/i);
    });

    it("fixture tamamen sentetiktir", () => {
        const fixture = JSON.parse(readFileSync(FIXTURE_SRC, "utf8"));
        assert.ok(fixture.syntheticEmailDomain.includes("internal"));
        for (const user of fixture.users) {
            assert.match(user.username, /^[a-z0-9._-]+$/);
            assert.match(user.businessId, /^shop-emulator-/);
            assert.equal(Object.prototype.hasOwnProperty.call(user, "password"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(user, "email"), false);
        }
    });
});

describe("seed emulator — idempotency & membership", () => {
    it("ikinci çalıştırmada duplicate kullanıcı oluşturmaz", async () => {
        let createCalls = 0;
        const auth = {
            getUserByEmail: async () => {
                throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
            },
            createUser: async () => {
                createCalls += 1;
                return { uid: "uid-emulator-1" };
            }
        };

        const store = new Map();
        const firestore = {
            doc: (_col, id) => ({ id }),
            get: async (ref) => ({
                exists: store.has(ref.id),
                data: () => store.get(ref.id)
            }),
            set: async (ref, data) => {
                store.set(ref.id, { ...data });
            }
        };

        const deps = {
            args: okSeedArgs,
            password: "synthetic-test-pass-01",
            auth,
            firestore,
            loadFixture: seed.loadEmulatorFixture,
            env: okEnv
        };

        await seed.runEmulatorSeed(deps);
        auth.getUserByEmail = async () => ({ uid: "uid-emulator-1" });
        await seed.runEmulatorSeed(deps);

        assert.equal(createCalls, 1);
    });

    it("membership doc UID ile eşleşir", () => {
        const doc = seed.buildMembershipDoc("uid-abc", "shop-emulator-a");
        const parsed = parseOwnerMembership(doc, "uid-abc");
        assert.equal(parsed?.businessId, "shop-emulator-a");
        assert.equal(parseOwnerMembership(doc, "other-uid"), null);
    });

    it("authGuard.cjs client parseOwnerMembership ile parity", () => {
        const data = { uid: "u1", businessId: "shop-emulator-a", role: "owner", status: "active" };
        assert.deepEqual(authGuardCjs.parseOwnerMembership(data, "u1"), parseOwnerMembership(data, "u1"));
    });
});

describe("membership → authenticated_owner", () => {
    it("geçerli membership authenticated_owner üretir", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-emulator-a")
        });
        await m.handleAuthUser({ uid: "u1" });
        const g = m.getSnapshot().guard;
        assert.equal(g.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
        assert.equal(g.businessId, "shop-emulator-a");
    });

    it("geçersiz role owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ({
                uid: "u1",
                businessId: "shop-emulator-a",
                role: "employee",
                status: "active"
            })
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("geçersiz status owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ({
                uid: "u1",
                businessId: "shop-emulator-a",
                role: "owner",
                status: "pending"
            })
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("geçersiz businessId owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ({
                uid: "u1",
                businessId: "",
                role: "owner",
                status: "active"
            })
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("uid uyuşmazlığı owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("other", "shop-emulator-a")
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });
});

describe("Firestore emulator gating", () => {
    it("production host üzerinde bağlanmaz", () => {
        assert.equal(
            shouldConnectFirestoreEmulator({
                hostname: "berberv1.vercel.app",
                search: "?authEmulator=1"
            }),
            false
        );
    });

    it("localhost flag olmadan bağlanmaz", () => {
        assert.equal(shouldConnectFirestoreEmulator({ hostname: "localhost", search: "" }), false);
    });

    it("localhost + flag ile bağlanır", () => {
        assert.equal(
            shouldConnectFirestoreEmulator({ hostname: "localhost", search: "?authEmulator=1" }),
            true
        );
    });

    it("firebase-config connectFirestoreEmulator gated", () => {
        const src = readFileSync(FIREBASE_CONFIG_SRC, "utf8");
        assert.match(src, /shouldConnectFirestoreEmulator\(\)/);
        assert.match(src, /connectFirestoreEmulator\(db,\s*FIRESTORE_EMULATOR_HOST,\s*FIRESTORE_EMULATOR_PORT\)/);
        assert.match(src, /typeof window !== "undefined"/);
    });
});

describe("legacy storage / URL isolation", () => {
    it("localStorage forge authenticated_owner üretmez", () => {
        const r = evaluateAuthGuard({
            authLoading: false,
            membershipLoading: false,
            firebaseUser: null,
            membership: null,
            error: null,
            legacyAuthMode: "legacy"
        });
        assert.notEqual(r.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("sessionStorage legacy authenticated_owner üretmez", () => {
        const r = evaluateAuthGuard({
            authLoading: false,
            membershipLoading: false,
            firebaseUser: null,
            membership: null,
            error: null,
            legacyAuthMode: "legacy"
        });
        assert.equal(r.state, AUTH_GUARD_STATE.LEGACY_ONLY);
        assert.equal(r.businessId, undefined);
    });

    it("URL dukkan parametresi membership businessId değiştirmez", () => {
        const r = evaluateAuthGuard({
            authLoading: false,
            membershipLoading: false,
            firebaseUser: { uid: "u1" },
            membership: ownerDoc("u1", "shop-emulator-a"),
            error: null,
            legacyAuthMode: "none"
        });
        assert.equal(r.businessId, "shop-emulator-a");
        assert.notEqual(r.businessId, "forged-from-url-slug");
    });
});

describe("dev auth state observer — production block", () => {
    it("production host üzerinde çalışmaz", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.match(src, /shouldConnectAuthEmulator\(\)/);
        assert.doesNotMatch(src, /firebaseUser\.uid/);
        assert.doesNotMatch(src, /getIdToken/);
        assert.doesNotMatch(src, /\.email/);
    });

    it("yalnız guard state ve businessId gösterir", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.match(src, /guard\.state/);
        assert.match(src, /guard\.businessId/);
        assert.doesNotMatch(src, /snapshot\.membership\b/);
        assert.doesNotMatch(src, /firebaseUser/);
    });
});

describe("dev static server — path safety", () => {
    it("path traversal reddedilir", () => {
        const r = resolveSafeStaticPath("/../outside.txt", ROOT);
        assert.equal(r.ok, false);
        assert.equal(r.reason, "path_traversal");
    });

    it("dotfile erişimi reddedilir", () => {
        const r = resolveSafeStaticPath("/.env", ROOT);
        assert.equal(r.ok, false);
        assert.equal(r.reason, "dotfile");
    });

    it(".git içeriği reddedilir", () => {
        const r = resolveSafeStaticPath("/.git/config", ROOT);
        assert.equal(r.ok, false);
        assert.equal(r.reason, "dotfile");
    });

    it("geçerli dosya yolu kabul edilir", () => {
        const r = resolveSafeStaticPath("/giris.html", ROOT);
        assert.equal(r.ok, true);
        assert.match(r.absolute, /giris\.html$/);
    });
});

describe("production network isolation", () => {
    it("seed testleri production ağına bağlanmaz", () => {
        const src = readFileSync(SEED_SRC, "utf8");
        assert.doesNotMatch(src, /firebase deploy/);
        assert.doesNotMatch(src, /applicationDefault/);
        assert.doesNotMatch(src, /serviceAccount/);
    });

    it("isLocalDevHost production hostname reddeder", () => {
        assert.equal(isLocalDevHost("berberv1.vercel.app"), false);
        assert.equal(shouldConnectAuthEmulator({ hostname: "berberrandevu-20a3e.web.app", search: "?authEmulator=1" }), false);
    });
});
