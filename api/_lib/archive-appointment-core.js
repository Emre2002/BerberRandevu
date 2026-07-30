import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

const ARCHIVE_COLLECTION = "deletedAppointments";
const ARCHIVE_DAYS = 7;

function slotLockId(businessId, date, time) {
    return `${businessId}__${date}__${time}`;
}

function normalizeTimeKey(key) {
    if (!key || key === "ALL") return null;
    if (/^\d{2}:\d{2}$/.test(key)) return key;
    const match = key.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : null;
}

function buildDeleteExpireAt(deletedAt) {
    const expire = deletedAt.toDate();
    expire.setDate(expire.getDate() + ARCHIVE_DAYS);
    return Timestamp.fromDate(expire);
}

export function parseLegacyAppointmentId(appointmentId) {
    const match = /^legacy-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/.exec(String(appointmentId || "").trim());
    if (!match) return null;
    return { date: match[1], time: match[2] };
}

/**
 * Server-derived archive document ID for idempotent concurrent archive requests.
 * @param {string} businessId
 * @param {string} appointmentId
 */
export function buildDeterministicArchiveId(businessId, appointmentId) {
    return crypto
        .createHash("sha256")
        .update(`deletedAppointment:${String(businessId).trim()}:${String(appointmentId).trim()}`)
        .digest("hex")
        .slice(0, 40);
}

function buildArchivePayload({
    appointment,
    businessId,
    appointmentId,
    archivedByUid,
    deletedBy,
    deletedByMode,
    archiveReason
}) {
    const deletedAt = Timestamp.now();
    const payload = {
        barberSlug: businessId,
        customerName: String(appointment.customerName || "").slice(0, 200),
        customerPhone: String(appointment.phone || appointment.customerPhone || "").slice(0, 32),
        appointmentDate: String(appointment.date || appointment.appointmentDate || "").slice(0, 10),
        appointmentTime: String(appointment.time || appointment.appointmentTime || "").slice(0, 5),
        serviceName: String(appointment.service || appointment.serviceName || "").slice(0, 200),
        note: String(appointment.musteriNotu || appointment.note || "").slice(0, 500),
        originalAppointmentId: appointmentId,
        deletedAt,
        deleteExpireAt: buildDeleteExpireAt(deletedAt),
        deletedBy: String(deletedBy || "owner").slice(0, 64),
        deletedByMode: String(deletedByMode || "adminPanel").slice(0, 32)
    };

    if (archivedByUid) payload.archivedByUid = archivedByUid;
    if (archiveReason) payload.archiveReason = String(archiveReason).slice(0, 200);

    return payload;
}

async function findExistingArchives(db, businessId, appointmentId) {
    const snap = await db
        .collection(ARCHIVE_COLLECTION)
        .where("barberSlug", "==", businessId)
        .where("originalAppointmentId", "==", appointmentId)
        .limit(5)
        .get();
    return snap.docs;
}

function assertArchiveTenantMatch(existingArchives, businessId) {
    for (const doc of existingArchives) {
        if (doc.data()?.barberSlug !== businessId) {
            const err = new Error("archive_conflict");
            err.code = "archive_conflict";
            throw err;
        }
    }
}

function resolveArchiveDocId(businessId, appointmentId, existingArchives) {
    const deterministicArchiveId = buildDeterministicArchiveId(businessId, appointmentId);
    const legacyAutoArchive = existingArchives.find((doc) => doc.id !== deterministicArchiveId) || null;
    return {
        deterministicArchiveId,
        archiveDocId: legacyAutoArchive?.id || deterministicArchiveId
    };
}

async function releaseSlotLock(tx, lockRef, appointmentId) {
    if (!lockRef) return;
    const lockSnap = await tx.get(lockRef);
    if (!lockSnap.exists) return;
    if (lockSnap.data()?.appointmentId === appointmentId) {
        tx.delete(lockRef);
    }
}

function buildArchiveSuccess(appointmentId, archiveId, { idempotent = false, reconciled = false } = {}) {
    return {
        ok: true,
        appointmentId,
        state: "archived",
        archiveId,
        ...(idempotent ? { idempotent: true } : {}),
        ...(reconciled ? { reconciled: true } : {})
    };
}

