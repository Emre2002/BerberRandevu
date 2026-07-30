import { PRODUCTION_BASE_URL } from "../../linkService.js";

export const BYPASS_HEADER = "x-vercel-protection-bypass";
export const BYPASS_ENV_VAR = "VERCEL_AUTOMATION_BYPASS_SECRET";
export const SMOKE_BASE_URL_ENV = "SMOKE_BASE_URL";
export const DEFAULT_TEST_SLUG = "abc";

/**
 * @param {string} baseUrl
 */
export function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").trim().replace(/\/+$/, "");
}

export function createInvalidSmokeBaseUrlError(message, smokeBaseUrlConfigured = false) {
    const err = new Error(message);
    err.code = "invalid_smoke_base_url";
    err.smokeBaseUrlConfigured = smokeBaseUrlConfigured;
    return err;
}

/**
 * Validates SMOKE_BASE_URL for live Preview E2E execution.
 * @param {string|undefined} raw
 * @param {{ allowNonVercelHostname?: boolean }} [options]
 * @returns {string}
 */
export function validateSmokeBaseUrl(raw, { allowNonVercelHostname = false } = {}) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) {
        throw createInvalidSmokeBaseUrlError(
            "SMOKE_BASE_URL is required for Preview E2E.",
            false
        );
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw createInvalidSmokeBaseUrlError(
            "SMOKE_BASE_URL must be a valid URL.",
            true
        );
    }

    if (parsed.protocol !== "https:") {
        throw createInvalidSmokeBaseUrlError(
            "SMOKE_BASE_URL must use https.",
            true
        );
    }

    if (!allowNonVercelHostname && !parsed.hostname.endsWith(".vercel.app")) {
        throw createInvalidSmokeBaseUrlError(
            "SMOKE_BASE_URL hostname must end with .vercel.app for Preview E2E.",
            true
        );
    }

    return normalizeBaseUrl(trimmed);
}

/**
 * @param {string} baseUrl
 */
export function isProductionTarget(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
    const production = normalizeBaseUrl(PRODUCTION_BASE_URL).toLowerCase();
    return normalized === production;
}

/**
 * Read bypass token from the single approved env var.
 * @returns {string}
 */
export function readBypassSecretFromEnv(env = process.env) {
    return String(env[BYPASS_ENV_VAR] || "").trim();
}

/**
 * @param {{ baseUrl: string, bypassSecret?: string }} input
 */
export function assertBypassAllowedForTarget({ baseUrl, bypassSecret }) {
    const secret = String(bypassSecret || "").trim();
    if (!secret) return;

    if (isProductionTarget(baseUrl)) {
        const err = new Error("bypass_token_on_production_forbidden");
        err.code = "bypass_token_on_production_forbidden";
        throw err;
    }
}

/**
 * @param {Record<string, string>} baseHeaders
 * @param {string} bypassSecret
 * @param {string} baseUrl
 * @returns {Record<string, string>}
 */
export function buildPreviewFetchHeaders(baseHeaders, bypassSecret, baseUrl) {
    assertBypassAllowedForTarget({ baseUrl, bypassSecret });

    const headers = { ...baseHeaders };
    const secret = String(bypassSecret || "").trim();
    if (secret) {
        headers[BYPASS_HEADER] = secret;
    }
    return headers;
}

/**
 * Safe header summary for reports — never includes the bypass secret value.
 * @param {Record<string, string>} headers
 */
export function describeSanitizedRequestHeaders(headers) {
    const described = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (key.toLowerCase() === BYPASS_HEADER) {
            described[BYPASS_HEADER] = value ? "[configured]" : null;
            continue;
        }
        described[key] = value;
    }
    return described;
}

/**
 * @param {{
 *   baseUrl?: string,
 *   bypassSecret?: string,
 *   slug?: string,
 *   env?: Record<string, string | undefined>,
 *   allowNonVercelHostname?: boolean
 * }} [options]
 */
