import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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
    UID_OWNER_B,
    UID_NO_MEMBERSHIP
} from "./fixtures.mjs";
import { doc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";

/** Production firestore.rules — güvenli membership tabanlı davranış karakterizasyonu. */

describe("current-rules-characterization", () => {
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

    describe("unauthenticated", () => {
        it("berberler get DENY", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("appointments get DENY", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc("appointments/appt-rules-a1").get());
        });

        it("berberler create DENY", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(
                setDoc(doc(ctx.firestore(), "berberler", "shop-rules-injected"), { name: "injected" })
            );
        });

        it("publicBarbers get ALLOW", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertSucceeds(ctx.firestore().doc(`publicBarbers/${SHOP_A}`).get());
        });

        it("unknown collection write DENY", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(
                setDoc(doc(ctx.firestore(), "unknownCollectionPhase4", "x"), { a: 1 })
            );
        });
    });

    describe("authenticated without membership", () => {
        it("berberler get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("other businessMemberships get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertFails(ctx.firestore().doc(`businessMemberships/${UID_OWNER_A}`).get());
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
    });

    describe("owner A", () => {
        it("own berberler get ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("tenant-scoped appointments query ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("barberId", "==", SHOP_A)
            );
            await assertSucceeds(getDocs(q));
        });

        it("calendar date+barberId query ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("date", "==", "2099-01-15"),
                where("barberId", "==", SHOP_A)
            );
            await assertSucceeds(getDocs(q));
        });

        it("unscoped appointments list DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(getDocs(collection(ctx.firestore(), "appointments")));
        });

        it("cross-tenant berberler get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_B}`).get());
        });

        it("cross-tenant appointment get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("appointments/appt-rules-b1").get());
        });

        it("cross-tenant barberId query DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("barberId", "==", SHOP_B)
            );
            await assertFails(getDocs(q));
        });

        it("membership update DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "businessMemberships", UID_OWNER_A), {
                    businessId: SHOP_B
                })
            );
        });

        it("appointment client create DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "appointments", "appt-rules-new"), {
                    barberId: SHOP_A,
                    date: "2099-02-01",
                    time: "09:00",
                    status: "confirmed"
                })
            );
        });

        it("appointment delete DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(deleteDoc(doc(ctx.firestore(), "appointments", "appt-rules-a1")));
        });

        it("password field update DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "berberler", SHOP_A), {
                    password: "attacker-set"
                })
            );
        });

        it("own blockedSlots write ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                setDoc(
                    doc(ctx.firestore(), "berberler", SHOP_A, "blockedSlots", "2099-02-01_12-00"),
                    { date: "2099-02-01", time: "12:00" }
                )
            );
        });

        it("legacy day doc get ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                ctx.firestore().doc(`berberler/${SHOP_A}/appointments/2099-01-15`).get()
            );
        });

        it("activationCodes get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("activationCodes/RULESTESTCODE").get());
        });
    });

    describe("owner B isolation", () => {
        it("owner B cannot read owner A appointment", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_B);
            await assertFails(ctx.firestore().doc("appointments/appt-rules-a1").get());
        });
    });
});
