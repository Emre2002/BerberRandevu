import { describe, it, before, after } from "node:test";
import {
    getCandidateRulesTestEnv,
    cleanupCandidateRulesTestEnv,
    assertSucceeds,
    assertFails
} from "../env.mjs";
import {
    seedRulesTestData,
    SHOP_A,
    SHOP_B,
    UID_OWNER_A,
    UID_OWNER_B,
    UID_NO_MEMBERSHIP,
    UID_DISABLED,
    UID_WRONG_ROLE
} from "../fixtures.mjs";
import {
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    where
} from "firebase/firestore";

describe("candidate-security — firestore.phase4b.rules", () => {
    /** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
    let testEnv;

    before(async () => {
        testEnv = await getCandidateRulesTestEnv();
        await testEnv.clearFirestore();
        await seedRulesTestData(testEnv);
    });

    after(async () => {
        await cleanupCandidateRulesTestEnv();
    });

    describe("businessMemberships", () => {
        it("1. unauthenticated own membership get deny", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc(`businessMemberships/${UID_OWNER_A}`).get());
        });

        it("2. authenticated own membership get allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc(`businessMemberships/${UID_OWNER_A}`).get());
        });

        it("3. authenticated other membership get deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc(`businessMemberships/${UID_OWNER_B}`).get());
        });

        it("4. membership list deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(getDocs(collection(ctx.firestore(), "businessMemberships")));
        });

        it("5. membership create deny", async () => {
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

        it("6. membership update deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "businessMemberships", UID_OWNER_A), {
                    businessId: SHOP_B
                })
            );
        });

        it("7. membership delete deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                deleteDoc(doc(ctx.firestore(), "businessMemberships", UID_OWNER_A))
            );
        });
    });

    describe("private business (berberler)", () => {
        it("8. public private barber get deny", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("9. without-membership private get deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("10. owner A own business get allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("11. owner A business B get deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_B}`).get());
        });

        it("12. owner A protected field update deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "berberler", SHOP_A), { password: "hacked" })
            );
        });

        it("13. owner A permitted profile field update allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(
                updateDoc(doc(ctx.firestore(), "berberler", SHOP_A), { name: "Updated Shop A" })
            );
        });

        it("14. owner A berberler collection list deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(getDocs(collection(ctx.firestore(), "berberler")));
        });

        it("15. disabled membership deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_DISABLED);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("16. wrong role deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_WRONG_ROLE);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("17. membership businessId mismatch deny cross-tenant", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_B}`).get());
        });
    });

    describe("publicBarbers", () => {
        it("18. public get allow", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertSucceeds(ctx.firestore().doc(`publicBarbers/${SHOP_A}`).get());
        });

        it("19. public list deny", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(getDocs(collection(ctx.firestore(), "publicBarbers")));
        });

        it("20. client create deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "publicBarbers", "shop-injected"), { name: "x" })
            );
        });

        it("21. client update deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "publicBarbers", SHOP_A), { name: "hacked" })
            );
        });

        it("22. client delete deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(deleteDoc(doc(ctx.firestore(), "publicBarbers", SHOP_A)));
        });
    });

    describe("appointments", () => {
        it("23. public create deny", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(
                setDoc(doc(ctx.firestore(), "appointments", "appt-public"), {
                    barberId: SHOP_A,
                    date: "2099-04-01",
                    time: "10:00"
                })
            );
        });

        it("24. authenticated client create deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "appointments", "appt-owner-create"), {
                    barberId: SHOP_A,
                    date: "2099-04-01",
                    time: "11:00"
                })
            );
        });

        it("25. owner own appointment get allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertSucceeds(ctx.firestore().doc("appointments/appt-rules-a1").get());
        });

        it("26. owner cross-tenant get deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("appointments/appt-rules-b1").get());
        });

        it("27. owner tenant-scoped query allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("barberId", "==", SHOP_A)
            );
            await assertSucceeds(getDocs(q));
        });

        it("28. owner unscoped query deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(getDocs(collection(ctx.firestore(), "appointments")));
        });

        it("29. owner update deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                updateDoc(doc(ctx.firestore(), "appointments", "appt-rules-a1"), { status: "cancelled" })
            );
        });

        it("30. owner delete deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(deleteDoc(doc(ctx.firestore(), "appointments", "appt-rules-a1")));
        });

        it("30b. owner calendar date+barberId query allow", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("date", "==", "2099-01-15"),
                where("barberId", "==", SHOP_A)
            );
            await assertSucceeds(getDocs(q));
        });

        it("30c. owner cross-tenant barberId query deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            const q = query(
                collection(ctx.firestore(), "appointments"),
                where("date", "==", "2099-01-15"),
                where("barberId", "==", SHOP_B)
            );
            await assertFails(getDocs(q));
        });
    });

    describe("default deny", () => {
        it("31. unknown collection get deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("unknownPhase4b/secret").get());
        });

        it("32. unknown collection create deny", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "unknownPhase4b", "x"), { a: 1 })
            );
        });
    });

    describe("legacy / client-controlled state (rules context)", () => {
        it("33. unauthenticated berberler deny (sessionStorage cannot help)", async () => {
            const ctx = testEnv.unauthenticatedContext();
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("34. no-membership deny (localStorage cannot help)", async () => {
            const ctx = testEnv.authenticatedContext(UID_NO_MEMBERSHIP);
            await assertFails(ctx.firestore().doc(`berberler/${SHOP_A}`).get());
        });

        it("35. forged appointment barberId in payload does not grant cross-tenant get", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(ctx.firestore().doc("appointments/appt-rules-b1").get());
        });

        it("36. forged appointment create with other tenant barberId denied", async () => {
            const ctx = testEnv.authenticatedContext(UID_OWNER_A);
            await assertFails(
                setDoc(doc(ctx.firestore(), "appointments", "appt-forged-tenant"), {
                    barberId: SHOP_B,
                    date: "2099-05-01",
                    time: "09:00"
                })
            );
        });
    });
});
