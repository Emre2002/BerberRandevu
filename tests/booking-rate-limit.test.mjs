import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Timestamp } from "firebase-admin/firestore";
import {
    RATE_LIMIT_SCOPES,
    buildRateLimitDocIdsForTests,
    checkBookingSuccessLimit,
    enforceAvailabilityBurstLimit,
    enforceBookingAttemptLimit,
    enforceCreateIpBusinessBurstLimit,
    enforcePublicRouteBurstLimit,
    getBookingRateLimitConfig,
    getPolicyMatrix,
    hashIpIdentity,
    hashPhoneIdentity,
    incrementBookingSuccessLimit,
    normalizeTrustedClientIp,
    requireProductionRateLimitSecrets
} from "../api/_lib/booking-rate-limit.js";
import { buildRateLimitHeaders } from "../api/_lib/http.js";
import { getClientIp } from "../api/_lib/rate-limit.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";
import { formatRateLimitMessage } from "../publicAppointmentClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function createMockDb() {
    const docs = new Map();

    function docRef(collectionName, id) {
        const key = `${collectionName}/${id}`;
        return {
            id,
            collectionName,
            async get() {
                const data = docs.get(key);
                return {
                    exists: Boolean(data),
                    data: () => data
                };
            },
            async delete() {
                docs.delete(key);
            },
            async set(payload, options) {
                const existing = docs.get(key) || {};
                docs.set(key, options?.merge ? { ...existing, ...payload } : payload);
            },
            collection(subName) {
                return collectionAt(`${collectionName}/${id}/${subName}`);
            }
        };
    }

    function collectionAt(path) {
        const prefix = `${path}/`;
        return {
            doc(id) {
                return docRef(path, id);
            },
            where(field, _op, value) {
                const filters = [{ field, value }];
                const query = {
                    where(nextField, _nextOp, nextValue) {
                        filters.push({ field: nextField, value: nextValue });
                        return query;
                    },
                    limit() {
                        return query;
                    },
                    async get() {
                        const matches = [];
                        for (const [key, data] of docs.entries()) {
                            if (!key.startsWith(prefix)) continue;
                            let ok = true;
                            for (const filter of filters) {
                                if (data?.[filter.field] !== filter.value) {
                                    ok = false;
                                    break;
                                }
                            }
                            if (!ok) continue;
                            matches.push({
                                id: key.slice(prefix.length),
                                data: () => ({ ...data })
                            });
                        }
                        return { docs: matches, empty: matches.length === 0, forEach(fn) { matches.forEach(fn); } };
                    }
                };
                return query;
            }
        };
    }

    return {
        collection(name) {
            return collectionAt(name);
        },
        runTransaction(fn) {
            const tx = {
                async get(ref) {
                    const key = `${ref.collectionName}/${ref.id}`;
                    const data = docs.get(key);
                    return {
                        exists: Boolean(data),
                        data: () => data
                    };
                },
                set(ref, payload, options) {
                    const key = `${ref.collectionName}/${ref.id}`;
                    const existing = docs.get(key) || {};
                    docs.set(key, options?.merge ? { ...existing, ...payload } : payload);
                }
            };
            return fn(tx);
        },
        _docs: docs
    };
}

describe("booking rate limit policy matrix", () => {
    it("documents rebalanced defaults", () => {
        const cfg = getBookingRateLimitConfig();
        assert.equal(cfg.BOOKING_ROUTE_BURST_MAX, 30);
        assert.equal(cfg.BOOKING_BURST_MAX, 10);
        assert.equal(cfg.BOOKING_BURST_WINDOW_SECONDS, 600);
        assert.equal(cfg.BOOKING_ATTEMPT_MAX, 10);
        assert.equal(cfg.BOOKING_SUCCESS_MAX, 5);
        assert.equal(cfg.BOOKING_IP_SUCCESS_MAX, 25);
        assert.equal(cfg.AVAILABILITY_RATE_LIMIT_MAX, 60);
    });

    it("identifies success policies as Istanbul request-day buckets", () => {
        const matrix = getPolicyMatrix();
        const phoneSuccess = matrix.find((p) => p.scope === RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS);
        assert.ok(phoneSuccess);
        assert.equal(phoneSuccess.limit, 5);
        assert.equal(phoneSuccess.resetPolicy, "istanbul_midnight");
        assert.match(phoneSuccess.key, /request day/);
    });

    it("adds separate ip_business_success policy for shared networks", () => {
        const matrix = getPolicyMatrix();
        const ipSuccess = matrix.find((p) => p.scope === RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS);
        assert.ok(ipSuccess);
        assert.equal(ipSuccess.limit, 25);
    });
});

