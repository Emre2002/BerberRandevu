import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldConnectAuthEmulator } from "../legacyAuthCompat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const AUTH_SERVICE_SRC = resolve(ROOT, "authService.js");
const FIREBASE_CONFIG_SRC = resolve(ROOT, "firebase-config.js");
const ENTRY_POINTS = ["giris.js", "admin-auth.js", "super-admin.js"];

function readBootstrapFnBlock() {
    const src = readFileSync(AUTH_SERVICE_SRC, "utf8");
    const fnBlock = src.match(/export function bootstrapPassiveAuthFoundation\(\)[\s\S]*?^}/m);
    assert.ok(fnBlock, "bootstrapPassiveAuthFoundation tanımlı");
    return fnBlock[0];
}

describe("bootstrapPassiveAuthFoundation — runtime safety", () => {
    it("non-browser ortamda erken çıkış guard'ı mevcut", () => {
        const block = readBootstrapFnBlock();
        assert.match(block, /if \(typeof window === "undefined"\) return/);
    });

    it("ensureAuthFoundationInitialized non-browser guard'ı mevcut", () => {
        const src = readFileSync(AUTH_SERVICE_SRC, "utf8");
        assert.match(src, /export async function ensureAuthFoundationInitialized[\s\S]*?if \(typeof window === "undefined"\) return/);
    });

    it("ardışık çağrı idempotency guard'ları mevcut", () => {
        const src = readFileSync(AUTH_SERVICE_SRC, "utf8");
        assert.match(src, /if \(unsubscribeAuth\) return/);
        assert.match(src, /if \(initPromise\) return initPromise/);
    });
});

describe("bootstrapPassiveAuthFoundation — error handling", () => {
    it("init hatasını kontrollü yakalar (legacy etkilenmez)", () => {
        const block = readBootstrapFnBlock();
        assert.match(block, /\.catch\s*\(/);
        assert.doesNotMatch(block, /console\.(log|error|warn)\([^)]*err/i);
    });

    it("hassas veri loglanmaz", () => {
        const block = readBootstrapFnBlock();
        assert.doesNotMatch(block, /console\.(log|error|warn)\([^)]*(uid|token|email|password)/i);
    });
});

describe("bootstrapPassiveAuthFoundation — legacy isolation", () => {
    it("bootstrap signIn, yönlendirme veya legacy session API çağırmaz", () => {
        const block = readBootstrapFnBlock();
        assert.equal(/signInWith/.test(block), false);
        assert.equal(/loginBarberSession/.test(block), false);
        assert.equal(/logoutBarberSession/.test(block), false);
        assert.equal(/logoutSuperAdmin/.test(block), false);
        assert.equal(/window\.location\.(replace|href|assign)/.test(block), false);
        assert.equal(/initGate/.test(block), false);
    });

    it("ensureAuthFoundationInitialized yetki kararı veya yönlendirme yapmaz", () => {
        const src = readFileSync(AUTH_SERVICE_SRC, "utf8");
        const initBlock = src.match(
            /export async function ensureAuthFoundationInitialized[\s\S]*?^}/m
        );
        assert.ok(initBlock);
        assert.doesNotMatch(initBlock[0], /window\.location/);
        assert.doesNotMatch(initBlock[0], /loginBarberSession/);
        assert.doesNotMatch(initBlock[0], /logoutSuperAdmin/);
    });
});

describe("bootstrapPassiveAuthFoundation — entry point wiring", () => {
    for (const file of ENTRY_POINTS) {
        it(`${file} authService bootstrap çağırır`, () => {
            const src = readFileSync(resolve(ROOT, file), "utf8");
            assert.match(src, /from\s+["']\.\/authService\.js["']/);
            assert.match(src, /bootstrapPassiveAuthFoundation\s*\(\s*\)/);
        });
    }
});

describe("bootstrapPassiveAuthFoundation — emulator gating", () => {
    it("production hostname emulator kapalı (flag olsa bile)", () => {
        assert.equal(
            shouldConnectAuthEmulator({
                hostname: "berberv1.vercel.app",
                search: "?authEmulator=1"
            }),
            false
        );
    });

    it("localhost flag olmadan emulator kapalı", () => {
        assert.equal(shouldConnectAuthEmulator({ hostname: "localhost", search: "" }), false);
    });

    it("localhost + authEmulator=1 emulator yolu açık", () => {
        assert.equal(
            shouldConnectAuthEmulator({ hostname: "localhost", search: "?authEmulator=1" }),
            true
        );
    });

    it("connectAuthEmulator try/catch ile tekrarlı bağlantıya toleranslı", () => {
        const src = readFileSync(FIREBASE_CONFIG_SRC, "utf8");
        assert.match(src, /connectAuthEmulator/);
        assert.match(src, /emulator zaten bağlı/);
    });

    it("firebase-config tek Auth instance promise kullanır", () => {
        const src = readFileSync(FIREBASE_CONFIG_SRC, "utf8");
        assert.match(src, /if \(authInitPromise\) return authInitPromise/);
    });
});
