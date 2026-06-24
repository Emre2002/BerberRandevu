import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import {
    getBookingUrl,
    getAdminUrl,
    getWhatsAppBookingMessage
} from "./linkService.js";
import { getCustomerBlockMessage, calculatePublicBookingOpen } from "./publicBookingAccess.js";

const BARBERS = "berberler";
const PUBLIC_BARBERS = "publicBarbers";

function trimStr(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Yalnızca public alanları seçer; username/password/telegram/abonelik alanlarını asla dahil etmez.
 */
export function buildPublicBarberData(barber, slug) {
    const resolvedSlug = slug || barber?.slug || "";
    const payload = {
        slug: resolvedSlug,
        name: trimStr(barber?.name),
        address: trimStr(barber?.address),
        city: trimStr(barber?.city),
        district: trimStr(barber?.district),
        neighborhood: trimStr(barber?.neighborhood),
        addressDetail: trimStr(barber?.addressDetail),
        phone: trimStr(barber?.phone),
        whatsapp: trimStr(barber?.whatsapp),
        openHour: trimStr(barber?.openHour || barber?.openingHour),
        closeHour: trimStr(barber?.closeHour || barber?.closingHour),
        logoUrl: trimStr(barber?.logoUrl),
        coverUrl: trimStr(barber?.coverUrl),
        mapsLink: trimStr(barber?.mapsLink),
        status: barber?.status || "active",
        bookingOpen: calculatePublicBookingOpen(barber)
    };

    if (Array.isArray(barber?.selectedServices) && barber.selectedServices.length > 0) {
        payload.selectedServices = barber.selectedServices.filter((s) => typeof s === "string");
    }

    return payload;
}

/** Müşteri randevu sayfası için public dükkan bilgisi. Yoksa legacy berberler fallback (uyarı ile). */
export async function fetchPublicBarber(slug) {
    const normalized = normalizeSlug(slug) || String(slug || "").trim();
    if (!normalized) return null;

    const pubSnap = await getDoc(doc(db, PUBLIC_BARBERS, normalized));
    if (pubSnap.exists()) {
        return { slug: pubSnap.id, ...pubSnap.data() };
    }

    console.warn(`publicBarbers/${normalized} bulunamadı. Public Mirror Sync çalıştırılmalı.`);
    const legacy = await fetchBarber(normalized);
    if (!legacy) return null;
    return buildPublicBarberData(legacy, normalized);
}

/** publicBarbers/{slug} mirror — yalnızca public alanlar yazılır. */
export async function syncPublicBarber(slug, barberData) {
    const normalized = normalizeSlug(slug) || String(slug || "").trim();
    if (!normalized || !barberData) return;

    const publicData = buildPublicBarberData({ ...barberData, slug: normalized }, normalized);
    await setDoc(doc(db, PUBLIC_BARBERS, normalized), {
        ...publicData,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

/**
 * Tüm berberler → publicBarbers migration (SuperAdmin konsolundan manuel çağrılır).
 * @returns {Promise<{ synced: number }>}
 */
export async function syncAllPublicBarbersForMigration() {
    const barbers = await fetchAllBarbers();
    for (const barber of barbers) {
        await syncPublicBarber(barber.slug, barber);
    }
    return { synced: barbers.length };
}

export function normalizeSlug(raw) {
    const trMap = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", I: "i", Ö: "o", Ş: "s", Ü: "u" };
    let s = String(raw || "").trim();
    for (const [from, to] of Object.entries(trMap)) {
        s = s.split(from).join(to);
    }
    return s
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export function normalizeUsername(raw) {
    return raw.trim().toLowerCase();
}

export async function slugExists(slug) {
    const snap = await getDoc(doc(db, BARBERS, slug));
    return snap.exists();
}

export async function usernameExists(username, excludeSlug = null) {
    const normalized = normalizeUsername(username);
    if (!normalized) return false;

    const q = query(collection(db, BARBERS), where("username", "==", normalized));
    const snap = await getDocs(q);

    for (const docSnap of snap.docs) {
        if (excludeSlug && docSnap.id === excludeSlug) continue;
        return true;
    }
    return false;
}

export async function fetchAllBarbers() {
    const snapshot = await getDocs(collection(db, BARBERS));
    const barbers = [];
    snapshot.forEach((docSnap) => {
        barbers.push({ slug: docSnap.id, ...docSnap.data() });
    });
    barbers.sort((a, b) =>
        (a.name || a.slug || "").localeCompare(b.name || b.slug || "", "tr")
    );
    return barbers;
}

export async function fetchBarber(slug) {
    const snap = await getDoc(doc(db, BARBERS, slug));
    if (!snap.exists()) return null;
    return { slug: snap.id, ...snap.data() };
}

const BARBER_LOGIN_ERROR = "Kullanıcı adı veya şifre hatalı.";

/**
 * Kullanıcı adı + şifre ile dükkanı çözer (slug bilgisi gerekmez).
 * Tek Firestore sorgusu: berberler.username == normalizeUsername(username)
 */
export async function resolveBarberLogin(username, password) {
    const normalized = normalizeUsername(username);
    if (!normalized || !password) {
        throw new Error(BARBER_LOGIN_ERROR);
    }

    const q = query(collection(db, BARBERS), where("username", "==", normalized));
    const snap = await getDocs(q);

    if (snap.empty) {
        throw new Error(BARBER_LOGIN_ERROR);
    }

    const docSnap = snap.docs[0];
    const barber = { slug: docSnap.id, ...docSnap.data() };

    if (password !== barber.password) {
        throw new Error(BARBER_LOGIN_ERROR);
    }

    return { slug: barber.slug, barber };
}

/**
 * Berber giriş doğrulaması — Firestore'daki username/password ile karşılaştırır.
 */
export async function validateBarberLogin(slug, username, password) {
    const barber = await fetchBarber(slug);
    if (!barber) {
        throw new Error("Berber bulunamadı.");
    }

    const inputUser = normalizeUsername(username);
    const storedUser = normalizeUsername(barber.username || "");

    if (inputUser !== storedUser || password !== barber.password) {
        throw new Error("Hatalı kullanıcı adı veya şifre.");
    }

    return barber;
}

function defaultSubscriptionEndDate(months = 1) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split("T")[0];
}

/**
 * Yeni berber oluşturur (kullanıcı adı + şifre Firestore'da saklanır).
 */
export async function createBarber({
    slug,
    name,
    address = "",
    city = "",
    district = "",
    neighborhood = "",
    addressDetail = "",
    phone,
    whatsapp = "",
    openHour,
    closeHour,
    username,
    password,
    logoUrl = "",
    coverUrl = "",
    telegramChatId = "",
    mapsLink = "",
    email = "",
    subscriptionEndDate: customSubscriptionEndDate = null
}) {
    const normalizedSlug = normalizeSlug(slug);
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedSlug) throw new Error("Geçerli bir slug giriniz.");
    if (!normalizedUsername) throw new Error("Kullanıcı adı zorunludur.");
    if (!password || password.length < 4) throw new Error("Şifre en az 4 karakter olmalıdır.");

    if (await slugExists(normalizedSlug)) {
        throw new Error("Bu slug zaten kullanılıyor.");
    }
    if (await usernameExists(normalizedUsername)) {
        throw new Error("Bu kullanıcı adı zaten kullanılıyor.");
    }

    const subscriptionEndDate = customSubscriptionEndDate || defaultSubscriptionEndDate(1);

    const barberPayload = {
        name: name.trim(),
        slug: normalizedSlug,
        address: address.trim(),
        city: city.trim(),
        district: district.trim(),
        neighborhood: neighborhood.trim(),
        addressDetail: addressDetail.trim(),
        phone: phone.trim(),
        email: (email || "").trim(),
        whatsapp: whatsapp.trim(),
        openHour,
        closeHour,
        username: normalizedUsername,
        password,
        logoUrl: logoUrl.trim(),
        coverUrl: coverUrl.trim(),
        telegramChatId: telegramChatId.trim(),
        mapsLink: mapsLink.trim(),
        status: "active",
        subscriptionStatus: "active",
        subscriptionEndDate,
        lastActivationCode: "",
        lastSubscriptionUpdate: null,
        createdAt: serverTimestamp()
    };

    await setDoc(doc(db, BARBERS, normalizedSlug), barberPayload);
    await syncPublicBarber(normalizedSlug, barberPayload);

    return { slug: normalizedSlug, username: normalizedUsername };
}

export async function updateBarber(slug, data, currentSlug = slug) {
    const allowed = [
        "name", "address", "city", "district", "neighborhood", "addressDetail",
        "phone", "whatsapp", "openHour", "closeHour", "email",
        "logoUrl", "coverUrl", "telegramChatId", "mapsLink", "status", "subscriptionStatus", "subscriptionEndDate",
        "username", "password", "lastActivationCode", "lastSubscriptionUpdate"
    ];
    const payload = {};

    allowed.forEach((key) => {
        if (data[key] === undefined) return;
        if (key === "username") {
            payload[key] = normalizeUsername(data[key]);
        } else if (typeof data[key] === "string") {
            payload[key] = data[key].trim();
        } else {
            payload[key] = data[key];
        }
    });

    if (payload.username && await usernameExists(payload.username, currentSlug)) {
        throw new Error("Bu kullanıcı adı zaten kullanılıyor.");
    }

    await updateDoc(doc(db, BARBERS, slug), payload);

    const updated = await fetchBarber(slug);
    if (updated) await syncPublicBarber(slug, updated);
}

export async function toggleBarberStatus(slug, currentStatus) {
    const newStatus = currentStatus === "active" ? "passive" : "active";
    await updateDoc(doc(db, BARBERS, slug), { status: newStatus });
    const updated = await fetchBarber(slug);
    if (updated) await syncPublicBarber(slug, updated);
    return newStatus;
}

export async function extendSubscription(slug, months) {
    const barber = await fetchBarber(slug);
    if (!barber) throw new Error("Berber bulunamadı.");

    let base = new Date();
    if (barber.subscriptionEndDate) {
        const end = new Date(barber.subscriptionEndDate);
        if (end > base) base = end;
    }
    base.setMonth(base.getMonth() + months);
    const subscriptionEndDate = base.toISOString().split("T")[0];

    await updateDoc(doc(db, BARBERS, slug), {
        subscriptionStatus: "active",
        subscriptionEndDate,
        subscriptionRenewedAt: serverTimestamp(),
        lastSubscriptionUpdate: serverTimestamp()
    });

    const updated = await fetchBarber(slug);
    if (updated) await syncPublicBarber(slug, updated);

    return subscriptionEndDate;
}

export async function removeBarber(slug) {
    await deleteDoc(doc(db, BARBERS, slug));
    await deleteDoc(doc(db, PUBLIC_BARBERS, slug)).catch(() => {});
}

export function getCustomerLink(slug) {
    return getBookingUrl(slug);
}

export function getAdminLoginLink(slug) {
    return getAdminUrl(slug);
}

export function getWhatsAppMessage(slug) {
    return getWhatsAppBookingMessage(slug);
}

/**
 * Müşteri ekranı engel nedeni — passive ve expired için ayrı mesajlar.
 */
export function getBarberBlockReason(barber) {
    if (!barber) {
        return { blocked: true, message: "İşletme bulunamadı." };
    }
    if (barber.status === "passive") {
        return {
            blocked: true,
            message: "Bu işletme geçici olarak hizmet vermemektedir."
        };
    }
    const hasSubscriptionFields =
        barber.subscriptionEndDate !== undefined ||
        barber.subscriptionStatus !== undefined;
    if (!hasSubscriptionFields && barber.bookingOpen !== undefined) {
        if (barber.bookingOpen === false) {
            return {
                blocked: true,
                message: getCustomerBlockMessage()
            };
        }
        return { blocked: false, message: "" };
    }
    if (!calculatePublicBookingOpen(barber)) {
        return {
            blocked: true,
            message: getCustomerBlockMessage()
        };
    }
    return { blocked: false, message: "" };
}

export function isBarberServiceAvailable(barber) {
    return !getBarberBlockReason(barber).blocked;
}

export function computeBarberStats(barbers) {
    const total = barbers.length;
    const active = barbers.filter((b) => (b.status || "active") === "active").length;
    const passive = barbers.filter((b) => b.status === "passive").length;
    const expired = barbers.filter((b) => {
        if (b.subscriptionStatus === "expired") return true;
        if (b.subscriptionEndDate) {
            const end = new Date(b.subscriptionEndDate);
            end.setHours(23, 59, 59, 999);
            return end < new Date();
        }
        return false;
    }).length;
    return { total, active, passive, expired };
}

export function buildMonthlyAppointmentChart(appointments) {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
            label: d.toLocaleDateString("tr-TR", { month: "short" })
        });
    }
    const values = months.map((m) =>
        appointments.filter((a) => a.date?.startsWith(m.key)).length
    );
    return { labels: months.map((m) => m.label), values };
}

export function buildBarberAppointmentChart(appointments, barbers) {
    const counts = {};
    barbers.forEach((b) => { counts[b.slug] = 0; });
    appointments.forEach((a) => {
        if (a.barberId && counts[a.barberId] !== undefined) counts[a.barberId]++;
    });
    const sorted = barbers
        .map((b) => ({ name: b.name || b.slug, count: counts[b.slug] || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    return {
        labels: sorted.map((s) => s.name),
        values: sorted.map((s) => s.count)
    };
}

export function formatDate(value) {
    if (!value) return "—";
    if (typeof value === "string") {
        return new Date(value).toLocaleDateString("tr-TR");
    }
    if (typeof value.toDate === "function") {
        return value.toDate().toLocaleDateString("tr-TR");
    }
    return "—";
}

export { db };
