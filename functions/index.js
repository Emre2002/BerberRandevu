const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const rateLimit = require("./lib/rateLimit");

initializeApp();
const db = getFirestore();

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled",
    "canceled",
    "iptal",
    "deleted",
    "pasif",
    "inactive"
]);

const DEFAULT_BARBER_SERVICES = [
    "Saç Kesimi & Yıkama",
    "Sakal Tıraşı (Klasik)",
    "Saç-Sakal Kesimi"
];

const USER_MESSAGES = {
    invalid_request: "Randevu oluşturulamadı. Lütfen bilgileri kontrol edip tekrar deneyin.",
    invalid_phone: "Geçerli bir Türk cep telefonu numarası girin.",
    invalid_service: "Seçilen hizmet bu işletme için geçerli değil.",
    invalid_slot: "Seçilen saat geçerli değil.",
    shop_not_found: "İşletme bulunamadı.",
    shop_passive: "Bu işletme geçici olarak hizmet vermemektedir.",
    booking_closed: "Bu işletmenin online randevu sistemi geçici olarak kapalıdır.",
    slot_taken: "Seçilen saat artık uygun değil.",
    slot_blocked: "Seçilen saat kapalıdır.",
    day_closed: "Berberimiz bu gün izinlidir. Lütfen başka bir gün seçiniz.",
    duplicate_phone_day: "Bu telefon numarası ile bugün için zaten bir randevu bulunmaktadır.",
    spam_detected: "Randevu oluşturulamadı. Lütfen tekrar deneyin.",
    phone_rate_limited:
        "Bu telefon numarasıyla kısa sürede çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.",
    ip_barber_rate_limited:
        "Bu bağlantı üzerinden kısa sürede çok fazla randevu oluşturuldu. Lütfen daha sonra tekrar deneyin.",
    ip_global_rate_limited: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
    rate_limit_error: "Randevu oluşturulamadı. Lütfen bir süre sonra tekrar deneyin.",
    internal: "Randevu oluşturulamadı. Lütfen tekrar deneyin."
};

function bookingError(code, message) {
    return new HttpsError("failed-precondition", message || USER_MESSAGES[code] || USER_MESSAGES.internal, {
        code
    });
}

async function rejectWithLog(code, logCtx) {
    if (logCtx) {
        await rateLimit.logRejectedAttempt(db, { ...logCtx, reason: code });
    }
    throw bookingError(code);
}

async function enforceRateLimit(fn, logCtx) {
    try {
        await fn();
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        const code = err?.code;
        if (code && USER_MESSAGES[code]) {
            await rejectWithLog(code, logCtx);
        }
        console.error("[rateLimit]", err);
        throw bookingError("rate_limit_error");
    }
}

function normalizePhone(phone) {
    if (!phone || phone === "—") return "";
    let digits = String(phone).replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

function isValidTurkishPhone(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (/^(0?5\d{9})$/.test(digits)) return true;
    if (/^(90)(5\d{9})$/.test(digits)) return true;
    return false;
}

function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

function cleanDisplayName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
}

function toYmd(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return null;
}

function minYmd(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
}

function maxYmd(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
}

function pickDisplayName(variants, fallback = "") {
    let best = fallback;
    let bestCount = -1;
    for (const [name, count] of Object.entries(variants || {})) {
        if (count > bestCount) {
            best = name;
            bestCount = count;
        }
    }
    return best || fallback;
}

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

function generateHourlySlots(openHour, closeHour) {
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

function getAllowedServices(barber) {
    const raw = barber?.selectedServices;
    if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((s) => typeof s === "string" && s.trim());
    }
    return [...DEFAULT_BARBER_SERVICES];
}

function blockedSlotId(date, time) {
    return `${date}_${time}`;
}

