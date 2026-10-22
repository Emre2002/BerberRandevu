import { describe, it, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { REPO_ROOT, RULES_TEST_PROJECT_ID, assertRulesTestGuards } from "./guards.mjs";
import { seedRulesTestData, SHOP_A, SHOP_B, UID_OWNER_A, UID_OWNER_B, UID_NO_MEMBERSHIP } from "./fixtures.mjs";

describe("development Firestore rules", () => {
    let testEnv;

    before(async () => {
        assertRulesTestGuards({ projectId: RULES_TEST_PROJECT_ID });
        testEnv = await initializeTestEnvironment({
            projectId: RULES_TEST_PROJECT_ID,
            firestore: {
                rules: readFileSync(resolve(REPO_ROOT, "firestore.development.rules"), "utf8"),
                host: "127.0.0.1",
                port: 8081
            }
        });
        await testEnv.clearFirestore();
        await seedRulesTestData(testEnv);
    });

    after(async () => {
        await testEnv?.cleanup();
    });

    it("rejects anonymous private access but allows public profile reads", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, "berberler", SHOP_A)));
        await assertFails(getDoc(doc(db, "appointments", "appt-rules-a1")));
        await assertSucceeds(getDoc(doc(db, "publicBarbers", SHOP_A)));
        await assertFails(setDoc(doc(db, "publicBarbers", "forged"), {
            slug: "forged", bookingOpen: true
        }));
    });

    it("allows an owner to read and update own services and hours", async () => {
        const db = testEnv.authenticatedContext(UID_OWNER_A).firestore();
        await assertSucceeds(getDoc(doc(db, "businessMemberships", UID_OWNER_A)));
        await assertSucceeds(getDoc(doc(db, "berberler", SHOP_A)));
        await assertSucceeds(updateDoc(doc(db, "berberler", SHOP_A), {
            selectedServices: ["Haircut"], openHour: "09:00", closeHour: "18:00"
        }));
        await assertSucceeds(setDoc(doc(db, "publicBarbers", SHOP_A), {
            selectedServices: ["Haircut"], openHour: "09:00", closeHour: "18:00",
            updatedAt: serverTimestamp()
        }, { merge: true }));
    });

    it("rejects cross-tenant reads and updates", async () => {
        const db = testEnv.authenticatedContext(UID_OWNER_A).firestore();
        const otherDb = testEnv.authenticatedContext(UID_OWNER_B).firestore();
        await assertFails(getDoc(doc(db, "berberler", SHOP_B)));
        await assertFails(getDoc(doc(db, "appointments", "appt-rules-b1")));
        await assertSucceeds(getDoc(doc(db, "customers", `${SHOP_A}_5551111111`)));
        await assertFails(getDoc(doc(otherDb, "customers", `${SHOP_A}_5551111111`)));
        await assertFails(updateDoc(doc(db, "berberler", SHOP_B), { openHour: "08:00" }));
        await assertFails(setDoc(doc(db, "berberler", SHOP_B, "blockedSlots", "cross-tenant"), {
            date: "2099-02-01", time: "12:00"
        }));
        await assertFails(updateDoc(doc(db, "publicBarbers", SHOP_B), { bookingOpen: true }));
    });

    it("rejects client booking writes and membership escalation", async () => {
        const ownerDb = testEnv.authenticatedContext(UID_OWNER_A).firestore();
        const anonymousDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(setDoc(doc(anonymousDb, "appointments", "new-anonymous"), { barberId: SHOP_A }));
        await assertFails(setDoc(doc(ownerDb, "appointments", "new-owner"), { barberId: SHOP_A }));
        await assertFails(updateDoc(doc(ownerDb, "businessMemberships", UID_OWNER_A), { role: "superAdmin" }));
        await assertFails(updateDoc(doc(ownerDb, "berberler", SHOP_A), { subscriptionStatus: "active" }));
        await assertFails(updateDoc(doc(ownerDb, "berberler", SHOP_A), { openHour: "29:00" }));
        await assertFails(updateDoc(doc(ownerDb, "publicBarbers", SHOP_A), { bookingOpen: false }));
    });

    it("rejects membership creation without trusted Admin credentials", async () => {
        const db = testEnv.authenticatedContext(UID_NO_MEMBERSHIP).firestore();
        await assertFails(setDoc(doc(db, "businessMemberships", UID_NO_MEMBERSHIP), {
            uid: UID_NO_MEMBERSHIP, role: "owner", status: "active", businessId: SHOP_A
        }));
        await assertFails(getDoc(doc(db, "berberler", SHOP_A)));
    });

    it("allows only bounded anonymous demo submissions", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        const valid = {
            adSoyad: "Test User", telefon: "5551234567", email: "test@example.com",
            dukkanAdi: "Test Shop", mesaj: "", durum: "pasif",
            olusturmaTarihi: serverTimestamp()
        };
        await assertSucceeds(setDoc(doc(db, "demo_talepleri", "valid"), valid));
        await assertFails(setDoc(doc(db, "demo_talepleri", "invalid-status"), { ...valid, durum: "approved" }));
        await assertFails(setDoc(doc(db, "demo_talepleri", "extra-field"), { ...valid, role: "owner" }));
        await assertFails(getDoc(doc(db, "demo_talepleri", "valid")));
    });

    it("allows only bounded anonymous pending applications", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        const valid = {
            ownerName: "Test Owner", phone: "5551234567", email: "test@example.com",
            shopName: "Test Shop", message: "", city: "Istanbul", district: "Besiktas",
            address: "Test address", mapsLink: "", openingHour: "09:00",
            closingHour: "18:00", packageType: "demo", status: "pending",
            createdAt: serverTimestamp()
        };
        await assertSucceeds(setDoc(doc(db, "pendingBarbers", "valid"), valid));
        await assertFails(setDoc(doc(db, "pendingBarbers", "invalid-status"), { ...valid, status: "approved" }));
        await assertFails(setDoc(doc(db, "pendingBarbers", "oversized"), { ...valid, message: "x".repeat(1001) }));
        await assertFails(getDoc(doc(db, "pendingBarbers", "valid")));
    });

    it("allows trusted superadmin application management", async () => {
        const db = testEnv.authenticatedContext("uid-admin-test", { superAdmin: true }).firestore();
        await assertSucceeds(getDoc(doc(db, "berberler", SHOP_A)));
        await assertSucceeds(updateDoc(doc(db, "pendingBarbers", "valid"), { status: "approved" }));
        await assertSucceeds(updateDoc(doc(db, "demo_talepleri", "valid"), { durum: "aktif" }));
    });
});
