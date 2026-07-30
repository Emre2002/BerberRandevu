import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PRODUCTION_BASE_URL } from "../linkService.js";
import { loadLocalEnvFile } from "../scripts/_lib/load-local-env.mjs";
import {
    BYPASS_ENV_VAR,
    BYPASS_HEADER,
    buildPreviewFetchHeaders,
    containsBypassSecret,
    createPreviewHttpClient,
    readBypassSecretFromEnv,
    resolvePreviewE2EConfig,
    sanitizeHttpResponse,
    validateSmokeBaseUrl
} from "../scripts/lib/preview-booking-e2e-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT_PATH = resolve(ROOT, "scripts/test-preview-booking-e2e.mjs");
const CLIENT_PATH = resolve(ROOT, "scripts/lib/preview-booking-e2e-client.mjs");
const STALE_PREVIEW_URL = "berber-randevu-abm4currj-berber35.vercel.app";
const TEST_PREVIEW_BASE_URL = "https://example-preview.vercel.app";

describe("preview booking e2e bypass header", () => {
    it("with secret: sends x-vercel-protection-bypass only (no set-bypass-cookie)", () => {
        const withSecret = buildPreviewFetchHeaders(
            { Accept: "application/json" },
            "preview-bypass-test-token",
            TEST_PREVIEW_BASE_URL
        );
        assert.equal(withSecret[BYPASS_HEADER], "preview-bypass-test-token");
        assert.equal(withSecret["x-vercel-set-bypass-cookie"], undefined);
        assert.equal(withSecret.Accept, "application/json");
    });

    it("without secret: sends neither bypass header", () => {
        const without = buildPreviewFetchHeaders({ Accept: "application/json" }, "", TEST_PREVIEW_BASE_URL);
        assert.equal(without[BYPASS_HEADER], undefined);
        assert.equal(without["x-vercel-set-bypass-cookie"], undefined);
    });

    it("reads bypass secret only from VERCEL_AUTOMATION_BYPASS_SECRET", () => {
        const secret = "env-only-secret";
        assert.equal(
            readBypassSecretFromEnv({
                [BYPASS_ENV_VAR]: secret,
                VERCEL_PROTECTION_BYPASS: "wrong-var"
            }),
            secret
        );
        assert.equal(readBypassSecretFromEnv({}), "");
    });

    it("refuses bypass token when SMOKE_BASE_URL targets production", () => {
        assert.throws(
            () => resolvePreviewE2EConfig({
                baseUrl: PRODUCTION_BASE_URL,
                bypassSecret: "preview-bypass-test-token",
                slug: "abc"
            }),
            (err) => err.code === "bypass_token_on_production_forbidden"
        );

        assert.throws(
            () => buildPreviewFetchHeaders({}, "preview-bypass-test-token", PRODUCTION_BASE_URL),
            (err) => err.code === "bypass_token_on_production_forbidden"
        );
    });

    it("createPreviewHttpClient attaches bypass header on every request when configured", async () => {
        const secret = "header-propagation-test";
        const seenHeaders = [];
        const seenRedirectModes = [];

        const fetchImpl = async (_url, init) => {
            seenHeaders.push({ ...(init?.headers || {}) });
            seenRedirectModes.push(init?.redirect);
            return {
                status: 200,
                headers: {
                    get() {
                        return null;
                    }
                },
                json: async () => ({ availableSlots: ["10:00"], services: ["Test"] })
            };
        };

        const client = createPreviewHttpClient({
            baseUrl: TEST_PREVIEW_BASE_URL,
            slug: "abc",
            bypassSecret: secret,
            fetchImpl
        });

        await client.fetchAvailability("2026-08-10");
        await client.createAppointment({ dukkan: "abc", website: "" });

        assert.equal(seenHeaders.length, 2);
        for (const headers of seenHeaders) {
            assert.equal(headers[BYPASS_HEADER], secret);
            assert.equal(headers["x-vercel-set-bypass-cookie"], undefined);
        }
        assert.deepEqual(seenRedirectModes, ["manual", "manual"]);
    });

    it("detects 307 immediately without entering a redirect loop", async () => {
        let fetchCalls = 0;
        const fetchImpl = async (_url, init) => {
            fetchCalls += 1;
            assert.equal(init?.redirect, "manual");
            return {
                status: 307,
                headers: {
                    get(name) {
                        if (name === "location") return "https://example-preview.vercel.app/api/public/availability?dukkan=abc";
                        if (name === "x-request-id") return "req-redirect-test";
                        return null;
                    }
                },
                json: async () => ({})
            };
        };

        const client = createPreviewHttpClient({
            baseUrl: TEST_PREVIEW_BASE_URL,
            slug: "abc",
            bypassSecret: "redirect-loop-test-secret",
            fetchImpl
        });

        await assert.rejects(
            () => client.fetchAvailability("2026-08-10"),
            (err) => err.code === "unexpected_redirect"
                && err.status === 307
                && err.location?.includes("/api/public/availability")
                && err.requestId === "req-redirect-test"
                && err.protectionBypassConfigured === true
        );
        assert.equal(fetchCalls, 1, "must not follow redirects or retry automatically");
    });

    it("sanitizeHttpResponse reports status, code and requestId without secrets", () => {
        const sanitized = sanitizeHttpResponse(
            {
                status: 503,
                headers: {
                    get(name) {
                        return name.toLowerCase() === "x-request-id" ? "req-preview-1" : null;
                    }
                }
            },
            { code: "rate_limit_config_error", requestId: "ignored-body-id" }
        );

        assert.deepEqual(sanitized, {
            status: 503,
            code: "rate_limit_config_error",
            requestId: "req-preview-1"
        });
    });
});

