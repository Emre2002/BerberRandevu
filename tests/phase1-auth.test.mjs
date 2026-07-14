import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    normalizeUsername,
    normalizeAndValidateUsername,
    validateNormalizedUsername
} from "../usernameNormalization.js";

import {
    parseOwnerMembership,
    MEMBERSHIP_ROLE_OWNER,
    MEMBERSHIP_STATUS_ACTIVE
} from "../authGuard.js";

import { evaluateAuthGuard, AUTH_GUARD_STATE } from "../authGuard.js";

import { shouldConnectAuthEmulator, isLocalDevHost } from "../legacyAuthCompat.js";

import { planUsernameMigration, isMigrationSafeToApply } from "../usernameMigration.js";

import { createAuthStateMachine } from "../authStateMachine.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function ownerDoc(uid, businessId) {
    return { uid, businessId, role: "owner", status: "active" };
}

describe("usernameNormalization", () => {
    it("trim ve lowercase uygular", () => {
        assert.equal(normalizeUsername("  TestUser  "), "testuser");
    });

    it("Türkçe I → ı", () => {
        assert.equal(normalizeUsername("IŞIK"), "ışık");
    });

    it("Türkçe İ → i", () => {
        assert.equal(normalizeUsername("İstanbul"), "istanbul");
    });

    it("deterministik tekrar üretim", () => {
        const a = normalizeUsername("  Ahmet_01  ");
        const b = normalizeUsername("  Ahmet_01  ");
        assert.equal(a, b);
        assert.equal(a, "ahmet_01");
    });

    it("geçersiz karakterleri reddeder", () => {
        const r = normalizeAndValidateUsername("ab@cd");
        assert.equal(r.ok, false);
        assert.equal(r.reason, "invalid_chars");
    });

    it("çok kısa kullanıcı adını reddeder", () => {
        const r = validateNormalizedUsername("ab");
        assert.equal(r.ok, false);
        assert.equal(r.reason, "too_short");
    });
});

