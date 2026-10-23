import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { isPublicDuplicatePhoneError, isPublicSlotConflictError } from "../publicBookingErrors.js";
import { mapBookingErrorToHttp } from "../api/_lib/create-appointment-core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(resolve(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const start = appSource.indexOf('    if (btnBook) {\n        btnBook.addEventListener("click"');
const end = appSource.indexOf("    await Promise.all([loadAvailableSlots(), loadTodayCount()]);", start);
assert.ok(start >= 0 && end > start);
const submitSource = appSource.slice(start, end);

function deferred() {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createHarness({ post = deferred(), refresh = Promise.resolve() } = {}) {
    const calls = [];
    const fields = {
        bookingHoneypot: { value: "" }, customerName: { value: "Test Customer" },
        customerPhone: { value: "05551234567" }, serviceSelect: { value: "Saç Kesimi" },
        customerNote: { value: "" }
    };
    const btnBook = { disabled: false, textContent: "Randevuyu Onayla", addEventListener(_name, fn) { this.click = fn; } };
    const context = {
        btnBook, bookingInProgress: false, lastSubmitAt: 0, bookingFormReadyAt: Date.now() - 10_000,
        MIN_FORM_MS: 3000, SUBMIT_COOLDOWN_MS: 2000, selectedSlot: "13:00", phoneDuplicateBlocked: false,
        dateInput: { value: "2026-11-05" }, slotsContainer: { querySelector: () => null },
        document: { getElementById: id => fields[id] || null },
        performance, console: { info: (...args) => calls.push(["log", ...args]), error: (...args) => calls.push(["error", ...args]) },
        isValidTurkishPhone: () => true, isPhoneCooldownActive: () => false,
        isCustomerBookingPage: () => true,
        getDayData: () => { throw new Error("unexpected availability request"); },
        checkPublicPhoneDuplicate: () => { throw new Error("unexpected duplicate request"); },
        getTenantBusinessId: () => "shop", aktifDukkan: "shop",
        getOrCreateBookingIdempotencyKey: () => "stable-key",
        createAppointmentWithEffects: async payload => { calls.push(["post", payload]); return post.promise; },
        applyBookedSlotToDayCache: (...args) => calls.push(["cache", ...args]),
        resetBookingIdempotencyKey: () => calls.push(["reset-key"]),
        setPhoneCooldown: () => calls.push(["cooldown"]),
        getShopDisplayName: () => "Shop",
        showBookingSuccessModal: details => calls.push(["success", details]),
        clearCustomerServiceSelection: () => {},
        invalidateDay: date => calls.push(["invalidate", date]),
        loadAvailableSlots: async () => { calls.push(["refresh-slots"]); await refresh; },
        loadTodayCount: async () => { calls.push(["refresh-count"]); await refresh; },
        showToast: message => calls.push(["toast", message]),
        showDuplicateAppointmentModal: () => calls.push(["duplicate-modal"]),
        updateBookButton: () => calls.push(["button-update"]),
        finishBookingSubmit: () => { context.bookingInProgress = false; calls.push(["finish"]); },
        showPhoneError: () => {},
        isPublicSlotConflictError, isPublicDuplicatePhoneError,
        customerErrorMessage: err => err.code || "booking_failed"
    };
    runInNewContext(submitSource, context);
    return { context, calls, post, btnBook };
}

describe("customer booking submit fast path", () => {
    it("defers optional phone blur checks so a submit does not start another request", async () => {
        const blurStart = appSource.indexOf('    const customerPhoneEl = document.getElementById("customerPhone");');
        const blurEnd = appSource.indexOf('    ["customerName", "customerPhone", "serviceSelect"]', blurStart);
        const pending = [];
        const phone = { addEventListener(_event, fn) { this.blur = fn; } };
        const context = {
            document: { getElementById: () => phone }, bookingInProgress: false,
            setTimeout: fn => pending.push(fn),
            checkPhoneDuplicateForSelectedDate: async () => { context.checks++; },
            updateBookButton: () => {}, checks: 0
        };
        runInNewContext(appSource.slice(blurStart, blurEnd), context);
        phone.blur();
        assert.equal(context.checks, 0);
        context.bookingInProgress = true;
        pending.shift()();
        assert.equal(context.checks, 0);
        context.bookingInProgress = false;
        phone.blur();
        pending.shift()();
        await Promise.resolve();
        assert.equal(context.checks, 1);
    });

    it("allows an uncertain idempotent retry despite a late early-duplicate result", () => {
        const start = appSource.indexOf("    function updateBookButton() {");
        const end = appSource.indexOf("    function onSlotSelect(", start);
        const btnBook = { disabled: false };
        const values = { customerName: "Test", customerPhone: "05551234567", serviceSelect: "Saç Kesimi" };
        const context = {
            btnBook, bookingInProgress: false, selectedSlot: "13:00",
            phoneDuplicateBlocked: true, allowIdempotentRetry: false,
            document: { getElementById: id => ({ value: values[id] }) },
            isValidTurkishPhone: () => true, showPhoneError: () => {}
        };
        runInNewContext(`${appSource.slice(start, end)}; this.updateBookButton = updateBookButton;`, context);
        context.updateBookButton();
        assert.equal(btnBook.disabled, true);
        context.allowIdempotentRetry = true;
        context.updateBookButton();
        assert.equal(btnBook.disabled, false);
    });

    it("starts one POST without preflight, rejects a second click, and shows success before refresh", async () => {
        const refresh = deferred();
        const h = createHarness({ refresh: refresh.promise });
        const first = h.btnBook.click();
        await h.btnBook.click();
        assert.equal(h.calls.filter(([name]) => name === "post").length, 1);
        assert.equal(h.calls[0][1].idempotencyKey, "stable-key");
        h.post.resolve("appointment-1");
        await first;
        assert.ok(h.calls.some(([name]) => name === "success"));
        assert.ok(h.calls.some(([name]) => name === "cache"));
        assert.ok(h.calls.some(([name]) => name === "refresh-slots"));
        assert.ok(h.calls.some(([name]) => name === "refresh-count"));
        assert.equal(h.context.bookingInProgress, false);
        const timing = h.calls.find(([name, label]) => name === "log" && label === "[booking/timing]")[2];
        assert.equal(timing.availabilityMs, 0);
        assert.equal(timing.duplicateCheckMs, 0);
        refresh.resolve();
    });

    it("marks the booked slot locally, without modifying a newly selected date", async () => {
        const h = createHarness();
        let replacement = null;
        const selectedEl = {
            textContent: "13:00",
            cloneNode: () => ({ classList: {
                remove() {}, add(name) { replacement = name; }
            }, title: "" }),
            replaceWith: () => {}
        };
        h.context.slotsContainer.querySelector = () => selectedEl;
        const first = h.btnBook.click();
        h.post.resolve("appointment-1");
        await first;
        assert.equal(replacement, "slot--booked");

        const next = createHarness();
        let changedDateMarked = false;
        next.context.slotsContainer.querySelector = () => ({
            textContent: "13:00", cloneNode: () => ({}), replaceWith: () => { changedDateMarked = true; }
        });
        const second = next.btnBook.click();
        next.context.dateInput.value = "2026-11-06";
        next.post.resolve("appointment-2");
        await second;
        assert.equal(changedDateMarked, false);
    });

    it("shows duplicate warning for HTTP 409 without treating it as a slot conflict", async () => {
        const h = createHarness();
        const request = h.btnBook.click();
        h.post.reject(Object.assign(new Error("duplicate"), { code: "duplicate_phone_day", status: 409 }));
        await request;
        assert.ok(h.calls.some(([name]) => name === "duplicate-modal"));
        assert.equal(h.calls.some(([name]) => name === "success"), false);
        assert.equal(h.calls.some(([name]) => name === "refresh-slots"), false);
    });

    it("refreshes after a server slot conflict and never shows success", async () => {
        const h = createHarness();
        const request = h.btnBook.click();
        h.post.reject(Object.assign(new Error("occupied"), { code: "slot_unavailable", status: 409 }));
        await request;
        assert.ok(h.calls.some(([name]) => name === "refresh-slots"));
        assert.equal(h.calls.some(([name]) => name === "success"), false);
        assert.equal(h.context.selectedSlot, null);
    });

    it("retains the idempotency key after an uncertain network failure", async () => {
        const h = createHarness();
        const request = h.btnBook.click();
        h.post.reject(new Error("network failure"));
        await request;
        assert.equal(h.calls.some(([name]) => name === "reset-key"), false);
        assert.equal(h.calls.some(([name]) => name === "success"), false);
    });

    for (const code of ["rate_limited", "booking_closed", "internal_error"]) {
        it(`does not show success after ${code}`, async () => {
            const h = createHarness();
            const request = h.btnBook.click();
            h.post.reject(Object.assign(new Error(code), { code, status: code === "rate_limited" ? 429 : 400 }));
            await request;
            assert.equal(h.calls.some(([name]) => name === "success"), false);
            assert.ok(h.calls.some(([name]) => name === "toast"));
        });
    }

    it("keeps booking-closed distinct from invalid request", () => {
        const mapped = mapBookingErrorToHttp({ code: "booking_closed" });
        assert.equal(mapped.body.code, "booking_closed");
        assert.match(mapped.body.message, /randevu kabul etmiyor/);
    });
});