describe("preview booking e2e smoke base url resolution", () => {
    it("loadLocalEnvFile does not overwrite variables already set in the shell", () => {
        const dir = mkdtempSync(join(tmpdir(), "preview-env-"));
        const envFile = join(dir, ".env.local");
        writeFileSync(envFile, [
            "SMOKE_BASE_URL=https://from-dotenv.vercel.app",
            "VERCEL_AUTOMATION_BYPASS_SECRET=dotenv-secret"
        ].join("\n"), "utf8");

        const targetEnv = {
            SMOKE_BASE_URL: "https://from-shell.vercel.app",
            VERCEL_AUTOMATION_BYPASS_SECRET: "shell-secret"
        };

        loadLocalEnvFile({ envFilePath: envFile, targetEnv });

        assert.equal(targetEnv.SMOKE_BASE_URL, "https://from-shell.vercel.app");
        assert.equal(targetEnv.VERCEL_AUTOMATION_BYPASS_SECRET, "shell-secret");
        unlinkSync(envFile);
    });

    it("missing SMOKE_BASE_URL fails with invalid_smoke_base_url before fetch", () => {
        assert.throws(
            () => resolvePreviewE2EConfig({ env: {} }),
            (err) => err.code === "invalid_smoke_base_url"
                && err.smokeBaseUrlConfigured === false
        );

        let fetchCalled = false;
        assert.throws(
            () => {
                resolvePreviewE2EConfig({ env: {} });
                createPreviewHttpClient({
                    baseUrl: "should-not-reach",
                    slug: "abc",
                    fetchImpl: async () => {
                        fetchCalled = true;
                        return { status: 200, headers: { get: () => null }, json: async () => ({}) };
                    }
                });
            },
            (err) => err.code === "invalid_smoke_base_url"
        );
        assert.equal(fetchCalled, false);
    });

    it("invalid SMOKE_BASE_URL fails with invalid_smoke_base_url before fetch", () => {
        for (const bad of ["not-a-url", "http://insecure.vercel.app", "https://example.com"]) {
            assert.throws(
                () => resolvePreviewE2EConfig({ baseUrl: bad }),
                (err) => err.code === "invalid_smoke_base_url"
                    && err.smokeBaseUrlConfigured === true,
                `expected invalid_smoke_base_url for ${bad}`
            );
        }
    });

    it("valid Preview URL is used exactly", () => {
        const configured = "https://berber-randevu-preview-xyz.vercel.app/";
        const config = resolvePreviewE2EConfig({
            env: { SMOKE_BASE_URL: configured },
            slug: "abc"
        });

        assert.equal(config.baseUrl, "https://berber-randevu-preview-xyz.vercel.app");
        assert.equal(config.resolvedBaseUrl, "https://berber-randevu-preview-xyz.vercel.app");
        assert.equal(config.smokeBaseUrlConfigured, true);
        assert.equal(validateSmokeBaseUrl(configured), config.baseUrl);
    });

    it("no stale Preview deployment URL remains in Preview E2E source", () => {
        const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
        const clientSrc = readFileSync(CLIENT_PATH, "utf8");

        assert.doesNotMatch(scriptSrc, new RegExp(STALE_PREVIEW_URL));
        assert.doesNotMatch(clientSrc, new RegExp(STALE_PREVIEW_URL));
        assert.doesNotMatch(clientSrc, /DEFAULT_PREVIEW_BASE_URL/);
    });

    it("script handles invalid_smoke_base_url with structured JSON before network", () => {
        const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
        assert.match(scriptSrc, /invalid_smoke_base_url/);
        assert.match(scriptSrc, /smokeBaseUrlConfigured/);
        assert.match(scriptSrc, /resolvedBaseUrl/);
    });
});

