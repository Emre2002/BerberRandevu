import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    getIstanbulTodayYmd,
    isPastAppointmentSlot,
    normalizeTimeHHmm,
    validateAppointmentDate
} from "../appointmentDateTime.js";
import {
    mapOwnerBookingErrorToHttp,
    OWNER_BOOKING_ERROR_MESSAGES
} from "../api/_lib/owner-booking-errors.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("appointment datetime normalization", () => {
    it("uses Europe/Istanbul for today comparisons", () => {
        const fixedNow = new Date("2026-07-30T08:00:00.000Z");
        assert.equal(getIstanbulTodayYmd(fixedNow), "2026-07-30");
        assert.equal(
            validateAppointmentDate("2026-07-29", fixedNow).code,
            "past_date"
        );
        assert.equal(validateAppointmentDate("2026-07-30", fixedNow).ok, true);
    });

    it("rejects past time on the current day in Istanbul", () => {
        const fixedNow = new Date("2026-07-30T09:30:00.000Z");
        assert.equal(isPastAppointmentSlot("2026-07-30", "10:00", fixedNow), true);
        assert.equal(isPastAppointmentSlot("2026-07-30", "13:00", fixedNow), false);
        assert.equal(isPastAppointmentSlot("2026-07-29", "23:00", fixedNow), true);
    });

    it("normalizes HH:mm and avoids DD.MM.YYYY confusion", () => {
        assert.equal(normalizeTimeHHmm("9:00"), "09:00");
        assert.equal(normalizeTimeHHmm("10.00"), "10:00");
        assert.equal(validateAppointmentDate("30.07.2026").ok, false);
    });
});

describe("owner booking error mapping", () => {
    it("maps past appointments to APPOINTMENT_IN_PAST", () => {
        const mapped = mapOwnerBookingErrorToHttp({ code: "appointment_in_past" }, "req-123");
        assert.equal(mapped.status, 400);
        assert.equal(mapped.body.code, "APPOINTMENT_IN_PAST");
        assert.equal(mapped.body.message, OWNER_BOOKING_ERROR_MESSAGES.APPOINTMENT_IN_PAST);
        assert.equal(mapped.body.requestId, "req-123");
    });

    it("maps slot conflicts to SLOT_UNAVAILABLE with HTTP 409", () => {
        const mapped = mapOwnerBookingErrorToHttp({ code: "slot_taken" }, "req-456");
        assert.equal(mapped.status, 409);
        assert.equal(mapped.body.code, "SLOT_UNAVAILABLE");
    });
});

describe("owner create-appointment route contract", () => {
    it("returns HTTP 201 appointment payload and requestId", () => {
        const src = readFileSync(resolve(ROOT, "api/owner/create-appointment.js"), "utf8");
        assert.match(src, /sendJson\(res, 201/);
        assert.match(src, /appointment:\s*\{/);
        assert.match(src, /requestId/);
        assert.match(src, /ownerContext:\s*true/);
    });

    it("privileged client treats HTTP 201 as success via response.ok", () => {
        const src = readFileSync(resolve(ROOT, "privilegedApiClient.js"), "utf8");
        assert.match(src, /if \(!response\.ok\)/);
        assert.doesNotMatch(src, /response\.status === 200/);
    });
});

describe("admin calendar duplicate submission guards", () => {
    it("locks owner save button and prevents duplicate POSTs", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /adminSaveInProgress/);
        assert.match(src, /if \(adminSaveInProgress\) return/);
        assert.match(src, /saveBtn\.disabled = true/);
        assert.match(src, /adminActiveIdempotencyKey/);
    });

    it("renders past empty slots subtly without hiding past appointments", () => {
        const appSrc = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const styleSrc = readFileSync(resolve(ROOT, "styles.css"), "utf8");
        assert.match(appSrc, /resolveCalendarCellPresentation/);
        assert.match(appSrc, /calendar-cell--past-empty/);
        assert.match(appSrc, /Geçmiş saat — yeni randevu oluşturulamaz/);
        assert.match(styleSrc, /calendar-cell--past-empty/);
    });

    it("optimistically marks admin and public slots occupied after success", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /applyLocalAdminAppointment/);
        assert.match(src, /applyBookedSlotToDayCache/);
    });
});

describe("public availability freshness", () => {
    it("uses no-store fetch and API cache headers", () => {
        const client = readFileSync(resolve(ROOT, "publicAvailabilityClient.js"), "utf8");
        const route = readFileSync(resolve(ROOT, "api/public/availability.js"), "utf8");
        assert.match(client, /cache:\s*"no-store"/);
        assert.match(route, /no-store, no-cache, must-revalidate/);
    });
});

describe("core booking validation", () => {
    it("exposes appointment_in_past for public API consumers", () => {
        const mapped = mapBookingErrorToHttp({ code: "appointment_in_past" });
        assert.equal(mapped.status, 400);
        assert.equal(mapped.body.code, "appointment_in_past");
    });
});
