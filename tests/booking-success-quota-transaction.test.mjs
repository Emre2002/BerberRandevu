import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { createPublicAppointment } from "../api/_lib/create-appointment-core.js";
import {
    getRequestDayBucket,
    resolveSuccessQuotaRefs,
    readSuccessCounterState,
    assertSuccessQuotaAvailable
} from "../api/_lib/booking-rate-limit.js";

function docKey(collection, id) {
    return `${collection}/${id}`;
}

function createBookingMockDb(initial = {}) {
    const docs = new Map(Object.entries(initial));
    let transactionQueue = Promise.resolve();
    let autoIdCounter = 0;

    const makeRef = (collection, id) => {
        const resolvedId = id || `auto-${++autoIdCounter}`;
        const collectionPath = collection;
        const key = docKey(collectionPath, resolvedId);
        const ref = {
            id: resolvedId,
            path: `${collectionPath}/${resolvedId}`,
            collectionName: collectionPath,
            async get() {
                if (!docs.has(key)) {
                    return { exists: false, data: () => undefined, id: resolvedId };
                }
                const value = docs.get(key);
                return {
                    exists: true,
                    id: resolvedId,
                    data: () => (typeof value === "object" ? { ...value } : value)
                };
            },
            async delete() {
                docs.delete(key);
            },
            async set(payload, options) {
                const existing = docs.get(key) || {};
                docs.set(key, options?.merge ? { ...existing, ...payload } : payload);
            },
            async update(payload) {
                const existing = docs.get(key) || {};
                docs.set(key, { ...existing, ...payload });
            },
            collection(subName) {
                return collectionAt(`${collectionPath}/${resolvedId}/${subName}`);
            }
        };
        return ref;
    };

    function collectionAt(path) {
        const prefix = `${path}/`;
        return {
            doc(id) {
                return makeRef(path, id);
            },
            where(field, _op, value) {
                const filters = [{ field, value }];
                const query = {
                    _prefix: prefix,
                    _filters: filters,
                    where(nextField, _nextOp, nextValue) {
                        filters.push({ field: nextField, value: nextValue });
                        return query;
                    },
                    limit() {
                        return query;
                    },
                    async get() {
                        const matches = [];
                        for (const [docKeyPath, data] of docs.entries()) {
                            if (!docKeyPath.startsWith(prefix)) continue;
                            let ok = true;
                            for (const filter of filters) {
                                if (data?.[filter.field] !== filter.value) {
                                    ok = false;
                                    break;
                                }
                            }
                            if (!ok) continue;
                            matches.push({
                                id: docKeyPath.slice(prefix.length),
                                data: () => ({ ...data }),
                                ref: makeRef(path, docKeyPath.slice(prefix.length))
                            });
                        }
                        return { docs: matches, empty: matches.length === 0, forEach(fn) { matches.forEach(fn); } };
                    }
                };
                return query;
            },
            async add(payload) {
                const ref = makeRef(path);
                docs.set(docKey(path, ref.id), { ...payload });
                return ref;
            }
        };
    }

    const db = {
        collection(name) {
            return collectionAt(name);
        },
        runTransaction(fn) {
            const run = async () => {
                const working = new Map(docs);
                const tx = {
                    async get(target) {
                        if (target && typeof target.get === "function" && !target.id && !target.collectionName) {
                            const prefix = target._prefix;
                            const filters = target._filters || [];
                            const matches = [];
                            for (const [docKeyPath, data] of working.entries()) {
                                if (prefix && !docKeyPath.startsWith(prefix)) continue;
                                let ok = true;
                                for (const filter of filters) {
                                    if (data?.[filter.field] !== filter.value) {
                                        ok = false;
                                        break;
                                    }
                                }
                                if (!ok) continue;
                                const collPath = prefix ? prefix.slice(0, -1) : "";
                                matches.push({
                                    id: docKeyPath.slice(prefix.length),
                                    data: () => ({ ...data }),
                                    ref: makeRef(collPath, docKeyPath.slice(prefix.length))
                                });
                            }
                            return { docs: matches, empty: matches.length === 0 };
                        }

                        const key = docKey(target.collectionName || target.path.split("/")[0], target.id);
                        if (!working.has(key)) {
                            return { exists: false, data: () => undefined, id: target.id };
                        }
                        const value = working.get(key);
                        return {
                            exists: true,
                            id: target.id,
                            data: () => (typeof value === "object" ? { ...value } : value)
                        };
                    },
                    set(ref, value, options) {
                        const key = docKey(ref.collectionName || ref.path.split("/")[0], ref.id);
                        const existing = working.get(key) || {};
                        working.set(
                            key,
                            options?.merge ? { ...existing, ...value } : { ...value }
                        );
                    },
                    delete(ref) {
                        working.delete(docKey(ref.collectionName || ref.path.split("/")[0], ref.id));
                    }
                };

                const result = await fn(tx);
                docs.clear();
                for (const [key, value] of working.entries()) {
                    docs.set(key, value);
                }
                return result;
            };

            const next = transactionQueue.then(run, run);
            transactionQueue = next.catch(() => {});
            return next;
        },
        _docs: docs
    };

    return { db, docs };
}

