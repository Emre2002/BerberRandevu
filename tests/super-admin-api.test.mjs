import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("super-admin privileged API wiring", () => {
    it("super-admin panel loads businesses via list-businesses API in production mode", () => {
        const src = readFileSync(resolve(ROOT, "super-admin-panel.js"), "utf8");
        assert.match(src, /listBusinessesForSuperAdminViaApi/);
        assert.match(src, /shouldUsePrivilegedApi\(\)/);
    });

    it("super-admin.js requires Firebase Auth session with superAdmin claim", () => {
        const src = readFileSync(resolve(ROOT, "super-admin.js"), "utf8");
        assert.match(src, /signInWithProductionSuperAdminAuth/);
        assert.match(src, /getIdTokenResult\(true\)/);
        assert.match(src, /Panel verileri yüklenemedi/);
        assert.doesNotMatch(src, /FirebaseError/);
    });

    it("list-businesses route verifies superAdmin claim server-side", () => {
        const src = readFileSync(resolve(ROOT, "api/list-businesses.js"), "utf8");
        assert.match(src, /requireSuperAdmin/);
        assert.doesNotMatch(src, /password/);
    });

    it("list-businesses sanitizes private business payload", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/business-sanitize.js"), "utf8");
        assert.doesNotMatch(src, /password/);
        assert.match(src, /sanitizeBusinessList/);
    });

    it("super-admin panel does not list berberler collection directly in privileged mode", () => {
        const src = readFileSync(resolve(ROOT, "super-admin-panel.js"), "utf8");
        const loadFn = src.slice(src.indexOf("async function loadPanelData"), src.indexOf("function refreshBarberStatsUI"));
        assert.match(loadFn, /listBusinessesForSuperAdminViaApi/);
    });

    it("localStorage isAdmin flag is not used as authorization gate in super-admin.js", () => {
        const src = readFileSync(resolve(ROOT, "super-admin.js"), "utf8");
        assert.doesNotMatch(src, /localStorage\.getItem\("isAdmin"\)/);
    });
});

describe("privileged API client retry behavior", () => {
    it("retries once with refreshed token on 401", () => {
        const src = readFileSync(resolve(ROOT, "privilegedApiClient.js"), "utf8");
        assert.match(src, /response\.status === 401/);
        assert.match(src, /getIdToken\(forceRefresh\)/);
    });
});
