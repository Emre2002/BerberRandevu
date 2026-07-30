import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    enforceAvailabilityBurstLimit,
    enforceBookingAttemptLimit,
    enforceCreateIpBusinessBurstLimit,
    enforcePublicRouteBurstLimit,
    hashIpIdentity,
    hashPhoneIdentity,
    requireProductionRateLimitSecrets
} from "../api/_lib/booking-rate-limit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEV_HMAC_FALLBACK = "berberrandevu-dev-hmac-secret-change-before-production";

const OWNER_ADMIN_ROUTES = [
    "api/owner/archive-appointment.js",
    "api/owner/create-appointment.js",
    "api/list-businesses.js",
    "api/update-business.js",
    "api/_lib/resolve-auth.js"
];

function createMinimalMockDb() {
    const docs = new Map();
    return {
        collection() {
            return {
                doc() {
                    return {
                        collectionName: "rateLimits",
                        id: "mock",
                        async get() {
                            return { exists: false, data: () => undefined };
                        }
                    };
                }
            };
        },
        runTransaction(fn) {
            const tx = {
                async get(ref) {
                    return { exists: false, data: () => undefined, id: ref.id };
                },
                set() {}
            };
            return fn(tx);
        },
        _docs: docs
    };
}

async function withProductionSecretsMissing(fn) {
    const prev = {
        VERCEL_ENV: process.env.VERCEL_ENV,
        PHONE: process.env.RATE_LIMIT_PHONE_HMAC_SECRET,
        IP: process.env.RATE_LIMIT_IP_HMAC_SECRET,
        SHARED: process.env.RATE_LIMIT_HMAC_SECRET,
        SALT: process.env.RATE_LIMIT_IP_SALT
    };

    process.env.VERCEL_ENV = "production";
    delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
    delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    delete process.env.RATE_LIMIT_IP_SALT;

    try {
        return await fn();
    } finally {
        process.env.VERCEL_ENV = prev.VERCEL_ENV;
        if (prev.PHONE) process.env.RATE_LIMIT_PHONE_HMAC_SECRET = prev.PHONE;
        else delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
        if (prev.IP) process.env.RATE_LIMIT_IP_HMAC_SECRET = prev.IP;
        else delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
        if (prev.SHARED) process.env.RATE_LIMIT_HMAC_SECRET = prev.SHARED;
        else delete process.env.RATE_LIMIT_HMAC_SECRET;
        if (prev.SALT) process.env.RATE_LIMIT_IP_SALT = prev.SALT;
        else delete process.env.RATE_LIMIT_IP_SALT;
    }
}

describe("rate-limit secret decoupling from getAdminDb", () => {
    it("getAdminDb does not import or call requireProductionRateLimitSecrets", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/firebase-admin.js"), "utf8");
        assert.doesNotMatch(src, /requireProductionRateLimitSecrets/);
        assert.doesNotMatch(src, /booking-rate-limit/);
    });

    it("requireProductionRateLimitSecrets lives only in booking-rate-limit entry points", () => {
        const bookingSrc = readFileSync(resolve(ROOT, "api/_lib/booking-rate-limit.js"), "utf8");
        assert.match(bookingSrc, /export function requireProductionRateLimitSecrets/);
        assert.match(bookingSrc, /function getIdentitySecret/);

        const adminBucketSrc = readFileSync(resolve(ROOT, "scripts/admin-rate-limit-bucket.mjs"), "utf8");
        assert.match(adminBucketSrc, /requireProductionRateLimitSecrets\(\)/);

        for (const route of OWNER_ADMIN_ROUTES) {
            const src = readFileSync(resolve(ROOT, route), "utf8");
            assert.doesNotMatch(
                src,
                /requireProductionRateLimitSecrets|from "\.\.\/_lib\/booking-rate-limit|from "\.\/_lib\/booking-rate-limit/
            );
        }
    });
});

describe("public booking fails closed without dedicated production secrets", () => {
    it("public create route handles rate_limit_config_error as HTTP 503", () => {
        const src = readFileSync(resolve(ROOT, "api/public/create-appointment.js"), "utf8");
        assert.match(src, /rate_limit_config_error/);
        assert.match(src, /503/);
        assert.match(src, /enforcePublicRouteBurstLimit/);
    });

    it("public availability route handles rate_limit_config_error as HTTP 503", () => {
        const src = readFileSync(resolve(ROOT, "api/public/availability.js"), "utf8");
        assert.match(src, /rate_limit_config_error/);
        assert.match(src, /503/);
        assert.match(src, /enforceAvailabilityBurstLimit/);
    });

    it("booking enforce functions throw rate_limit_config_error before Firestore writes", async () => {
        const db = createMinimalMockDb();

        await withProductionSecretsMissing(async () => {
            await assert.rejects(
                () => enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.1"),
                (err) => err.code === "rate_limit_config_error"
            );
            await assert.rejects(
                () => enforceCreateIpBusinessBurstLimit(db, "shop-a", "203.0.113.1"),
                (err) => err.code === "rate_limit_config_error"
            );
            await assert.rejects(
                () => enforceAvailabilityBurstLimit(db, "shop-a", "203.0.113.1"),
                (err) => err.code === "rate_limit_config_error"
            );
            await assert.rejects(
                () => enforceBookingAttemptLimit(db, "shop-a", "5551234567"),
                (err) => err.code === "rate_limit_config_error"
            );
        });
    });
});