async function loadBlockedState(barberSlug, date, slots) {
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

async function isLegacySlotTaken(barberSlug, date, time) {
    const legacyRef = db.collection("berberler").doc(barberSlug).collection("appointments").doc(date);
    const legacySnap = await legacyRef.get();
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

async function upsertCustomerOnAppointment({ barberSlug, customerName, phone, appointmentDate }) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;

    const customerId = `${barberSlug}_${normalized}`;
    const ref = db.collection("customers").doc(customerId);
    const snap = await ref.get();
    const variantName = cleanDisplayName(customerName);
    const apptDate = toYmd(appointmentDate);

    if (snap.exists) {
        const data = snap.data();
        const variants = { ...(data.nameVariants || {}) };

        if (!Object.keys(variants).length) {
            const legacy = cleanDisplayName(data.displayName || data.fullName || data.customerName);
            if (legacy) variants[legacy] = data.totalVisits ?? data.totalAppointments ?? 1;
        }
        if (variantName) variants[variantName] = (variants[variantName] || 0) + 1;

        const displayName = pickDisplayName(variants, variantName || data.displayName || "");
        const firstVisit = minYmd(toYmd(data.firstVisit), apptDate) || apptDate || null;
        const lastVisit = maxYmd(toYmd(data.lastVisit), apptDate) || apptDate || null;

        const payload = {
            displayName,
            fullName: displayName,
            customerName: displayName,
            phone: normalized,
            nameVariants: variants,
            lastAppointmentDate: appointmentDate,
            totalAppointments: FieldValue.increment(1),
            totalVisits: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        };
        if (firstVisit) payload.firstVisit = firstVisit;
        if (lastVisit) payload.lastVisit = lastVisit;

        await ref.update(payload);
    } else {
        const variants = variantName ? { [variantName]: 1 } : {};
        await ref.set({
            barberSlug,
            displayName: variantName,
            fullName: variantName,
            customerName: variantName,
            phone: normalized,
            nameVariants: variants,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            firstVisit: apptDate || null,
            lastVisit: apptDate || null,
            totalAppointments: 1,
            totalVisits: 1,
            lastAppointmentDate: appointmentDate
        });
    }

    return customerId;
}

async function createNotification({ barberSlug, customerName, phone, date, time }) {
    await db.collection("notifications").add({
        type: "newAppointment",
        barberSlug,
        customerName,
        phone: phone || "—",
        date,
        time,
        read: false,
        createdAt: FieldValue.serverTimestamp()
    });
}

function buildTelegramAppointmentMessage({ customerName, phone, date, time, barberName }) {
    return `🔔 Yeni Randevu\n\nBerber: ${barberName || "—"}\nMüşteri: ${customerName}\nTelefon: ${phone}\nTarih: ${date}\nSaat: ${time}`;
}

async function maybeSendTelegram({ barberSlug, customerName, phone, date, time }) {
    try {
        const barberSnap = await db.collection("berberler").doc(barberSlug).get();
        const chatId = barberSnap.exists ? barberSnap.data()?.telegramChatId : null;
        if (!chatId) return;

        const barberName = barberSnap.data()?.name || barberSlug;
        const text = buildTelegramAppointmentMessage({ customerName, phone, date, time, barberName });
        const token = process.env.TELEGRAM_BOT_TOKEN;

        if (!token) {
            console.info("[Telegram Mock]", { chatId, text });
            return;
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
        });
    } catch (err) {
        console.warn("[Telegram]", err.message);
    }
}