describe("trusted client IP normalization", () => {
    it("uses first x-forwarded-for value on Vercel-style requests", () => {
        const ip = getClientIp({
            headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
            socket: { remoteAddress: "127.0.0.1" }
        });
        assert.equal(ip, "203.0.113.5");
    });

    it("normalizes IPv4-mapped IPv6 and bracketed IPv6", () => {
        assert.equal(normalizeTrustedClientIp("::ffff:192.0.2.1"), "192.0.2.1");
        assert.equal(normalizeTrustedClientIp("[2001:db8::1]"), "2001:db8::1");
    });
});

describe("privacy-safe rate-limit keys", () => {
    it("never stores raw phone or IP in derived identities", () => {
        const phone = "5551234567";
        const ip = "203.0.113.8";
        const phoneHash = hashPhoneIdentity(phone, "demo-shop");
        const ipHash = hashIpIdentity(ip);
        assert.doesNotMatch(phoneHash, /5551234567/);
        assert.doesNotMatch(ipHash, /203\.0\.113\.8/);
        assert.equal(phoneHash.length, 24);
        assert.equal(ipHash.length, 24);
    });

    it("uses separate buckets for availability and create burst counters", () => {
        const ids = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-a",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.1",
            requestDay: "20260730"
        });
        assert.notEqual(ids.burstCreate, ids.burstAvailability);
        assert.match(ids.burstCreate, /burst_create_/);
        assert.match(ids.burstAvailability, /burst_avail_/);
    });

    it("scopes attempt and success counters per tenant", () => {
        const tenantA = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-a",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.1",
            requestDay: "20260730"
        });
        const tenantB = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-b",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.1",
            requestDay: "20260730"
        });
        assert.notEqual(tenantA.attempt, tenantB.attempt);
        assert.notEqual(tenantA.phoneSuccess, tenantB.phoneSuccess);
        assert.notEqual(tenantA.ipSuccess, tenantB.ipSuccess);
    });
});

describe("firestore counter behavior", () => {
    it("allows three different phones on the same IP to book without exhausting ip success limit", async () => {
        const db = createMockDb();
        process.env.BOOKING_IP_SUCCESS_MAX = "25";

        for (const phone of ["5551111101", "5551111102", "5551111103"]) {
            await incrementBookingSuccessLimit(db, "shop-a", phone, "2026-07-30", "203.0.113.50");
        }

        await assert.doesNotReject(() =>
            checkBookingSuccessLimit(db, "shop-a", "5551111104", "2026-07-30", "203.0.113.50")
        );

        delete process.env.BOOKING_IP_SUCCESS_MAX;
    });

    it("enforces ip+business success threshold at configured limit", async () => {
        const db = createMockDb();
        process.env.BOOKING_IP_SUCCESS_MAX = "3";

        for (let i = 0; i < 3; i += 1) {
            await incrementBookingSuccessLimit(db, "shop-a", `555900000${i}`, "2026-07-30", "203.0.113.51");
        }

        await assert.rejects(
            () => checkBookingSuccessLimit(db, "shop-a", "5559000099", "2026-07-30", "203.0.113.51"),
            (err) => err.code === "rate_limited" && err.rateLimitScope === RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS
        );

        delete process.env.BOOKING_IP_SUCCESS_MAX;
    });

    it("increments success quota only through success counter helper", async () => {
        const db = createMockDb();
        process.env.BOOKING_SUCCESS_MAX = "1";

        await incrementBookingSuccessLimit(db, "shop-a", "5559998877", "2026-07-30", "203.0.113.52");
        await assert.rejects(
            () => incrementBookingSuccessLimit(db, "shop-a", "5559998877", "2026-07-30", "203.0.113.52"),
            (err) => err.code === "rate_limited"
        );

        delete process.env.BOOKING_SUCCESS_MAX;
    });

    it("tracks booking attempts separately from burst counters", async () => {
        const db = createMockDb();
        process.env.BOOKING_ATTEMPT_MAX = "2";

        await enforceBookingAttemptLimit(db, "shop-a", "5554443322");
        await enforceBookingAttemptLimit(db, "shop-a", "5554443322");
        await assert.rejects(
            () => enforceBookingAttemptLimit(db, "shop-a", "5554443322"),
            (err) => err.code === "rate_limited" && err.rateLimitScope === RATE_LIMIT_SCOPES.PHONE_BUSINESS_ATTEMPT
        );

        delete process.env.BOOKING_ATTEMPT_MAX;
    });

    it("scopes create burst per ip+business", async () => {
        const db = createMockDb();
        process.env.BOOKING_BURST_MAX = "2";

        await enforceCreateIpBusinessBurstLimit(db, "shop-a", "203.0.113.60");
        await enforceCreateIpBusinessBurstLimit(db, "shop-a", "203.0.113.60");
        await assert.rejects(
            () => enforceCreateIpBusinessBurstLimit(db, "shop-a", "203.0.113.60"),
            (err) => err.rateLimitScope === RATE_LIMIT_SCOPES.IP_BUSINESS_CREATE_BURST
        );

        await assert.doesNotReject(() =>
            enforceCreateIpBusinessBurstLimit(db, "shop-b", "203.0.113.60")
        );

        delete process.env.BOOKING_BURST_MAX;
    });

    it("resets an expired window without waiting for document deletion", async () => {
        const db = createMockDb();
        process.env.BOOKING_ROUTE_BURST_MAX = "1";
        process.env.BOOKING_ROUTE_BURST_WINDOW_SECONDS = "30";

        await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.21");

        const ids = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-a",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.21",
            requestDay: "20260730"
        });
        const key = `rateLimits/${ids.routeBurst}`;
        const stored = db._docs.get(key);
        stored.resetAt = Timestamp.fromMillis(Date.now() - 1000);
        db._docs.set(key, stored);

        await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.21");

        delete process.env.BOOKING_ROUTE_BURST_MAX;
        delete process.env.BOOKING_ROUTE_BURST_WINDOW_SECONDS;
    });
});

