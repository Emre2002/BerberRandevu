import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { shouldConnectAuthEmulator, shouldUseEmulatorAuthLogin } from "../legacyAuthCompat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const resolver = require("../functions/lib/emulatorAuthResolver.js");
const usernameNorm = require("../functions/lib/usernameNormalization.js");

const EMULATOR_AUTH_LOGIN_SRC = resolve(ROOT, "emulatorAuthLogin.js");
const GIRIS_SRC = resolve(ROOT, "giris.js");
const FIREBASE_CONFIG_SRC = resolve(ROOT, "firebase-config.js");
const FUNCTIONS_INDEX_SRC = resolve(ROOT, "functions/index.js");
const RESOLVE_CALLABLE_SRC = resolve(ROOT, "functions/lib/resolveAuthIdentifierCallable.js");

describe("emulator auth gating — client", () => {
    it("production hostname emulator login yolunu açamaz", () => {
        assert.equal(
            shouldUseEmulatorAuthLogin({
                hostname: "berberv1.vercel.app",
                search: "?authEmulator=1"
            }),
            false
        );
    });

    it("localhost tek başına yeterli değil", () => {
        assert.equal(shouldUseEmulatorAuthLogin({ hostname: "localhost", search: "" }), false);
    });

    it("localhost + authEmulator=1 yolu açar", () => {
        assert.equal(
            shouldUseEmulatorAuthLogin({ hostname: "localhost", search: "?authEmulator=1" }),
            true
        );
    });

    it("shouldConnectAuthEmulator ile aynı sonuç", () => {
        const ctx = { hostname: "127.0.0.1", search: "?useEmulators=1" };
        assert.equal(shouldUseEmulatorAuthLogin(ctx), shouldConnectAuthEmulator(ctx));
    });
});

describe("emulatorAuthResolver — server-side", () => {
    let prevEmulator;

    beforeEach(() => {
        prevEmulator = process.env.FUNCTIONS_EMULATOR;
        process.env.FUNCTIONS_EMULATOR = "true";
        resolver._resetFixtureCacheForTests();
    });

    afterEach(() => {
        if (prevEmulator === undefined) {
            delete process.env.FUNCTIONS_EMULATOR;
        } else {
            process.env.FUNCTIONS_EMULATOR = prevEmulator;
        }
        resolver._resetFixtureCacheForTests();
    });

    it("geçerli fixture username authEmail döndürür", () => {
        const result = resolver.resolveEmulatorAuthIdentifier("emulator_owner");
        assert.equal(result.ok, true);
        assert.equal(result.authEmail, "emulator_owner@users.berberrandevu.internal");
        assert.equal(result.businessId, "shop-emulator-a");
    });

    it("invalid username reddedilir", () => {
        const result = resolver.resolveEmulatorAuthIdentifier("ab");
        assert.equal(result.ok, false);
        assert.equal(result.code, resolver.GENERIC_AUTH_ERROR);
    });

    it("fixture dışı username generic hata", () => {
        const result = resolver.resolveEmulatorAuthIdentifier("unknown_user_xyz");
        assert.equal(result.ok, false);
        assert.equal(result.code, resolver.GENERIC_AUTH_ERROR);
    });

    it("FUNCTIONS_EMULATOR yokken fail-closed", () => {
        delete process.env.FUNCTIONS_EMULATOR;
        const result = resolver.resolveEmulatorAuthIdentifier("emulator_owner");
        assert.equal(result.ok, false);
        assert.equal(result.code, "emulator_unavailable");
    });

    it("normalizeAndValidateUsername invalid_chars reddeder", () => {
        const r = usernameNorm.normalizeAndValidateUsername("bad@user");
        assert.equal(r.ok, false);
        assert.equal(r.reason, "invalid_chars");
    });
});

