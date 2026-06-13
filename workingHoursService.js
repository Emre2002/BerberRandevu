/**
 * Çalışma saatleri — ortak slot üretimi ve doğrulama.
 * openHour / closeHour standart alanları kullanılır (1 saatlik slotlar).
 */

export const SLOT_DURATION_MINUTES = 60;

/** Berber admin select seçenekleri */
export const HOUR_SELECT_OPTIONS = [
    "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
    "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
    "19:00", "20:00", "21:00", "22:00", "23:00", "00:00"
];

export const DEFAULT_OPEN_HOUR = "09:00";
export const DEFAULT_CLOSE_HOUR = "21:00";

/**
 * Firestore berber dokümanından standart çalışma saatlerini okur.
 * Eski openingHour / closingHour alanlarıyla uyumludur.
 * @param {{ warnMissing?: boolean }} opts
 */
export function getBarberWorkingHours(barber, { warnMissing = false } = {}) {
    const hasOpen = barber?.openHour || barber?.openingHour;
    const hasClose = barber?.closeHour || barber?.closingHour;

    if (warnMissing && (!hasOpen || !hasClose)) {
        console.warn("openHour/closeHour bulunamadı, varsayılan çalışma saatleri kullanıldı.");
    }

    return {
        openHour: hasOpen || DEFAULT_OPEN_HOUR,
        closeHour: hasClose || DEFAULT_CLOSE_HOUR
    };
}

/**
 * "HH:MM" → gün başından dakika.
 * @returns {number|null}
 */
export function timeToMinutes(time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes) {
    const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 1 saatlik slot başlangıç saatlerini üretir.
 * closeHour başlangıç slotu olarak dahil edilmez (ör. 21:00 kapanış → son slot 20:00).
 *
 * @returns {string[]} ["09:00", "10:00", ...]
 */
export function generateHourlySlots(openHour, closeHour) {
    const open = timeToMinutes(openHour);
    const close = timeToMinutes(closeHour);
    if (open === null || close === null) return [];
    if (close <= open) return [];

    const slots = [];
    for (let t = open; t + SLOT_DURATION_MINUTES <= close; t += SLOT_DURATION_MINUTES) {
        slots.push(minutesToTime(t));
    }
    return slots;
}

/**
 * Görsel aralık formatı: ["09:00-10:00", "10:00-11:00", ...]
 */
export function generateHourlySlotRanges(openHour, closeHour) {
    return generateHourlySlots(openHour, closeHour).map((start) => {
        const end = minutesToTime(timeToMinutes(start) + SLOT_DURATION_MINUTES);
        return `${start}-${end}`;
    });
}

/**
 * @returns {string|null} Hata mesajı veya null (geçerli).
 */
export function validateWorkingHours(openHour, closeHour) {
    const open = timeToMinutes(openHour);
    const close = timeToMinutes(closeHour);
    if (open === null || close === null) return "Geçerli saat seçin.";
    if (close <= open) return "Kapanış saati açılış saatinden sonra olmalıdır.";
    return null;
}

export function isWithinWorkingHours(slotStart, openHour, closeHour) {
    return generateHourlySlots(openHour, closeHour).includes(slotStart);
}

/**
 * Mevcut slot listesini çalışma saatlerine göre süzer (geriye dönük uyumluluk).
 */
export function filterSlotsByWorkingHours(
    slots,
    openHour,
    closeHour,
    slotDuration = SLOT_DURATION_MINUTES
) {
    if (!Array.isArray(slots)) return [];
    const allowed = new Set(generateHourlySlots(openHour, closeHour));
    if (!allowed.size) return [...slots];

    return slots.filter((slot) => {
        if (allowed.has(slot)) return true;
        const start = timeToMinutes(slot);
        if (start === null) return false;
        const open = timeToMinutes(openHour);
        let close = timeToMinutes(closeHour);
        if (open === null || close === null) return true;
        if (close <= open) close += 24 * 60;
        const end = start + slotDuration;
        return start >= open && end <= close;
    });
}

export function sortSlotTimes(times) {
    return [...times].sort((a, b) => {
        const am = timeToMinutes(a);
        const bm = timeToMinutes(b);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return am - bm;
    });
}
