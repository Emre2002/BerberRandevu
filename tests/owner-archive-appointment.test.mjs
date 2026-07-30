import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseLegacyAppointmentId,
    mapArchiveErrorToHttp
} from "../api/_lib/archive-appointment-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("owner archive-appointment server route", () => {
    it("route requires POST and owner membership", () => {
        const src = readFileSync(resolve(ROOT, "api/owner/archive-appointment.js"), "utf8");
        assert.match(src, /requireOwnerMembership/);
        assert.match(src, /archiveOwnerAppointment/);
        assert.match(src, /req\.method !== "POST"/);
        assert.doesNotMatch(src, /err\.stack/);
    });

    it("derives businessId only from membership, not request body", () => {
        const src = readFileSync(resolve(ROOT, "api/owner/archive-appointment.js"), "utf8");
        assert.match(src, /businessId: ownerAuth\.membership\.businessId/);
        assert.doesNotMatch(src, /body\.businessId/);
        assert.doesNotMatch(src, /body\.barberSlug/);
    });

    it("returns stable sanitized JSON contract", () => {
        assert.deepEqual(mapArchiveErrorToHttp({ code: "forbidden" }), {
            status: 403,
            body: { ok: false, code: "forbidden" }
        });
        assert.deepEqual(mapArchiveErrorToHttp({ code: "appointment_not_found" }), {
            status: 404,
            body: { ok: false, code: "appointment_not_found" }
        });
        assert.deepEqual(mapArchiveErrorToHttp({ code: "archive_conflict" }), {
            status: 409,
            body: { ok: false, code: "archive_conflict" }
        });
    });
});

describe("owner archive appointment core", () => {
    it("uses one Firestore transaction for archive write and active delete", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/archive-appointment-core.js"), "utf8");
        assert.match(src, /runTransaction/);
        assert.match(src, /tx\.set\(archiveRef/);
        assert.match(src, /tx\.delete\(appointmentRef\)/);
        assert.doesNotMatch(src, /await archiveOwnerAppointment[\s\S]*await delete/);
    });

    it("reconciles partial archive state without creating duplicate archive", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/archive-appointment-core.js"), "utf8");
        assert.match(src, /reconciled:\s*true/);
        assert.match(src, /existingArchives\.length > 0/);
        assert.match(src, /idempotent:\s*true/);
    });

    it("releases slot lock tied to archived appointment", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/archive-appointment-core.js"), "utf8");
        assert.match(src, /appointmentSlotLocks/);
        assert.match(src, /releaseSlotLock/);
    });

    it("parses legacy appointment ids", () => {
        assert.deepEqual(parseLegacyAppointmentId("legacy-2026-07-31-14:30"), {
            date: "2026-07-31",
            time: "14:30"
        });
        assert.equal(parseLegacyAppointmentId("abc123"), null);
    });

    it("uses allowlisted archive fields only", () => {
        const src = readFileSync(resolve(ROOT, "api/_lib/archive-appointment-core.js"), "utf8");
        assert.match(src, /barberSlug/);
        assert.match(src, /originalAppointmentId/);
        assert.match(src, /archivedByUid/);
        assert.match(src, /deleteExpireAt/);
        assert.doesNotMatch(src, /\.\.\.appointment/);
    });
});

describe("owner archive client wiring", () => {
    it("deletedAppointmentsService uses owner API only", () => {
        const src = readFileSync(resolve(ROOT, "deletedAppointmentsService.js"), "utf8");
        assert.match(src, /archiveOwnerAppointmentViaApi/);
        assert.doesNotMatch(src, /deleteDoc/);
        assert.doesNotMatch(src, /addDoc/);
    });

    it("admin delete confirm sends one archive API request", () => {
        const src = readFileSync(resolve(ROOT, "app.js"), "utf8");
        const block = src.slice(src.indexOf('document.getElementById("deleteConfirmYes")'), src.indexOf("document.getElementById(\"btnPrevWeek\")"));
        assert.match(block, /archiveAndDeleteAppointment/);
        assert.doesNotMatch(block, /deleteDoc/);
        assert.match(block, /confirmBtn\.disabled = true/);
        assert.match(block, /Takvim yenilenemedi/);
    });

    it("privileged API client exposes archive route", () => {
        const src = readFileSync(resolve(ROOT, "privilegedApiClient.js"), "utf8");
        assert.match(src, /archiveOwnerAppointment:\s*"\/api\/owner\/archive-appointment"/);
        assert.match(src, /archiveOwnerAppointmentViaApi/);
    });

    it("does not show raw Firebase permission errors for archive", () => {
        const src = readFileSync(resolve(ROOT, "deletedAppointmentsService.js"), "utf8");
        assert.doesNotMatch(src, /FirebaseError/);
        assert.doesNotMatch(src, /permission-denied/);
        assert.match(src, /ARCHIVE_ERROR_MESSAGES/);
    });
});

describe("owner archive security invariants", () => {
    it("firestore rules still deny direct client appointment delete", () => {
        const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        const block = rules.match(/match \/appointments\/\{appointmentId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
        assert.match(block, /allow create, update, delete: if false/);
    });

    it("archive API never trusts client businessId", () => {
        const route = readFileSync(resolve(ROOT, "api/owner/archive-appointment.js"), "utf8");
        const core = readFileSync(resolve(ROOT, "api/_lib/archive-appointment-core.js"), "utf8");
        assert.doesNotMatch(route, /body\.businessId/);
        assert.match(core, /fresh\.barberId !== businessId/);
    });
});
