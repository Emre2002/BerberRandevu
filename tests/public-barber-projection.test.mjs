import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
    buildPublicBarberProjection,
    findLeakedSensitiveKeys,
    findUnexpectedProjectionKeys,
    publicBarberAllowlistKeys,
    PUBLIC_BARBER_SENSITIVE_FIELDS
} from "../publicBarberProjection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const PRIVATE_FIXTURE = {
    slug: "shop-emulator-a",
    name: "Emulator Shop A",
    password: "secret-plaintext",
    username: "emulator_owner",
    telegramChatId: "12345",
    subscriptionStatus: "active",
    subscriptionEndDate: "2099-12-31",
    lastActivationCode: "BRB-TEST",
    openHour: "09:00",
    closeHour: "18:00",
    phone: "+905551112233",
    selectedServices: ["Sac", "Sakal"],
    internalSecretField: "must-not-copy"
};

describe("publicBarberProjection — allowlist", () => {
    it("1. projection yalnız allowlist alanlarını içerir", () => {
        const projection = buildPublicBarberProjection(PRIVATE_FIXTURE, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.deepEqual(findUnexpectedProjectionKeys(projection), []);
        assert.deepEqual(findLeakedSensitiveKeys(projection), []);
    });

    it("2. password public belgeye kopyalanmaz", () => {
        const projection = buildPublicBarberProjection(PRIVATE_FIXTURE, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.password, undefined);
    });

    it("3. telegramChatId kopyalanmaz", () => {
        const projection = buildPublicBarberProjection(PRIVATE_FIXTURE, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.telegramChatId, undefined);
    });

    it("4. subscription alanları kopyalanmaz", () => {
        const projection = buildPublicBarberProjection(PRIVATE_FIXTURE, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.subscriptionStatus, undefined);
        assert.equal(projection.subscriptionEndDate, undefined);
        assert.equal(projection.lastActivationCode, undefined);
    });

    it("5. bilinmeyen private alanlar otomatik kopyalanmaz", () => {
        const projection = buildPublicBarberProjection(PRIVATE_FIXTURE, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.internalSecretField, undefined);
    });

    it("allowlist hassas alanları içermez", () => {
        const allow = new Set(publicBarberAllowlistKeys());
        for (const field of PUBLIC_BARBER_SENSITIVE_FIELDS) {
            assert.equal(allow.has(field), false, `allowlist must not include ${field}`);
        }
    });
});

describe("backfill-emulator-public-barbers — fail-closed guards", () => {
    const backfill = require("../functions/scripts/backfill-emulator-public-barbers.js");

    it("6. emulator host yoksa reddedilir", () => {
        const prev = process.env.FIRESTORE_EMULATOR_HOST;
        delete process.env.FIRESTORE_EMULATOR_HOST;
        const result = backfill.validateGuards({
            emulatorOnly: true,
            confirmProject: backfill.EXPECTED_PROJECT_ID,
            dryRun: false,
            slugs: []
        });
        if (prev) process.env.FIRESTORE_EMULATOR_HOST = prev;
        assert.equal(result.ok, false);
        assert.match(result.reason, /firestore_missing_host/);
    });

    it("7. non-localhost emulator host reddedilir", () => {
        const result = backfill.parseEmulatorHost("203.0.113.1:8080");
        assert.equal(result.ok, false);
        assert.equal(result.reason, "non_local_host");
    });

    it("8. yanlış confirm-project reddedilir", () => {
        const prev = process.env.FIRESTORE_EMULATOR_HOST;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        const result = backfill.validateGuards({
            emulatorOnly: true,
            confirmProject: "production-like-project",
            dryRun: false,
            slugs: []
        });
        if (prev === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
        else process.env.FIRESTORE_EMULATOR_HOST = prev;
        assert.equal(result.ok, false);
        assert.equal(result.reason, "confirm_project_mismatch");
    });
});

describe("public client — fetchPublicBarber fail-closed", () => {
    const firestoreServiceSrc = readFileSync(resolve(ROOT, "firestoreService.js"), "utf8");
    const appSrc = readFileSync(resolve(ROOT, "app.js"), "utf8");

    it("9-11. fetchPublicBarber private berberler fallback içermez", () => {
        const fnBlock = firestoreServiceSrc.match(
            /export async function fetchPublicBarber[\s\S]*?^}/m
        )?.[0];
        assert.ok(fnBlock);
        assert.doesNotMatch(fnBlock, /fetchBarber/);
        assert.doesNotMatch(fnBlock, /["']berberler["']/);
    });

    it("müşteri sayfası profil yüklemesi fetchPublicBarber kullanır", () => {
        assert.match(appSrc, /isCustomerPage[\s\S]*?fetchPublicBarber\(aktifDukkan\)/);
    });

    it("12. admin paneli membership tabanlı private berber okumasını kullanır", () => {
        assert.match(appSrc, /fetchBarber\(getTenantBusinessId\(\)\)/);
        assert.match(appSrc, /getAuthorizedBusinessContextWithFreshToken/);
    });
});
