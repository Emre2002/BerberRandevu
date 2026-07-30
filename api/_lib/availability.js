import { validateAppointmentDate, normalizeTimeHHmm } from "./appointment-datetime.js";

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled", "canceled", "iptal", "deleted", "pasif", "inactive"
]);

function timeToMinutes(time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
    const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function generateHourlySlots(openHour, closeHour) {
    const open = timeToMinutes(openHour);
    const close = timeToMinutes(closeHour);
    if (open === null || close === null || close <= open) return [];
    const slots = [];
    for (let t = open; t + 60 <= close; t += 60) {
        slots.push(minutesToTime(t));
    }
    return slots;
}

function getWorkingHours(barber) {
    return {
        openHour: barber?.openHour || barber?.openingHour || "09:00",
        closeHour: barber?.closeHour || barber?.closingHour || "21:00"
    };
}

function blockedSlotId(date, time) {
    return `${date}_${time}`;
}

function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

export function buildOccupiedIntervalsFromHourlyTimes(times) {
    const normalized = [...new Set(
        (times || [])
            .map((time) => normalizeTimeHHmm(time))
            .filter(Boolean)
    )].sort();

    return normalized.map((start) => {
        const startMinutes = timeToMinutes(start);
        return {
            start,
            end: minutesToTime(startMinutes + 60)
        };
    });
}

async function loadBlockedState(db, barberSlug, date, slots) {
    const blocked = new Set();
    let dayClosed = false;

    const [snap, allSnap] = await Promise.all([
        db.collection("berberler")
            .doc(barberSlug)
            .collection("blockedSlots")
            .where("date", "==", date)
            .get(),
        db.collection("berberler")
            .doc(barberSlug)
            .collection("blockedSlots")
            .doc(blockedSlotId(date, "ALL"))
            .get()
    ]);

    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.time === "ALL") {
            dayClosed = true;
            slots.forEach((t) => blocked.add(t));
        } else if (data.time) {
            blocked.add(normalizeTimeHHmm(data.time));
        }
    });

    if (!dayClosed && allSnap.exists) {
        dayClosed = true;
        slots.forEach((t) => blocked.add(t));
    }

    return { blocked, dayClosed };
}

function parseLegacyDayBusyTimes(legacyData, slots) {
    const busy = new Set();
    if (!legacyData) return busy;

    if (legacyData.ALL === "BLOCKED") {
        return busy;
    }

    const slotSet = new Set(slots);
    for (const [key, value] of Object.entries(legacyData)) {
        if (key === "ALL") continue;
        const slotTime = normalizeTimeHHmm(/^(\d{1,2}:\d{2})/.exec(key)?.[1] || key);
        if (!slotTime || !slotSet.has(slotTime)) continue;
        if (typeof value === "string" && value.trim()) {
            busy.add(slotTime);
        }
    }

    return busy;
}

async function loadLegacyDayDoc(db, barberSlug, date) {
    const legacySnap = await db
        .collection("berberler")
        .doc(barberSlug)
        .collection("appointments")
        .doc(date)
        .get();
    return legacySnap.exists ? legacySnap.data() : null;
}

async function loadBusySlots(db, barberSlug, date, slots) {
    const busy = new Set();

    const [appointmentsSnap, legacyData] = await Promise.all([
        db.collection("appointments")
            .where("barberId", "==", barberSlug)
            .where("date", "==", date)
            .get(),
        loadLegacyDayDoc(db, barberSlug, date)
    ]);

    for (const docSnap of appointmentsSnap.docs) {
        const appt = docSnap.data();
        const slotTime = normalizeTimeHHmm(appt.time);
        if (slotTime && isActiveAppointmentStatus(appt.status)) {
            busy.add(slotTime);
        }
    }

    for (const slotTime of parseLegacyDayBusyTimes(legacyData, slots)) {
        busy.add(slotTime);
    }

    return busy;
}

export function validateAvailabilityDate(date) {
    return validateAppointmentDate(date);
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function computePublicAvailability(db, { businessSlug, date, requestId = null }) {
    const startedAt = Date.now();
    let publicBarberMs = 0;
    let parallelMs = 0;

    const publicSnap = await db.collection("publicBarbers").doc(businessSlug).get();
    publicBarberMs = Date.now() - startedAt;

    if (!publicSnap.exists) {
        return { ok: false, code: "shop_not_found", requestId, timings: { publicBarberMs, totalMs: publicBarberMs } };
    }

    const publicBarber = publicSnap.data();
    if (publicBarber.status === "passive") {
        return { ok: false, code: "shop_passive", requestId, timings: { publicBarberMs, totalMs: publicBarberMs } };
    }
    if (publicBarber.bookingOpen !== true) {
        return { ok: false, code: "booking_closed", requestId, timings: { publicBarberMs, totalMs: publicBarberMs } };
    }

    const { openHour, closeHour } = getWorkingHours(publicBarber);
    const slots = generateHourlySlots(openHour, closeHour);

    const parallelStarted = Date.now();
    const [{ blocked, dayClosed }, busy] = await Promise.all([
        loadBlockedState(db, businessSlug, date, slots),
        loadBusySlots(db, businessSlug, date, slots)
    ]);
    parallelMs = Date.now() - parallelStarted;

    const availableSlots = [];
    const busySlots = [];
    const blockedSlots = [];

    for (const time of slots) {
        if (dayClosed || blocked.has(time)) {
            blockedSlots.push(time);
        } else if (busy.has(time)) {
            busySlots.push(time);
        } else {
            availableSlots.push(time);
        }
    }

    const occupiedIntervals = buildOccupiedIntervalsFromHourlyTimes(busySlots);
    const generatedAt = new Date().toISOString();
    const totalMs = Date.now() - startedAt;

    return {
        ok: true,
        requestId,
        timings: { publicBarberMs, parallelMs, totalMs },
        payload: {
            ok: true,
            businessId: businessSlug,
            barberId: businessSlug,
            date,
            timezone: "Europe/Istanbul",
            workingHours: { openHour, closeHour },
            isClosed: dayClosed,
            availableSlots,
            busySlots,
            blockedSlots,
            occupiedIntervals,
            generatedAt,
            requestId
        }
    };
}

export async function hasActivePhoneAppointmentOnDay(db, { businessSlug, date, phoneNorm }) {
    if (!phoneNorm) return false;

    const appointmentsSnap = await db
        .collection("appointments")
        .where("barberId", "==", businessSlug)
        .where("date", "==", date)
        .get();

    for (const docSnap of appointmentsSnap.docs) {
        const appt = docSnap.data();
        if (!isActiveAppointmentStatus(appt.status)) continue;
        const digits = String(appt.phone || "").replace(/\D/g, "");
        let normalized = digits;
        if (normalized.startsWith("90") && normalized.length === 12) normalized = normalized.slice(2);
        if (normalized.startsWith("0")) normalized = normalized.slice(1);
        if (normalized === phoneNorm) return true;
    }

    return false;
}

export { parseLegacyDayBusyTimes, loadLegacyDayDoc };
