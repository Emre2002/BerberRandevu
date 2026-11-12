import { activateSubscriptionCodeViaApi } from "./activationCodeService.js";
import {
    CUSTOMER_GRACE_DAYS,
    isCustomerBookingAllowed,
    calculatePublicBookingOpen,
    getCustomerBlockMessage
} from "./publicBookingAccess.js";

export { CUSTOMER_GRACE_DAYS, isCustomerBookingAllowed, calculatePublicBookingOpen, getCustomerBlockMessage };
export { extendSubscriptionEndDate, PACKAGE_TYPES } from "./subscriptionTerms.js";

export const ADMIN_GRACE_DAYS = 7;

/** Firestore Timestamp, Date veya "YYYY-MM-DD" string → Date (gün sonu). */
export function toEndOfDay(value) {
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

/** Bugünün başlangıcı (yerel). */
export function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Abonelik bitişinden bu yana geçen tam gün sayısı. Aktifken -1 döner. */
export function daysAfterSubscriptionEnd(barber) {
    const end = toEndOfDay(barber?.subscriptionEndDate);
    if (!end) return -1;
    const now = new Date();
    if (now <= end) return -1;
    const start = startOfToday();
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    return Math.floor((start - endDay) / 86400000);
}

/** Bitiş tarihine kalan gün (negatif = süresi geçmiş). */
export function calculateRemainingDays(subscriptionEndDate) {
    const end = toEndOfDay(subscriptionEndDate);
    if (!end) return null;
    const today = startOfToday();
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    return Math.ceil((endDay - today) / 86400000);
}

/** dd.MM.yyyy formatında tarih metni. */
export function formatDateTR(value) {
    const end = toEndOfDay(value);
    if (!end) return "—";
    return end.toLocaleDateString("tr-TR", {
        day: "2-digit", month: "2-digit", year: "numeric"
    });
}

/** Bitiş tarihine göre subscriptionStatus türetir. */
export function deriveSubscriptionStatusFromEndDate(endDate) {
    const remaining = calculateRemainingDays(endDate);
    if (remaining === null) return "expired";
    return remaining >= 0 ? "active" : "expired";
}

/** Yeni onaylanan dükkanlar için 1 günlük deneme bitiş tarihi (bugün + 1 gün). */
export function getInitialTrialEndDate() {
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, "0");
    const d = String(end.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** Son 7 gün uyarı modalı gösterilmeli mi? (aktif abonelik, henüz bitmemiş) */
export function isSubscriptionWarningDue(barber) {
    if (!barber) return false;
    const remaining = calculateRemainingDays(barber.subscriptionEndDate);
    if (remaining === null) return false;
    return remaining >= 0 && remaining <= 7;
}

export function getSubscriptionWarningStorageKey(barberSlug, subscriptionEndDate) {
    const end = subscriptionEndDate ? String(subscriptionEndDate).slice(0, 10) : "";
    return `subscriptionWarningHidden_${barberSlug}_${end}`;
}

export function isSubscriptionWarningDismissed(barberSlug, subscriptionEndDate) {
    try {
        return localStorage.getItem(
            getSubscriptionWarningStorageKey(barberSlug, subscriptionEndDate)
        ) === "1";
    } catch {
        return false;
    }
}

export function dismissSubscriptionWarning(barberSlug, subscriptionEndDate) {
    try {
        localStorage.setItem(
            getSubscriptionWarningStorageKey(barberSlug, subscriptionEndDate),
            "1"
        );
    } catch { /* private mode */ }
}

/** Berber abonelik durumu özeti. */
export function getSubscriptionState(barber) {
    if (!barber) {
        return {
            status: "expired",
            remainingDays: null,
            daysAfterEnd: null,
            endDateFormatted: "—",
            tone: "expired",
            label: "Bilinmiyor"
        };
    }

    const remaining = calculateRemainingDays(barber.subscriptionEndDate);
    const daysAfter = daysAfterSubscriptionEnd(barber);
    const end = toEndOfDay(barber.subscriptionEndDate);

    let status = "active";
    if (daysAfter < 0) {
        status = "active";
    } else if (daysAfter <= CUSTOMER_GRACE_DAYS) {
        status = "active";
    } else if (daysAfter <= ADMIN_GRACE_DAYS) {
        status = "grace_customer_closed";
    } else {
        status = "grace_admin_limited";
    }

    if (barber.subscriptionStatus === "expired" && daysAfter > ADMIN_GRACE_DAYS) {
        status = "expired";
    }

    let tone = "green";
    let label = "Aktif";
    if (remaining !== null) {
        if (remaining < 0) {
            if (daysAfter <= CUSTOMER_GRACE_DAYS) {
                tone = "red";
                label = "Süresi doldu (müşteri grace)";
            } else if (daysAfter <= ADMIN_GRACE_DAYS) {
                tone = "darkred";
                label = "Müşteri kapalı";
            } else {
                tone = "locked";
                label = "Takvim kilitli";
            }
        } else if (remaining <= 7) {
            tone = "red";
            label = "Kritik";
        } else if (remaining <= 30) {
            tone = "orange";
            label = "Yaklaşıyor";
        } else {
            tone = "green";
            label = "Aktif";
        }
    }

    const endDateFormatted = formatDateTR(barber.subscriptionEndDate);

    return {
        status,
        remainingDays: remaining,
        daysAfterEnd: daysAfter < 0 ? 0 : daysAfter,
        endDateFormatted,
        tone,
        label
    };
}

/** Berber admin takvimi açık mı? (bitiş + 7 gün grace) */
export function isAdminCalendarAllowed(barber) {
    if (!barber) return false;
    const daysAfter = daysAfterSubscriptionEnd(barber);
    if (daysAfter < 0) return true;
    return daysAfter <= ADMIN_GRACE_DAYS;
}

export function getAdminCalendarLockMessage() {
    return "Abonelik süreniz dolduğu için randevu takvimi kapatıldı. Sistemi kullanmaya devam etmek için Shopier'den aktivasyon kodu satın alıp Abonelik sekmesinden etkinleştirin.";
}

export const SHOPIER_URL = "https://www.shopier.com/BerberRandevu";

export { activateSubscriptionCodeViaApi as activateSubscriptionCode };