function seedPublicBusiness(docs, businessId, { openHour = "09:00", closeHour = "21:00" } = {}) {
    docs.set(docKey("publicBarbers", businessId), {
        status: "active",
        bookingOpen: true,
        openHour,
        closeHour,
        selectedServices: ["Saç Kesimi & Yıkama"]
    });
}

function futureDate(offsetDays = 14) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function bookingInput(overrides = {}) {
    return {
        dukkan: "shop-a",
        customerName: "Test Musteri",
        phone: "05551234567",
        service: "Saç Kesimi & Yıkama",
        date: futureDate(14),
        time: "10:00",
        musteriNotu: "",
        website: "",
        ...overrides
    };
}

describe("success quota atomic transaction", () => {
    const envBackup = {};

    beforeEach(() => {
        envBackup.BOOKING_SUCCESS_MAX = process.env.BOOKING_SUCCESS_MAX;
        envBackup.BOOKING_IP_SUCCESS_MAX = process.env.BOOKING_IP_SUCCESS_MAX;
        envBackup.BOOKING_BURST_MAX = process.env.BOOKING_BURST_MAX;
        envBackup.BOOKING_ATTEMPT_MAX = process.env.BOOKING_ATTEMPT_MAX;
        process.env.BOOKING_SUCCESS_MAX = "1";
        process.env.BOOKING_IP_SUCCESS_MAX = "100";
        process.env.BOOKING_BURST_MAX = "100";
        process.env.BOOKING_ATTEMPT_MAX = "100";
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(envBackup)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it("allows at most one commit when two requests compete at final phone quota", async () => {
        const businessId = "shop-a";
        const { db, docs } = createBookingMockDb();
        seedPublicBusiness(docs, businessId);

        const dateA = futureDate(14);
        const dateB = futureDate(15);

        const results = await Promise.allSettled([
            createPublicAppointment(db, bookingInput({ date: dateA, time: "10:00", phone: "05551111111" }), {
                clientIp: "203.0.113.1"
            }),
            createPublicAppointment(db, bookingInput({ date: dateB, time: "11:00", phone: "05551111111" }), {
                clientIp: "203.0.113.2"
            })
        ]);

        const successes = results.filter((r) => r.status === "fulfilled" && r.value?.ok);
        const rateLimited = results.filter(
            (r) => r.status === "rejected" && r.reason?.code === "rate_limited"
        );

        assert.equal(successes.length, 1, "exactly one booking should commit");
        assert.equal(rateLimited.length, 1, "exactly one request should be rate limited");

        const appointmentDocs = [...docs.entries()].filter(([key]) => key.startsWith("appointments/"));
        assert.equal(appointmentDocs.length, 1, "only one appointment document should exist");

        const quota = resolveSuccessQuotaRefs(db, businessId, "5551111111", "203.0.113.1");
        const phoneSnap = await quota.phone.ref.get();
        const phoneState = readSuccessCounterState(phoneSnap, {
            limit: 1,
            requestDay: quota.requestDay,
            resetAtMs: quota.resetAtMs,
            nowMs: quota.nowMs,
            scope: quota.phone.scope
        });
        assert.equal(phoneState.count, 1, "phone success counter should be exactly 1");
    });

    it("does not return HTTP 429 mapping for a committed appointment", async () => {
        const businessId = "shop-a";
        const { db, docs } = createBookingMockDb();
        seedPublicBusiness(docs, businessId);

        const result = await createPublicAppointment(
            db,
            bookingInput({ phone: "05552222222" }),
            { clientIp: "203.0.113.3" }
        );

        assert.equal(result.ok, true);
        assert.ok(result.appointmentId);

        const appointmentDocs = [...docs.entries()].filter(([key]) => key.startsWith("appointments/"));
        assert.equal(appointmentDocs.length, 1);
    });

    it("shares request-day quota across different future appointment dates", async () => {
        const businessId = "shop-a";
        const { db, docs } = createBookingMockDb();
        seedPublicBusiness(docs, businessId);
        process.env.BOOKING_SUCCESS_MAX = "1";

        await createPublicAppointment(
            db,
            bookingInput({ date: futureDate(20), time: "10:00", phone: "05553333333" }),
            { clientIp: "203.0.113.4" }
        );

        await assert.rejects(
            () => createPublicAppointment(
                db,
                bookingInput({ date: futureDate(25), time: "11:00", phone: "05553333333" }),
                { clientIp: "203.0.113.5" }
            ),
            (err) => err.code === "rate_limited"
        );

        const appointmentDocs = [...docs.entries()].filter(([key]) => key.startsWith("appointments/"));
        assert.equal(appointmentDocs.length, 1, "second date must not bypass request-day quota");
    });

    it("idempotent replay does not consume additional success quota", async () => {
        const businessId = "shop-a";
        const { db, docs } = createBookingMockDb();
        seedPublicBusiness(docs, businessId);
        process.env.BOOKING_SUCCESS_MAX = "1";

        const input = bookingInput({
            phone: "05554444444",
            idempotencyKey: "idem-quota-test-1"
        });

        const first = await createPublicAppointment(db, input, { clientIp: "203.0.113.6" });
        assert.equal(first.ok, true);

        const replay = await createPublicAppointment(db, input, { clientIp: "203.0.113.6" });
        assert.equal(replay.ok, true);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.appointmentId, first.appointmentId);

        const quota = resolveSuccessQuotaRefs(db, businessId, "5554444444", "203.0.113.6");
        const phoneSnap = await quota.phone.ref.get();
        const phoneState = readSuccessCounterState(phoneSnap, {
            limit: 1,
            requestDay: quota.requestDay,
            resetAtMs: quota.resetAtMs,
            nowMs: quota.nowMs,
            scope: quota.phone.scope
        });
        assert.equal(phoneState.count, 1);

        const appointmentDocs = [...docs.entries()].filter(([key]) => key.startsWith("appointments/"));
        assert.equal(appointmentDocs.length, 1);
    });

    it("concurrent same-slot booking yields one success and one slot conflict", async () => {
        const businessId = "shop-a";
        const { db, docs } = createBookingMockDb();
        seedPublicBusiness(docs, businessId);
        process.env.BOOKING_SUCCESS_MAX = "10";

        const shared = bookingInput({
            date: futureDate(16),
            time: "12:00",
            phone: "05555555551"
        });
        const sharedB = bookingInput({
            date: futureDate(16),
            time: "12:00",
            phone: "05555555552"
        });

        const results = await Promise.allSettled([
            createPublicAppointment(db, shared, { clientIp: "203.0.113.7" }),
            createPublicAppointment(db, sharedB, { clientIp: "203.0.113.8" })
        ]);

        const successes = results.filter((r) => r.status === "fulfilled" && r.value?.ok);
        const conflicts = results.filter(
            (r) => r.status === "rejected" && r.reason?.code === "slot_taken"
        );

        assert.equal(successes.length, 1);
        assert.equal(conflicts.length, 1);

        const appointmentDocs = [...docs.entries()].filter(([key]) => key.startsWith("appointments/"));
        assert.equal(appointmentDocs.length, 1);
    });
});

describe("request-day bucket semantics", () => {
    it("uses Istanbul request day independent of appointment date", () => {
        const fixedNow = new Date("2026-07-30T20:00:00.000Z");
        const requestDay = getRequestDayBucket(fixedNow);
        assert.equal(requestDay, "20260730");

        const { db } = createBookingMockDb();
        const quotaA = resolveSuccessQuotaRefs(db, "shop-a", "5551234567", "203.0.113.1", fixedNow);
        const quotaB = resolveSuccessQuotaRefs(
            db,
            "shop-a",
            "5551234567",
            "203.0.113.1",
            fixedNow
        );

        assert.match(quotaA.phone.ref.id, /_20260730$/);
        assert.equal(quotaA.phone.ref.id, quotaB.phone.ref.id);
        assert.notEqual(quotaA.requestDay, "20260815");
    });

    it("resets counter when requestDay on stored doc differs from current request day", () => {
        const resetAtMs = Date.now() + 3600_000;
        const snap = {
            exists: true,
            data: () => ({
                count: 5,
                requestDay: "20260729",
                resetAt: Timestamp.fromMillis(resetAtMs)
            })
        };

        const state = readSuccessCounterState(snap, {
            limit: 5,
            requestDay: "20260730",
            resetAtMs,
            nowMs: Date.now(),
            scope: "phone_business_success"
        });

        assert.equal(state.count, 0, "stale requestDay should not carry over count");
    });

    it("assertSuccessQuotaAvailable throws at limit without side effects", () => {
        assert.throws(
            () => assertSuccessQuotaAvailable(
                { count: 5, limit: 5, resetAtMs: Date.now() + 60_000, scope: "phone_business_success" },
                Date.now()
            ),
            (err) => err.code === "rate_limited"
        );
    });
});
