import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUsername } from "../api/_lib/normalize-username.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RESOLVE_SRC = resolve(ROOT, "api/_lib/resolve-auth.js");

function legacyNormalizeUsername(raw) {
    if (raw == null) return "";
    return String(raw).trim().toLowerCase();
}

function usernameMatchesStored(normalized, rawStored) {
    if (rawStored == null || rawStored === "") return false;
    const stored = String(rawStored);
    return (
        normalizeUsername(stored) === normalized
        || legacyNormalizeUsername(stored) === normalized
        || stored.trim() === normalized
    );
}

describe("resolve-auth production fallbacks", () => {
    it("includes bounded berberler scan fallback for owner resolution", () => {
        const src = readFileSync(RESOLVE_SRC, "utf8");
        assert.match(src, /findOwnerBusinessIdByUsername/);
        assert.match(src, /collection\("berberler"\)\.select\("username"\)/);
    });

    it("includes slug document fallback when username equals business slug", () => {
        const src = readFileSync(RESOLVE_SRC, "utf8");
        assert.match(src, /collection\("berberler"\)\.doc\(normalized\)/);
    });

    it("falls through to production fallback when authLoginIndex doc is incomplete", () => {
        const src = readFileSync(RESOLVE_SRC, "utf8");
        assert.match(src, /if \(fromIndex\.ok\)/);
        assert.match(src, /resolveSuperAdminFallback/);
    });

    it("includes Firebase Auth membership fallback for owner resolution", () => {
        const src = readFileSync(RESOLVE_SRC, "utf8");
        assert.match(src, /resolveOwnerViaAuthMembership/);
        assert.match(src, /businessMemberships/);
    });

    it("matches legacy and canonical stored usernames", () => {
        const normalized = normalizeUsername("bedirhan");
        assert.equal(usernameMatchesStored(normalized, "Bedirhan"), true);
        assert.equal(usernameMatchesStored(normalized, "bedirhan"), true);
        assert.equal(usernameMatchesStored(normalized, "  BEDIRHAN "), true);
        assert.equal(usernameMatchesStored(normalized, "altinmakas"), false);
    });
});
