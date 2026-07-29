import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("appointment calendar authorization — frontend contract", () => {
    const appSrc = readFileSync(resolve(ROOT, "app.js"), "utf8");
    const adminAuthSrc = readFileSync(resolve(ROOT, "admin-auth.js"), "utf8");

    it("app.js authorizedBusinessContext kullanır", () => {
        assert.match(appSrc, /from\s+["']\.\/authorizedBusinessContext\.js["']/);
        assert.match(appSrc, /getAuthorizedBusinessContextWithFreshToken/);
    });

    it("admin takvim sorguları getTenantBusinessId ile tenant sınırlanır", () => {
        assert.match(appSrc, /function getTenantBusinessId\(/);
        assert.match(appSrc, /where\("barberId", "==", tenantId\)/);
        assert.match(appSrc, /authorizedAdminBusinessId/);
    });

    it("startAdminApp membership doğrulaması sonrası admin başlatır", () => {
        assert.match(appSrc, /getAuthorizedBusinessContextWithFreshToken\(\{ expectedBusinessId: slug \}\)/);
        const block = appSrc.match(/function startAdminApp[\s\S]*?^}/m)?.[0] || "";
        assert.match(block, /authorizedAdminBusinessId = context\.businessId/);
        assert.match(block, /initAdminPage\(\)/);
    });

    it("admin-auth membership tabanlı gate kullanır", () => {
        assert.match(adminAuthSrc, /subscribeAuthorizedBusinessContext/);
        assert.match(adminAuthSrc, /AUTH_GUARD_STATE\.AUTHENTICATED_OWNER/);
        assert.doesNotMatch(adminAuthSrc, /requireBarberSession/);
        assert.doesNotMatch(adminAuthSrc, /sessionStorage/);
    });

    it("ham Firestore permission mesajı kullanıcıya gösterilmez", () => {
        assert.match(appSrc, /adminAccessErrorMessage/);
        assert.match(appSrc, /Randevu takvimine erişilemiyor/);
        assert.doesNotMatch(appSrc, /Missing or insufficient permissions/);
    });

    it("URL slug yetki kanıtı olarak kullanılmaz", () => {
        const ctxSrc = readFileSync(resolve(ROOT, "authorizedBusinessContext.js"), "utf8");
        assert.match(ctxSrc, /URL, storage veya client global state/);
        assert.match(adminAuthSrc, /urlSlug !== context\.businessId/);
    });
});

describe("appointment calendar authorization — rules regression", () => {
    const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");

    it("production rules businessMemberships içerir", () => {
        assert.match(rules, /match \/businessMemberships\/\{membershipUid\}/);
    });

    it("appointments list tenant barberId ile sınırlı", () => {
        assert.match(rules, /match \/appointments\/\{appointmentId\}/);
        assert.match(rules, /resource\.data\.barberId == ownerBusinessId\(\)/);
    });

    it("geniş authenticated read yok", () => {
        assert.doesNotMatch(rules, /allow read: if request\.auth != null/);
        assert.doesNotMatch(rules, /allow read, write: if true/);
    });

    it("legacy nested appointments owner read", () => {
        assert.match(rules, /match \/appointments\/\{legacyDate\}/);
        assert.match(rules, /allow get, list: if ownsBusiness\(businessId\)/);
    });
});
