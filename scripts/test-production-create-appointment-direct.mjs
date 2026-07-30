#!/usr/bin/env node
/**
 * Direct server-side production booking test (Admin SDK) — abc test tenant only.
 * Creates one appointment, verifies, then cleans up. No credentials logged.
 */
import crypto from "node:crypto";
import { getAdminDb } from "../api/_lib/firebase-admin.js";
import { computePublicAvailability } from "../api/_lib/availability.js";
import { createPublicAppointment } from "../api/_lib/create-appointment-core.js";
import { resolvePublicBusinessSlug } from "../api/_lib/resolve-public-business-slug.js";

const slug = process.env.SMOKE_PUBLIC_SLUG || "abc";
const db = getAdminDb();

function tomorrowYmd() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

const businessId = await resolvePublicBusinessSlug(db, slug);
if (!businessId) {
    console.log(JSON.stringify({ ok: false, code: "business_not_found", slug }));
    process.exit(1);
}

const date = tomorrowYmd();
const availability = await computePublicAvailability(db, { businessSlug: businessId, date });
if (!availability.ok || !availability.payload.availableSlots?.length) {
    console.log(JSON.stringify({
        ok: false,
        code: "no_available_slot",
        businessId,
        date,
        state: availability.code || "empty"
    }));
    process.exit(1);
}

const time = availability.payload.availableSlots[0];

const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
const services = publicSnap.data()?.selectedServices;
const service = Array.isArray(services) && services.length ? services[0] : "Saç Kesimi";

const idempotencyKey = `test-${Date.now()}`;

const created = await createPublicAppointment(db, {
    dukkan: slug,
    customerName: "Test Musteri",
    phone: "05559876543",
    service,
    date,
    time,
    musteriNotu: "automated-test",
    website: "",
    idempotencyKey
}, { clientIp: "127.0.0.1" });

const snap = await db.collection("appointments").doc(created.appointmentId).get();
const ok = snap.exists && snap.data()?.barberId === businessId;

if (ok) {
    await db.collection("appointments").doc(created.appointmentId).delete();
    const lockId = `${businessId}__${date}__${time}`;
    await db.collection("appointmentSlotLocks").doc(lockId).delete().catch(() => {});
    await db.collection("appointmentIdempotency").doc(
        crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)
    ).delete().catch(() => {});
}

console.log(JSON.stringify({
    ok,
    businessId,
    slug,
    date,
    time,
    appointmentId: ok ? created.appointmentId : null,
    cleanedUp: ok
}));
process.exit(ok ? 0 : 1);
