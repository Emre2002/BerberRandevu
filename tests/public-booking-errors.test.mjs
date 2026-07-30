import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    PUBLIC_BOOKING_ERROR_MESSAGES,
    mapPublicBookingHttpError,
    resolvePublicBookingUserMessage,
    isPublicSlotConflictError,
    isPublicDuplicatePhoneError
} from "../publicBookingErrors.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("public booking error architecture", () => {
    it("appointmentService does not reference undeclared owner constants", () => {
        const src = readFileSync(resolve(ROOT, "appointmentService.js"), "utf8");
        assert.doesNotMatch(src, /OWNER_BOOKING_ERROR_MESSAGES/);
        assert.match(src, /resolvePublicBookingUserMessage/);
        assert.match(src, /from "\.\/publicBookingErrors\.js"/);
    });

    it("public app imports public booking error mapper, not owner-only globals", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /resolvePublicBookingUserMessage/);
        assert.match(src, /isPublicSlotConflictError/);
        assert.match(src, /from "\.\/publicBookingErrors\.js"/);
    });

    it("mapPublicBookingHttpError preserves status, code, message and requestId", () => {
        const response = {
            status: 409,
            headers: { get: () => "req-abc-123" }
        };
        const err = mapPublicBookingHttpError(response, {
            code: "slot_unavailable",
            message: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin.",
            requestId: "req-abc-123"
        });
        assert.equal(err.status, 409);
        assert.equal(err.code, "slot_unavailable");
        assert.match(err.message, /Bu saat kısa süre önce doldu/);
        assert.equal(err.requestId, "req-abc-123");
    });

    it("resolvePublicBookingUserMessage never throws and maps SLOT_UNAVAILABLE", () => {
        const message = resolvePublicBookingUserMessage({
            code: "slot_unavailable",
            message: "ignored when code maps"
        });
        assert.equal(message, PUBLIC_BOOKING_ERROR_MESSAGES.slot_unavailable);
        assert.doesNotMatch(message, /ReferenceError|OWNER_BOOKING/);
    });

    it("HTTP 409 mapped error does not produce ReferenceError in user message path", () => {
        const response = { status: 409, headers: { get: () => null } };
        const err = mapPublicBookingHttpError(response, {
            code: "slot_unavailable",
            message: PUBLIC_BOOKING_ERROR_MESSAGES.slot_unavailable,
            requestId: "req-409"
        });
        const uiMessage = resolvePublicBookingUserMessage(err);
        assert.match(uiMessage, /Bu saat kısa süre önce doldu/);
        assert.doesNotMatch(uiMessage, /ReferenceError|OWNER_BOOKING_ERROR_MESSAGES/);
    });

    it("detects slot conflict and duplicate phone separately", () => {
        assert.equal(isPublicSlotConflictError({ status: 409, code: "slot_unavailable" }), true);
        assert.equal(isPublicDuplicatePhoneError({ code: "duplicate_phone_day" }), true);
        assert.equal(isPublicSlotConflictError({ code: "duplicate_phone_day" }), false);
    });

    it("server mapBookingErrorToHttp includes sanitized message and requestId", () => {
        const mapped = mapBookingErrorToHttp({ code: "slot_taken" }, { requestId: "req-1" });
        assert.equal(mapped.status, 409);
        assert.equal(mapped.body.code, "slot_unavailable");
        assert.match(mapped.body.message, /Bu saat kısa süre önce doldu/);
        assert.equal(mapped.body.requestId, "req-1");
    });

    it("duplicate phone conflict returns distinct code from slot conflict", () => {
        const mapped = mapBookingErrorToHttp({ code: "duplicate_phone_day" }, { requestId: "req-2" });
        assert.equal(mapped.status, 409);
        assert.equal(mapped.body.code, "duplicate_phone_day");
        assert.match(mapped.body.message, /telefon numarası/i);
    });
});

describe("public booking conflict UX", () => {
    it("clears selection and refreshes availability after slot conflict", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const submitBlock = src.slice(
            src.indexOf('btnBook.addEventListener("click"'),
            src.indexOf("await Promise.all([loadAvailableSlots(), loadTodayCount()])")
        );
        assert.match(submitBlock, /isPublicSlotConflictError\(err\)/);
        assert.match(submitBlock, /selectedSlot = null/);
        assert.match(submitBlock, /invalidateDay\(conflictDate\)/);
        assert.match(submitBlock, /await loadAvailableSlots\(conflictDate\)/);
        assert.match(submitBlock, /customerErrorMessage\(err\)/);
    });

    it("uses server phone duplicate check on public submit", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /checkPublicPhoneDuplicate/);
        assert.match(src, /isCustomerBookingPage\(\)[\s\S]*checkPublicPhoneDuplicate/);
    });
});

describe("availability and create consistency", () => {
    it("both use normalizeTimeHHmm from shared appointment datetime helpers", () => {
        const availabilitySrc = readFileSync(resolve(ROOT, "api/_lib/availability.js"), "utf8");
        const createSrc = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        assert.match(availabilitySrc, /normalizeTimeHHmm/);
        assert.match(createSrc, /normalizeTimeHHmm/);
    });

    it("create transaction reconciles orphaned slot locks safely", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        assert.match(src, /lockIsActive/);
        assert.match(src, /tx\.delete\(lockRef\)/);
    });

    it("availability uses hourly slot generation consistent with create validation", () => {
        const availabilitySrc = readFileSync(resolve(ROOT, "api/_lib/availability.js"), "utf8");
        const createSrc = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        assert.match(availabilitySrc, /generateHourlySlots/);
        assert.match(createSrc, /generateHourlySlots/);
    });
});

describe("public booking security invariants", () => {
    it("does not add direct client Firestore appointment writes", () => {
        const src = readFileSync(resolve(ROOT, "publicAppointmentClient.js"), "utf8");
        assert.doesNotMatch(src, /addDoc/);
        assert.doesNotMatch(src, /collection\(db, "appointments"\)/);
    });

    it("preserves strict appointment Firestore rules", () => {
        const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        const block = rules.match(/match \/appointments\/\{appointmentId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
        assert.match(block, /allow create, update, delete: if false/);
    });
});
