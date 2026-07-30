import {
    collection,
    getDocs,
    doc,
    query,
    where,
    orderBy,
    limit,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { archiveOwnerAppointmentViaApi } from "./privilegedApiClient.js";

const COLLECTION = "deletedAppointments";
const ARCHIVE_DAYS = 7;
const LIST_LIMIT = 100;

export const ARCHIVE_ERROR_MESSAGES = {
    invalid_request: "Randevu şu anda arşive alınamadı. Lütfen tekrar deneyin.",
    auth_required: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın.",
    token_expired: "Oturum süresi doldu. Lütfen tekrar giriş yapın.",
    auth_invalid: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın.",
    forbidden: "Bu randevu üzerinde işlem yapma yetkiniz bulunmuyor.",
    appointment_not_found: "Randevu bulunamadı veya daha önce kaldırılmış.",
    archive_conflict: "Randevu arşiv durumu doğrulanamadı. Sayfayı yenileyip tekrar deneyin.",
    rate_limited: "Kısa sürede çok fazla işlem yapıldı. Lütfen daha sonra tekrar deneyin.",
    internal_error: "Randevu şu anda arşive alınamadı. Lütfen tekrar deneyin.",
    privileged_api_failed: "Randevu şu anda arşive alınamadı. Lütfen tekrar deneyin."
};

function toArchiveUserError(error) {
    const code = String(error?.code || "internal_error");
    const message = ARCHIVE_ERROR_MESSAGES[code] || ARCHIVE_ERROR_MESSAGES.internal_error;
    const mapped = new Error(message);
    mapped.code = code;
    return mapped;
}

/**
 * Owner archive via authenticated server API only.
 * Never writes archive docs or deletes active appointments from the browser.
 */
export async function archiveAndDeleteAppointment({
    appointment,
    deletedBy = "barberAdmin",
    deletedByMode = "adminPanel",
    archiveReason = ""
}) {
    const appointmentId = appointment?.id || `legacy-${appointment?.date}-${appointment?.time}`;
    if (!appointmentId || appointmentId === "legacy-undefined-undefined") {
        throw toArchiveUserError({ code: "invalid_request" });
    }

    try {
        return await archiveOwnerAppointmentViaApi({
            appointmentId,
            deletedBy,
            deletedByMode,
            archiveReason
        });
    } catch (err) {
        throw toArchiveUserError(err);
    }
}

/**
 * Süresi dolmamış silinen randevuları getirir (canlı dinleme yok).
 */
export async function fetchActiveDeletedAppointments(barberSlug) {
    const now = Timestamp.now();
    const baseQuery = [
        collection(db, COLLECTION),
        where("barberSlug", "==", barberSlug),
        where("deleteExpireAt", ">", now),
        limit(LIST_LIMIT)
    ];

    try {
        const q = query(...baseQuery, orderBy("deleteExpireAt", "asc"));
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        if (err?.code === "failed-precondition") {
            console.warn(
                "deletedAppointments için Firestore composite index gerekli: " +
                "barberSlug (Asc) + deleteExpireAt (Asc). " +
                "Firebase Console → Firestore → Indexes bölümünden oluşturun."
            );
            const snap = await getDocs(query(...baseQuery));
            return snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                    const aMs = a.deleteExpireAt?.toMillis?.() ?? 0;
                    const bMs = b.deleteExpireAt?.toMillis?.() ?? 0;
                    return aMs - bMs;
                });
        }
        throw err;
    }
}

export function formatDeletedAt(ts) {
    if (!ts?.toDate) return "—";
    return ts.toDate().toLocaleString("tr-TR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

export function formatArchiveExpiry(ts) {
    if (!ts?.toDate) return "";
    const daysLeft = Math.ceil((ts.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return "Arşiv süresi doldu";
    if (daysLeft === 1) return "1 gün içinde arşivden kalkacak";
    return `${daysLeft} gün içinde arşivden kalkacak`;
}