describe("429 response contract", () => {
    it("maps rate_limited errors with scope and Retry-After metadata", () => {
        const mapped = mapBookingErrorToHttp({
            code: "rate_limited",
            retryAfterSeconds: 45,
            rateLimitLimit: 10,
            rateLimitScope: RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS,
            rateLimitReset: 1_700_000_000
        }, { requestId: "req-429" });
        assert.equal(mapped.status, 429);
        assert.equal(mapped.body.scope, RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS);
        assert.equal(mapped.body.requestId, "req-429");
        assert.equal(mapped.body.retryAfterSeconds, 45);
        assert.equal(mapped.headers["Retry-After"], "45");
    });

    it("429 HTTP helper includes scope without raw identifiers", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/http.js"), "utf8");
        assert.match(src, /scope/);
        assert.match(src, /requestId/);
        assert.doesNotMatch(src, /rawPhone|rawIp|hmac/i);
    });
});

describe("counter ordering and quota isolation", () => {
    it("enforces success quotas atomically inside create transaction", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        const txnBlock = src.slice(src.indexOf("await db.runTransaction"), src.indexOf("await runBestEffortSideEffects"));
        assert.match(txnBlock, /resolveSuccessQuotaRefs|readSuccessCounterState/);
        assert.match(txnBlock, /assertSuccessQuotaAvailable/);
        assert.match(txnBlock, /buildSuccessCounterWritePayload/);
        assert.doesNotMatch(txnBlock, /incrementBookingSuccessLimit/);
        assert.doesNotMatch(txnBlock, /checkBookingSuccessLimit/);
    });

    it("checks idempotency before attempt limit and before transaction", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        const idemIndex = src.indexOf('collection("appointmentIdempotency").doc(idempotencyDocId).get()');
        const attemptIndex = src.indexOf("await enforceBookingAttemptLimit(");
        const txnIndex = src.indexOf("await db.runTransaction");
        assert.ok(idemIndex > 0 && attemptIndex > idemIndex);
        assert.ok(txnIndex > attemptIndex);
    });

    it("does not increment success counters on slot conflict paths", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        const txnBlock = src.slice(src.indexOf("await db.runTransaction"), src.indexOf("await runBestEffortSideEffects"));
        const quotaWriteIndex = txnBlock.indexOf("buildSuccessCounterWritePayload");
        const slotTakenIndex = txnBlock.indexOf('err.code = "slot_taken"');
        assert.ok(quotaWriteIndex > slotTakenIndex, "quota writes occur after slot conflict checks");
    });

    it("availability route scopes burst limiter to business", () => {
        const src = readFileSync(resolve(ROOT, "api/public/availability.js"), "utf8");
        assert.match(src, /enforceAvailabilityBurstLimit\(db, businessSlug, ip\)/);
    });

    it("firebase-admin stays decoupled from booking rate-limit secrets", () => {
        const adminSrc = readFileSync(resolve(ROOT, "api/_lib/firebase-admin.js"), "utf8");
        assert.doesNotMatch(adminSrc, /requireProductionRateLimitSecrets/);
        assert.doesNotMatch(adminSrc, /booking-rate-limit/);
    });

    it("production requires dedicated HMAC secrets and rejects fallbacks", () => {
        const prevEnv = process.env.VERCEL_ENV;
        const prevPhone = process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
        const prevIp = process.env.RATE_LIMIT_IP_HMAC_SECRET;
        const prevShared = process.env.RATE_LIMIT_HMAC_SECRET;
        const prevSalt = process.env.RATE_LIMIT_IP_SALT;

        process.env.VERCEL_ENV = "production";
        delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
        delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
        delete process.env.RATE_LIMIT_HMAC_SECRET;
        assert.throws(
            () => requireProductionRateLimitSecrets(),
            (err) => err.code === "rate_limit_config_error"
        );

        process.env.RATE_LIMIT_HMAC_SECRET = "shared-only-secret";
        assert.throws(
            () => requireProductionRateLimitSecrets(),
            (err) => err.code === "rate_limit_config_error"
        );

        process.env.RATE_LIMIT_PHONE_HMAC_SECRET = "prod-phone-secret";
        process.env.RATE_LIMIT_IP_HMAC_SECRET = "prod-ip-secret";
        process.env.RATE_LIMIT_IP_SALT = "legacy-salt";
        assert.throws(
            () => requireProductionRateLimitSecrets(),
            (err) => err.code === "rate_limit_config_error"
        );

        delete process.env.RATE_LIMIT_IP_SALT;
        process.env.RATE_LIMIT_PHONE_HMAC_SECRET = "berberrandevu-dev-hmac-secret-change-before-production";
        process.env.RATE_LIMIT_IP_HMAC_SECRET = "prod-ip-secret";
        assert.throws(
            () => requireProductionRateLimitSecrets(),
            (err) => err.code === "rate_limit_config_error"
        );

        process.env.VERCEL_ENV = prevEnv;
        if (prevPhone) process.env.RATE_LIMIT_PHONE_HMAC_SECRET = prevPhone;
        else delete process.env.RATE_LIMIT_PHONE_HMAC_SECRET;
        if (prevIp) process.env.RATE_LIMIT_IP_HMAC_SECRET = prevIp;
        else delete process.env.RATE_LIMIT_IP_HMAC_SECRET;
        if (prevShared) process.env.RATE_LIMIT_HMAC_SECRET = prevShared;
        else delete process.env.RATE_LIMIT_HMAC_SECRET;
        if (prevSalt) process.env.RATE_LIMIT_IP_SALT = prevSalt;
        else delete process.env.RATE_LIMIT_IP_SALT;
    });

    it("maps rate_limit_config_error to HTTP 503 with requestId", () => {
        const mapped = mapBookingErrorToHttp({ code: "rate_limit_config_error" }, { requestId: "req-503" });
        assert.equal(mapped.status, 503);
        assert.equal(mapped.body.code, "rate_limit_config_error");
        assert.equal(mapped.body.requestId, "req-503");
    });
});

describe("admin bucket diagnostic script safety", () => {
    it("requires explicit environment and refuses wildcard scopes", () => {
        const src = readFileSync(resolve(ROOT, "scripts/admin-rate-limit-bucket.mjs"), "utf8");
        assert.match(src, /requireArg\(args, "environment"\)/);
        assert.match(src, /confirm-production/);
        assert.match(src, /Wildcard scopes are not allowed/);
        assert.doesNotMatch(src, /deleteCollection|batch\(\)\.commit\(\)[\s\S]*rateLimits/);
    });
});

describe("public booking client UX", () => {
    it("formats retry duration for Turkish users", () => {
        assert.match(formatRateLimitMessage(45), /Yaklaşık 45 saniye/);
        assert.match(formatRateLimitMessage(120), /Yaklaşık 2 dakika/);
    });

    it("does not auto-retry on 429", () => {
        const src = readFileSync(resolve(ROOT, "publicAppointmentClient.js"), "utf8");
        assert.equal((src.match(/await fetch\(/g) || []).length, 1);
        assert.doesNotMatch(src, /while\s*\(/);
    });
});
