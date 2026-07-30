#!/usr/bin/env node
/**
 * Production booking E2E via HTTP API + browser-free validation.
 */
import crypto from "node:crypto";
import { getAdminDb } from "../api/_lib/firebase-admin.js";
import { computePublicAvailability } from "../api/_lib/availability.js";

const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const slug = process.env.SMOKE_PUBLIC_SLUG || "abc";

function tomorrowYmd() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

import { resolvePublicBusinessSlug } from "../api/_lib/resolve-public-business-slug.js";

const date = tomorrowYmd();
const availUrl = `${BASE}/api/public/availability?dukkan=${encodeURIComponent(slug)}&date=${date}`;
const availResp = await fetch(availUrl);
const availBody = await availResp.json();

if (availResp.status !== 200 || !availBody.availableSlots?.length) {
    console.log(JSON.stringify({ ok: false, stage: "availability", status: availResp.status }));
    process.exit(1);
}

const db = getAdminDb();
const businessId = await resolvePublicBusinessSlug(db, slug);
const publicSnap = await db.collection("publicBarbers").doc(businessId).get();
const services = publicSnap.data()?.selectedServices;
const service = Array.isArray(services) && services.length ? services[0] : "Saç Kesimi";
const time = availBody.availableSlots[0];
const idempotencyKey = crypto.randomUUID();

const createResp = await fetch(`${BASE}/api/public/create-appointment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
        dukkan: slug,
        customerName: "Test Musteri",
        phone: "05559876543",
        service,
        date,
        time,
        musteriNotu: "e2e-test",
        idempotencyKey
    })
});

const createBody = await createResp.json();
const appointmentId = createBody?.appointmentId;

const ok = createResp.status === 201 && createBody?.ok === true && appointmentId;

let verified = false;
if (ok) {
    const snap = await db.collection("appointments").doc(appointmentId).get();
    verified = snap.exists && snap.data()?.barberId === businessId;
}

if (verified) {
    await db.collection("appointments").doc(appointmentId).delete();
    await db.collection("appointmentSlotLocks").doc(`${businessId}__${date}__${time}`).delete().catch(() => {});
    await db.collection("appointmentIdempotency").doc(
        crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)
    ).delete().catch(() => {});
}

console.log(JSON.stringify({
    ok: verified,
    stage: "production_http_e2e",
    createStatus: createResp.status,
    createCode: createBody?.code ?? null,
    businessId,
    appointmentId: verified ? appointmentId : null,
    cleanedUp: verified
}));
process.exit(verified ? 0 : 1);
