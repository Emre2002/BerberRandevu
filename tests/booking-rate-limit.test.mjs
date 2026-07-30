import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Timestamp } from "firebase-admin/firestore";
import {
    buildRateLimitDocIdsForTests,
    enforceAvailabilityBurstLimit,
    enforceBookingAttemptLimit,
    enforcePublicRouteBurstLimit,
    getBookingRateLimitConfig,
    hashIpIdentity,
    hashPhoneIdentity,
    incrementBookingSuccessLimit,
    normalizeTrustedClientIp
} from "../api/_lib/booking-rate-limit.js";
import { buildRateLimitHeaders } from "../api/_lib/http.js";
import { getClientIp } from "../api/_lib/rate-limit.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";
import { formatRateLimitMessage } from "../publicAppointmentClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function createMockDb() {
    const docs = new Map();

    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        id,
                        collectionName: name,
                        async get() {
                            const key = `${name}/${id}`;
                            const data = docs.get(key);
                            return {
                                exists: Boolean(data),
                                data: () => data
                            };
                        }
                    };
                }
            };
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

describe("booking rate limit configuration", () => {
    it("uses documented safe defaults", () => {
        const cfg = getBookingRateLimitConfig();
        assert.equal(cfg.BOOKING_BURST_MAX, 40);
        assert.equal(cfg.BOOKING_BURST_WINDOW_SECONDS, 60);
        assert.equal(cfg.BOOKING_ATTEMPT_MAX, 12);
        assert.equal(cfg.BOOKING_SUCCESS_MAX, 3);
        assert.equal(cfg.AVAILABILITY_RATE_LIMIT_MAX, 120);
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

    it("does not treat spoofed client-ip header as identity when x-forwarded-for is absent", () => {
        const spoofed = getClientIp({
            headers: { "client-ip": "203.0.113.99" },
            socket: { remoteAddress: "198.51.100.10" }
        });
        assert.equal(spoofed, "198.51.100.10");
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
            date: "2026-07-30"
        });
        assert.notEqual(ids.burstCreate, ids.burstAvailability);
        assert.match(ids.burstCreate, /burst_public-create-appointment_/);
        assert.match(ids.burstAvailability, /burst_public-availability_/);
    });

    it("scopes attempt and success counters per tenant and phone identity", () => {
        const tenantA = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-a",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.1",
            date: "2026-07-30"
        });
        const tenantB = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-b",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.1",
            date: "2026-07-30"
        });
        assert.notEqual(tenantA.attempt, tenantB.attempt);
        assert.notEqual(tenantA.success, tenantB.success);
    });
});

describe("firestore counter behavior", () => {
    it("accepts requests up to the limit and rejects limit+1", async () => {
        const db = createMockDb();
        process.env.BOOKING_BURST_MAX = "3";
        process.env.BOOKING_BURST_WINDOW_SECONDS = "60";

        for (let i = 0; i < 3; i += 1) {
            await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.20");
        }

        await assert.rejects(
            () => enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.20"),
            (err) => err.code === "rate_limited" && err.retryAfterSeconds > 0
        );

        delete process.env.BOOKING_BURST_MAX;
        delete process.env.BOOKING_BURST_WINDOW_SECONDS;
    });

    it("resets an expired window without waiting for document deletion", async () => {
        const db = createMockDb();
        process.env.BOOKING_BURST_MAX = "1";
        process.env.BOOKING_BURST_WINDOW_SECONDS = "30";

        await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.21");

        const ids = buildRateLimitDocIdsForTests({
            routeName: "public-create-appointment",
            businessId: "shop-a",
            phoneNorm: "5551112233",
            clientIp: "203.0.113.21",
            date: "2026-07-30"
        });
        const key = `rateLimits/${ids.burstCreate}`;
        const stored = db._docs.get(key);
        stored.resetAt = Timestamp.fromMillis(Date.now() - 1000);
        db._docs.set(key, stored);

        await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.21");

        delete process.env.BOOKING_BURST_MAX;
        delete process.env.BOOKING_BURST_WINDOW_SECONDS;
    });

    it("does not share availability and create burst counters", async () => {
        const db = createMockDb();
        process.env.BOOKING_BURST_MAX = "1";
        process.env.AVAILABILITY_RATE_LIMIT_MAX = "1";

        await enforcePublicRouteBurstLimit(db, "public-create-appointment", "203.0.113.22");
        await enforceAvailabilityBurstLimit(db, "203.0.113.22");

        delete process.env.BOOKING_BURST_MAX;
        delete process.env.AVAILABILITY_RATE_LIMIT_MAX;
    });

    it("increments success quota only through success counter helper", async () => {
        const db = createMockDb();
        process.env.BOOKING_SUCCESS_MAX = "1";

        await incrementBookingSuccessLimit(db, "shop-a", "5559998877", "2026-07-30");
        await assert.rejects(
            () => incrementBookingSuccessLimit(db, "shop-a", "5559998877", "2026-07-30"),
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
            (err) => err.code === "rate_limited"
        );

        delete process.env.BOOKING_ATTEMPT_MAX;
    });
});

