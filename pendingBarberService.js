import {
    collection, addDoc, getDocs, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, hasFirebaseConfig } from "./firebase-config.js";
import { callPrivilegedApi } from "./privilegedApiClient.js";

const COLLECTION = "pendingBarbers";

export const PACKAGE_OPTIONS = {
    monthly: { label: "Aylık Paket", days: 30 },
    quarterly: { label: "3 Aylık Paket", days: 90 },
    yearly: { label: "Yıllık Paket", days: 365 },
    demo: { label: "Önce Demo İstiyorum", days: 30 }
};

function ensureDb() {
    if (!hasFirebaseConfig() || !db) {
        throw new Error("Firebase yapılandırması eksik. Lütfen daha sonra tekrar deneyin.");
    }
    return db;
}

/** Ana sayfa dükkan başvuru formu. */
export async function submitPendingBarber({
    ownerName, phone, email, shopName, message = "",
    city, district, address, mapsLink = "",
    openingHour, closingHour, packageType = "demo"
}) {
    const database = ensureDb();

    if (!ownerName?.trim()) throw new Error("Ad Soyad zorunludur.");
    if (!phone?.trim()) throw new Error("Telefon numarası zorunludur.");
    if (!email?.trim()) throw new Error("E-posta adresi zorunludur.");
    if (!shopName?.trim()) throw new Error("Dükkan adı zorunludur.");
    if (!city?.trim()) throw new Error("İl seçimi zorunludur.");
    if (!district?.trim()) throw new Error("İlçe seçimi zorunludur.");
    if (!address?.trim()) throw new Error("Açık adres zorunludur.");
    if (!openingHour || !closingHour) throw new Error("Çalışma saatleri zorunludur.");

    await addDoc(collection(database, COLLECTION), {
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        shopName: shopName.trim(),
        message: (message || "").trim(),
        city: city.trim(),
        district: district.trim(),
        address: address.trim(),
        mapsLink: (mapsLink || "").trim(),
        openingHour,
        closingHour,
        packageType: PACKAGE_OPTIONS[packageType] ? packageType : "demo",
        status: "pending",
        createdAt: serverTimestamp()
    });
}

/** Super Admin: tüm başvuruları tek seferde çeker. */
export async function fetchAllPendingBarbers() {
    const database = ensureDb();
    const snap = await getDocs(
        query(collection(database, COLLECTION), orderBy("createdAt", "desc"))
    );
    const items = [];
    snap.forEach((d) => {
        const { createdPassword: _legacyPassword, ...safeData } = d.data();
        items.push({ id: d.id, ...safeData });
    });
    return items;
}

/** Server checks the claim and performs the entire state transition. */
export async function rejectPendingBarber(id) {
    return callPrivilegedApi("reviewApplication", { applicationId: id, action: "reject" });
}

export async function approvePendingBarber(id) {
    return callPrivilegedApi("reviewApplication", { applicationId: id, action: "approve" });
}

export function formatPendingDate(ts) {
    if (!ts) return "—";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString("tr-TR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

export function packageLabel(type) {
    return PACKAGE_OPTIONS[type]?.label || type || "—";
}
