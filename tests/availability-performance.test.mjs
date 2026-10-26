import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
    buildOccupiedIntervalsFromHourlyTimes,
    computePublicAvailability,
    parseLegacyDayBusyTimes
} from "../api/_lib/availability.js";
import { isPastAppointmentSlot } from "../appointmentDateTime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const availabilityClientSource = readFileSync(resolve(ROOT, "publicAvailabilityClient.js"), "utf8")
    .replace('import { getBaseUrl } from "./linkService.js";', 'function getBaseUrl() { return "https://preview.example.test"; }');
const { fetchPublicAvailability, getAvailabilityInFlightCount, invalidateAvailabilityMemoryCache } =
    await import(`data:text/javascript,${encodeURIComponent(availabilityClientSource)}`);

function createMockDb({ publicBarber, appointments = [], blocked = [], legacy = null }) {
    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        id,
                        collection(subName) {
                            return {
                                doc(subId) {
                                    const path = `${name}/${id}/${subName}/${subId}`;
                                    return {
                                        id: subId,
                                        async get() {
                                            if (subName === "appointments" && subId.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                                return { exists: legacy != null, data: () => legacy };
                                            }
                                            if (subName === "blockedSlots") {
                                                const match = blocked.find((b) => b.docId === subId);
                                                return { exists: Boolean(match), data: () => match?.data || {} };
                                            }
                                            return { exists: false, data: () => null };
                                        }
                                    };
                                },
                                where(field, op, value) {
                                    return {
                                        async get() {
                                            if (subName === "blockedSlots" && field === "date") {
                                                return {
                                                    forEach(fn) {
                                                        blocked
                                                            .filter((b) => b.data.date === value && b.docId.includes("_"))
                                                            .forEach((b) => fn({ data: () => b.data }));
                                                    },
                                                    docs: blocked
                                                        .filter((b) => b.data.date === value && b.docId.includes("_"))
                                                        .map((b) => ({ data: () => b.data }))
                                                };
                                            }
                                            return { forEach() {}, docs: [] };
                                        }
                                    };
                                }
                            };
                        },
                        async get() {
                            if (name === "publicBarbers") {
                                return { exists: Boolean(publicBarber), data: () => publicBarber };
                            }
                            return { exists: false, data: () => null };
                        }
                    };
                },
                where(field, op, value) {
                    const filters = [{ field, op, value }];
                    const query = {
                        where(nextField, nextOp, nextValue) {
                            filters.push({ field: nextField, op: nextOp, value: nextValue });
                            return query;
                        },
                        async get() {
                            if (name === "appointments") {
                                return {
                                    docs: appointments
                                        .filter((a) => filters.every((f) => a[f.field] === f.value))
                                        .map((a) => ({ data: () => a }))
                                };
                            }
                            return { docs: [] };
                        }
                    };
                    return query;
                }
            };
        }
    };
}

describe("availability backend performance characteristics", () => {
    it("loads legacy day doc once instead of per-slot N+1 reads", async () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/availability.js"), "utf8");
        assert.doesNotMatch(src, /for \(const time of slots\)[\s\S]*await isLegacySlotTaken/);
        assert.match(src, /loadLegacyDayDoc/);
        assert.match(src, /Promise\.all/);
    });

    it("builds occupied intervals from hourly busy slots", () => {
        assert.deepEqual(buildOccupiedIntervalsFromHourlyTimes(["10:00", "9:00"]), [
            { start: "09:00", end: "10:00" },
            { start: "10:00", end: "11:00" }
        ]);
    });

    it("parses legacy day busy times in one pass", () => {
        const busy = parseLegacyDayBusyTimes({
            "10:00": "Ali",
            "11:00": ""
        }, ["09:00", "10:00", "11:00"]);
        assert.deepEqual([...busy], ["10:00"]);
    });

    it("computePublicAvailability returns compact payload without customer PII", async () => {
        const db = createMockDb({
            publicBarber: {
                status: "active",
                bookingOpen: true,
                openHour: "09:00",
                closeHour: "12:00"
            },
            appointments: [{
                barberId: "shop-a",
                date: "2026-08-01",
                time: "10:00",
                status: "confirmed",
                customerName: "Hidden",
                phone: "5551112233"
            }],
            blocked: [],
            legacy: null
        });

        const result = await computePublicAvailability(db, {
            businessSlug: "shop-a",
            date: "2026-08-01",
            requestId: "test-req"
        });

        assert.equal(result.ok, true);
        assert.equal(result.payload.businessId, "shop-a");
        assert.equal(result.payload.requestId, "test-req");
        assert.deepEqual(result.payload.occupiedIntervals, [{ start: "10:00", end: "11:00" }]);
        assert.doesNotMatch(JSON.stringify(result.payload), /Hidden|5551112233/);
    });
});