describe("emulator auth — client sentetik email üretmez", () => {
    it("emulatorAuthLogin.js sentetik domain veya email birleştirme yapmaz", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        assert.equal(src.includes("users.berberrandevu.internal"), false);
        assert.equal(/@\$\{/.test(src), false);
        assert.equal(/`[^`]*@\$\{/.test(src), false);
        assert.match(src, /callable\(\{\s*username\s*\}\)/);
        assert.doesNotMatch(src, /callable\(\{[^}]*password/);
    });

    it("giris.js production legacy yolunu korur", () => {
        const src = readFileSync(GIRIS_SRC, "utf8");
        assert.match(src, /resolveBarberLogin\(username, password\)/);
        assert.match(src, /shouldUseEmulatorAuthLogin\(\)/);
        assert.match(src, /signInWithEmulatorAuth\(username, password\)/);
    });

    it("usernameNormalization.js sentetik email üretmez (client)", async () => {
        const mod = await import(pathToFileURL(resolve(ROOT, "usernameNormalization.js")).href);
        const src = readFileSync(resolve(ROOT, "usernameNormalization.js"), "utf8");
        assert.equal(src.includes("users.berberrandevu.internal"), false);
        assert.equal(typeof mod.normalizeAndValidateUsername, "function");
    });

    it("getResolveAuthIdentifierCallable yalnız emulator flag ile", () => {
        const src = readFileSync(FIREBASE_CONFIG_SRC, "utf8");
        assert.match(src, /if \(!shouldConnectAuthEmulator\(\)\) return null/);
        assert.match(src, /resolveAuthIdentifierForEmulator/);
    });
});

describe("emulator auth — functions callable güvenliği", () => {
    it("resolveAuthIdentifierForEmulator yalnız FUNCTIONS_EMULATOR=true iken export edilir", () => {
        const src = readFileSync(FUNCTIONS_INDEX_SRC, "utf8");
        assert.match(src, /if \(process\.env\.FUNCTIONS_EMULATOR === "true"\)/);
        assert.match(src, /exports\.resolveAuthIdentifierForEmulator = onCall/);
    });

    it("resolveAuthIdentifier callable password alanını reddeder", () => {
        const src = readFileSync(RESOLVE_CALLABLE_SRC, "utf8");
        assert.match(src, /hasOwnProperty\.call\(data,\s*"password"\)/);
        assert.doesNotMatch(src, /data\.password/);
        assert.doesNotMatch(src, /console\.(log|info|warn|error)/);
    });

    it("resolver modülü password parametresi veya data.password kullanmaz", () => {
        const src = readFileSync(resolve(ROOT, "functions/lib/emulatorAuthResolver.js"), "utf8");
        assert.doesNotMatch(src, /function resolveEmulatorAuthIdentifier\([^)]*password/i);
        assert.doesNotMatch(src, /data\.password/);
        assert.match(src, /normalizeAndValidateUsername/);
        assert.match(src, /GENERIC_AUTH_ERROR/);
    });
});

describe("emulator auth — legacy izolasyon", () => {
    it("giris.js emulator hata durumunda legacy resolveBarberLogin'e düşmez", () => {
        const src = readFileSync(GIRIS_SRC, "utf8");
        const emulatorTry = src.match(
            /if \(shouldUseEmulatorAuthLogin\(\)\) \{[\s\S]*?return;\s*\}/
        );
        assert.ok(emulatorTry, "emulator try branch bulunamadı");
        assert.doesNotMatch(emulatorTry[0], /resolveBarberLogin/);
    });

    it("emulatorAuthLogin production guard", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        assert.match(src, /if \(!shouldUseEmulatorAuthLogin\(\)\)/);
        assert.match(src, /emulator_auth_not_allowed/);
    });
});

describe("emulator auth — hassas veri loglanmaz", () => {
    it("emulatorAuthLogin console log içermez", () => {
        const src = readFileSync(EMULATOR_AUTH_LOGIN_SRC, "utf8");
        assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/);
    });

    it("giris.js emulator dalında password loglanmaz", () => {
        const src = readFileSync(GIRIS_SRC, "utf8");
        assert.doesNotMatch(src, /console\.(log|info|warn|error).*password/i);
    });
});
