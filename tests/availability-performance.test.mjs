import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    buildOccupiedIntervalsFromHourlyTimes,
    computePublicAvailability,
    parseLegacyDayBusyTimes
} from "../api/_lib/availability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

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
    it("deduplicates concurrent identical requests", () => {
        const src = readFileSync(resolve(ROOT, "publicAvailabilityClient.js"), "utf8");
        assert.match(src, /inFlightRequests/);
        assert.match(src, /inFlightRequests\.has\(requestKey\)/);
    });

    it("aborts obsolete requests and ignores stale sequences", () => {
        const src = readFileSync(resolve(ROOT, "publicAvailabilityClient.js"), "utf8");
        assert.match(src, /AbortController/);
        assert.match(src, /availability_response_stale/);
        assert.match(src, /cache:\s*"no-store"/);
    });

    it("uses one canonical loader in app.js with sequence guard", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /renderSlotsChecking/);
        assert.match(src, /nextAvailabilityRequestSequence/);
        assert.match(src, /Promise\.all\(\[loadAvailableSlots\(\), loadTodayCount\(\)\]\)/);
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
