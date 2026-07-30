const BUSINESS_TIMEZONE = "Europe/Istanbul";

export function istanbulNowParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: BUSINESS_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const pick = (type) => parts.find((p) => p.type === type)?.value || "00";
    return {
        date: `${pick("year")}-${pick("month")}-${pick("day")}`,
        hour: pick("hour"),
        minute: pick("minute")
    };
}

export function getIstanbulTodayYmd(now = new Date()) {
    return istanbulNowParts(now).date;
}

export function isValidYmdDateString(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
}

export function normalizeTimeHHmm(time) {
    const raw = String(time || "").trim();
    if (/^\d{2}:\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!match) return "";
    return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

export function compareYmdDates(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

export function isPastAppointmentSlot(date, time, now = new Date()) {
    if (!isValidYmdDateString(date)) return false;
    const normalizedTime = normalizeTimeHHmm(time);
    if (!normalizedTime) return false;

    const today = getIstanbulTodayYmd(now);
    const cmp = compareYmdDates(date, today);
    if (cmp < 0) return true;
    if (cmp > 0) return false;

    const [h, m] = normalizedTime.split(":").map(Number);
    const parts = istanbulNowParts(now);
    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    return h * 60 + m <= nowMinutes;
}

export function addDaysYmd(date, days) {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function validateAppointmentDate(date, now = new Date()) {
    if (!isValidYmdDateString(date)) {
        return { ok: false, code: "invalid_date" };
    }
    const today = getIstanbulTodayYmd(now);
    const maxDate = addDaysYmd(today, 90);
    if (compareYmdDates(date, today) < 0) {
        return { ok: false, code: "past_date" };
    }
    if (compareYmdDates(date, maxDate) > 0) {
        return { ok: false, code: "date_out_of_range" };
    }
    return { ok: true };
}

export function buildSlotKey(businessId, date, time, barberId = businessId) {
    return `${businessId}|${barberId}|${date}|${normalizeTimeHHmm(time)}`;
}

export { BUSINESS_TIMEZONE };