describe("availability client deduplication", () => {
    it("shares identical requests, but leaves different dates independent", async () => {
        const originalFetch = globalThis.fetch;
        const pending = [];
        globalThis.fetch = (url, options) => new Promise((resolve) => pending.push({ url, options, resolve }));
        try {
            const a = fetchPublicAvailability("test-shop", "2026-11-01");
            const b = fetchPublicAvailability("test-shop", "2026-11-01");
            const c = fetchPublicAvailability("test-shop", "2026-11-02");
            assert.equal(pending.length, 2);
            assert.equal(getAvailabilityInFlightCount(), 2);
            assert.equal(pending[0].options.signal.aborted, false);
            assert.equal(pending[1].options.signal.aborted, false);
            pending[1].resolve({ ok: true, json: async () => ({ date: "2026-11-02" }) });
            pending[0].resolve({ ok: true, json: async () => ({ date: "2026-11-01" }) });
            assert.deepEqual(await Promise.all([a, b, c]), [
                { date: "2026-11-01" }, { date: "2026-11-01" }, { date: "2026-11-02" }
            ]);
            assert.deepEqual(await fetchPublicAvailability("test-shop", "2026-11-01"), { date: "2026-11-01" });
            assert.equal(pending.length, 2);
        } finally {
            invalidateAvailabilityMemoryCache("test-shop", "2026-11-01");
            invalidateAvailabilityMemoryCache("test-shop", "2026-11-02");
            globalThis.fetch = originalFetch;
        }
    });

    it("invalidates an in-flight response even when fetch ignores abort", async () => {
        const originalFetch = globalThis.fetch;
        const pending = [];
        globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
        try {
            const old = fetchPublicAvailability("test-shop", "2026-11-03");
            invalidateAvailabilityMemoryCache("test-shop", "2026-11-03");
            const fresh = fetchPublicAvailability("test-shop", "2026-11-03");
            pending[0]({ ok: true, json: async () => ({ version: "old" }) });
            pending[1]({ ok: true, json: async () => ({ version: "fresh" }) });
            await assert.rejects(old, { code: "availability_response_stale" });
            assert.deepEqual(await fresh, { version: "fresh" });
            assert.deepEqual(await fetchPublicAvailability("test-shop", "2026-11-03"), { version: "fresh" });
            assert.equal(pending.length, 2);
        } finally {
            invalidateAvailabilityMemoryCache("test-shop", "2026-11-03");
            globalThis.fetch = originalFetch;
        }
    });

    it("a forced refresh replaces an older same-key request", async () => {
        const originalFetch = globalThis.fetch;
        const pending = [];
        globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
        try {
            const old = fetchPublicAvailability("test-shop", "2026-11-04");
            const fresh = fetchPublicAvailability("test-shop", "2026-11-04", { force: true });
            pending[0]({ ok: true, json: async () => ({ version: "old" }) });
            pending[1]({ ok: true, json: async () => ({ version: "fresh" }) });
            await assert.rejects(old, { code: "availability_response_stale" });
            assert.deepEqual(await fresh, { version: "fresh" });
        } finally {
            invalidateAvailabilityMemoryCache("test-shop", "2026-11-04");
            globalThis.fetch = originalFetch;
        }
    });

    it("keeps the UI sequence guard local to slot rendering", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /renderSlotsChecking/);
        assert.match(src, /const requestSequence = \+\+activeAvailabilitySequence/);
        assert.doesNotMatch(src, /nextAvailabilityRequestSequence/);
        assert.match(src, /Promise\.all\(\[loadAvailableSlots\(\), loadTodayCount\(\)\]\)/);
    });

    it("renders only the latest date when responses arrive out of order", async () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const loadSource = src.slice(src.indexOf("    async function loadAvailableSlots("), src.indexOf("    if (dateInput) {", src.indexOf("    async function loadAvailableSlots(")));
        const pending = new Map();
        const rendered = [];
        const context = {
            activeAvailabilitySequence: 0, dateInput: { value: "2026-11-01" }, slotsContainer: {},
            selectedSlot: null, availableCountEl: null,
            renderSlotsChecking() {}, updateBookButton() {},
            getDayData: date => new Promise(resolve => pending.set(date, resolve)),
            getToday: () => "2026-10-23", renderSlots: (_container, date) => rendered.push(date),
            console, showError() {}, showToast() {}, onSlotSelect() {}, isCustomerBookingPage: () => true
        };
        runInNewContext(`${loadSource}; this.loadAvailableSlots = loadAvailableSlots;`, context);
        const older = context.loadAvailableSlots("2026-11-01");
        const newer = context.loadAvailableSlots("2026-11-02");
        pending.get("2026-11-02")({ appointments: {}, blocked: new Set(), dayClosed: false });
        pending.get("2026-11-01")({ appointments: {}, blocked: new Set(), dayClosed: false });
        await Promise.all([older, newer]);
        assert.deepEqual(rendered, ["2026-11-02"]);
    });

    it("a forced day reload prevents an older response from restoring stale cache", async () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const loadSource = src.slice(src.indexOf("async function fetchPublicDayData("), src.indexOf("async function getDayData("));
        const pending = [];
        const dayDataCache = new Map();
        const context = {
            dayDataCache, dayCacheVersions: new Map(), dayCacheKey: date => date,
            DAY_CACHE_TTL_MS: 20_000, Date,
            getTenantBusinessId: () => "shop",
            fetchPublicAvailability: () => new Promise(resolve => pending.push(resolve)),
            mapPublicAvailabilityToDayData: data => data
        };
        runInNewContext(`${loadSource}; this.fetchPublicDayData = fetchPublicDayData;`, context);
        const old = context.fetchPublicDayData("2026-11-05");
        const fresh = context.fetchPublicDayData("2026-11-05", { force: true });
        pending[0]({ version: "old" });
        pending[1]({ version: "fresh" });
        await assert.rejects(old, { code: "availability_response_stale" });
        assert.equal((await fresh).version, "fresh");
        assert.equal(dayDataCache.get("2026-11-05").data.version, "fresh");
    });

    it("counts only bookable Istanbul times, excluding occupied and blocked slots", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const countSource = src.slice(src.indexOf("function countAvailableSlots("), src.indexOf("function renderSlotsChecking("));
        const now = new Date("2026-10-23T09:30:00Z");
        const context = {
            getVisibleSlots: () => ["12:00", "13:00", "14:00", "15:00"],
            isPastAppointmentSlot: (date, time) => isPastAppointmentSlot(date, time, now)
        };
        runInNewContext(`${countSource}; this.countAvailableSlots = countAvailableSlots;`, context);
        assert.equal(context.countAvailableSlots("2026-10-23", { "14:00": true }, new Set(["15:00"]), false), 1);
        assert.equal(context.countAvailableSlots("2026-10-23", {}, new Set(), true), 0);
    });

    it("keeps the today count unknown when the availability request fails", async () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const loadSource = src.slice(src.indexOf("    async function loadTodayCount("), src.indexOf("    async function loadAvailableSlots("));
        const availableCountEl = { textContent: "—" };
        const errors = [];
        const context = {
            getToday: () => "2026-10-23", getDayData: async () => { throw { code: "availability_unavailable" }; },
            availableCountEl, console: { error: (...args) => errors.push(args) }
        };
        runInNewContext(`${loadSource}; this.loadTodayCount = loadTodayCount;`, context);
        await context.loadTodayCount();
        assert.equal(availableCountEl.textContent, "-");
        assert.equal(errors.length, 1);
    });

    it("treats Istanbul past times as unavailable", () => {
        const now = new Date("2026-10-23T09:30:00Z"); // 12:30 Istanbul
        assert.equal(isPastAppointmentSlot("2026-10-23", "12:00", now), true);
        assert.equal(isPastAppointmentSlot("2026-10-23", "13:00", now), false);
    });

    it("does not force refresh auth token in availability client path", () => {
        const clientSrc = readFileSync(resolve(ROOT, "publicAvailabilityClient.js"), "utf8");
        assert.doesNotMatch(clientSrc, /getIdToken/);
    });
});

describe("availability API route instrumentation", () => {
    it("returns requestId and no-store headers", () => {
        const src = readFileSync(resolve(ROOT, "api/public/availability.js"), "utf8");
        assert.match(src, /requestId/);
        assert.match(src, /X-Request-Id/);
        assert.match(src, /no-store, no-cache, must-revalidate/);
    });
});