describe("authGuard", () => {
    const base = {
        authLoading: false,
        membershipLoading: false,
        firebaseUser: null,
        membership: null,
        error: null,
        legacyAuthMode: "none"
    };

    it("auth yokken unauthenticated", () => {
        assert.equal(evaluateAuthGuard(base).state, AUTH_GUARD_STATE.UNAUTHENTICATED);
    });

    it("sessionStorage legacy authenticated_owner üretmez", () => {
        const r = evaluateAuthGuard({ ...base, legacyAuthMode: "legacy" });
        assert.equal(r.state, AUTH_GUARD_STATE.LEGACY_ONLY);
        assert.equal(r.businessId, undefined);
    });

    it("localStorage isAdmin forge authenticated_owner üretmez", () => {
        const r = evaluateAuthGuard({ ...base, legacyAuthMode: "legacy" });
        assert.notEqual(r.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("firebase user membership yoksa authenticated_without_membership", () => {
        const r = evaluateAuthGuard({
            ...base,
            firebaseUser: { uid: "uid-1" }
        });
        assert.equal(r.state, AUTH_GUARD_STATE.AUTHENTICATED_WITHOUT_MEMBERSHIP);
    });

    it("firebase user + owner membership → authenticated_owner", () => {
        const membership = {
            uid: "uid-1",
            businessId: "shop-a",
            role: MEMBERSHIP_ROLE_OWNER,
            status: MEMBERSHIP_STATUS_ACTIVE
        };
        const r = evaluateAuthGuard({
            ...base,
            firebaseUser: { uid: "uid-1" },
            membership
        });
        assert.equal(r.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
        assert.equal(r.businessId, "shop-a");
    });

    it("owner dışı role yetki vermez", () => {
        const r = evaluateAuthGuard({
            ...base,
            firebaseUser: { uid: "uid-1" },
            membership: {
                uid: "uid-1",
                businessId: "shop-a",
                role: "employee",
                status: MEMBERSHIP_STATUS_ACTIVE
            }
        });
        assert.equal(r.state, AUTH_GUARD_STATE.AUTHENTICATED_WITHOUT_MEMBERSHIP);
    });

    it("businessId yalnız membership belgesinden", () => {
        const r = evaluateAuthGuard({
            ...base,
            firebaseUser: { uid: "uid-1" },
            membership: {
                uid: "uid-1",
                businessId: "shop-b",
                role: MEMBERSHIP_ROLE_OWNER,
                status: MEMBERSHIP_STATUS_ACTIVE
            }
        });
        assert.equal(r.businessId, "shop-b");
    });

    it("auth loading tamamlanmadan authenticated kararı vermez", () => {
        const r = evaluateAuthGuard({
            ...base,
            authLoading: true,
            firebaseUser: { uid: "uid-1" },
            membership: {
                uid: "uid-1",
                businessId: "shop-a",
                role: MEMBERSHIP_ROLE_OWNER,
                status: MEMBERSHIP_STATUS_ACTIVE
            }
        });
        assert.equal(r.state, AUTH_GUARD_STATE.LOADING);
    });
});

describe("parseOwnerMembership", () => {
    it("active owner membership parse eder", () => {
        const m = parseOwnerMembership(
            { uid: "u1", businessId: "shop-a", role: "owner", status: "active" },
            "u1"
        );
        assert.equal(m?.businessId, "shop-a");
    });

    it("uid uyuşmazlığında null", () => {
        assert.equal(
            parseOwnerMembership(
                { uid: "other", businessId: "shop-a", role: "owner", status: "active" },
                "u1"
            ),
            null
        );
    });
});

describe("auth emulator gating", () => {
    it("production host emulator'a bağlanmaz", () => {
        assert.equal(
            shouldConnectAuthEmulator({ hostname: "berberv1.vercel.app", search: "?authEmulator=1" }),
            false
        );
    });

    it("localhost flag olmadan emulator'a bağlanmaz", () => {
        assert.equal(shouldConnectAuthEmulator({ hostname: "localhost", search: "" }), false);
    });

    it("localhost + flag ile bağlanır", () => {
        assert.equal(
            shouldConnectAuthEmulator({ hostname: "localhost", search: "?authEmulator=1" }),
            true
        );
    });

    it("IPv6 ::1 + flag ile bağlanır", () => {
        assert.equal(shouldConnectAuthEmulator({ hostname: "::1", search: "?useEmulators=1" }), true);
        assert.equal(shouldConnectAuthEmulator({ hostname: "[::1]", search: "?authEmulator=1" }), true);
    });

    it("IPv6 ::1 flag olmadan bağlanmaz (fail-closed)", () => {
        assert.equal(shouldConnectAuthEmulator({ hostname: "::1", search: "" }), false);
    });

    it("isLocalDevHost yalnız bilinen localhost'ları kabul eder", () => {
        assert.equal(isLocalDevHost("localhost"), true);
        assert.equal(isLocalDevHost("127.0.0.1"), true);
        assert.equal(isLocalDevHost("::1"), true);
        assert.equal(isLocalDevHost("berberv1.vercel.app"), false);
    });
});

describe("canonical username golden vectors", () => {
    const cases = [
        ["I", "ı"],
        ["İ", "i"],
        ["ı", "ı"],
        ["i", "i"],
        ["  IŞIK  ", "ışık"],
        ["İSTANBUL", "istanbul"],
        ["ＡＢＣ123", "abc123"]
    ];
    for (const [input, expected] of cases) {
        it(`"${input}" → "${expected}"`, () => {
            assert.equal(normalizeUsername(input), expected);
        });
    }

    it("görünmez karakter charset ile reddedilir", () => {
        const r = normalizeAndValidateUsername("ab\u200bcd");
        assert.equal(r.ok, false);
        assert.equal(r.reason, "invalid_chars");
    });

    it("maksimum uzunluk aşımı reddedilir", () => {
        const r = validateNormalizedUsername("a".repeat(33));
        assert.equal(r.ok, false);
        assert.equal(r.reason, "too_long");
    });
});

describe("username migration dry-run", () => {
    it("değişen kaydı raporlar (full-width)", () => {
        const plan = planUsernameMigration([{ slug: "a", username: "ｊohn123" }]);
        assert.equal(plan.changes.length, 1);
        assert.equal(plan.changes[0].to, "john123");
    });

    it("collision tespit eder ama otomatik bağlamaz", () => {
        const plan = planUsernameMigration([
            { slug: "x", username: "JOHN" },
            { slug: "y", username: "john" }
        ]);
        assert.equal(plan.collisions.length, 1);
        assert.equal(plan.collisions[0].canonical, "john");
        assert.deepEqual(plan.collisions[0].slugs.sort(), ["x", "y"]);
        assert.equal(isMigrationSafeToApply(plan), false);
    });

    it("collision yoksa migration safe", () => {
        const plan = planUsernameMigration([
            { slug: "x", username: "john" },
            { slug: "y", username: "jane" }
        ]);
        assert.equal(plan.collisions.length, 0);
        assert.equal(isMigrationSafeToApply(plan), true);
    });

    it("boş normalize invalid olarak raporlanır", () => {
        const plan = planUsernameMigration([{ slug: "z", username: "  " }]);
        assert.equal(plan.invalid.length, 1);
        assert.equal(isMigrationSafeToApply(plan), false);
    });
});

describe("authStateMachine — membership fail-closed", () => {
    it("malformed membership owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ({ garbage: true })
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.equal(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_WITHOUT_MEMBERSHIP);
    });

    it("uid/doc uyuşmazlığı owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("other", "shop-a")
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("geçersiz businessId owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ({ uid: "u1", businessId: 123, role: "owner", status: "active" })
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("fetch hatası fail-closed (ERROR, owner değil)", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => {
                throw new Error("firestore down");
            }
        });
        await m.handleAuthUser({ uid: "u1" });
        const g = m.getSnapshot().guard;
        assert.equal(g.state, AUTH_GUARD_STATE.ERROR);
    });

    it("geçerli owner membership authenticated_owner üretir", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-a")
        });
        await m.handleAuthUser({ uid: "u1" });
        const g = m.getSnapshot().guard;
        assert.equal(g.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
        assert.equal(g.businessId, "shop-a");
    });
});