describe("owner/admin routes remain independent of booking HMAC secrets", () => {
    it("owner create uses ownerContext and does not import booking-rate-limit", () => {
        const src = readFileSync(resolve(ROOT, "api/owner/create-appointment.js"), "utf8");
        assert.match(src, /ownerContext:\s*true/);
        assert.doesNotMatch(src, /booking-rate-limit/);
    });

    it("owner archive route does not import booking-rate-limit", () => {
        const src = readFileSync(resolve(ROOT, "api/owner/archive-appointment.js"), "utf8");
        assert.doesNotMatch(src, /booking-rate-limit/);
    });

    it("createPublicAppointment skips public rate limits when ownerContext is true", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        assert.match(src, /if \(!ownerContext\)/);
        assert.match(src, /await enforceCreateIpBusinessBurstLimit/);
        assert.match(src, /await enforceBookingAttemptLimit/);
        const ownerGuard = src.match(/if \(!ownerContext\) \{[\s\S]*?await enforceCreateIpBusinessBurstLimit/);
        assert.ok(ownerGuard, "create burst limit is guarded by ownerContext");
    });

    it("getAdminDb does not throw rate_limit_config_error when booking secrets are missing", async () => {
        await withProductionSecretsMissing(async () => {
            assert.throws(
                () => requireProductionRateLimitSecrets(),
                (err) => err.code === "rate_limit_config_error"
            );

            const { getAdminDb } = await import("../api/_lib/firebase-admin.js");
            try {
                getAdminDb();
            } catch (err) {
                assert.notEqual(
                    err?.code,
                    "rate_limit_config_error",
                    "getAdminDb must not depend on booking HMAC secrets"
                );
            }
        });
    });
});

describe("production HMAC identity cannot use development fallback", () => {
    const hmacEntryPoints = [
        { name: "hashIpIdentity", fn: () => hashIpIdentity("203.0.113.1") },
        { name: "hashPhoneIdentity", fn: () => hashPhoneIdentity("5551234567", "shop-a") }
    ];

    for (const { name, fn } of hmacEntryPoints) {
        it(`${name} rejects missing dedicated secrets in production`, async () => {
            await withProductionSecretsMissing(async () => {
                assert.throws(fn, (err) => err.code === "rate_limit_config_error");
            });
        });
    }

    it("rejects dev fallback value even when both dedicated vars are set", async () => {
        const prev = {
            VERCEL_ENV: process.env.VERCEL_ENV,
            PHONE: process.env.RATE_LIMIT_PHONE_HMAC_SECRET,
            IP: process.env.RATE_LIMIT_IP_HMAC_SECRET
        };

        process.env.VERCEL_ENV = "production";
        process.env.RATE_LIMIT_PHONE_HMAC_SECRET = DEV_HMAC_FALLBACK;
        process.env.RATE_LIMIT_IP_HMAC_SECRET = "prod-ip-secret";

        try {
            assert.throws(
                () => hashIpIdentity("203.0.113.1"),
                (err) => err.code === "rate_limit_config_error"
            );
        } finally {
            process.env.VERCEL_ENV = prev.VERCEL_ENV;
            if (prev.PHONE) process.env.RATE_LIMIT_PHONE_HMAC_SECRET = prev.PHONE;
            else delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
            if (prev.IP) process.env.RATE_LIMIT_IP_HMAC_SECRET = prev.IP;
            else delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
        }
    });

    it("rejects shared RATE_LIMIT_HMAC_SECRET without dedicated secrets in production", async () => {
        const prev = {
            VERCEL_ENV: process.env.VERCEL_ENV,
            PHONE: process.env.RATE_LIMIT_PHONE_HMAC_SECRET,
            IP: process.env.RATE_LIMIT_IP_HMAC_SECRET,
            SHARED: process.env.RATE_LIMIT_HMAC_SECRET
        };

        process.env.VERCEL_ENV = "production";
        delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
        delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
        process.env.RATE_LIMIT_HMAC_SECRET = "shared-production-secret";

        try {
            assert.throws(
                () => requireProductionRateLimitSecrets(),
                (err) => err.code === "rate_limit_config_error"
            );
            assert.throws(
                () => hashPhoneIdentity("5551234567", "shop-a"),
                (err) => err.code === "rate_limit_config_error"
            );
        } finally {
            process.env.VERCEL_ENV = prev.VERCEL_ENV;
            if (prev.PHONE) process.env.RATE_LIMIT_PHONE_HMAC_SECRET = prev.PHONE;
            else delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
            if (prev.IP) process.env.RATE_LIMIT_IP_HMAC_SECRET = prev.IP;
            else delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
            if (prev.SHARED) process.env.RATE_LIMIT_HMAC_SECRET = prev.SHARED;
            else delete process.env.RATE_LIMIT_HMAC_SECRET;
        }
    });
});
