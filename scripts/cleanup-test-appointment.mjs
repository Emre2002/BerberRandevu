#!/usr/bin/env node
/**
 * Remove a test appointment created during production validation.
 * Usage: node scripts/cleanup-test-appointment.mjs --id=<appointmentId>
 */
import { getAdminDb } from "../api/_lib/firebase-admin.js";

const idArg = process.argv.find((a) => a.startsWith("--id="));
const appointmentId = idArg ? idArg.slice("--id=".length).trim() : "";

if (!appointmentId || !/^[A-Za-z0-9_-]{10,}$/.test(appointmentId)) {
    console.error(JSON.stringify({ ok: false, code: "invalid_appointment_id" }));
    process.exit(1);
}

const db = getAdminDb();
const ref = db.collection("appointments").doc(appointmentId);
const snap = await ref.get();

if (!snap.exists) {
    console.log(JSON.stringify({ ok: true, deleted: false, reason: "not_found" }));
    process.exit(0);
}

const data = snap.data() || {};
await ref.delete();

const lockId = `${data.barberId}__${data.date}__${data.time}`;
await db.collection("appointmentSlotLocks").doc(lockId).delete().catch(() => {});

console.log(JSON.stringify({
    ok: true,
    deleted: true,
    businessId: data.barberId || null,
    date: data.date || null,
    time: data.time || null
}));