export function resolvePreviewE2EConfig(options = {}) {
    const env = options.env || process.env;
    const allowNonVercelHostname = options.allowNonVercelHostname === true;
    const smokeRaw = options.baseUrl !== undefined ? options.baseUrl : env.SMOKE_BASE_URL;
    const smokeConfigured = String(smokeRaw ?? "").trim().length > 0;

    const baseUrl = validateSmokeBaseUrl(smokeRaw, { allowNonVercelHostname });
    const bypassSecret = String(options.bypassSecret ?? readBypassSecretFromEnv(env)).trim();
    const slug = String(options.slug || env.SMOKE_PUBLIC_SLUG || DEFAULT_TEST_SLUG).trim();

    assertBypassAllowedForTarget({ baseUrl, bypassSecret });

    return {
        baseUrl,
        resolvedBaseUrl: baseUrl,
        smokeBaseUrlConfigured: smokeConfigured,
        slug,
        bypassSecret,
        protectionBypassConfigured: Boolean(bypassSecret)
    };
}

/**
 * @param {Response} response
 * @param {Record<string, unknown>} body
 */
export function sanitizeHttpResponse(response, body = {}) {
    return {
        status: response.status,
        code: typeof body?.code === "string" ? body.code : (body?.error?.code ? String(body.error.code) : null),
        requestId: response.headers.get("x-request-id") || (typeof body?.requestId === "string" ? body.requestId : null)
    };
}

/**
 * @param {Response} response
 * @param {{ protectionBypassConfigured?: boolean }} [meta]
 */
export function buildUnexpectedRedirectDiagnostic(response, { protectionBypassConfigured = false } = {}) {
    return {
        code: "unexpected_redirect",
        status: response.status,
        location: response.headers.get("location"),
        requestId: response.headers.get("x-request-id"),
        protectionBypassConfigured
    };
}

/**
 * @param {Response} response
 * @param {{ protectionBypassConfigured?: boolean }} [meta]
 */
export function assertNoRedirectResponse(response, meta = {}) {
    if (response.status >= 300 && response.status < 400) {
        const diagnostic = buildUnexpectedRedirectDiagnostic(response, meta);
        const err = new Error("unexpected_redirect");
        err.code = "unexpected_redirect";
        Object.assign(err, diagnostic);
        throw err;
    }
}

/**
 * @param {unknown} value
 * @param {string} secret
 */
export function containsBypassSecret(value, secret) {
    if (!secret) return false;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.includes(secret);
}

/**
 * @param {{
 *   baseUrl: string,
 *   slug: string,
 *   bypassSecret?: string,
 *   fetchImpl?: typeof fetch
 * }} config
 */
export function createPreviewHttpClient({
    baseUrl,
    slug,
    bypassSecret = "",
    fetchImpl = fetch
}) {
    const secret = String(bypassSecret || "").trim();
    const protectionBypassConfigured = Boolean(secret);
    let lastRequestHeaders = {};

    async function previewFetch(url, init = {}) {
        const headers = buildPreviewFetchHeaders(
            { ...(init.headers || {}) },
            secret,
            baseUrl
        );
        lastRequestHeaders = describeSanitizedRequestHeaders(headers);
        const res = await fetchImpl(url, {
            ...init,
            headers,
            redirect: "manual",
            cache: init.cache || "no-store"
        });
        assertNoRedirectResponse(res, { protectionBypassConfigured });
        return res;
    }

    return {
        getLastRequestHeaders() {
            return { ...lastRequestHeaders };
        },

        async fetchAvailability(date) {
            const url = `${baseUrl}/api/public/availability?dukkan=${encodeURIComponent(slug)}&date=${date}`;
            const res = await previewFetch(url, {
                headers: { Accept: "application/json" }
            });
            const body = await res.json().catch(() => ({}));
            return {
                ...sanitizeHttpResponse(res, body),
                body,
                requestHeadersUsed: { ...lastRequestHeaders }
            };
        },

        async createAppointment(payload) {
            const res = await previewFetch(`${baseUrl}/api/public/create-appointment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify(payload)
            });
            const body = await res.json().catch(() => ({}));
            return {
                ...sanitizeHttpResponse(res, body),
                body,
                requestHeadersUsed: { ...lastRequestHeaders }
            };
        }
    };
}
