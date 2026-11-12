export const PACKAGE_TYPES = {
    monthly: { label: "Aylık", durationDays: 30, prefix: "AYLIK" },
    quarterly: { label: "3 Aylık", durationDays: 90, prefix: "3AY" },
    yearly: { label: "Yıllık", durationDays: 365, prefix: "YIL" }
};

const istanbulDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
});

function subscriptionDay(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    const date = typeof value?.toDate === "function" ? value.toDate() : value;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(istanbulDate.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

/** Aktif abonelik mevcut bitişten, bitmiş abonelik İstanbul'da bugünden uzatılır. */
export function extendSubscriptionEndDate(currentEndDate, durationDays, now = new Date()) {
    const today = Date.parse(subscriptionDay(now));
    const currentEnd = Date.parse(subscriptionDay(currentEndDate));
    const isActive = currentEnd >= today;
    const end = new Date(isActive ? currentEnd : today);
    end.setUTCDate(end.getUTCDate() + durationDays - (isActive ? 0 : 1));
    if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999) return null;
    return end.toISOString().slice(0, 10);
}