exports.createAppointment = onCall({ cors: true }, async (request) => {
    rateLimit.logAppCheckMonitor(request);

    const data = request.data || {};
    const barberSlug = String(data.barberSlug || "").trim();
    const customerName = cleanDisplayName(data.customerName);
    const phoneRaw = String(data.phone || "").trim();
    const service = String(data.service || "").trim();
    const date = String(data.date || "").trim();
    const time = String(data.time || "").trim();
    const musteriNotu = String(data.musteriNotu || "").trim();
    const website = String(data.website || "").trim();

    const clientIp = rateLimit.extractClientIp(request);
    const ipHash = rateLimit.hashIp(clientIp);
    const hourBucket = rateLimit.getHourBucket();

    let normalizedPhone = "";
    const attemptLogBase = () => ({
        barberSlug,
        phoneNorm: normalizedPhone,
        ipHash
    });

    await enforceRateLimit(
        () => rateLimit.enforceGlobalIpLimit(db, ipHash, hourBucket),
        { barberSlug, phoneNorm: "", ipHash }
    );

    if (!barberSlug) {
        throw bookingError("invalid_request");
    }

    if (website) {
        await rejectWithLog("spam_detected", attemptLogBase());
    }

    if (customerName.length < 2 || customerName.length > 80) {
        throw bookingError("invalid_request");
    }

    if (!isValidTurkishPhone(phoneRaw)) {
        throw bookingError("invalid_phone");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw bookingError("invalid_request");
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
        throw bookingError("invalid_slot");
    }

    if (!service) {
        throw bookingError("invalid_service");
    }

    normalizedPhone = normalizePhone(phoneRaw);
    const displayPhone = phoneRaw.replace(/\s/g, "");

    await enforceRateLimit(
        () => rateLimit.enforcePhoneAttemptLimit(db, barberSlug, normalizedPhone, hourBucket),
        attemptLogBase()
    );

    const publicSnap = await db.collection("publicBarbers").doc(barberSlug).get();
    if (!publicSnap.exists) {
        throw bookingError("shop_not_found");
    }

    const publicBarber = publicSnap.data();

    if (publicBarber.status === "passive") {
        throw bookingError("shop_passive");
    }

    if (publicBarber.bookingOpen !== true) {
        throw bookingError("booking_closed");
    }

    const allowedServices = getAllowedServices(publicBarber);
    if (!allowedServices.includes(service)) {
        throw bookingError("invalid_service");
    }

    const { openHour, closeHour } = getWorkingHours(publicBarber);
    const validSlots = generateHourlySlots(openHour, closeHour);
    if (!validSlots.includes(time)) {
        throw bookingError("invalid_slot");
    }

    const { blocked, dayClosed } = await loadBlockedState(barberSlug, date, validSlots);
    if (dayClosed) {
        throw bookingError("day_closed");
    }
    if (blocked.has(time)) {
        throw bookingError("slot_blocked");
    }

    const appointmentsSnap = await db
        .collection("appointments")
        .where("barberId", "==", barberSlug)
        .where("date", "==", date)
        .get();

    for (const docSnap of appointmentsSnap.docs) {
        const appt = docSnap.data();
        if (appt.time === time && isActiveAppointmentStatus(appt.status)) {
            await rejectWithLog("slot_taken", attemptLogBase());
        }
        if (
            isActiveAppointmentStatus(appt.status) &&
            normalizePhone(appt.phone) === normalizedPhone
        ) {
            await rejectWithLog("duplicate_phone_day", attemptLogBase());
        }
    }

    if (await isLegacySlotTaken(barberSlug, date, time)) {
        await rejectWithLog("slot_taken", attemptLogBase());
    }

    await enforceRateLimit(
        () => rateLimit.checkIpBarberSuccessLimit(db, barberSlug, ipHash, hourBucket),
        attemptLogBase()
    );

    const appointmentRef = db.collection("appointments").doc();
    await appointmentRef.set({
        barberId: barberSlug,
        customerName,
        phone: displayPhone,
        service,
        date,
        time,
        status: "confirmed",
        musteriNotu: musteriNotu || ""
    });

    await upsertCustomerOnAppointment({
        barberSlug,
        customerName,
        phone: displayPhone,
        appointmentDate: date
    });

    await createNotification({
        barberSlug,
        customerName,
        phone: displayPhone,
        date,
        time
    });

    await maybeSendTelegram({
        barberSlug,
        customerName,
        phone: displayPhone,
        date,
        time
    });

    try {
        await rateLimit.incrementIpBarberSuccess(db, barberSlug, ipHash, hourBucket);
    } catch (err) {
        console.warn("[rateLimit] success counter increment failed:", err.message);
    }

    return { appointmentId: appointmentRef.id, message: "ok" };
});
