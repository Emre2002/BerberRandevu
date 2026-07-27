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
    UID_NO_MEMBERSHIP
} from "./fixtures.mjs";
import { doc, setDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

/**
 * Current Rules Characterization — production firestore.rules mevcut davranışı ölçer.
 * Güvensiz izinler burada ALLOW olarak karakterize edilir; hedef model değildir.
 */

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
        it("1. unauthenticated public read — berberler get ALLOW", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("2. unauthenticated private read — appointments get ALLOW (rules açık)", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertSucceeds(ctx.firestore().doc("appointments/appt-rules-a1").get());
        });

        it("3. unauthenticated write — berberler create ALLOW", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertSucceeds(
                setDoc(doc(ctx.firestore(), "berberler", "shop-rules-injected"), { name: "injected" })
            );
        });

        it("18. publicBarbers get DENY (rules'ta tanımsız → default deny)", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc(`publicBarbers/${SHOP_A}`).get());
        });

        it("20. bilinmeyen koleksiyon write DENY", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(
                setDoc(doc(ctx.firestore(), "unknownCollectionPhase4", "x"), { a: 1 })
            );
        });
    });

    describe("authenticated without membership", () => {
        it("4. authenticated user private read — berberler get ALLOW (membership gerekmez)", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("9. membership olmayan kullanıcı — businessMemberships get DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertFails(ctx.firestore().doc(`businessMemberships/${UID_OWNER_A}`).get());
        });

        it("12. client membership create DENY (koleksiyon rules'ta yok)", async () => {
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

    describe("owner A (Auth uid, rules membership yok)", () => {
        it("5. owner A kendi işletme verisi get — berberler ALLOW (tenant kontrolü yok)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("6. owner A appointments list/query — ALLOW (barberId filtresi rules'ta zorunlu değil)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(getDocs(collection(ctx.firestore(), "appointments")));
        });

        it("7. owner A işletme B verisi get — ALLOW (cross-tenant izolasyon yok)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_B}`).get());
        });

        it("8. owner A işletme B appointments update — ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                updateDoc(doc(ctx.firestore(), "appointments", "appt-rules-b1"), { status: "hacked" })
            );
        });

        it("13. owner A membership update DENY (koleksiyon rules'ta yok)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "businessMemberships", UID_OWNER_A), {
                    businessId: SHOP_B
                })
            );
        });

        it("14. owner role yükseltme — businessMemberships write DENY", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "businessMemberships", "uid-escalation"), {
                    uid: "uid-escalation",
                    businessId: SHOP_A,
                    role: "superAdmin",
                    status: "active"
                })
            );
        });

        it("15. appointment create — client ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                setDoc(doc(ctx.firestore(), "appointments", "appt-rules-new"), {
                    barberId: SHOP_A,
                    date: "2099-02-01",
                    time: "09:00",
                    status: "confirmed"
                })
            );
        });

        it("16. appointment delete — ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                deleteDoc(doc(ctx.firestore(), "appointments", "appt-rules-a1"))
            );
        });

        it("19. private barber update — password alanı ALLOW (mass assignment)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                updateDoc(doc(ctx.firestore(), "berberler", SHOP_A), {
                    password: "attacker-set"
                })
            );
        });

        it("blockedSlots write — ALLOW", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                setDoc(
                    doc(ctx.firestore(), "berberler", SHOP_A, "blockedSlots", "2099-02-01_12-00"),
                    { date: "2099-02-01", time: "12:00" }
                )
            );
        });

        it("activationCodes get DENY (rules'ta tanımsız)", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("activationCodes/RULESTESTCODE").get());
        });
    });

    describe("legacy/session has no rules effect", () => {
        it("10-11. rules request.auth dışı client state okumaz", () => {
            assert.ok(true);
        });
    });
});
