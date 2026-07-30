import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    isValidTurkishPhone,
    normalizePhone,
    mapBookingErrorToHttp
} from "../api/_lib/create-appointment-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("public create-appointment server route", () => {
    it("route exists and returns sanitized error contract", () => {
        const src = readFileSync(resolve(ROOT, "api/public/create-appointment.js"), "utf8");
        assert.match(src, /createPublicAppointment/);
        assert.match(src, /ok: false/);
        assert.doesNotMatch(src, /err\.stack/);
    });

    it("alias route re-exports public handler", () => {
        const src = readFileSync(resolve(ROOT, "api/create-appointment.js"), "utf8");
        assert.match(src, /public\/create-appointment/);
    });

    it("core uses Admin SDK transaction and idempotency", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/create-appointment-core.js"), "utf8");
        assert.match(src, /runTransaction/);
        assert.match(src, /appointmentIdempotency/);
        assert.match(src, /resolvePublicBusinessSlug/);
        assert.match(src, /runBestEffortSideEffects/);
    });
});

describe("public booking client adapter", () => {
    it("submitPublicAppointment uses server API only", () => {
        const src = readFileSync(resolve(ROOT, "publicAppointmentClient.js"), "utf8");
        assert.match(src, /\/api\/public\/create-appointment/);
        assert.doesNotMatch(src, /addDoc/);
        assert.doesNotMatch(src, /collection\(db, "appointments"\)/);
    });

    it("appointmentService uses server API without Firestore fallback", () => {
        const src = readFileSync(resolve(ROOT, "appointmentService.js"), "utf8");
        assert.match(src, /createAppointmentViaServerApi/);
        assert.match(src, /submitPublicAppointment/);
        assert.match(src, /createAppointmentViaOwnerApi/);
        assert.doesNotMatch(src, /createAppointmentViaCallable/);
        assert.doesNotMatch(src, /falling back to client path/);
    });

    it("admin calendar uses authenticated owner server API", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /forceOwner:\s*true/);
    });

    it("firebase-config does not expose createAppointment callable", () => {
        const src = readFileSync(resolve(ROOT, "firebase-config.js"), "utf8");
        assert.doesNotMatch(src, /getCreateAppointmentCallable/);
        assert.doesNotMatch(src, /createAppointmentCallable/);
    });

    it("app.js passes idempotencyKey on customer booking submit", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        assert.match(src, /idempotencyKey/);
        assert.match(src, /createAppointmentWithEffects/);
    });
});

describe("booking validation helpers", () => {
    it("accepts Turkish mobile numbers", () => {
        assert.equal(isValidTurkishPhone("05551234567"), true);
        assert.equal(isValidTurkishPhone("5551234567"), true);
        assert.equal(isValidTurkishPhone("905551234567"), true);
        assert.equal(isValidTurkishPhone("123"), false);
    });

    it("normalizes phone consistently", () => {
        assert.equal(normalizePhone("0555 123 45 67"), "5551234567");
        assert.equal(normalizePhone("+90 555 123 45 67"), "5551234567");
    });

    it("maps booking errors to stable HTTP codes", () => {
        assert.deepEqual(mapBookingErrorToHttp({ code: "business_not_found" }), {
            status: 404,
            body: {
                ok: false,
                code: "business_not_found",
                message: "İşletme bilgileri bulunamadı."
            }
        });
        assert.deepEqual(mapBookingErrorToHttp({ code: "slot_taken" }), {
            status: 409,
            body: {
                ok: false,
                code: "slot_unavailable",
                message: "Bu saat kısa süre önce doldu. Lütfen başka bir saat seçin."
            }
        });
        assert.deepEqual(mapBookingErrorToHttp({ code: "rate_limited", retryAfterSeconds: 30 }), {
            status: 429,
            headers: {
                "Retry-After": "30",
                "RateLimit-Remaining": "0"
            },
            body: {
                ok: false,
                code: "rate_limited",
                message: "Çok fazla işlem yapıldı. Lütfen kısa süre sonra tekrar deneyin.",
                scope: null,
                limit: null,
                remaining: 0,
                retryAfterSeconds: 30
            }
        });
    });
});

describe("slug resolution module", () => {
    it("tries exact slug before normalization", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/resolve-public-business-slug.js"), "utf8");
        assert.match(src, /\.doc\(trimmed\)/);
        assert.match(src, /authLoginIndex/);
        assert.match(src, /normalizeSlug/);
    });
});

describe("security invariants", () => {
    it("firestore rules still deny direct client appointment create", () => {
        const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        const block = rules.match(/match \/appointments\/\{appointmentId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
        assert.match(block, /allow create, update, delete: if false/);
    });
});
