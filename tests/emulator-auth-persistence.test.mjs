import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAuthGuard, AUTH_GUARD_STATE } from "../authGuard.js";
import { createAuthStateMachine } from "../authStateMachine.js";
import { shouldUseEmulatorAuthLogin } from "../legacyAuthCompat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const EMULATOR_AUTH_LOGIN_SRC = resolve(ROOT, "emulatorAuthLogin.js");
const GIRIS_SRC = resolve(ROOT, "giris.js");
const DEV_AUTH_STATE_SRC = resolve(ROOT, "dev-auth-state.js");
const AUTH_SERVICE_SRC = resolve(ROOT, "authService.js");
const RUNBOOK_SRC = resolve(ROOT, "EMULATOR_MEMBERSHIP_E2E_RUNBOOK.md");

function ownerDoc(uid, businessId) {
    return { uid, businessId, role: "owner", status: "active" };
}

describe("emulator auth persistence — sign-in sırası", () => {
    it("sign-in öncesi ensureAuthFoundationInitialized await edilir", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        const signInIdx = src.indexOf("await signInWithEmailAndPassword");
        const ensureIdx = src.indexOf("await ensureAuthFoundationInitialized()");
        assert.ok(signInIdx > -1);
        assert.ok(ensureIdx > -1);
        assert.ok(ensureIdx < signInIdx);
    });

    it("sign-in sonrası currentUser doğrulanır", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        assert.match(src, /if \(!auth\.currentUser\)/);
        assert.match(src, /emulator_auth_signin_failed/);
    });

    it("authService persistence listener'dan önce kurulur", () => {
        const src = readFileSync(AUTH_SERVICE_SRC, "utf8");
        const persistenceIdx = src.indexOf("await setPersistence(auth, browserLocalPersistence)");
        const listenerIdx = src.indexOf("onAuthStateChanged(auth");
        assert.ok(persistenceIdx > -1);
        assert.ok(listenerIdx > persistenceIdx);
    });
});

describe("emulator login — redirect ve auth izolasyon", () => {
    it("production host emulator login yolunu açamaz", () => {
        assert.equal(
            shouldUseEmulatorAuthLogin({
                hostname: "berberv1.vercel.app",
                search: "?authEmulator=1"
            }),
            false
        );
        const src = readFileSync(GIRIS_SRC, "utf8");
        assert.match(src, /signInWithProductionOwnerAuth\(username, password\)/);
        assert.doesNotMatch(src, /resolveBarberLogin\(username, password\)/);
    });

    it("sign-in başarısız olduğunda redirect olmaz", () => {
        const src = readFileSync(GIRIS_SRC, "utf8");
        const catchBlock = src.match(/catch \(err\) \{([\s\S]*?)\} finally/);
        assert.ok(catchBlock);
        assert.doesNotMatch(catchBlock[1], /window\.location/);
    });

    it("sign-in başarılı olduktan sonra membership tabanlı redirect olur", () => {
        const src = readFileSync(GIRIS_SRC, "utf8");
        const emulatorBranch = src.match(
            /if \(shouldUseEmulatorAuthLogin\(\)\) \{([\s\S]*?)return;\s*\}/
        );
        assert.ok(emulatorBranch);
        const branch = emulatorBranch[1];
        const signInIdx = branch.indexOf("await signInWithEmulatorAuth");
        const redirectIdx = branch.indexOf("redirectAfterAuth");
        assert.ok(signInIdx > -1);
        assert.ok(redirectIdx > signInIdx);
        assert.doesNotMatch(branch, /loginBarberSession/);
    });
});

describe("dev-auth-state observer — state ayrımı", () => {
    it("ilk Auth callback gelene kadar loading gösterir", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.match(src, /isAuthStateKnown\(\)/);
        assert.match(src, /Auth yükleniyor/);
    });

    it("ERROR state unauthenticated gibi gizlenmez", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.match(src, /AUTH_GUARD_STATE\.ERROR/);
        assert.match(src, /fail-closed/);
    });

    it("UID/email/token/password loglanmaz", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/);
        assert.doesNotMatch(src, /\.uid/);
        assert.doesNotMatch(src, /getIdToken/);
        assert.doesNotMatch(src, /\.email/);
        assert.doesNotMatch(src, /password/i);
    });

    it("membership lookup başarısız olsa bile membershipLookupStarted true olur", () => {
        const src = readFileSync(DEV_AUTH_STATE_SRC, "utf8");
        assert.match(src, /Boolean\(snapshot\.error\)/);
        assert.match(src, /membershipErrorPresent/);
    });
});

