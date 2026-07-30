import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("owner calendar and messaging security", () => {
    const campaignSrc = readFileSync(resolve(ROOT, "campaignService.js"), "utf8");
    const barberExtrasSrc = readFileSync(resolve(ROOT, "barberAdminExtras.js"), "utf8");
    const appSrc = readFileSync(resolve(ROOT, "app.js"), "utf8");
    const syncSrc = readFileSync(resolve(ROOT, "scripts/sync-production-auth-passwords.mjs"), "utf8");
    const syncPs1 = readFileSync(resolve(ROOT, "scripts/sync-production-auth-passwords.ps1"), "utf8");

    it("owner campaign history query is tenant scoped", () => {
        assert.match(campaignSrc, /fetchCampaignsByBarber[\s\S]*where\("barberSlug", "==", barberSlug\)/);
        assert.doesNotMatch(campaignSrc, /fetchCampaignHistory\(100\)/);
    });

    it("messaging bootstrap catches permission failures without unhandled rejection", () => {
        assert.match(barberExtrasSrc, /void loadCustomers\(\)/);
        assert.match(barberExtrasSrc, /void loadHistory\(\)/);
        assert.match(barberExtrasSrc, /Müşteri listesi yüklenemedi/);
        assert.match(barberExtrasSrc, /Mesaj geçmişi yüklenemedi/);
    });

    it("admin calendar queries use membership business id", () => {
        assert.match(appSrc, /where\("barberId", "==", tenantId\)/);
        assert.match(appSrc, /authorizedAdminBusinessId = context\.businessId/);
        assert.match(appSrc, /getAuthorizedBusinessContextWithFreshToken/);
    });

    it("URL slug does not override membership tenant", () => {
        assert.match(appSrc, /expectedBusinessId: slug/);
        assert.doesNotMatch(appSrc, /getTenantBusinessId[\s\S]*urlSlug/);
    });

    it("password sync script never uses CLI password args or persistent env", () => {
        assert.match(syncSrc, /readStdinJson|from-local-credentials/);
        assert.doesNotMatch(syncSrc, /process\.argv.*password/i);
        assert.doesNotMatch(syncPs1, /\$env:.*PASS\s*=/);
        assert.match(syncPs1, /\bfinally\b/);
        assert.match(syncPs1, /Set-StrictMode/);
    });

    it("password sync preserves superadmin claim path", () => {
        assert.match(syncSrc, /setCustomUserClaims/);
        assert.match(syncSrc, /superAdmin: true/);
        assert.match(syncSrc, /disabled: false/);
    });
});
