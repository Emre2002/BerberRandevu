import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isPastAppointmentSlot } from "../appointmentDateTime.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("admin calendar past slot rendering priority", () => {
    const appSrc = readFileSync(resolve(ROOT, "app.js"), "utf8");
    const styleSrc = readFileSync(resolve(ROOT, "styles.css"), "utf8");

    it("checks appointment existence before past-empty state", () => {
        assert.match(appSrc, /resolveCalendarCellPresentation/);
        assert.match(appSrc, /findAppointmentForSlot/);
        const fnBlock = appSrc.slice(
            appSrc.indexOf("function resolveCalendarCellPresentation"),
            appSrc.indexOf("function calendarCellClassName")
        );
        const mainPath = fnBlock.slice(fnBlock.indexOf("const appt = findAppointmentForSlot"));
        const apptIndex = mainPath.indexOf("findAppointmentForSlot");
        const pastIndex = mainPath.indexOf('kind: "past-empty"');
        assert.ok(apptIndex >= 0 && pastIndex > apptIndex);
    });

    it("does not render prominent Geçmiş label in calendar cells", () => {
        const drawBlock = appSrc.slice(
            appSrc.indexOf("function drawCalendar()"),
            appSrc.indexOf("async function renderCalendar()")
        );
        assert.doesNotMatch(drawBlock, /textContent = "Geçmiş"/);
        assert.match(drawBlock, /presentation\.kind === "past-empty"/);
        assert.match(drawBlock, /textContent = ""/);
    });

    it("uses past-empty styling without overriding booked appointments", () => {
        assert.match(styleSrc, /calendar-cell--past-empty/);
        assert.match(styleSrc, /calendar-cell--booked/);
        assert.doesNotMatch(styleSrc, /\.calendar-cell--past[^-a-zA-Z]/);
        assert.match(appSrc, /calendarCellClassName\(presentation\.kind\)/);
        assert.match(appSrc, /presentation\.kind === "booked"/);
    });

    it("allows past appointments to open detail modal instead of create modal", () => {
        const clickBlock = appSrc.slice(
            appSrc.indexOf("async function handleCellClick"),
            appSrc.indexOf("function renderDayActions")
        );
        assert.match(clickBlock, /presentation\.kind === "past-empty"/);
        assert.match(clickBlock, /presentation\.kind === "available"/);
        assert.doesNotMatch(clickBlock, /if \(isCalendarSlotPast\(date, time\)\) \{[\s\S]*return;[\s\S]*\}[\s\S]*const state = getCellState/);
        assert.match(clickBlock, /Randevu Detayı/);
    });

    it("blocks only available past slots from opening the create modal", () => {
        assert.match(appSrc, /if \(isCalendarSlotPast\(date, time\)\) \{[\s\S]*showToast\("Geçmiş bir tarih/);
        assert.match(appSrc, /presentation\.kind === "past-empty"/);
    });

    it("keeps future empty slots clickable with Boş label", () => {
        const drawBlock = appSrc.slice(
            appSrc.indexOf("function drawCalendar()"),
            appSrc.indexOf("async function renderCalendar()")
        );
        assert.match(drawBlock, /textContent = "Boş"/);
        assert.match(drawBlock, /addEventListener\("click", \(\) => handleCellClick\(date, time\)\)/);
    });

    it("renders booked slots with customer name and click handler regardless of past", () => {
        const drawBlock = appSrc.slice(
            appSrc.indexOf("function drawCalendar()"),
            appSrc.indexOf("async function renderCalendar()")
        );
        assert.match(drawBlock, /presentation\.kind === "booked"/);
        assert.match(drawBlock, /appt\.customerName/);
        assert.match(drawBlock, /cell\.addEventListener\("click", \(\) => handleCellClick\(date, time\)\)/);
    });

    it("marks past empty cells aria-disabled without prominent label", () => {
        const drawBlock = appSrc.slice(
            appSrc.indexOf("function drawCalendar()"),
            appSrc.indexOf("async function renderCalendar()")
        );
        assert.match(drawBlock, /setAttribute\("aria-disabled", "true"\)/);
        assert.match(drawBlock, /Geçmiş saat — yeni randevu oluşturulamaz/);
        assert.doesNotMatch(drawBlock, /textContent = "Geçmiş"/);
    });

    it("redraws calendar via drawCalendar after local appointment apply", () => {
        assert.match(appSrc, /function applyLocalAdminAppointment[\s\S]*drawCalendar\(\)/);
    });
});

describe("admin calendar appointment queries", () => {
    it("loads appointments by exact date without future-only filter", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const fetchBlock = src.slice(
            src.indexOf("async function fetchNewAppointments"),
            src.indexOf("async function fetchLegacyDayDoc")
        );
        assert.match(fetchBlock, /where\("date", "==", date\)/);
        assert.doesNotMatch(fetchBlock, /date\s*>=/);
        assert.doesNotMatch(fetchBlock, /futureOnly|upcoming|startTime/);
    });

    it("loads week data for all seven selected dates", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /getWeekData\(weekDates\)/);
        assert.match(src, /weekDates\.map\(date => getDayData\(date\)\)/);
    });
});

describe("past appointment creation remains blocked server-side", () => {
    it("maps appointment_in_past to HTTP 400", () => {
        const mapped = mapBookingErrorToHttp({ code: "appointment_in_past" });
        assert.equal(mapped.status, 400);
        assert.equal(mapped.body.code, "appointment_in_past");
    });

    it("detects past slots using Europe/Istanbul helpers", () => {
        const fixedNow = new Date("2026-07-30T09:30:00.000Z");
        assert.equal(isPastAppointmentSlot("2026-07-29", "10:00", fixedNow), true);
        assert.equal(isPastAppointmentSlot("2026-07-31", "10:00", fixedNow), false);
    });

    it("blocks today's past hours but allows future hours on the same day", () => {
        const noonIstanbul = new Date("2026-07-30T09:00:00.000Z");
        assert.equal(isPastAppointmentSlot("2026-07-30", "09:00", noonIstanbul), true);
        assert.equal(isPastAppointmentSlot("2026-07-30", "14:00", noonIstanbul), false);
    });
});

describe("admin calendar security invariants", () => {
    it("does not introduce direct client appointment writes in calendar flow", () => {
        const adminBlock = readFileSync(resolve(ROOT, "app.js"), "utf8").slice(
            readFileSync(resolve(ROOT, "app.js"), "utf8").indexOf("function initAdminPage"),
            readFileSync(resolve(ROOT, "app.js"), "utf8").indexOf("function startAdminApp")
        );
        assert.doesNotMatch(adminBlock, /addDoc\(collection\(db, "appointments"\)/);
        assert.match(adminBlock, /createAppointmentWithEffects/);
    });

    it("queries only bounded weekly range, not all historical appointments", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const fetchBlock = src.slice(
            src.indexOf("async function fetchNewAppointments"),
            src.indexOf("async function fetchLegacyDayDoc")
        );
        assert.match(src, /getWeekDates\(currentMonday\)/);
        assert.match(fetchBlock, /where\("date", "==", date\)/);
        assert.doesNotMatch(fetchBlock, /limit\(\d+\)/); // per-day exact match, not unbounded scan helper
    });

    it("preserves tenant-isolated appointment Firestore rules", () => {
        const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        const apptBlock = rules.slice(
            rules.indexOf("match /appointments/{appointmentId}"),
            rules.indexOf("match /customers/{customerId}")
        );
        assert.match(apptBlock, /allow create, update, delete: if false/);
        assert.match(apptBlock, /resource\.data\.barberId == ownerBusinessId\(\)/);
    });
});
