import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
    buildPublicBarberProjection,
    findLeakedSensitiveKeys,
    findUnexpectedProjectionKeys
} from "../publicBarberProjection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const seed = require("../functions/scripts/seed-emulator-membership.js");
const backfill = require("../functions/scripts/backfill-emulator-public-barbers.js");

const EMULATOR_RULES = readFileSync(resolve(ROOT, "firestore.emulator.rules"), "utf8");
const FIXTURE = seed.loadEmulatorFixture();

const okSeedArgs = {
    emulatorOnly: true,
    confirmProject: seed.EXPECTED_PROJECT_ID
};

const okEnv = {
    authEmulatorHost: "127.0.0.1:9099",
    firestoreEmulatorHost: "127.0.0.1:8080"
};

function createMockFirestore() {
    const store = new Map();
    return {
        store,
        doc: (col, id) => ({ col, id, key: `${col}/${id}` }),
        get: async (ref) => ({
            exists: store.has(ref.key),
            data: () => store.get(ref.key)
        }),
        set: async (ref, data, opts) => {
            if (opts?.merge && store.has(ref.key)) {
                store.set(ref.key, { ...store.get(ref.key), ...data });
            } else {
                store.set(ref.key, { ...data });
            }
        }
    };
}

function createMockAuth() {
    let createCalls = 0;
    return {
        auth: {
            getUserByEmail: async () => {
                throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
            },
            createUser: async () => {
                createCalls += 1;
                return { uid: "uid-emulator-smoke-1" };
            }
        },
        get createCalls() {
            return createCalls;
        }
    };
}

describe("Phase 4B2 emulator smoke — private berber seed", () => {
    it("seed private berber belgesini oluşturur", async () => {
        const { auth } = createMockAuth();
        const firestore = createMockFirestore();

        const result = await seed.runEmulatorSeed({
            args: okSeedArgs,
            password: "synthetic-test-pass-01",
            auth,
            firestore,
            loadFixture: seed.loadEmulatorFixture,
            env: okEnv
        });

        assert.equal(result.seeded.length, 1);
        const privateDoc = firestore.store.get("berberler/shop-emulator-a");
        assert.ok(privateDoc);
        assert.equal(privateDoc.slug, "shop-emulator-a");
        assert.equal(privateDoc.name, "Emulator Shop A");
        assert.equal(privateDoc.openHour, "09:00");
        assert.equal(privateDoc.closeHour, "18:00");
        assert.equal(privateDoc.password, "synthetic-emulator-private-password");
        assert.equal(privateDoc.telegramChatId, "emulator-telegram-sentinel-999");
        assert.equal(result.seeded[0].privateBarberStatus, "created");
    });

    it("buildPrivateBarberSeedDoc fixture alanlarını explicit seçer", () => {
        const entry = FIXTURE.users[0];
        const doc = seed.buildPrivateBarberSeedDoc(entry, "shop-emulator-a");
        assert.equal(doc.name, "Emulator Shop A");
        assert.ok(Array.isArray(doc.selectedServices));
        assert.equal(doc.subscriptionStatus, "active");
    });
});

describe("Phase 4B2 emulator smoke — backfill projection", () => {
    it("backfill writtenCount 1 ve publicBarbers projection üretir", async () => {
        const entry = FIXTURE.users[0];
        const privateDoc = seed.buildPrivateBarberSeedDoc(entry, "shop-emulator-a");
        const store = new Map([["berberler/shop-emulator-a", privateDoc]]);
        const publicWrites = [];

        const db = {
            collection: (name) => ({
                doc: (slug) => ({
                    get: async () => ({
                        exists: store.has(`${name}/${slug}`),
                        data: () => store.get(`${name}/${slug}`)
                    }),
                    set: async (payload, opts) => {
                        publicWrites.push({ slug, payload, opts });
                        store.set(`${name}/${slug}`, payload);
                    }
                })
            })
        };

        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        const args = {
            emulatorOnly: true,
            confirmProject: backfill.EXPECTED_PROJECT_ID,
            dryRun: false,
            slugs: ["shop-emulator-a"]
        };
        assert.equal(backfill.validateGuards(args).ok, true);

        const {
            buildPublicBarberProjection,
            findLeakedSensitiveKeys,
            findUnexpectedProjectionKeys
        } = await import("../publicBarberProjection.js");

        let written = 0;
        for (const slug of args.slugs) {
            const privateSnap = await db.collection("berberler").doc(slug).get();
            assert.equal(privateSnap.exists, true);
            const privateData = privateSnap.data();
            const projection = buildPublicBarberProjection(privateData, slug, {
                bookingOpen: true
            });
            assert.deepEqual(findUnexpectedProjectionKeys(projection), []);
            assert.deepEqual(findLeakedSensitiveKeys(projection), []);
            await db.collection("publicBarbers").doc(slug).set(
                { ...projection, updatedAt: new Date() },
                { merge: true }
            );
            written += 1;
        }

        assert.equal(written, 1);
        const publicDoc = store.get("publicBarbers/shop-emulator-a");
        assert.ok(publicDoc);
        assert.equal(publicDoc.name, "Emulator Shop A");
    });

    it("password public belgeye kopyalanmaz", () => {
        const privateDoc = seed.buildPrivateBarberSeedDoc(FIXTURE.users[0], "shop-emulator-a");
        const projection = buildPublicBarberProjection(privateDoc, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.password, undefined);
    });

    it("telegramChatId public belgeye kopyalanmaz", () => {
        const privateDoc = seed.buildPrivateBarberSeedDoc(FIXTURE.users[0], "shop-emulator-a");
        const projection = buildPublicBarberProjection(privateDoc, "shop-emulator-a", {
            bookingOpen: true
        });
        assert.equal(projection.telegramChatId, undefined);
    });
});

describe("Phase 4B2 emulator smoke — firestore.emulator.rules", () => {
    const membershipBlock = EMULATOR_RULES.match(
        /match \/businessMemberships\/\{membershipUid\} \{([\s\S]*?)\n    \}/
    );
    const publicBarbersBlock = EMULATOR_RULES.match(
        /match \/publicBarbers\/\{businessId\} \{([\s\S]*?)\n    \}/
    );
    const berberlerBlock = EMULATOR_RULES.match(
        /match \/berberler\/\{slug\} \{([\s\S]*?)\n      match \/blockedSlots/
    );

    it("publicBarbers unauthenticated get allow", () => {
        assert.ok(publicBarbersBlock);
        assert.match(publicBarbersBlock[1], /allow get: if true/);
        assert.match(publicBarbersBlock[1], /allow list, create, update, delete: if false/);
    });

    it("berberler unauthenticated public get deny", () => {
        assert.ok(berberlerBlock);
        assert.doesNotMatch(berberlerBlock[1], /allow read: if true/);
        assert.match(berberlerBlock[1], /allow get: if ownsBusiness\(slug\)/);
    });

    it("own membership authenticated get allow", () => {
        assert.ok(membershipBlock);
        assert.match(membershipBlock[1], /allow get:/);
        assert.match(membershipBlock[1], /request\.auth\.uid == membershipUid/);
        assert.match(membershipBlock[1], /request\.auth != null/);
    });

    it("production firestore.rules membership tabanlı güvenli model içerir", () => {
        const prodRules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
        assert.match(prodRules, /businessMemberships/);
    });
});
