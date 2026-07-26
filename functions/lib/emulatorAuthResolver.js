const path = require("path");
const fs = require("fs");
const { normalizeAndValidateUsername } = require("./usernameNormalization");

const GENERIC_AUTH_ERROR = "auth_failed";

/** @type {{ syntheticEmailDomain: string, users: Array<{ username: string, businessId: string }> }} */
let fixtureConfig = null;

function loadFixtureConfig() {
    if (fixtureConfig) return fixtureConfig;
    const fixturePath = path.join(__dirname, "..", "..", "fixtures", "auth-emulator-users.json");
    const raw = fs.readFileSync(fixturePath, "utf8");
    fixtureConfig = JSON.parse(raw);
    return fixtureConfig;
}

function isFunctionsEmulatorRuntime() {
    return process.env.FUNCTIONS_EMULATOR === "true";
}

function buildSyntheticEmail(normalizedUsername, domain) {
    return `${normalizedUsername}@${domain}`;
}

function getFixtureUserMap() {
    const config = loadFixtureConfig();
    const domain = config.syntheticEmailDomain || "users.berberrandevu.internal";
    const map = new Map();
    for (const entry of config.users || []) {
        const validated = normalizeAndValidateUsername(entry?.username);
        if (!validated.ok) continue;
        map.set(validated.normalized, {
            businessId: String(entry.businessId || "").trim(),
            domain
        });
    }
    return map;
}

/**
 * Emulator-only username → Auth identifier çözümlemesi.
 * Ham password kabul etmez. Kullanıcı yokluğunda generic hata.
 * @param {unknown} rawUsername
 * @returns {{ ok: true, authEmail: string, businessId: string } | { ok: false, code: string }}
 */
function resolveEmulatorAuthIdentifier(rawUsername) {
    if (!isFunctionsEmulatorRuntime()) {
        return { ok: false, code: "emulator_unavailable" };
    }

    const validated = normalizeAndValidateUsername(rawUsername);
    if (!validated.ok) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    const fixtures = getFixtureUserMap();
    const fixture = fixtures.get(validated.normalized);
    if (!fixture || !fixture.businessId) {
        return { ok: false, code: GENERIC_AUTH_ERROR };
    }

    const authEmail = buildSyntheticEmail(validated.normalized, fixture.domain);
    return {
        ok: true,
        authEmail,
        businessId: fixture.businessId
    };
}

module.exports = {
    GENERIC_AUTH_ERROR,
    isFunctionsEmulatorRuntime,
    resolveEmulatorAuthIdentifier,
    /** Test/teardown */
    _resetFixtureCacheForTests() {
        fixtureConfig = null;
    }
};
