/** Sentetik Phase 4 rules fixture kimlikleri — production verisi değil. */

export const SHOP_A = "shop-rules-a";
export const SHOP_B = "shop-rules-b";

export const UID_OWNER_A = "uid-owner-rules-a";
export const UID_OWNER_B = "uid-owner-rules-b";
export const UID_NO_MEMBERSHIP = "uid-no-membership";
export const UID_DISABLED = "uid-disabled-owner";
export const UID_WRONG_ROLE = "uid-wrong-role";

/**
 * Admin context (rules disabled) ile temel seed.
 * @param {import('@firebase/rules-unit-testing').RulesTestEnvironment} testEnv
 */
export async function seedRulesTestData(testEnv) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();

        await db.collection("berberler").doc(SHOP_A).set({
            name: "Rules Test Shop A",
            slug: SHOP_A,
            username: "rules_owner_a",
            password: "must-not-be-readable",
            status: "active",
            openHour: "09:00",
            closeHour: "18:00"
        });
        await db.collection("berberler").doc(SHOP_B).set({
            name: "Rules Test Shop B",
            slug: SHOP_B,
            username: "rules_owner_b",
            password: "must-not-be-readable",
            status: "active"
        });

        await db.collection("publicBarbers").doc(SHOP_A).set({
            name: "Public A",
            slug: SHOP_A,
            bookingOpen: true,
            status: "active"
        });

        await db.collection("businessMemberships").doc(UID_OWNER_A).set({
            uid: UID_OWNER_A,
            businessId: SHOP_A,
            role: "owner",
            status: "active"
        });
        await db.collection("businessMemberships").doc(UID_OWNER_B).set({
            uid: UID_OWNER_B,
            businessId: SHOP_B,
            role: "owner",
            status: "active"
        });
        await db.collection("businessMemberships").doc(UID_DISABLED).set({
            uid: UID_DISABLED,
            businessId: SHOP_A,
            role: "owner",
            status: "disabled"
        });
        await db.collection("businessMemberships").doc(UID_WRONG_ROLE).set({
            uid: UID_WRONG_ROLE,
            businessId: SHOP_A,
            role: "employee",
            status: "active"
        });

        await db.collection("appointments").doc("appt-rules-a1").set({
            barberId: SHOP_A,
            date: "2099-01-15",
            time: "10:00",
            phone: "+905551111111",
            status: "confirmed"
        });
        await db.collection("appointments").doc("appt-rules-b1").set({
            barberId: SHOP_B,
            date: "2099-01-15",
            time: "11:00",
            phone: "+905552222222",
            status: "confirmed"
        });

        await db.collection("customers").doc(`${SHOP_A}_5551111111`).set({
            barberSlug: SHOP_A,
            phone: "+905551111111",
            displayName: "Test Customer A"
        });

        await db.collection("activationCodes").doc("RULESTESTCODE").set({
            isUsed: false,
            durationDays: 30
        });

        await db.collection("berberler").doc(SHOP_A).collection("blockedSlots").doc("2099-01-15_10-00").set({
            date: "2099-01-15",
            time: "10:00"
        });

        const archiveExpiry = new Date("2099-02-01T00:00:00Z");
        await db.collection("deletedAppointments").doc("archive-rules-a1").set({
            barberSlug: SHOP_A,
            customerName: "Archived A",
            customerPhone: "5551111111",
            appointmentDate: "2099-01-10",
            appointmentTime: "10:00",
            serviceName: "Test",
            originalAppointmentId: "appt-archived-a1",
            deletedAt: new Date("2099-01-11T00:00:00Z"),
            deleteExpireAt: archiveExpiry,
            deletedBy: "seed",
            deletedByMode: "rules-test"
        });
        await db.collection("deletedAppointments").doc("archive-rules-b1").set({
            barberSlug: SHOP_B,
            customerName: "Archived B",
            customerPhone: "5552222222",
            appointmentDate: "2099-01-10",
            appointmentTime: "11:00",
            serviceName: "Test",
            originalAppointmentId: "appt-archived-b1",
            deletedAt: new Date("2099-01-11T00:00:00Z"),
            deleteExpireAt: archiveExpiry,
            deletedBy: "seed",
            deletedByMode: "rules-test"
        });
    });
}
