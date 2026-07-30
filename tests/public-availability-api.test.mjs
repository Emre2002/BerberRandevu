import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    mapPublicAvailabilityToDayData
} from "../publicAvailabilityClient.js";
import {
    validateAvailabilityDate,
    generateHourlySlots
} from "../api/_lib/availability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("public availability client", () => {
    it("maps API payload without customer PII fields", () => {
        const mapped = mapPublicAvailabilityToDayData({
            date: "2026-07-30",
            isClosed: false,
            busySlots: ["10:00"],
            blockedSlots: ["11:00"],
            availableSlots: ["09:00"]
        });

        assert.equal(mapped.dayClosed, false);
        assert.ok(mapped.appointments["10:00"]);
        assert.ok(mapped.blocked.has("11:00"));
        assert.equal(mapped.appointments["10:00"].customerName, undefined);
        assert.equal(mapped.appointments["10:00"].phone, undefined);
    });

    it("customer app.js uses public availability API for booking page", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /fetchPublicAvailability/);
        assert.match(src, /isCustomerBookingPage\(\)/);
        assert.match(src, /Saat bilgileri şu anda yüklenemiyor/);
    });

    it("customer app.js does not query appointments collection on booking page path", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const customerBranch = src.slice(src.indexOf("async function fetchPublicDayData"));
        assert.doesNotMatch(customerBranch, /collection\(db, "appointments"\)/);
    });
});

describe("public availability validation", () => {
    it("rejects invalid and past dates", () => {
        assert.equal(validateAvailabilityDate("bad-date").ok, false);
        assert.equal(validateAvailabilityDate("1999-01-01").ok, false);
    });

    it("generates hourly slots within working hours", () => {
        const slots = generateHourlySlots("09:00", "12:00");
        assert.deepEqual(slots, ["09:00", "10:00", "11:00"]);
    });
});

describe("public availability API route", () => {
    it("exists and does not leak stack traces in generic errors", () => {
        const src = readFileSync(resolve(ROOT, "api/public/availability.js"), "utf8");
        assert.match(src, /computePublicAvailability/);
        assert.doesNotMatch(src, /err\.stack/);
        assert.match(src, /Cache-Control/);
    });
});
