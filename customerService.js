import {
    doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

const CUSTOMERS = "customers";
const APPOINTMENTS = "appointments";

// VIP eşiği ve müşteri durum tanımları (CRM modülü için ortak kaynak).
export const VIP_THRESHOLD = 10;
export const CUSTOMER_STATUS = {
    active: { id: "active", label: "Aktif", emoji: "🟢" },
    risky: { id: "risky", label: "Riskli", emoji: "🟡" },
    lost: { id: "lost", label: "Kaybedilmiş", emoji: "🔴" }
};

export function normalizePhone(phone) {
    if (!phone || phone === "—") return "";
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

export function getCustomerDocId(barberSlug, phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return `${barberSlug}_${normalized}`;
}

/**
 * Randevu oluşturulduğunda müşteri kaydını günceller veya oluşturur.
 */
/**
 * İsmi görüntüleme/varyant anahtarı için temizler:
 * fazla boşlukları teke indirir, baş/son boşlukları siler.
 * Büyük/küçük harf ve Türkçe karakterler KORUNUR (displayName doğal kalsın).
 */
export function cleanDisplayName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
}

/** Bir değeri "YYYY-MM-DD" biçimine çevirir (string randevu tarihi veya Timestamp). */
export function toYmd(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = toDateSafe(value);
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "YYYY-MM-DD" stringleri sözlüksel olarak kronolojik sıralanır.
function minYmd(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }
function maxYmd(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }

/** nameVariants içinden en çok kullanılan ismi seçer (eşitlikte ilk eklenen). */
export function pickDisplayName(variants, fallback = "") {
    let best = fallback;
    let bestCount = -1;
    for (const [name, count] of Object.entries(variants || {})) {
        if (count > bestCount) { best = name; bestCount = count; }
    }
    return best || fallback;
}

/**
 * Randevu oluşturulduğunda müşteriyi TELEFONA göre tekilleştirir.
 *
 * Doküman kimliği `barberSlug_normalizedPhone` olduğundan, aynı berber + telefon
 * her zaman tek kayda denk gelir; bu sayede tam koleksiyon taraması yapmadan
 * yalnızca ilgili kayıt tek bir getDoc ile okunur (where sorgusundan da ucuz).
 *
 * Farklı yazılan isimler (Adem Kaya / AdemKaya / ADEM KAYA) nameVariants içinde
 * ayrı sayaçlarda tutulur; en çok kullanılan isim displayName olur.
 */
export async function upsertCustomerOnAppointment({ barberSlug, customerName, phone, appointmentDate }) {
    const customerId = getCustomerDocId(barberSlug, phone);
    if (!customerId) return null;

    const ref = doc(db, CUSTOMERS, customerId);
    const snap = await getDoc(ref);
    const normalized = normalizePhone(phone);
    const variantName = cleanDisplayName(customerName);
    // ÖNEMLI: İlk/Son geliş, randevunun SEÇİLEN tarihinden hesaplanır (server time DEĞİL).
    const apptDate = toYmd(appointmentDate);

    if (snap.exists()) {
        // Mevcut müşteri: ziyaret say, isim varyantını işle, ilk/son gelişi tarihe göre güncelle.
        const data = snap.data();
        const variants = { ...(data.nameVariants || {}) };

        // Geriye dönük uyum: eski kayıtta varyant yoksa mevcut ismi tohumla.
        if (!Object.keys(variants).length) {
            const legacy = cleanDisplayName(data.displayName || data.fullName || data.customerName);
            if (legacy) variants[legacy] = data.totalVisits ?? data.totalAppointments ?? 1;
        }
        if (variantName) variants[variantName] = (variants[variantName] || 0) + 1;

        const displayName = pickDisplayName(variants, variantName || data.displayName || "");

        // Mevcut ilk/son gelişi randevu tarihiyle karşılaştır (en eski / en yeni).
        const firstVisit = minYmd(toYmd(data.firstVisit), apptDate) || apptDate || null;
        const lastVisit = maxYmd(toYmd(data.lastVisit), apptDate) || apptDate || null;

        const payload = {
            displayName,
            fullName: displayName,
            customerName: displayName,
            phone: normalized,
            nameVariants: variants,
            lastAppointmentDate: appointmentDate,
            totalAppointments: increment(1),
            totalVisits: increment(1),
            updatedAt: serverTimestamp()  // güncellenme zamanı — DEĞİŞMEZ mantık
        };
        if (firstVisit) payload.firstVisit = firstVisit;
        if (lastVisit) payload.lastVisit = lastVisit;

        await updateDoc(ref, payload);
    } else {
        // Yeni müşteri. firstVisit = lastVisit = randevu tarihi. createdAt = sistem zamanı.
        const variants = variantName ? { [variantName]: 1 } : {};
        await setDoc(ref, {
            barberSlug,
            displayName: variantName,
            fullName: variantName,
            customerName: variantName,
            phone: normalized,
            nameVariants: variants,
            createdAt: serverTimestamp(),   // kayıt oluşturulma tarihi — DEĞİŞMEZ
            updatedAt: serverTimestamp(),
            firstVisit: apptDate || null,   // randevu tarihinden
            lastVisit: apptDate || null,    // randevu tarihinden
            totalAppointments: 1,
            totalVisits: 1,
            lastAppointmentDate: appointmentDate
        });
    }

    return customerId;
}

// --- CRM yardımcıları -------------------------------------------------------

export function toDateSafe(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

export function daysSince(date) {
    if (!date) return Infinity;
    return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/** Son ziyarete göre müşteri durumu: 0-30 aktif, 31-60 riskli, 60+ kaybedilmiş. */
export function computeCustomerStatus(lastVisit) {
    const d = daysSince(lastVisit);
    if (d <= 30) return "active";
    if (d <= 60) return "risky";
    return "lost";
}

/** Ham Firestore müşteri dökümanını CRM için tek tip yapıya çevirir (eski/yeni alanları birleştirir). */
export function normalizeCustomerRecord(raw) {
    const totalVisits = raw.totalVisits ?? raw.totalAppointments ?? 0;
    // İlk/Son geliş YALNIZCA randevu tarihlerinden gelir; createdAt'e DÜŞMEZ.
    const lastVisit = toDateSafe(raw.lastVisit) || toDateSafe(raw.lastAppointmentDate);
    const firstVisit = toDateSafe(raw.firstVisit) || toDateSafe(raw.lastAppointmentDate);
    return {
        customerId: raw.customerId,
        barberSlug: raw.barberSlug || "",
        fullName: raw.displayName || raw.fullName || raw.customerName || "İsimsiz Müşteri",
        phone: raw.phone || "",
        nameVariants: raw.nameVariants || null,
        totalVisits,
        firstVisit,
        lastVisit,
        status: computeCustomerStatus(lastVisit),
        isVip: totalVisits >= VIP_THRESHOLD
    };
}

/**
 * Bir berberin tüm randevularını getirir (müşteri detayındaki randevu geçmişi için).
 * Yalnızca eşitlik filtresi kullanır (composite index gerektirmez); sıralama
 * istemci tarafında yapılır. CRM tarafında oturum başına bir kez okunup cache'lenir.
 */
export async function fetchAppointmentsByBarber(barberSlug) {
    const q = query(collection(db, APPOINTMENTS), where("barberId", "==", barberSlug));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export async function fetchAllCustomers() {
    const snap = await getDocs(collection(db, CUSTOMERS));
    const list = [];
    snap.forEach((d) => list.push({ customerId: d.id, ...d.data() }));
    return list.sort((a, b) => (b.totalAppointments || 0) - (a.totalAppointments || 0));
}

export async function fetchCustomersByBarber(barberSlug) {
    const q = query(collection(db, CUSTOMERS), where("barberSlug", "==", barberSlug));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ customerId: d.id, ...d.data() }));
    return list.sort((a, b) => (b.totalAppointments || 0) - (a.totalAppointments || 0));
}

export function computeCustomerStats(customers) {
    const total = customers.length;
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last30Days = customers.filter((c) => {
        const created = c.createdAt?.toDate?.();
        return created && created >= thirtyDaysAgo;
    }).length;

    const byBarber = {};
    customers.forEach((c) => {
        const slug = c.barberSlug || "—";
        byBarber[slug] = (byBarber[slug] || 0) + 1;
    });

    return { total, last30Days, byBarber };
}

export function filterCustomers(customers, searchTerm) {
    const q = (searchTerm || "").trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
        const name = (c.customerName || "").toLowerCase();
        const phone = (c.phone || "").toLowerCase();
        return name.includes(q) || phone.includes(q);
    });
}

export function formatCustomerDate(value) {
    if (!value) return "—";
    if (typeof value === "string") return new Date(value).toLocaleDateString("tr-TR");
    if (typeof value.toDate === "function") return value.toDate().toLocaleDateString("tr-TR");
    return "—";
}