describe("authStateMachine — race / generation guard", () => {
    it("kullanıcı değişiminde eski istek yeni state'i overwrite etmez", async () => {
        const resolvers = {};
        const m = createAuthStateMachine({
            fetchMembership: (uid) =>
                new Promise((res) => {
                    resolvers[uid] = () => res(ownerDoc(uid, uid === "A" ? "shop-a" : "shop-b"));
                })
        });

        m.handleAuthUser({ uid: "A" });
        m.handleAuthUser({ uid: "B" });

        resolvers.A(); // eski istek geç tamamlanır → yok sayılmalı
        await tick();
        resolvers.B();
        await tick();

        const g = m.getSnapshot().guard;
        assert.equal(g.businessId, "shop-b");
    });

    it("sign-out sonrası geç tamamlanan eski istek owner üretmez", async () => {
        const resolvers = {};
        const m = createAuthStateMachine({
            fetchMembership: (uid) =>
                new Promise((res) => {
                    resolvers[uid] = () => res(ownerDoc(uid, "shop-a"));
                })
        });

        m.handleAuthUser({ uid: "A" });
        await m.handleAuthUser(null); // sign-out

        resolvers.A();
        await tick();

        const g = m.getSnapshot().guard;
        assert.notEqual(g.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });
});

describe("authStateMachine — signOut", () => {
    it("signOut adapter'ı çağırır; sonra null user owner temizler", async () => {
        let called = 0;
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-a"),
            authAdapter: {
                signOut: async () => {
                    called += 1;
                }
            }
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.equal(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);

        await m.signOut();
        assert.equal(called, 1);

        await m.handleAuthUser(null); // gerçek Firebase'de listener tetikler
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });

    it("signOut hatası fail-closed (owner state üretmez)", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-a"),
            authAdapter: {
                signOut: async () => {
                    throw new Error("network");
                }
            }
        });
        await m.handleAuthUser({ uid: "u1" });
        await assert.rejects(() => m.signOut(), /network/);
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
    });
});

describe("authStateMachine — legacy & determinism", () => {
    it("legacy mode tek başına owner üretmez", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => null,
            legacyModeProvider: () => "legacy"
        });
        await m.handleAuthUser(null);
        assert.equal(m.getSnapshot().guard.state, AUTH_GUARD_STATE.LEGACY_ONLY);
    });

    it("her handleAuthUser generation'ı artırır", async () => {
        const m = createAuthStateMachine({ fetchMembership: async () => null });
        const g0 = m.getGeneration();
        await m.handleAuthUser({ uid: "A" });
        await m.handleAuthUser({ uid: "B" });
        assert.equal(m.getGeneration(), g0 + 2);
    });
});