describe("429 response contract", () => {
    it("maps rate_limited errors with Retry-After metadata", () => {
        const mapped = mapBookingErrorToHttp({
            code: "rate_limited",
            retryAfterSeconds: 45,
            rateLimitLimit: 12,
            rateLimitReset: 1_700_000_000
        });
        assert.equal(mapped.status, 429);
        assert.equal(mapped.body.retryAfterSeconds, 45);
        assert.equal(mapped.headers["Retry-After"], "45");
        assert.equal(mapped.headers["RateLimit-Limit"], "12");
        assert.equal(mapped.headers["RateLimit-Remaining"], "0");
    });

    it("builds rate-limit headers for successful responses when metadata exists", () => {
        const headers = buildRateLimitHeaders({
            limit: 40,
            remaining: 39,
            resetAtSeconds: 1_700_000_060
        });
        assert.equal(headers["RateLimit-Limit"], "40");
        assert.equal(headers["RateLimit-Remaining"], "39");
    });
});

describe("public booking client UX", () => {
    it("formats retry duration for Turkish users", () => {
        assert.match(formatRateLimitMessage(45), /Yaklaşık 45 saniye/);
        assert.match(formatRateLimitMessage(120), /Yaklaşık 2 dakika/);
        assert.match(
            formatRateLimitMessage(null),
            /Kısa sürede çok fazla işlem yapıldı/
        );
    });

    it("does not auto-retry on 429", () => {
        const src = readFileSync(resolve(ROOT, "publicAppointmentClient.js"), "utf8");
        assert.equal((src.match(/await fetch\(/g) || []).length, 1);
        assert.doesNotMatch(src, /while\s*\(/);
        assert.doesNotMatch(src, /setTimeout[\s\S]*fetch\(/);
    });

    it("submit handler disables button while pending and guards double click", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /bookingInProgress/);
        assert.match(src, /if \(bookingInProgress\) return/);
        assert.match(src, /btnBook\.disabled = true/);
        assert.match(src, /getOrCreateBookingIdempotencyKey/);
    });

    it("create route uses Firestore burst limiter instead of in-memory create quota", () => {
        const src = readFileSync(resolve(ROOT, "api/public/create-appointment.js"), "utf8");
        assert.match(src, /enforcePublicRouteBurstLimit/);
        assert.match(src, /sendRateLimited/);
        assert.doesNotMatch(src, /checkRateLimit\(`public-create-appointment/);
    });

    it("core checks idempotency before attempt and success counters", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        const idemIndex = src.indexOf('collection("appointmentIdempotency").doc(idempotencyDocId).get()');
        const attemptIndex = src.indexOf("await enforceBookingAttemptLimit(");
        const successIndex = src.indexOf("await checkBookingSuccessLimit(");
        assert.ok(idemIndex > 0 && attemptIndex > idemIndex);
        assert.ok(successIndex > attemptIndex);
        assert.doesNotMatch(src, /enforceGlobalIpLimit/);
    });
});
