import { FieldValue } from "firebase-admin/firestore";
import { parseOwnerMembership } from "../../authGuard.js";

export class OwnerSettingsError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export async function updateOwnerSettings(db, { uid, businessId, updates }) {
    const fail = (code = "invalid_request", status = 400) => { throw new OwnerSettingsError(code, status); };
    if (!uid || !businessId || /\//.test(uid + businessId)) fail("forbidden", 403);
    const allowed = ["selectedServices", "openHour", "closeHour"];
    if (!updates || typeof updates !== "object" || Array.isArray(updates)
        || !Object.keys(updates).length || Object.keys(updates).some(key => !allowed.includes(key))) fail();
    const changes = { ...updates };
    if (Object.hasOwn(changes, "selectedServices")) {
        const services = changes.selectedServices;
        if (!Array.isArray(services) || !services.length || services.length > 30
            || services.some(value => typeof value !== "string" || !value.trim() || value.length > 120)) fail();
        changes.selectedServices = [...new Set(services.map(value => value.trim()))];
    }
    const validHour = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    for (const key of ["openHour", "closeHour"]) {
        if (Object.hasOwn(changes, key) && !validHour(changes[key])) fail();
    }
    const privateRef = db.collection("berberler").doc(businessId);
    const publicRef = db.collection("publicBarbers").doc(businessId);
    const membershipRef = db.collection("businessMemberships").doc(uid);
    await db.runTransaction(async tx => {
        const [membership, business, publicProfile] = await Promise.all([
            tx.get(membershipRef), tx.get(privateRef), tx.get(publicRef)
        ]);
        if (parseOwnerMembership(membership.exists ? membership.data() : null, uid)?.businessId !== businessId) fail("forbidden", 403);
        if (!business.exists || !publicProfile.exists || publicProfile.data().slug !== businessId) fail("profile_not_found", 409);
        if (Object.hasOwn(changes, "openHour") || Object.hasOwn(changes, "closeHour")) {
            const open = changes.openHour ?? business.data().openHour ?? "09:00";
            const close = changes.closeHour ?? business.data().closeHour ?? "21:00";
            if (!validHour(open) || !validHour(close) || open >= close) fail();
        }
        // Update existing documents only. A failed commit leaves both unchanged.
        tx.update(privateRef, changes);
        tx.update(publicRef, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    });
    return { ok: true };
}
