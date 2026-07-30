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

async function loadBlockedState(db, barberSlug, date, slots) {
    const blocked = new Set();
    let dayClosed = false;

    const snap = await db
        .collection("berberler")
        .doc(barberSlug)
        .collection("blockedSlots")
        .where("date", "==", date)
        .get();

    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.time === "ALL") {
            dayClosed = true;
            slots.forEach((t) => blocked.add(t));
        } else if (data.time) {
            blocked.add(data.time);
        }
    });

    if (!dayClosed) {
        const allRef = db
            .collection("berberler")
            .doc(barberSlug)
            .collection("blockedSlots")
            .doc(blockedSlotId(date, "ALL"));
        const allSnap = await allRef.get();
        if (allSnap.exists) {
            dayClosed = true;
            slots.forEach((t) => blocked.add(t));
        }
    }

    return { blocked, dayClosed };
}

async function isLegacySlotTaken(db, barberSlug, date, time) {
    const legacySnap = await db
        .collection("berberler")
        .doc(barberSlug)
        .collection("appointments")
        .doc(date)
        .get();

    if (!legacySnap.exists) return false;

    const data = legacySnap.data();
    if (data.ALL === "BLOCKED") return true;

    for (const [key, value] of Object.entries(data)) {
        if (key === "ALL") continue;
        const slotTime = /^(\d{2}:\d{2})/.exec(key)?.[1];
        if (slotTime === time && typeof value === "string" && value.trim()) {
            return true;
        }
    }
    return false;
}

async function loadBusySlots(db, barberSlug, date, slots) {
    const busy = new Set();

    const appointmentsSnap = await db
        .collection("appointments")
        .where("barberId", "==", barberSlug)
        .where("date", "==", date)
        .get();

    for (const docSnap of appointmentsSnap.docs) {
        const appt = docSnap.data();
        if (appt.time && isActiveAppointmentStatus(appt.status)) {
            busy.add(appt.time);
        }
    }

    for (const time of slots) {
        if (await isLegacySlotTaken(db, barberSlug, date, time)) {
            busy.add(time);
        }
    }

    return busy;
}

function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function todayYmd() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function validateAvailabilityDate(date) {
    if (!isValidDateString(date)) {
        return { ok: false, code: "invalid_date" };
    }
    const today = todayYmd();
    const maxDate = addDays(today, 90);
    if (date < today) {
        return { ok: false, code: "past_date" };
    }
    if (date > maxDate) {
        return { ok: false, code: "date_out_of_range" };
    }
    return { ok: true };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function computePublicAvailability(db, { businessSlug, date }) {
    const publicSnap = await db.collection("publicBarbers").doc(businessSlug).get();
    if (!publicSnap.exists) {
        return { ok: false, code: "shop_not_found" };
    }

    const publicBarber = publicSnap.data();
    if (publicBarber.status === "passive") {
        return { ok: false, code: "shop_passive" };
    }
    if (publicBarber.bookingOpen !== true) {
        return { ok: false, code: "booking_closed" };
    }

    const { openHour, closeHour } = getWorkingHours(publicBarber);
    const slots = generateHourlySlots(openHour, closeHour);
    const { blocked, dayClosed } = await loadBlockedState(db, businessSlug, date, slots);
    const busy = dayClosed ? new Set() : await loadBusySlots(db, businessSlug, date, slots);

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

    return {
        ok: true,
        payload: {
            date,
            timezone: "Europe/Istanbul",
            workingHours: { openHour, closeHour },
            isClosed: dayClosed,
            availableSlots,
            busySlots,
            blockedSlots
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
