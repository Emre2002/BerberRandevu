import { describe, it } from "node:test";
import assert from "node:assert/strict";

function parseRetryAfterHeader(raw) {
    if (raw == null || raw === "") return null;

    const trimmed = String(raw).trim();
    const asSeconds = Number(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return {
            retryAfterSeconds: Math.floor(asSeconds),
            resetInSeconds: Math.floor(asSeconds)
        };
    }

    const resetMs = Date.parse(trimmed);
    if (Number.isFinite(resetMs)) {
        const resetInSeconds = Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));
        return {
            resetAt: new Date(resetMs).toISOString(),
            resetInSeconds,
            retryAfterSeconds: resetInSeconds
        };
    }

    return null;
}

function parseResetTimestamp(raw) {
    if (raw == null || raw === "") return null;

    const value = Number(String(raw).trim());
    if (!Number.isFinite(value) || value < 0) return null;

    const resetMs = value > 1_000_000_000_000 ? value : value * 1000;
    const resetInSeconds = Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));

    return {
        resetAt: new Date(resetMs).toISOString(),
        resetInSeconds,
        retryAfterSeconds: resetInSeconds
    };
}

function extractSanitizedRateLimitInfo(headers) {
    const headersPresent = [];
    const info = {};

    const retryAfterRaw = headers.get("retry-after");
    if (retryAfterRaw) {
        headersPresent.push("retry-after");
        const parsed = parseRetryAfterHeader(retryAfterRaw);
        if (parsed) {
            if (parsed.retryAfterSeconds != null) info.retryAfterSeconds = parsed.retryAfterSeconds;
            if (parsed.resetAt) info.resetAt = parsed.resetAt;
            if (parsed.resetInSeconds != null) info.resetInSeconds = parsed.resetInSeconds;
        }
    }

    for (const headerName of ["x-ratelimit-reset", "ratelimit-reset"]) {
        const raw = headers.get(headerName);
        if (!raw) continue;

        headersPresent.push(headerName);
        const parsed = parseResetTimestamp(raw);
        if (parsed) {
            if (!info.resetAt) info.resetAt = parsed.resetAt;
            if (info.resetInSeconds == null) info.resetInSeconds = parsed.resetInSeconds;
            if (info.retryAfterSeconds == null) info.retryAfterSeconds = parsed.retryAfterSeconds;
        }
    }

    for (const headerName of ["x-ratelimit-remaining", "ratelimit-remaining"]) {
        const raw = headers.get(headerName);
        if (raw == null || raw === "") continue;

        const remaining = Number(String(raw).trim());
        if (Number.isFinite(remaining) && remaining >= 0) {
            headersPresent.push(headerName);
            info.remaining = Math.floor(remaining);
        }
    }

    if (headersPresent.length === 0) return null;

    return {
        ...info,
        headersPresent: [...new Set(headersPresent)]
    };
}

describe("production booking e2e rate-limit diagnostics", () => {
    it("parses Retry-After seconds", () => {
        const parsed = parseRetryAfterHeader("120");
        assert.equal(parsed?.retryAfterSeconds, 120);
        assert.equal(parsed?.resetInSeconds, 120);
    });

    it("extracts sanitized rate-limit headers from a 429 response shape", () => {
        const headers = new Map([
            ["retry-after", "45"],
            ["x-ratelimit-remaining", "0"]
        ]);
        const info = extractSanitizedRateLimitInfo({
            get(name) {
                return headers.get(name.toLowerCase()) ?? null;
            }
        });
        assert.deepEqual(info?.headersPresent, ["retry-after", "x-ratelimit-remaining"]);
        assert.equal(info?.retryAfterSeconds, 45);
        assert.equal(info?.remaining, 0);
    });

    it("returns null when no rate-limit headers are present", () => {
        const info = extractSanitizedRateLimitInfo({ get: () => null });
        assert.equal(info, null);
    });
});
