/**
 * Müşteri randevu erişimi — firestoreService ile subscriptionService arasında döngüsel import olmaması için ayrıldı.
 */

export const CUSTOMER_GRACE_DAYS = 3;

function toEndOfDay(value) {
    if (!value) return null;
    let d;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const [y, m, day] = value.slice(0, 10).split("-").map(Number);
        d = new Date(y, m - 1, day);
    } else if (typeof value?.toDate === "function") {
        d = value.toDate();
    } else if (value instanceof Date) {
        d = value;
    } else {
        return null;
    }
    if (isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
}

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysAfterSubscriptionEnd(barber) {
    const end = toEndOfDay(barber?.subscriptionEndDate);
    if (!end) return -1;
    const now = new Date();
    if (now <= end) return -1;
    const start = startOfToday();
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    return Math.floor((start - endDay) / 86400000);
}

/** Müşteri randevu sayfası açık mı? (bitiş + grace günleri) */
export function isCustomerBookingAllowed(barber) {
    if (!barber) return false;
    if (barber.status === "passive") return false;
    const daysAfter = daysAfterSubscriptionEnd(barber);
    if (daysAfter < 0) return true;
    return daysAfter <= CUSTOMER_GRACE_DAYS;
}

/** publicBarbers/{slug}.bookingOpen için merkezi hesaplama. */
export function calculatePublicBookingOpen(barberData) {
    return isCustomerBookingAllowed(barberData);
}

export function getCustomerBlockMessage() {
    return "Bu işletmenin online randevu sistemi geçici olarak kapalıdır.";
}
