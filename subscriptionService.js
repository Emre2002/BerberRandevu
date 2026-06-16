/**
 * Abonelik durumu, grace period ve kod etkinleştirme mantığı.
 * İleride activateSubscriptionCode Cloud Functions'a taşınabilir — tek modülde izole.
 */
import {
    doc, getDoc, updateDoc, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

export const CUSTOMER_GRACE_DAYS = 3;
export const ADMIN_GRACE_DAYS = 7;

export const PACKAGE_TYPES = {
    monthly: { label: "Aylık", durationDays: 30, prefix: "AYLIK" },
    quarterly: { label: "3 Aylık", durationDays: 90, prefix: "3AY" },
    yearly: { label: "Yıllık", durationDays: 365, prefix: "YIL" }
};

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

/**
 * Mevcut bitiş + süre uzatma.
 * Aktif abonelik varsa mevcut bitişe eklenir; bitmişse bugünden başlar.
 */
export function extendSubscriptionEndDate(currentEndDate, durationDays) {
    const today = startOfToday();
    const currentEnd = toEndOfDay(currentEndDate);
    let base = today;

    if (currentEnd && currentEnd >= today) {
        base = new Date(currentEnd);
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + 1);
    }

    const newEnd = new Date(base);
    newEnd.setDate(newEnd.getDate() + durationDays - 1);
    newEnd.setHours(23, 59, 59, 999);

    const y = newEnd.getFullYear();
    const m = String(newEnd.getMonth() + 1).padStart(2, "0");
    const d = String(newEnd.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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

/** Müşteri randevu sayfası açık mı? (bitiş + 3 gün grace) */
export function isCustomerBookingAllowed(barber) {
    if (!barber) return false;
    if (barber.status === "passive") return false;
    const daysAfter = daysAfterSubscriptionEnd(barber);
    if (daysAfter < 0) return true;
    return daysAfter <= CUSTOMER_GRACE_DAYS;
}

/** Berber admin takvimi açık mı? (bitiş + 7 gün grace) */
export function isAdminCalendarAllowed(barber) {
    if (!barber) return false;
    const daysAfter = daysAfterSubscriptionEnd(barber);
    if (daysAfter < 0) return true;
    return daysAfter <= ADMIN_GRACE_DAYS;
}

export function getCustomerBlockMessage() {
    return "Bu işletmenin online randevu sistemi geçici olarak kapalıdır.";
}

export const SHOPIER_URL = "https://www.shopier.com/BerberRandevu";

export function getAdminCalendarLockMessage() {
    return "Abonelik süreniz dolduğu için randevu takvimi kapatıldı. Sistemi kullanmaya devam etmek için Shopier'den aktivasyon kodu satın alıp Abonelik sekmesinden etkinleştirin.";
}

/**
 * Aktivasyon kodunu etkinleştirir.
 * Yalnızca ilgili kod dokümanı + berber dokümanı okunur (tam tarama yok).
 * Transaction ile kod tek kullanımlık garanti edilir.
 */
export async function activateSubscriptionCode(rawCode, barberSlug) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) throw new Error("Lütfen aktivasyon kodunu girin.");
    if (!barberSlug) throw new Error("Dükkan bilgisi bulunamadı.");

    const codeRef = doc(db, "activationCodes", code);
    const barberRef = doc(db, "berberler", barberSlug);

    return runTransaction(db, async (tx) => {
        const codeSnap = await tx.get(codeRef);
        if (!codeSnap.exists()) {
            throw new Error("Geçersiz aktivasyon kodu.");
        }

        const codeData = codeSnap.data();
        if (codeData.isUsed) {
            throw new Error("Bu kod daha önce kullanılmış.");
        }

        const barberSnap = await tx.get(barberRef);
        if (!barberSnap.exists()) {
            throw new Error("Berber kaydı bulunamadı.");
        }

        const barber = barberSnap.data();
        const durationDays = codeData.durationDays || PACKAGE_TYPES[codeData.packageType]?.durationDays || 30;
        const newEndDate = extendSubscriptionEndDate(barber.subscriptionEndDate, durationDays);

        tx.update(barberRef, {
            subscriptionStatus: "active",
            subscriptionEndDate: newEndDate,
            lastActivationCode: code,
            lastSubscriptionUpdate: serverTimestamp()
        });

        tx.update(codeRef, {
            isUsed: true,
            usedByBarberSlug: barberSlug,
            usedAt: serverTimestamp()
        });

        return {
            newEndDate,
            durationDays,
            packageType: codeData.packageType || "monthly"
        };
    });
}
