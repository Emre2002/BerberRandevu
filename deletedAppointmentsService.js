import {
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    doc,
    getDoc,
    setDoc,
    query,
    where,
    orderBy,
    limit,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

const COLLECTION = "deletedAppointments";
const ARCHIVE_DAYS = 7;
const LIST_LIMIT = 100;

function normalizeTimeKey(key) {
    if (!key || key === "ALL") return null;
    if (/^\d{2}:\d{2}$/.test(key)) return key;
    const match = key.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : null;
}

function buildDeleteExpireAt(deletedAt) {
    const expire = deletedAt.toDate();
    expire.setDate(expire.getDate() + ARCHIVE_DAYS);
    return Timestamp.fromDate(expire);
}

async function deleteOriginalAppointment(barberSlug, appointment) {
    if (appointment.legacy) {
        const snap = await getDoc(doc(db, "berberler", barberSlug, "appointments", appointment.date));
        if (snap.exists()) {
            const data = { ...snap.data() };
            Object.keys(data).forEach((key) => {
                if (normalizeTimeKey(key) === appointment.time) delete data[key];
            });
            await setDoc(doc(db, "berberler", barberSlug, "appointments", appointment.date), data);
        }
        return;
    }
    if (appointment.id) {
        await deleteDoc(doc(db, "appointments", appointment.id));
    }
}

/**
 * Önce arşive yazar, başarılı olursa orijinal randevuyu siler.
 */
export async function archiveAndDeleteAppointment({
    barberSlug,
    appointment,
    deletedBy = "barberAdmin",
    deletedByMode = "adminPanel"
}) {
    const deletedAt = Timestamp.now();
    const deleteExpireAt = buildDeleteExpireAt(deletedAt);

    const archiveDoc = {
        barberSlug,
        customerName: appointment.customerName || "",
        customerPhone: appointment.phone || "",
        appointmentDate: appointment.date || "",
        appointmentTime: appointment.time || "",
        serviceName: appointment.service || "",
        note: appointment.musteriNotu || "",
        originalAppointmentId: appointment.id || `legacy-${appointment.date}-${appointment.time}`,
        deletedAt,
        deleteExpireAt,
        deletedBy,
        deletedByMode
    };

    try {
        await addDoc(collection(db, COLLECTION), archiveDoc);
    } catch (err) {
        console.error("Arşive yazma hatası:", err);
        throw new Error("Randevu arşive taşınamadığı için silme işlemi iptal edildi.");
    }

    try {
        await deleteOriginalAppointment(barberSlug, appointment);
    } catch (err) {
        console.error("Orijinal randevu silme hatası:", err);
        throw new Error("Randevu arşive alındı ancak takvimden kaldırılamadı. Lütfen sayfayı yenileyin.");
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
