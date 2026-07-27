import { describe, it, before, after } from "node:test";
import {
    getProductionRulesTestEnv,
    cleanupProductionRulesTestEnv,
    assertSucceeds,
    assertFails
} from "./env.mjs";
import {
    seedRulesTestData,
    SHOP_A,
    SHOP_B,
    UID_OWNER_A,
    UID_NO_MEMBERSHIP
} from "./fixtures.mjs";
import { doc, setDoc, updateDoc, collection, getDocs } from "firebase/firestore";

/**
 * Target Security Requirements — hedef deny-by-default model.
 * Mevcut production firestore.rules ile çoğu test BAŞARISIZ olması beklenir.
 */

describe("target-security-requirements", () => {
    /** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
    let testEnv;

    before(async () => {
        testEnv = await getProductionRulesTestEnv();
        await testEnv.clearFirestore();
        await seedRulesTestData(testEnv);
    });

    after(async () => {
        await cleanupProductionRulesTestEnv();
    });

    it("unauthenticated berberler get DENY", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
    });

    it("unauthenticated appointments get DENY", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertFails(ctx.firestore().doc("appointments/appt-rules-a1").get());
    });

    it("unauthenticated berberler write DENY", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertFails(
            setDoc(doc(ctx.firestore(), "berberler", "shop-target-blocked"), { x: 1 })
        );
    });

    it("owner A cross-tenant berberler/shop-b get DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(ctx.firestore().doc(`berberler/${SHOP_B}`).get());
    });

    it("owner A cross-tenant appointment update DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(
            updateDoc(doc(ctx.firestore(), "appointments", "appt-rules-b1"), { status: "stolen" })
        );
    });

    it("owner A own businessMemberships get ALLOW", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertSucceeds(ctx.firestore().doc(`businessMemberships/${UID_OWNER_A}`).get());
    });

    it("owner A other businessMemberships get DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(ctx.firestore().doc("businessMemberships/uid-owner-rules-b").get());
    });

    it("no-membership user berberler get DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
        await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
    });

    it("client appointment create DENY (public CF only)", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertFails(
            setDoc(doc(ctx.firestore(), "appointments", "appt-target-public"), {
                barberId: SHOP_A,
                date: "2099-03-01",
                time: "10:00"
            })
        );
    });

    it("client membership create DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
        await assertFails(
            setDoc(doc(ctx.firestore(), "businessMemberships", UID_NO_MEMBERSHIP), {
                uid: UID_NO_MEMBERSHIP,
                businessId: SHOP_A,
                role: "owner",
                status: "active"
            })
        );
    });

    it("client membership role escalation DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(
            updateDoc(doc(ctx.firestore(), "businessMemberships", UID_OWNER_A), {
                role: "superAdmin"
            })
        );
    });

    it("client protected field password update DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(
            updateDoc(doc(ctx.firestore(), "berberler", SHOP_A), { password: "new" })
        );
    });

    it("publicBarbers get ALLOW", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertSucceeds(ctx.firestore().doc(`publicBarbers/${SHOP_A}`).get());
    });

    it("activationCodes unauthenticated get DENY", async () => {
        const ctx = testEnv.unauthenticatedContext();
        await assertFails(ctx.firestore().doc("activationCodes/RULESTESTCODE").get());
    });

    it("appointments broad list DENY", async () => {
        const ctx = testEnv.authenticatedContext(UID_OWNER_A);
        await assertFails(getDocs(collection(ctx.firestore(), "appointments")));
    });
});