async function archiveLegacyAppointment(db, input) {
    const {
        businessId,
        appointmentId,
        legacy,
        archivedByUid,
        deletedBy,
        deletedByMode,
        archiveReason,
        existingArchives
    } = input;

    const { deterministicArchiveId, archiveDocId } = resolveArchiveDocId(
        businessId,
        appointmentId,
        existingArchives
    );
    const archiveRef = db.collection(ARCHIVE_COLLECTION).doc(archiveDocId);
    const legacyRef = db.collection("berberler").doc(businessId).collection("appointments").doc(legacy.date);

    return db.runTransaction(async (tx) => {
        const archiveSnap = await tx.get(archiveRef);
        const legacySnap = await tx.get(legacyRef);

        if (archiveSnap.exists) {
            if (archiveSnap.data()?.barberSlug !== businessId) {
                const err = new Error("archive_conflict");
                err.code = "archive_conflict";
                throw err;
            }

            let reconciled = false;
            if (legacySnap.exists) {
                const data = { ...legacySnap.data() };
                let changed = false;
                for (const key of Object.keys(data)) {
                    if (normalizeTimeKey(key) === legacy.time) {
                        delete data[key];
                        changed = true;
                    }
                }
                if (changed) {
                    tx.set(legacyRef, data);
                    reconciled = true;
                }
            }

            return buildArchiveSuccess(appointmentId, archiveDocId, {
                idempotent: !reconciled,
                reconciled
            });
        }

        if (!legacySnap.exists) {
            const err = new Error("appointment_not_found");
            err.code = "appointment_not_found";
            throw err;
        }

        const legacyData = legacySnap.data() || {};
        let customerName = "";
        let slotPresent = false;

        for (const [key, value] of Object.entries(legacyData)) {
            if (normalizeTimeKey(key) !== legacy.time) continue;
            slotPresent = true;
            if (typeof value === "string" && value.trim()) {
                customerName = value.trim();
            }
            break;
        }

        if (!slotPresent) {
            const err = new Error("appointment_not_found");
            err.code = "appointment_not_found";
            throw err;
        }

        const writeRef = db.collection(ARCHIVE_COLLECTION).doc(deterministicArchiveId);
        const archivePayload = buildArchivePayload({
            appointment: {
                customerName,
                phone: "—",
                service: "—",
                date: legacy.date,
                time: legacy.time
            },
            businessId,
            appointmentId,
            archivedByUid,
            deletedBy,
            deletedByMode,
            archiveReason
        });

        const data = { ...legacyData };
        for (const key of Object.keys(data)) {
            if (normalizeTimeKey(key) === legacy.time) {
                delete data[key];
            }
        }

        tx.set(writeRef, archivePayload);
        tx.set(legacyRef, data);

        return buildArchiveSuccess(appointmentId, deterministicArchiveId);
    });
}

/**
 * Atomically archive and remove an owner appointment.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {object} input
 */
export async function archiveOwnerAppointment(db, input) {
    const businessId = String(input.businessId || "").trim();
    const appointmentId = String(input.appointmentId || "").trim();
    const archivedByUid = String(input.archivedByUid || "").trim();

    if (!businessId || !appointmentId) {
        const err = new Error("invalid_request");
        err.code = "invalid_request";
        throw err;
    }

    const existingArchives = await findExistingArchives(db, businessId, appointmentId);
    assertArchiveTenantMatch(existingArchives, businessId);

    const legacy = parseLegacyAppointmentId(appointmentId);
    if (legacy) {
        return archiveLegacyAppointment(db, {
            businessId,
            appointmentId,
            legacy,
            archivedByUid,
            deletedBy: input.deletedBy,
            deletedByMode: input.deletedByMode,
            archiveReason: input.archiveReason,
            existingArchives
        });
    }

    const { deterministicArchiveId, archiveDocId } = resolveArchiveDocId(
        businessId,
        appointmentId,
        existingArchives
    );
    const archiveRef = db.collection(ARCHIVE_COLLECTION).doc(archiveDocId);
    const appointmentRef = db.collection("appointments").doc(appointmentId);

    return db.runTransaction(async (tx) => {
        const archiveSnap = await tx.get(archiveRef);
        const appointmentSnap = await tx.get(appointmentRef);

        if (archiveSnap.exists) {
            if (archiveSnap.data()?.barberSlug !== businessId) {
                const err = new Error("archive_conflict");
                err.code = "archive_conflict";
                throw err;
            }

            let reconciled = false;
            if (appointmentSnap.exists) {
                const appointment = appointmentSnap.data() || {};
                if (appointment.barberId !== businessId) {
                    const err = new Error("forbidden");
                    err.code = "forbidden";
                    throw err;
                }

                const date = String(appointment.date || "").trim();
                const time = String(appointment.time || "").trim();
                const lockRef = date && time
                    ? db.collection("appointmentSlotLocks").doc(slotLockId(businessId, date, time))
                    : null;

                tx.delete(appointmentRef);
                await releaseSlotLock(tx, lockRef, appointmentId);
                reconciled = true;
            }

            return buildArchiveSuccess(appointmentId, archiveDocId, {
                idempotent: !reconciled,
                reconciled
            });
        }

        if (!appointmentSnap.exists) {
            const err = new Error("appointment_not_found");
            err.code = "appointment_not_found";
            throw err;
        }

        const appointment = appointmentSnap.data() || {};
        if (appointment.barberId !== businessId) {
            const err = new Error("forbidden");
            err.code = "forbidden";
            throw err;
        }

        const date = String(appointment.date || "").trim();
        const time = String(appointment.time || "").trim();
        const lockRef = date && time
            ? db.collection("appointmentSlotLocks").doc(slotLockId(businessId, date, time))
            : null;

        const writeRef = db.collection(ARCHIVE_COLLECTION).doc(deterministicArchiveId);
        const archivePayload = buildArchivePayload({
            appointment,
            businessId,
            appointmentId,
            archivedByUid,
            deletedBy: input.deletedBy,
            deletedByMode: input.deletedByMode,
            archiveReason: input.archiveReason
        });

        tx.set(writeRef, archivePayload);
        tx.delete(appointmentRef);
        await releaseSlotLock(tx, lockRef, appointmentId);

        return buildArchiveSuccess(appointmentId, deterministicArchiveId);
    });
}

export function mapArchiveErrorToHttp(err) {
    const code = err?.code || "internal_error";
    const map = {
        invalid_request: { status: 400, body: { ok: false, code: "invalid_request" } },
        unauthenticated: { status: 401, body: { ok: false, code: "unauthenticated" } },
        forbidden: { status: 403, body: { ok: false, code: "forbidden" } },
        appointment_not_found: { status: 404, body: { ok: false, code: "appointment_not_found" } },
        archive_conflict: { status: 409, body: { ok: false, code: "archive_conflict" } }
    };
    return map[code] || { status: 500, body: { ok: false, code: "internal_error" } };
}