describe("preview booking e2e script safety", () => {
    it("never logs or serializes the bypass token", () => {
        const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
        const clientSrc = readFileSync(CLIENT_PATH, "utf8");

        assert.doesNotMatch(scriptSrc, /console\.(log|info|warn|error)\([^\)]*bypassSecret/);
        assert.doesNotMatch(scriptSrc, /console\.(log|info|warn|error)\([^\)]*process\.env\[BYPASS_ENV_VAR\]/);
        assert.doesNotMatch(clientSrc, /console\.(log|info|warn|error)\([^\)]*bypassSecret/);
        assert.doesNotMatch(clientSrc, /x-vercel-set-bypass-cookie/);
        assert.match(scriptSrc, /printJson\(report\)/);
        assert.match(scriptSrc, /containsBypassSecret\(report, bypassSecret\)/);
        assert.match(scriptSrc, /main\(\)\.catch/);
    });

    it("never places bypass token in query strings", () => {
        const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
        const clientSrc = readFileSync(CLIENT_PATH, "utf8");

        assert.doesNotMatch(scriptSrc, /protection-bypass|VERCEL_AUTOMATION_BYPASS_SECRET.*\?/);
        assert.doesNotMatch(clientSrc, /searchParams.*bypass|protection-bypass.*encodeURIComponent/);
        assert.match(clientSrc, /api\/public\/availability\?dukkan=/);
    });

    it("uses SMOKE_BASE_URL and reports protectionBypassConfigured boolean only", () => {
        const scriptSrc = readFileSync(SCRIPT_PATH, "utf8");
        assert.match(scriptSrc, /loadLocalEnvFile\(\)/);
        assert.match(scriptSrc, /from "\.\/lib\/preview-booking-e2e-client\.mjs"/);
        assert.match(scriptSrc, /protectionBypassConfigured/);
        assert.match(scriptSrc, /resolvedBaseUrl/);
        assert.doesNotMatch(scriptSrc, /protectionBypassConfigured:\s*bypassSecret/);
    });

    it("report JSON does not contain a configured bypass secret", () => {
        const secret = "must-not-appear-in-report";
        const report = {
            baseUrl: TEST_PREVIEW_BASE_URL,
            resolvedBaseUrl: TEST_PREVIEW_BASE_URL,
            slug: "abc",
            protectionBypassConfigured: true,
            scenarios: [{
                name: "free_slot_returns_201",
                ok: true,
                status: 201,
                code: null,
                requestId: "req-abc"
            }]
        };

        assert.equal(containsBypassSecret(report, secret), false);
        assert.equal(containsBypassSecret(JSON.stringify(report), secret), false);
    });
});
