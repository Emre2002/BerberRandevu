import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getProductionRulesTestEnv, cleanupProductionRulesTestEnv, assertFails, assertSucceeds, RULES_TEST_PROJECT_ID } from "./env.mjs";
import { seedRulesTestData, SHOP_A, SHOP_B, UID_OWNER_A, UID_OWNER_B, UID_NO_MEMBERSHIP, UID_DISABLED } from "./fixtures.mjs";
import { updateOwnerSettings } from "../../api/_lib/owner-settings-core.js";
import { reviewApplication } from "../../api/_lib/review-application-core.js";

describe("production owner settings transaction and application access (local emulator only)", () => {
    let env, app, db;
    before(async () => {
        env = await getProductionRulesTestEnv();
        app = initializeApp({ projectId: RULES_TEST_PROJECT_ID }, "owner-settings-rules-test");
        db = getFirestore(app);
        db.settings({ host: "127.0.0.1:8081", ssl: false });
    });
    beforeEach(async () => {
        await env.clearFirestore();
        await seedRulesTestData(env);
        await db.doc("pendingBarbers/application").set({ status: "pending", shopName: "Fixture", createdAt: new Date() });
    });
    after(async () => { await cleanupProductionRulesTestEnv(); if (app) await deleteApp(app); });
    const input = updates => ({ uid: UID_OWNER_A, businessId: SHOP_A, updates });
    const snapshot = async path => (await db.doc(path).get()).data();

    it("server approval claims a stored application once under concurrent requests", async () => {
        await db.doc("pendingBarbers/application").update({ ownerName: "Fixture", shopName: "Fixture Shop", email: "fixture@example.test",
            phone: "05551234567", city: "İzmir", district: "Konak", address: "Fixture", openingHour: "09:00", closingHour: "19:00" });
        let authCalls = 0;
        const auth = { createUser: async () => { authCalls++; return { uid: "application-owner" }; } };
        const review = () => reviewApplication({ db, auth, timestamp: () => new Date(), applicationId: "application", action: "approve", reviewerUid: "superadmin-fixture" });
        const results = await Promise.allSettled([review(), review()]);
        assert.ok(results.some(result => result.status === "fulfilled"));
        assert.equal(authCalls, 1);
        assert.equal((await snapshot("pendingBarbers/application")).status, "approved");
        assert.equal((await snapshot("businessMemberships/application-owner")).businessId, "fixture-shop");
        assert.equal((await review()).idempotentReplay, true);
        assert.equal(authCalls, 1);
    });
    it("server rejection preserves the application and safely replays", async () => {
        const review = () => reviewApplication({ db, auth: {}, timestamp: () => new Date(), applicationId: "application", action: "reject", reviewerUid: "superadmin-fixture" });
        await review();
        const before = await snapshot("pendingBarbers/application");
        assert.equal(before.status, "rejected");
        assert.equal((await review()).idempotentReplay, true);
        assert.deepEqual(await snapshot("pendingBarbers/application"), before);
    });

    for (const updates of [{ selectedServices: ["Haircut", "Shave"] }, { openHour: "10:00", closeHour: "19:00" }]) {
        it(`updates own ${Object.keys(updates).join(", ")} and the public profile together`, async () => {
            const before = await snapshot(`berberler/${SHOP_A}`);
            await updateOwnerSettings(db, input(updates));
            const privateData = await snapshot(`berberler/${SHOP_A}`);
            const publicData = (await env.unauthenticatedContext().firestore().doc(`publicBarbers/${SHOP_A}`).get()).data();
            for (const [key, value] of Object.entries(updates)) {
                assert.deepEqual(privateData[key], value);
                assert.deepEqual(publicData[key], value);
            }
            assert.equal(privateData.password, before.password);
            assert.equal(publicData.password, undefined);
            assert.equal(publicData.bookingOpen, true);
            assert.equal((await snapshot("appointments/appt-rules-a1")).status, "confirmed");
            assert.equal((await snapshot("activationCodes/RULESTESTCODE")).isUsed, false);
        });
    }
    for (const uid of [UID_OWNER_B, UID_NO_MEMBERSHIP, UID_DISABLED, "anonymous"]) {
        it(`rejects mismatched, absent or inactive membership: ${uid}`, async () => {
            await assert.rejects(updateOwnerSettings(db, { ...input({ openHour: "10:00" }), uid }), { code: "forbidden" });
            assert.equal((await snapshot(`berberler/${SHOP_A}`)).openHour, "09:00");
        });
    }
    for (const key of ["slug", "businessId", "subscriptionStatus", "subscriptionEndDate", "payments", "ownerUid", "superAdmin", "password", "bookingOpen"]) {
        it(`rejects protected field ${key}`, async () => {
            await assert.rejects(updateOwnerSettings(db, input({ [key]: "forged" })), { code: "invalid_request" });
        });
    }
    for (const updates of [{ openHour: "29:00" }, { openHour: "20:00", closeHour: "10:00" }, { selectedServices: [] }, { selectedServices: [42] }]) {
        it(`rejects malformed settings ${JSON.stringify(updates)}`, async () => {
            await assert.rejects(updateOwnerSettings(db, input(updates)), { code: "invalid_request" });
        });
    }
    it("missing public profile leaves the private record unchanged", async () => {
        await db.doc(`publicBarbers/${SHOP_A}`).delete();
        await assert.rejects(updateOwnerSettings(db, input({ openHour: "10:00" })), { code: "profile_not_found" });
        assert.equal((await snapshot(`berberler/${SHOP_A}`)).openHour, "09:00");
    });
    it("failure staging the second write commits neither document", async () => {
        const failingDb = {
            collection: name => db.collection(name),
            runTransaction: fn => db.runTransaction(tx => fn({
                get: ref => tx.get(ref),
                update: (ref, data) => {
                    if (ref.path.startsWith("publicBarbers/")) throw new Error("fixture failure");
                    return tx.update(ref, data);
                }
            }))
        };
        await assert.rejects(updateOwnerSettings(failingDb, input({ openHour: "10:00" })), /fixture failure/);
        assert.equal((await snapshot(`berberler/${SHOP_A}`)).openHour, "09:00");
        assert.equal((await snapshot(`publicBarbers/${SHOP_A}`)).openHour, undefined);
    });
    it("concurrent changes retain both settings in both documents", async () => {
        await Promise.all([
            updateOwnerSettings(db, input({ selectedServices: ["Haircut"] })),
            updateOwnerSettings(db, input({ openHour: "10:00", closeHour: "19:00" }))
        ]);
        for (const collection of ["berberler", "publicBarbers"]) {
            const record = await snapshot(`${collection}/${SHOP_A}`);
            assert.deepEqual(record.selectedServices, ["Haircut"]);
            assert.equal(record.openHour, "10:00");
        }
    });
    it("public and owner clients cannot write public profiles or protected private fields", async () => {
        for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext(UID_OWNER_A)]) {
            const client = ctx.firestore();
            await assertFails(client.doc(`publicBarbers/${SHOP_A}`).update({ openHour: "10:00" }));
            await assertFails(client.doc(`berberler/${SHOP_A}`).update({ subscriptionStatus: "active" }));
            await assertFails(client.doc(`berberler/${SHOP_B}`).update({ openHour: "10:00" }));
        }
    });
    it("only a verified superAdmin claim grants application get/list, with no write permission", async () => {
        const admin = env.authenticatedContext("superadmin-fixture", { superAdmin: true }).firestore();
        await assertSucceeds(admin.doc("pendingBarbers/application").get());
        const applications = await assertSucceeds(admin.collection("pendingBarbers").orderBy("createdAt", "desc").get());
        assert.equal(applications.docs[0].id, "application");
        await assertFails(admin.doc("pendingBarbers/application").update({ status: "approved" }));
        await assertFails(admin.doc("pendingBarbers/application").delete());
        for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext(UID_OWNER_A), env.authenticatedContext(UID_NO_MEMBERSHIP), env.authenticatedContext("forged", { superAdmin: "true" })]) {
            const client = ctx.firestore();
            await assertFails(client.doc("pendingBarbers/application").get());
            await assertFails(client.collection("pendingBarbers").get());
        }
    });
});
