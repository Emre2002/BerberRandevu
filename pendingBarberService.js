import {
    collection, addDoc, getDocs, getDoc, doc, updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, hasFirebaseConfig, SITE_BASE_URL } from "./firebase-config.js";
import {
    createBarber, normalizeSlug, slugExists, usernameExists, getAdminLoginLink
} from "./firestoreService.js";
import { getInitialTrialEndDate } from "./subscriptionService.js";

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

function subscriptionEndFromDays(days) {
    const end = new Date();
    end.setDate(end.getDate() + days - 1);
    end.setHours(23, 59, 59, 999);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, "0");
    const d = String(end.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** @deprecated Onay akışında getInitialTrialEndDate() kullanılır. */

function generatePassword(len = 8) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pwd = "";
    for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
}

async function generateUniqueSlug(shopName) {
    let base = normalizeSlug(shopName);
    if (!base) base = "dukkan";
    let slug = base;
    let n = 2;
    while (await slugExists(slug)) {
        slug = `${base}-${n}`;
        n++;
    }
    return slug;
}

async function generateUniqueUsername(slug) {
    let base = slug.replace(/-/g, "");
    if (!base) base = "berber";
    let username = base;
    let n = 2;
    while (await usernameExists(username)) {
        username = `${base}${n}`;
        n++;
    }
    return username;
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
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    return items;
}

export async function rejectPendingBarber(id) {
    const database = ensureDb();
    await updateDoc(doc(database, COLLECTION, id), {
        status: "rejected",
        rejectedAt: serverTimestamp()
    });
}

/**
 * Onayla: pendingBarbers verisinden berberler koleksiyonunda otomatik dükkan oluşturur.
 * Slug, kullanıcı adı ve şifre otomatik üretilir.
 */
export async function approvePendingBarber(id) {
    const database = ensureDb();
    const pendingRef = doc(database, COLLECTION, id);
    const pendingSnap = await getDoc(pendingRef);

    if (!pendingSnap.exists()) throw new Error("Başvuru bulunamadı.");

    const p = pendingSnap.data();
    if (p.status === "approved") throw new Error("Bu başvuru zaten onaylanmış.");
    if (p.status === "rejected") throw new Error("Reddedilmiş başvuru onaylanamaz.");

    const slug = await generateUniqueSlug(p.shopName);
    const username = await generateUniqueUsername(slug);
    const password = generatePassword(8);
    // Paket tercihi ne olursa olsun başlangıçta yalnızca 1 günlük deneme erişimi.
    const subscriptionEndDate = getInitialTrialEndDate();

    const composedAddress = [p.city, p.district, p.address].filter(Boolean).join(", ");

    await createBarber({
        slug,
        name: p.shopName,
        city: p.city,
        district: p.district,
        addressDetail: p.address,
        address: composedAddress,
        phone: p.phone,
        email: p.email,
        whatsapp: p.phone.replace(/\D/g, "").replace(/^0/, "90"),
        openHour: p.openingHour,
        closeHour: p.closingHour,
        mapsLink: p.mapsLink || "",
        username,
        password,
        subscriptionEndDate
    });

    await updateDoc(pendingRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        createdSlug: slug,
        createdUsername: username,
        createdPassword: password
    });

    return { slug, username, password, adminUrl: getAdminLoginLink(slug), subscriptionEndDate };
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

export function buildWhatsAppApprovalLink(phone, { slug, username, password }) {
    const digits = String(phone || "").replace(/\D/g, "");
    let wa = digits;
    if (wa.startsWith("0")) wa = "90" + wa.slice(1);
    else if (!wa.startsWith("90")) wa = "90" + wa;

    const adminUrl = `${SITE_BASE_URL}/admin.html?dukkan=${slug}`;
    const text = `Merhaba.\n\nBerberRandevu başvurunuz onaylanmıştır.\n\nAdmin Panel:\n${adminUrl}\n\nKullanıcı Adınız:\n${username}\n\nŞifreniz:\n${password}`;

    return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
}