describe("auth state machine — membership öncesi/sonrası", () => {
    it("null Auth callback unauthenticated üretir", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-a")
        });
        await m.handleAuthUser(null);
        assert.equal(m.getSnapshot().guard.state, AUTH_GUARD_STATE.UNAUTHENTICATED);
    });

    it("Auth user callback membership lookup başlatır", async () => {
        let started = false;
        const m = createAuthStateMachine({
            fetchMembership: async () => {
                started = true;
                return ownerDoc("u1", "shop-a");
            }
        });
        const pending = m.handleAuthUser({ uid: "u1" });
        assert.equal(m.getSnapshot().membershipLoading, true);
        await pending;
        assert.equal(started, true);
    });

    it("geçerli membership authenticated_owner üretir", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => ownerDoc("u1", "shop-emulator-a")
        });
        await m.handleAuthUser({ uid: "u1" });
        const g = m.getSnapshot().guard;
        assert.equal(g.state, AUTH_GUARD_STATE.AUTHENTICATED_OWNER);
        assert.equal(g.businessId, "shop-emulator-a");
    });

    it("membership yoksa authenticated_without_membership üretir", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => null
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.equal(
            m.getSnapshot().guard.state,
            AUTH_GUARD_STATE.AUTHENTICATED_WITHOUT_MEMBERSHIP
        );
    });

    it("fetch hatası error state üretir (unauthenticated değil)", async () => {
        const m = createAuthStateMachine({
            fetchMembership: async () => {
                throw new Error("firestore unavailable");
            }
        });
        await m.handleAuthUser({ uid: "u1" });
        assert.equal(m.getSnapshot().guard.state, AUTH_GUARD_STATE.ERROR);
        assert.notEqual(m.getSnapshot().guard.state, AUTH_GUARD_STATE.UNAUTHENTICATED);
    });
});

describe("origin kuralı — runbook", () => {
    it("localhost/127.0.0.1 karışıklığı açıkça engellenir", () => {
        const src = readFileSync(RUNBOOK_SRC, "utf8");
        assert.match(src, /127\.0\.0\.1/);
        assert.match(src, /localhost.*farklı origin/i);
    });
});

describe("production network isolation", () => {
    it("persistence testleri production ağına bağlanmaz", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        assert.doesNotMatch(src, /firebase deploy/);
        assert.doesNotMatch(src, /applicationDefault/);
    });
});

describe("emulator firestore config — firebase.emulator.json", () => {
    const prodCfg = JSON.parse(readFileSync(resolve(ROOT, "firebase.json"), "utf8"));
    const emulatorConfig = JSON.parse(readFileSync(resolve(ROOT, "firebase.emulator.json"), "utf8"));

    it("firebase.emulator.json mevcuttur", () => {
        assert.ok(emulatorConfig.firestore);
    });

    it("firebase.emulator.json top-level firestore.rules firestore.emulator.rules kullanır", () => {
        assert.equal(emulatorConfig.firestore.rules, "firestore.emulator.rules");
    });

    it("firebase.json top-level firestore.rules production firestore.rules olarak kalır", () => {
        assert.equal(prodCfg.firestore.rules, "firestore.rules");
    });

    it("firebase.json içinde emulators.firestore.rules bulunmaz", () => {
        assert.equal(prodCfg.emulators?.firestore?.rules, undefined);
    });

    it("npm run serve firebase.emulator.json config kullanır", () => {
        const pkg = JSON.parse(readFileSync(resolve(ROOT, "functions/package.json"), "utf8"));
        assert.match(pkg.scripts.serve, /--config\s+\.\.\/firebase\.emulator\.json/);
        assert.doesNotMatch(pkg.scripts.serve, /--config\s+\.\.\/firebase\.json/);
    });
});

describe("emulator firestore rules — businessMemberships security", () => {
    const rules = readFileSync(resolve(ROOT, "firestore.emulator.rules"), "utf8");
    const membershipBlock = rules.match(
        /match \/businessMemberships\/\{membershipUid\} \{([\s\S]*?)\n    \}/
    );

    it("businessMemberships bloğu tanımlıdır", () => {
        assert.ok(membershipBlock);
    });

    it("kendi UID membership belgesine get izni verir", () => {
        assert.match(membershipBlock[1], /allow get:/);
        assert.match(membershipBlock[1], /request\.auth\.uid == membershipUid/);
    });

    it("list/create/update/delete reddedilir", () => {
        assert.match(membershipBlock[1], /allow list, create, update, delete: if false/);
    });

    it("geniş allow read kullanılmaz (businessMemberships)", () => {
        assert.doesNotMatch(membershipBlock[1], /allow read:/);
    });

    it("businessMemberships client write açık değildir", () => {
        assert.doesNotMatch(membershipBlock[1], /allow write: if true/);
    });

    it("unauthenticated erişim koşulu auth gerektirir", () => {
        assert.match(membershipBlock[1], /request\.auth != null/);
    });

    it("production firestore.rules dosyası membership güvenli model içerir", () => {
        const prodRules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        assert.match(prodRules, /businessMemberships/);
    });
});
