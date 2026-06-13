import { db } from "./firebase-config.js";
import { getBarberBlockReason } from "./firestoreService.js";
import { createAppointmentWithEffects } from "./appointmentService.js";
import {
    initBarberLiveNotifications, initBarberMessaging, initAdminTabs
} from "./barberAdminExtras.js";
import { initCustomerCrm } from "./customerCrm.js";
import { initSubscriptionAdmin } from "./subscriptionAdmin.js";
import { initWorkingHoursAdmin } from "./workingHoursAdmin.js";
import {
    isAdminCalendarAllowed,
    getAdminCalendarLockMessage
} from "./subscriptionService.js";
import {
    generateHourlySlots,
    getBarberWorkingHours,
    isWithinWorkingHours,
    sortSlotTimes
} from "./workingHoursService.js";
import { 
    doc,
    getDoc,
    collection, 
    addDoc, 
    setDoc, 
    getDocs, 
    deleteDoc, 
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase db firebase-config.js üzerinden yüklenir

// === DİNAMİK DÜKKAN YAKALAMA VE ARAYÜZ GÜNCELLEME SİHRİ ===
const urlParams = new URLSearchParams(window.location.search);
const urlSlug = urlParams.get("dukkan") || urlParams.get("randevu") || urlParams.get("shop") || "";
const isCustomerPageEarly = typeof document !== "undefined" && document.getElementById?.("slotsContainer");
const aktifDukkan = urlSlug || (isCustomerPageEarly ? "x-men" : urlSlug);

/** Admin panelinde abonelik kilidi için önbellek (ekstra Firestore read yok). */
let cachedBarberData = null;

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Müşteri tarafı için yapısal adresi satırlara böler:
//   1) İl / İlçe   2) Mahalle   3) Açık Adres   (yoksa eski tek-satır adrese düşer)
function formatBarberAddressLines(veri) {
    const temiz = (v) => (v == null ? "" : String(v).trim());
    const lines = [];
    const loc = [temiz(veri.city), temiz(veri.district)].filter(Boolean).join(" / ");
    if (loc) lines.push(loc);
    const mahalle = temiz(veri.neighborhood);
    if (mahalle) lines.push(mahalle);
    const detay = temiz(veri.addressDetail);
    if (detay) lines.push(detay);
    if (!lines.length) {
        const legacy = temiz(veri.address) || temiz(veri.adres);
        if (legacy) lines.push(legacy);
    }
    return lines;
}

function formatCustomerNoteModalHtml(note) {
    const trimmed = (note || "").trim();
    if (trimmed) {
        return `<div class="modal-detail modal-detail--note">
            <div class="modal-detail-label">Müşteri Notu</div>
            <div class="modal-detail-value modal-detail-note">${escapeHtml(trimmed)}</div>
        </div>`;
    }
    return `<div class="modal-detail modal-detail--note">
        <div class="modal-detail-label">Müşteri Notu</div>
        <div class="modal-detail-value modal-detail-value--empty">Müşteri bir not bırakmadı.</div>
    </div>`;
}

// Müşteri randevu sayfası için tam ekran, modern bilgilendirme/hata ekranı.
function renderBookingNoticeScreen(icon, title, message) {
    document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at top,#16161f,#0b0b11);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;">
            <div style="width:100%;max-width:430px;background:linear-gradient(145deg,#1a1a26,#12121a);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:42px 32px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.55);">
                <div style="width:78px;height:78px;margin:0 auto 22px;border-radius:50%;background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.32);display:flex;align-items:center;justify-content:center;font-size:2.1rem;">${icon}</div>
                <h1 style="color:#fff;font-size:1.4rem;font-weight:700;margin:0 0 10px;">${escapeHtml(title)}</h1>
                <p style="color:#a9a9b8;font-size:0.95rem;line-height:1.6;margin:0 0 28px;">${escapeHtml(message)}</p>
                <a href="index.html" style="display:inline-block;padding:12px 24px;border-radius:10px;background:#d4a853;color:#12121a;font-weight:700;font-size:0.9rem;text-decoration:none;">Ana Sayfaya Dön</a>
            </div>
        </div>
    `;
}

// Yalnızca geçerli http(s) Google Maps URL'lerini kabul eder; bozuk linklerde false döner.
function isValidMapsUrl(url) {
    const raw = (url || "").trim();
    if (!raw) return false;
    try {
        const parsed = new URL(raw);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

// Müşteri randevu sayfasındaki "Yol Tarifi Al" butonunu/kartını dükkanın mapsLink'ine göre kurar.
function kurYolTarifiButonu(mapsLink) {
    const directionsBtn = document.getElementById("directionsBtn");
    if (!directionsBtn) return; // Admin sayfasında bu öğeler yoktur

    const directionsEmpty = document.getElementById("directionsEmpty");
    const addressCard = document.getElementById("addressCard");
    const link = (mapsLink || "").trim();

    if (isValidMapsUrl(link)) {
        directionsBtn.hidden = false;
        if (directionsEmpty) directionsEmpty.hidden = true;

        const haritayiAc = () => window.open(link, "_blank", "noopener");

        directionsBtn.onclick = (e) => {
            e.stopPropagation();
            haritayiAc();
        };

        if (addressCard) {
            addressCard.classList.add("info-card--clickable");
            addressCard.onclick = haritayiAc;
        }
    } else {
        // Link yok veya bozuk: butonu gizle, bilgilendirme mesajını göster
        directionsBtn.hidden = true;
        directionsBtn.onclick = null;
        if (directionsEmpty) directionsEmpty.hidden = false;
        if (addressCard) {
            addressCard.classList.remove("info-card--clickable");
            addressCard.onclick = null;
        }
    }
}

async function dukkanArayuzunuDinamikYap() {
    const isCustomerPage = Boolean(document.getElementById("slotsContainer"));
    try {
        const dukkanRef = doc(db, "berberler", aktifDukkan);
        const dukkanSnap = await getDoc(dukkanRef);

        if (dukkanSnap.exists()) {
            const veri = dukkanSnap.data();
            cachedBarberData = { slug: aktifDukkan, ...veri };

            if (isCustomerPage) {
                const block = getBarberBlockReason(veri);
                if (block.blocked) {
                    renderBookingNoticeScreen("⚠️", "Şu An Hizmet Verilemiyor", block.message);
                    return false;
                }
            }
            
            // 1. BERBER ADI GÜNCELLEME
            const berberAdi = veri.name || veri.isim || veri.altinmakas || veri.bedirhan || veri["Ahmet Yılmaz"] || "Elite Berber";
            if (document.getElementById("barberName")) {
                document.getElementById("barberName").textContent = berberAdi;
            }
            if (document.getElementById("dukkan-ismi")) {
                document.getElementById("dukkan-ismi").innerText = berberAdi;
            }

            // 2. ADRES GÜNCELLEME (yapısal: İl/İlçe, Mahalle, Açık Adres — çok satırlı)
            const adresSatirlari = formatBarberAddressLines(veri);
            const barberAddressEl = document.getElementById("barberAddress");
            if (barberAddressEl) {
                barberAddressEl.innerHTML = adresSatirlari.length
                    ? adresSatirlari.map(escapeHtml).join("<br>")
                    : "Adres bilgisi henüz eklenmemiş.";
            }
            if (document.getElementById("dukkan-adres")) {
                document.getElementById("dukkan-adres").innerText = adresSatirlari.join("\n");
            }

            // 2.1 GOOGLE MAPS / YOL TARİFİ — sadece geçerli link varsa buton aktif olur
            kurYolTarifiButonu(veri.mapsLink);

            // 3. TELEFON GÜNCELLEME
            const berberTelefonu = veri.phone || veri.telefon || "0555 123 45 67";
            if (document.getElementById("barberPhone")) {
                document.getElementById("barberPhone").textContent = berberTelefonu;
                document.getElementById("barberPhone").href = `tel:${berberTelefonu.replace(/\s/g, '')}`;
            }
            if (document.getElementById("dukkan-telefon")) {
                document.getElementById("dukkan-telefon").innerText = berberTelefonu;
            }

            // 4. ÇALIŞMA SAATLERİ — slot üretimini besler
            activeWorkingHours = getBarberWorkingHours(veri, { warnMissing: true });

            if (document.getElementById("barberHours")) {
                const saatMetni = veri.openHour && veri.closeHour
                    ? `Her gün ${veri.openHour} – ${veri.closeHour}`
                    : (veri.saatler || "Her gün 07:00 - 22:00");
                document.getElementById("barberHours").textContent = saatMetni;
            }

            if (veri.logoUrl && document.getElementById("logoArea")) {
                const logoArea = document.getElementById("logoArea");
                logoArea.innerHTML = "";
                const img = document.createElement("img");
                img.src = veri.logoUrl;
                img.alt = "Logo";
                img.style.cssText = "width:64px;height:64px;border-radius:50%;object-fit:cover;";
                logoArea.appendChild(img);
            }

        } else {
            console.log("Firebase'de dükkan bulunamadı:", aktifDukkan);
            if (isCustomerPage) {
                renderBookingNoticeScreen(
                    "🔍",
                    "İşletme Bulunamadı",
                    "Aradığınız randevu sayfası mevcut değil. Lütfen bağlantının doğru olduğundan emin olun."
                );
                return false;
            }
        }
        return true;
    } catch (hata) {
        console.error("Dükkan verisi çekilirken hata oluştu:", hata);
        if (isCustomerPage) {
            renderBookingNoticeScreen(
                "📡",
                "Bağlantı Sorunu",
                "Şu anda işletme bilgilerine ulaşılamıyor. Lütfen internet bağlantınızı kontrol edip tekrar deneyin."
            );
            return false;
        }
        return true;
    }
}

// Aktif dükkanın çalışma saatleri Firestore'dan doldurulur.
let activeWorkingHours = getBarberWorkingHours({});

/** Müşteri ve admin için geçerli 1 saatlik slot başlangıçları. */
function getVisibleSlots() {
    return generateHourlySlots(activeWorkingHours.openHour, activeWorkingHours.closeHour);
}

/**
 * Admin haftalık takvimi: çalışma saatleri içi slotlar + mevcut randevu/kapalı saat yetimleri.
 */
function getAdminCalendarSlots(week) {
    const shown = new Set(getVisibleSlots());

    if (week?.appointments) {
        Object.keys(week.appointments).forEach((date) => {
            Object.keys(week.appointments[date] || {}).forEach((t) => shown.add(t));
            if (week.blocked && !week.dayClosed?.[date]) {
                week.blocked[date]?.forEach((t) => shown.add(t));
            }
        });
    }

    return sortSlotTimes([...shown]);
}

function isOutsideCurrentWorkingHours(time) {
    return !isWithinWorkingHours(time, activeWorkingHours.openHour, activeWorkingHours.closeHour);
}

/** Gün kapalıyken tüm dinamik slotları blocked set'e ekler. */
function markAllSlotsBlocked(blocked, slots) {
    slots.forEach((t) => blocked.add(t));
}

function dayCacheKey(date) {
    return `${date}|${activeWorkingHours.openHour}|${activeWorkingHours.closeHour}`;
}

const DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function getToday() {
    return formatDateLocal(new Date());
}

function blockedSlotId(date, time) {
    return `${date}_${time}`;
}

function normalizeTimeKey(key) {
    if (!key || key === "ALL") return null;
    if (/^\d{2}:\d{2}$/.test(key)) return key;
    const match = key.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : null;
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove("show"), 4000);
}
function showUndoToast(message, onUndo, onConfirm) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.innerHTML = `
        <span>${message}</span>
        <button id="toastUndoBtn" style="margin-left:12px;background:none;border:1px solid currentColor;border-radius:4px;color:inherit;font-size:0.8rem;padding:3px 10px;cursor:pointer;font-family:inherit;">Geri Al</button>
    `;
    toast.className = "toast error show";

    let undone = false;
    let timer;

    document.getElementById("toastUndoBtn").addEventListener("click", () => {
        undone = true;
        clearTimeout(timer);
        toast.classList.remove("show");
        onUndo();
    });

    timer = setTimeout(async () => {
        if (!undone) {
            toast.classList.remove("show");
            await onConfirm();
        }
    }, 5000);
}

function showError(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="slots-error">${message}</div>`;
}

function firestoreErrorMessage(err) {
    const code = err?.code || "";
    if (code === "permission-denied") {
        return "Firestore erişim izni reddedildi. Firebase Console → Firestore → Rules bölümünden okuma/yazma izinlerini kontrol edin.";
    }
    if (code === "unavailable") {
        return "Firebase sunucusuna ulaşılamıyor. İnternet bağlantınızı kontrol edin.";
    }
    return err?.message || "Bilinmeyen bir hata oluştu.";
}

async function fetchNewAppointments(date) {
    // Kanka buradaki yolu ana appointments koleksiyonuna çevirdik ki takvim kilitlenmesin
    const q = query(collection(db, "appointments"), where("date", "==", date), where("barberId", "==", aktifDukkan));
    const snap = await getDocs(q);
    const map = {};
    snap.forEach(d => {
        const data = d.data();
        if (data.time) {
            map[data.time] = { id: d.id, ...data, legacy: false };
        }
    });
    return map;
}

async function fetchLegacyDayDoc(date, slots) {
    const snap = await getDoc(doc(db, "berberler", aktifDukkan, "appointments", date));
    const appointments = {};
    const blocked = new Set();
    let dayClosed = false;
    const slotList = slots ?? getVisibleSlots();

    if (!snap.exists()) {
        return { appointments, blocked, dayClosed };
    }

    const data = snap.data();
    if (data.ALL === "BLOCKED") {
        dayClosed = true;
        markAllSlotsBlocked(blocked, slotList);
        return { appointments, blocked, dayClosed };
    }

    Object.entries(data).forEach(([key, value]) => {
        if (key === "ALL") return;
        const time = normalizeTimeKey(key);
        if (!time) return;

        if (value === "BLOCKED") {
            blocked.add(time);
        } else if (typeof value === "string" && value.trim()) {
            appointments[time] = {
                id: `legacy-${date}-${time}`,
                customerName: value,
                phone: "—",
                service: "—",
                date,
                time,
                status: "confirmed",
                legacy: true
            };
        }
    });

    return { appointments, blocked, dayClosed };
}
async function fetchBlockedSlotsCollection(date, slots) {
    const blocked = new Set();
    let dayClosed = false;
    const slotList = slots ?? getVisibleSlots();

    try {
        const q = query(collection(db, "berberler", aktifDukkan, "blockedSlots"), where("date", "==", date));
        const snap = await getDocs(q);
        snap.forEach(d => {
            const data = d.data();
            if (data.time === "ALL") {
                dayClosed = true;
                markAllSlotsBlocked(blocked, slotList);
            } else if (data.time) {
                blocked.add(data.time);
            }
        });
    } catch (hata) {
        console.warn("Koleksiyon çekilirken hata oluştu, döküman bazlı kontrol deneniyor:", hata);
        try {
            const dayRef = doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, "ALL"));
            const daySnap = await getDoc(dayRef);
            if (daySnap.exists()) {
                dayClosed = true;
                markAllSlotsBlocked(blocked, slotList);
                return { blocked, dayClosed };
            }

            await Promise.all(slotList.map(async (time) => {
                const ref = doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, time));
                const snap = await getDoc(ref);
                if (snap.exists()) blocked.add(time);
            }));
        } catch (icHata) {
            console.error("Yedek engelli saat kontrolü de başarısız oldu:", icHata);
        }
    }

    return { blocked, dayClosed };
}

// === GÜN VERİSİ CACHE (Firestore read azaltımı) ===
// Cache anahtarı: date + openHour + closeHour (çalışma saati değişince eski veri kullanılmaz).
const DAY_CACHE_TTL_MS = 20000;
const dayDataCache = new Map(); // cacheKey -> { ts, data }

function invalidateDay(date) {
    for (const key of [...dayDataCache.keys()]) {
        if (key.startsWith(`${date}|`)) dayDataCache.delete(key);
    }
}

function invalidateAllDayCache() {
    dayDataCache.clear();
}

async function getDayData(date, { force = false } = {}) {
    if (!db) {
        throw new Error("Firebase bağlantısı kurulamadı.");
    }

    const slots = getVisibleSlots();
    const cacheKey = dayCacheKey(date);

    if (!force) {
        const cached = dayDataCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < DAY_CACHE_TTL_MS) {
            return cached.data;
        }
    }

    const [newAppointments, legacy, blockedData] = await Promise.all([
        fetchNewAppointments(date),
        fetchLegacyDayDoc(date, slots),
        fetchBlockedSlotsCollection(date, slots)
    ]);

    const appointments = { ...legacy.appointments, ...newAppointments };
    const blocked = new Set([...legacy.blocked, ...blockedData.blocked]);
    const dayClosed = legacy.dayClosed || blockedData.dayClosed;

    if (dayClosed) {
        markAllSlotsBlocked(blocked, slots);
    }

    const data = { appointments, blocked, dayClosed };
    dayDataCache.set(cacheKey, { ts: Date.now(), data });
    return data;
}

async function getWeekData(weekDates) {
    const appointments = {};
    const blocked = {};
    const dayClosed = {};

    const results = await Promise.all(weekDates.map(date => getDayData(date)));

    weekDates.forEach((date, i) => {
        appointments[date] = results[i].appointments;
        blocked[date] = results[i].blocked;
        dayClosed[date] = results[i].dayClosed;
    });

    return { appointments, blocked, dayClosed };
}

function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getWeekDates(monday) {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return formatDateLocal(d);
    });
}

function countAvailableSlots(appointments, blocked, dayClosed) {
    if (dayClosed) return 0;
    return getVisibleSlots().filter(t => !appointments[t] && !blocked.has(t)).length;
}

function renderSlots(container, date, appointments, blocked, dayClosed, onSelect) {
    container.innerHTML = "";

    if (dayClosed) {
        container.innerHTML =
            '<div class="slots-day-closed">Berberimiz bu gün izinlidir. Lütfen başka bir gün seçiniz.</div>';
        return;
    }

    // Sadece dükkanın çalışma saatleri içindeki 1 saatlik slotlar üretilir.
    // Aralık dışındaki saatler hiç render edilmez (disabled/pasif değil).
    const visibleSlots = getVisibleSlots();

    if (!visibleSlots.length) {
        container.innerHTML =
            '<div class="slots-empty">Bu gün için tanımlı çalışma saati bulunmuyor.</div>';
        return;
    }

    visibleSlots.forEach(time => {
        const slotEl = document.createElement("div");
        slotEl.classList.add("slot");
        slotEl.textContent = time;

        if (blocked.has(time)) {
            slotEl.classList.add("slot--closed");
            slotEl.title = "Kapalı";
        } else if (appointments[time]) {
            slotEl.classList.add("slot--booked");
            slotEl.title = "Dolu";
        } else {
            slotEl.classList.add("slot--available");
            slotEl.addEventListener("click", () => onSelect(slotEl, time));
        }

        container.appendChild(slotEl);
    });
}

const MOTIVATION_QUOTES = [
    "İyi bir tıraş, günün geri kalanını değiştirir.",
    "Tarzın, senin sessiz konuşmandır; bırak saçların konuşsun.",
    "Görünüşünü değiştir, enerjin değişsin.",
    "Buradan sadece saçın değil, özgüvenin de yenilenerek çıkar.",
    "Aynaya baktığında ne görmek istediğine sen karar ver.",
    "Kaliteli bir kesim, en iyi takım elbiseden daha değerlidir.",
    "Tarzını şansa bırakma, ustaya bırak.",
    "Saç tasarımı bir sanat ise, burası senin galerindir.",
    "Sıradan bir kesim değil, sana özel bir imza.",
    "Her saç bir tuvaldir, biz sadece resmi tamamlıyoruz.",
    "Jiletin keskinliği, ustanın tecrübesiyle buluştu.",
    "Ayrıntılar fark yaratır; biz o ayrıntıları çok iyi biliyoruz.",
    "Klasik duruş, modern dokunuş.",
    "Kötü geçen bir günü unutturacak tek şey, sıcak bir havlu ve jilet gibi bir tıraştır.",
    "Burada sadece saçlar değil, dertler de kısaltılır.",
    "Karizmanı tazelemek için en doğru sıradasın.",
    "Saçın şakası olmaz, randevunu al, yerini sağlama al.",
    "Çayımız taze, muhabbetimiz derin, makasımız keskindir.",
    "Girişte sıradan, çıkışta efsane.",
    "Hayat mükemmel olmayabilir ama saçların olabilir."
];

function setRandomMotivationQuote() {
    const el = document.getElementById("motivationQuote");
    if (!el) return;
    const quote = MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)];
    el.textContent = `"${quote}"`;
}

function initCustomerPage() {
    const slotsContainer = document.getElementById("slotsContainer");
    if (!slotsContainer) return;

    setRandomMotivationQuote();

    let selectedSlot = null;

    const dateInput = document.getElementById("appointmentDate");
    const btnBook = document.getElementById("btnBook");
    const availableCountEl = document.getElementById("availableCount");

    if (dateInput) {
        dateInput.value = getToday();
        dateInput.min = getToday();
    }

    function isValidTurkishPhone(raw) {
        const digits = raw.replace(/\D/g, "");
        if (/^(0?5\d{9})$/.test(digits)) return true;
        if (/^(90)(5\d{9})$/.test(digits)) return true;
        return false;
    }

    function showPhoneError(show) {
        let errEl = document.getElementById("phoneError");
        if (!errEl) {
            errEl = document.createElement("div");
            errEl.id = "phoneError";
            errEl.style.cssText = "font-size:0.75rem;color:var(--danger);margin-top:4px;";
            document.getElementById("customerPhone")?.parentNode.appendChild(errEl);
        }
        errEl.textContent = show ? "Geçerli bir Türk cep numarası girin (örn: 0555 123 45 67)" : "";
    }

    function updateBookButton() {
        const name = document.getElementById("customerName")?.value.trim() || "";
        const phone = document.getElementById("customerPhone")?.value.trim() || "";
        const service = document.getElementById("serviceSelect")?.value || "";
        const phoneOk = phone === "" || isValidTurkishPhone(phone);
        showPhoneError(phone !== "" && !phoneOk);
        if (btnBook) {
            btnBook.disabled = !(name && phone && phoneOk && service && selectedSlot);
        }
    }

    function onSlotSelect(slotEl, time) {
        document.querySelectorAll(".slot--selected").forEach(s => s.classList.remove("slot--selected"));
        slotEl.classList.add("slot--selected");
        selectedSlot = time;
        updateBookButton();
    }

    async function loadTodayCount() {
        try {
            const { appointments, blocked, dayClosed } = await getDayData(getToday());
            if (availableCountEl) {
                // Sadece çalışma saatleri içindeki slotlar üzerinden net boş sayısını hesaplıyoruz
                let realCount = 0;
                getVisibleSlots().forEach(time => {
                    const isBlocked = blocked && (blocked.has ? blocked.has(time) : blocked[time]);
                    const isBooked = appointments && appointments[time];
                    
                    // Eğer gün tamamen kapalı değilse, saat kapatılmamışsa ve randevu yoksa boştur
                    if (!dayClosed && !isBlocked && !isBooked) {
                        realCount++;
                    }
                });
                
                // Eğer gün tamamen kapalıysa direkt 0 yaz, değilse gerçek boş sayısını yaz kanka
                availableCountEl.textContent = dayClosed ? 0 : realCount;
            }
        } catch (err) {
            console.error(err);
            if (availableCountEl) availableCountEl.textContent = "-";
        }
    }

    async function loadAvailableSlots(belirliTarih) {
        const date = belirliTarih || dateInput?.value;
        if (!date) return;

        slotsContainer.innerHTML = '<div class="slots-loading">Saatler yükleniyor...</div>';
        selectedSlot = null;
        updateBookButton();

        try {
            const { appointments, blocked, dayClosed } = await getDayData(date);

            if (date === getToday() && availableCountEl) {
                availableCountEl.textContent = countAvailableSlots(appointments, blocked, dayClosed);
            }

            renderSlots(slotsContainer, date, appointments, blocked, false, onSlotSelect);
        } catch (err) {
            console.error("Saatler yüklenemedi:", err);
            showError(slotsContainer, firestoreErrorMessage(err));
            showToast("Saatler yüklenemedi.", "error");
        }
    }
    
    if (dateInput) {
        dateInput.addEventListener("change", () => {
            selectedSlot = null;
            updateBookButton();
            loadAvailableSlots();
        });
    }

    ["customerName", "customerPhone", "serviceSelect"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", updateBookButton);
            el.addEventListener("change", updateBookButton);
        }
    });

    if (btnBook) {
        btnBook.addEventListener("click", async () => {
            const customerName = document.getElementById("customerName").value.trim();
            const phone = document.getElementById("customerPhone").value.trim();
            const service = document.getElementById("serviceSelect").value;
            const date = dateInput.value;

            if (!customerName || !phone || !service || !selectedSlot) return;

            btnBook.disabled = true;
            btnBook.textContent = "Kaydediliyor...";

            try {
                // Yarış koşulunu önlemek için yazmadan hemen önce TAZE veri oku (cache bypass).
                const { appointments, blocked, dayClosed } = await getDayData(date, { force: true });

                if (dayClosed || blocked.has(selectedSlot) || appointments[selectedSlot]) {
                    showToast("Seçilen saat artık uygun değil.", "error");
                    selectedSlot = null;
                    await loadAvailableSlots();
                    return;
                }

                // Kanka randevuyu ana koleksiyona kaydedip barberId ekliyoruz ki her şey senkronize olsun
                const customerNoteEl = document.getElementById("customerNote");
                const musteriNotu = customerNoteEl ? customerNoteEl.value.trim() : "";

                await createAppointmentWithEffects({
                    barberId: aktifDukkan,
                    customerName,
                    phone,
                    service,
                    date,
                    time: selectedSlot,
                    status: "confirmed",
                    musteriNotu
                });

                showToast("Randevunuz başarıyla oluşturuldu!");
                selectedSlot = null;
                document.getElementById("customerName").value = "";
                document.getElementById("customerPhone").value = "";
                document.getElementById("serviceSelect").value = "";
                if (customerNoteEl) customerNoteEl.value = "";
                // Bu gün değişti: cache'i temizle ki reload taze okusun. "Bugün"
                // sayacı ise (farklı gün seçiliyse) cache'ten 0 okuma ile gelir.
                invalidateDay(date);
                await loadAvailableSlots();
                await loadTodayCount();
            } catch (err) {
                console.error(err);
                showToast(firestoreErrorMessage(err), "error");
            } finally {
                btnBook.textContent = "Randevuyu Onayla";
                updateBookButton();
            }
        });
    }

    loadAvailableSlots();
    loadTodayCount();
}

function initAdminPage() {
    const calendarGrid = document.getElementById("calendarGrid");
    if (!calendarGrid) return;

    initAdminTabs();
    initBarberLiveNotifications(aktifDukkan);
    initBarberMessaging(aktifDukkan, showToast);

    const crm = initCustomerCrm(aktifDukkan);
    document.querySelector('.admin-tab[data-tab="customers"]')
        ?.addEventListener("click", () => crm.activate());

    const subscription = initSubscriptionAdmin(aktifDukkan, showToast, {
        initialBarber: cachedBarberData,
        onActivated: (barber) => {
            cachedBarberData = { slug: aktifDukkan, ...barber };
            subscription.updateBarberData?.(cachedBarberData);
            applyAdminSubscriptionLock(cachedBarberData);
            if (calendarEnabled && typeof renderCalendarFn === "function") {
                renderCalendarFn();
            }
        }
    });

    const workingHoursAdmin = initWorkingHoursAdmin(aktifDukkan, showToast, {
        initialBarber: cachedBarberData,
        onUpdated: ({ openHour, closeHour }) => {
            activeWorkingHours = { openHour, closeHour };
            if (cachedBarberData) {
                cachedBarberData.openHour = openHour;
                cachedBarberData.closeHour = closeHour;
            }
            invalidateAllDayCache();
            if (calendarEnabled && typeof renderCalendarFn === "function") {
                renderCalendarFn();
            }
        }
    });

    document.getElementById("subTopGoTab")?.addEventListener("click", () => {
        subscription.openSubscriptionTab?.();
    });

    let calendarEnabled = true;
    let renderCalendarFn = null;
    let drawCalendarFn = null;

    function applyAdminSubscriptionLock(barber) {
        const allowed = isAdminCalendarAllowed(barber);
        calendarEnabled = allowed;

        const lockBanner = document.getElementById("adminSubLockBanner");
        const calPanel = document.querySelector('[data-panel="calendar"]');
        const customersTab = document.querySelector('.admin-tab[data-tab="customers"]');
        const messagesTab = document.querySelector('.admin-tab[data-tab="messages"]');
        const dayActions = document.getElementById("dayActions");
        const legend = document.querySelector(".admin-legend");
        const adminHeader = document.querySelector('[data-panel="calendar"] .admin-header');

        if (lockBanner) {
            lockBanner.hidden = allowed;
            if (!allowed) lockBanner.textContent = getAdminCalendarLockMessage();
        }

        if (customersTab) customersTab.hidden = !allowed;
        if (messagesTab) messagesTab.hidden = !allowed;

        if (!allowed && calPanel) {
            if (dayActions) dayActions.hidden = true;
            if (legend) legend.hidden = true;
            if (adminHeader) adminHeader.hidden = true;
            calendarGrid.innerHTML = `<div class="sub-lock-screen">
                <div class="sub-lock-screen__icon">🔒</div>
                <p>${getAdminCalendarLockMessage()}</p>
                <button type="button" class="btn btn-primary" id="goToSubscriptionTab">Kod Etkinleştir</button>
            </div>`;
            document.getElementById("goToSubscriptionTab")?.addEventListener("click", () => {
                subscription.openSubscriptionTab?.();
            });
            document.querySelector('.admin-tab[data-tab="subscription"]')?.click();
        } else if (allowed) {
            if (dayActions) dayActions.hidden = false;
            if (legend) legend.hidden = false;
            if (adminHeader) adminHeader.hidden = false;
            if (customersTab) customersTab.hidden = false;
            if (messagesTab) messagesTab.hidden = false;
        }
    }

    if (cachedBarberData) {
        applyAdminSubscriptionLock(cachedBarberData);
    }

    let currentMonday = getMondayOfWeek(new Date());
    let weekData = null;

    const weekLabel = document.getElementById("weekLabel");
    const dayActions = document.getElementById("dayActions");
    const modalOverlay = document.getElementById("modalOverlay");

    document.getElementById("btnPrevWeek")?.addEventListener("click", () => {
        currentMonday.setDate(currentMonday.getDate() - 7);
        renderCalendar();
    });

    document.getElementById("btnNextWeek")?.addEventListener("click", () => {
        currentMonday.setDate(currentMonday.getDate() + 7);
        renderCalendar();
    });

    modalOverlay?.addEventListener("click", (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    function closeModal() {
        modalOverlay?.classList.remove("show");
    }

    function openModal(title, bodyHtml, actionsHtml) {
        document.getElementById("modalTitle").textContent = title;
        document.getElementById("modalBody").innerHTML = bodyHtml;
        document.getElementById("modalActions").innerHTML = actionsHtml;
        modalOverlay.classList.add("show");
    }

    function formatDisplayDate(dateStr) {
        const [y, m, d] = dateStr.split("-");
        return `${d}.${m}.${y}`;
    }

    async function blockSlot(date, time) {
        await setDoc(doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, time)), { date, time });
    }

    async function unblockSlot(date, time) {
        await deleteDoc(doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, time)));
    }

    async function blockDay(date) {
        await setDoc(doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, "ALL")), { date, time: "ALL" });
    }

    async function unblockDay(date) {
        await deleteDoc(doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, "ALL")));
        const { blocked } = await fetchBlockedSlotsCollection(date);
        await Promise.all(
            [...blocked].map(t =>
                deleteDoc(doc(db, "berberler", aktifDukkan, "blockedSlots", blockedSlotId(date, t))).catch(() => {})
            )
        );
    }

    async function deleteAppointment(appointment) {
        if (appointment.legacy) {
            const snap = await getDoc(doc(db, "berberler", aktifDukkan, "appointments", appointment.date));
            if (snap.exists()) {
                const data = { ...snap.data() };
                Object.keys(data).forEach(key => {
                    if (normalizeTimeKey(key) === appointment.time) delete data[key];
                });
                await setDoc(doc(db, "berberler", aktifDukkan, "appointments", appointment.date), data);
            }
        } else {
            // Kanka randevuyu ana appointments koleksiyonundan silecek şekilde güncelledik
            await deleteDoc(doc(db, "appointments", appointment.id));
        }
    }

    function getCellState(date, time) {
        if (weekData.dayClosed[date]) return "closed";
        if (weekData.blocked[date].has(time)) return "closed";
        if (weekData.appointments[date][time]) return "booked";
        return "available";
    }
    async function handleCellClick(date, time) {
        try {
            const state = getCellState(date, time);

            if (state === "available") {
                openModal("Boş Randevu", `
                    <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:16px;">
                        <strong>${formatDisplayDate(date)} — ${time}</strong> için ne yapmak istersiniz?
                    </p>
                    <div class="form-group">
                        <label for="adminCustName">Müşteri Ad Soyad</label>
                        <input type="text" id="adminCustName" placeholder="Ahmet Yılmaz" style="width:100%;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:0.875rem;font-family:inherit;">
                    </div>
                    <div class="form-group" style="margin-top:10px;">
                        <label for="adminCustPhone">Telefon</label>
                        <input type="tel" id="adminCustPhone" placeholder="0555 123 45 67" style="width:100%;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:0.875rem;font-family:inherit;">
                    </div>
                    <div class="form-group" style="margin-top:10px;">
                        <label for="adminCustService">Hizmet</label>
                        <select id="adminCustService" style="width:100%;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:0.875rem;font-family:inherit;appearance:none;">
                            <option value="">Hizmet seçiniz...</option>
                            <option>Saç Kesimi</option>
                            <option>Saç + Sakal</option>
                            <option>Sakal</option>
                            <option>Çocuk Tıraşı</option>
                        </select>
                    </div>
                `, `
                    <button class="btn btn-secondary" id="modalBlock">Saati Kapat</button>
                    <button class="btn btn-primary" id="modalSaveAppt">Randevu Kaydet</button>
                `);

                document.getElementById("modalBlock").addEventListener("click", async () => {
                    closeModal();
                    await blockSlot(date, time);
                    showToast(`${formatDisplayDate(date)} ${time} kapatıldı.`);
                    await refreshDay(date);
                });

                document.getElementById("modalSaveAppt").addEventListener("click", async () => {
                    const customerName = document.getElementById("adminCustName").value.trim();
                    const phone = document.getElementById("adminCustPhone").value.trim();
                    const service = document.getElementById("adminCustService").value;

                    if (!customerName) {
                        showToast("Lütfen müşteri adını girin.", "error");
                        return;
                    }

                    try {
                        // Kanka admin panelinden girilen randevuyu da ana koleksiyona eşitliyoruz
                        await createAppointmentWithEffects({
                            barberId: aktifDukkan,
                            customerName,
                            phone: phone || "—",
                            service: service || "—",
                            date,
                            time,
                            status: "confirmed",
                            musteriNotu: ""
                        });
                        closeModal();
                        showToast(`${customerName} için randevu kaydedildi.`);
                        await refreshDay(date);
                    } catch (err) {
                        showToast(firestoreErrorMessage(err), "error");
                    }
                });
                return;
            }

            if (state === "closed") {
                if (weekData.dayClosed[date]) {
                    showToast("Günü açmak için üstteki butonu kullanın.", "error");
                    return;
                }
                await unblockSlot(date, time);
                showToast(`${formatDisplayDate(date)} ${time} açıldı.`);
                await refreshDay(date);
                return;
            }

            const appt = weekData.appointments[date][time];
            const outsideWarn = isOutsideCurrentWorkingHours(time)
                ? `<p style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.35);color:#fb923c;font-size:0.85rem;">⚠️ Bu randevu mevcut çalışma saatleri dışında kalıyor.</p>`
                : "";
            openModal("Randevu Detayı", `
                ${outsideWarn}
                <div class="modal-detail">
                    <div class="modal-detail-label">Müşteri</div>
                    <div class="modal-detail-value">${appt.customerName}</div>
                </div>
                <div class="modal-detail">
                    <div class="modal-detail-label">Telefon</div>
                    <div class="modal-detail-value">${appt.phone}</div>
                </div>
                ${formatCustomerNoteModalHtml(appt.musteriNotu)}
                <div class="modal-detail">
                    <div class="modal-detail-label">Hizmet</div>
                    <div class="modal-detail-value">${appt.service}</div>
                </div>
                <div class="modal-detail">
                    <div class="modal-detail-label">Tarih & Saat</div>
                    <div class="modal-detail-value">${formatDisplayDate(date)} — ${time}</div>
                </div>
                <div class="modal-detail">
                    <div class="modal-detail-label">Durum</div>
                    <div class="modal-detail-value">${appt.status || "confirmed"}</div>
                </div>
            `, `
                <button class="btn btn-secondary" id="modalClose">Kapat</button>
                <button class="btn btn-danger" id="modalDelete">Randevuyu Sil</button>
            `);

            document.getElementById("modalClose").addEventListener("click", closeModal);
            document.getElementById("modalDelete").addEventListener("click", async () => {
                closeModal();
                showUndoToast(`Randevu silindi.`, async () => {
                    try {
                        // Kanka geri alma butonuna basınca da yine ana koleksiyona yazıyoruz
                        await createAppointmentWithEffects({
                            barberId: aktifDukkan,
                            customerName: appt.customerName,
                            phone: appt.phone === "—" ? "" : appt.phone,
                            service: appt.service === "—" ? "" : appt.service,
                            date: appt.date,
                            time: appt.time,
                            status: appt.status || "confirmed",
                            musteriNotu: appt.musteriNotu || ""
                        });
                        showToast("Randevu geri alındı.");
                        await refreshDay(appt.date);
                    } catch (err) {
                        showToast("Geri alma başarısız: " + firestoreErrorMessage(err), "error");
                    }
                }, async () => {
                    await deleteAppointment(appt);
                    await refreshDay(appt.date);
                });
            });
        } catch (err) {
            console.error(err);
            showToast(firestoreErrorMessage(err), "error");
        }
    }
    function renderDayActions(weekDates) {
        if (!dayActions) return;
        dayActions.innerHTML = "";
        weekDates.forEach((date, i) => {
            const btn = document.createElement("button");
            btn.className = "btn btn-secondary btn-sm";
            const isClosed = weekData.dayClosed[date];
            btn.textContent = isClosed
                ? `${DAY_NAMES[i]} — Günü Aç`
                : `${DAY_NAMES[i]} — Günü Kapat`;
            btn.addEventListener("click", async () => {
                try {
                    if (isClosed) {
                        await unblockDay(date);
                        showToast(`${DAY_NAMES[i]} günü açıldı.`);
                    } else {
                        await blockDay(date);
                        showToast(`${DAY_NAMES[i]} günü kapatıldı.`);
                    }
                    await refreshDay(date);
                } catch (err) {
                    console.error(err);
                    showToast(firestoreErrorMessage(err), "error");
                }
            });
            dayActions.appendChild(btn);
        });
    }

    // Yalnızca bellekteki weekData'dan DOM çizer (Firestore okuması YAPMAZ).
    function drawCalendar() {
        const weekDates = getWeekDates(currentMonday);
        const today = getToday();

        if (weekLabel) {
            weekLabel.textContent = `${formatDisplayDate(weekDates[0])} — ${formatDisplayDate(weekDates[6])}`;
        }

        calendarGrid.innerHTML = "";

        const corner = document.createElement("div");
        corner.className = "calendar-header calendar-header--corner";
        corner.textContent = "Saat";
        calendarGrid.appendChild(corner);

        weekDates.forEach((date, i) => {
            const header = document.createElement("div");
            header.className = "calendar-header";
            if (date === today) header.classList.add("calendar-header--today");
            header.innerHTML = `${DAY_NAMES[i]}<small>${formatDisplayDate(date)}</small>`;
            calendarGrid.appendChild(header);
        });

        getAdminCalendarSlots(weekData).forEach(time => {
            const timeLabel = document.createElement("div");
            timeLabel.className = "time-label";
            timeLabel.textContent = time;
            calendarGrid.appendChild(timeLabel);

            const outsideHours = isOutsideCurrentWorkingHours(time);

            weekDates.forEach(date => {
                const cell = document.createElement("div");
                const state = getCellState(date, time);
                cell.className = `calendar-cell calendar-cell--${state}`;

                if (outsideHours) {
                    cell.classList.add("calendar-cell--outside-hours");
                }

                if (state === "booked") {
                    const appt = weekData.appointments[date][time];
                    cell.textContent = appt.customerName ? appt.customerName.split(" ")[0] : "Dolu";
                    let tip = `${appt.customerName || "Müşteri"} — ${appt.service || "Hizmet"}`;
                    if (outsideHours) {
                        tip += " — Bu randevu mevcut çalışma saatleri dışında kalıyor.";
                    }
                    cell.title = tip;
                } else if (state === "closed") {
                    cell.textContent = "Kapalı";
                    if (outsideHours) {
                        cell.title = "Bu saat mevcut çalışma saatleri dışında.";
                    }
                } else {
                    cell.textContent = "Boş";
                }

                cell.addEventListener("click", () => handleCellClick(date, time));
                calendarGrid.appendChild(cell);
            });
        });

        renderDayActions(weekDates);
    }

    // Tüm haftayı Firestore'dan çeker (ilk yükleme + hafta değişimi).
    async function renderCalendar() {
        if (!calendarEnabled) return;
        const weekDates = getWeekDates(currentMonday);
        calendarGrid.innerHTML = '<div class="slots-loading">Takvim yükleniyor...</div>';

        try {
            weekData = await getWeekData(weekDates);
            drawCalendar();
        } catch (err) {
            console.error("Takvim yüklenemedi:", err);
            showError(calendarGrid, "Takvim yüklenemedi. Lütfen sayfayı yenileyin.");
            showToast("Takvim yüklenemedi.", "error");
        }
    }

    // İşlem sonrası SADECE ilgili günü taze okuyup yeniden çizer.
    // Haftalık ~21 okuma yerine tek gün (~3 okuma) ile günceller.
    async function refreshDay(date) {
        if (!weekData || !weekData.appointments[date]) {
            return renderCalendar();
        }
        try {
            invalidateDay(date);
            const d = await getDayData(date, { force: true });
            weekData.appointments[date] = d.appointments;
            weekData.blocked[date] = d.blocked;
            weekData.dayClosed[date] = d.dayClosed;
            drawCalendar();
        } catch (err) {
            console.error("Gün güncellenemedi:", err);
            showToast(firestoreErrorMessage(err), "error");
        }
    }

    if (calendarEnabled) {
        renderCalendarFn = renderCalendar;
        drawCalendarFn = drawCalendar;
        renderCalendar();
    }
}

function init() {
    if (!db) {
        const msg = "Firebase bağlantısı kurulamadı. Sayfayı bir web sunucusu üzerinden açtığınızdan emin olun (file:// yerine http://).";
        showError(document.getElementById("slotsContainer"), msg);
        showError(document.getElementById("calendarGrid"), msg);
        showToast(msg, "error");
        return;
    }

    dukkanArayuzunuDinamikYap().then((canContinue) => {
        if (!canContinue) return;

        if (document.getElementById("slotsContainer")) {
            initCustomerPage();
        }

        if (document.getElementById("calendarGrid") && aktifDukkan) {
            initAdminPage();
        }
    });
}

window.addEventListener("unhandledrejection", (e) => {
    console.error("Yakalanmamış hata:", e.reason);
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
// === BUTONLARIN LİNKİNİ DÜKKANA GÖRE OTOMATİK AYARLAYAN SİHİRBAZ ===
function butonLinkleriniGuncelle() {
    const urlParams = new URLSearchParams(window.location.search);
    const gecerliDukkan = urlParams.get("dukkan") || urlParams.get("randevu") || urlParams.get("shop") || aktifDukkan || "x-men";

    // 1. Randevu sayfasındaki "Yönetim Paneli" butonunu dükkana göre yönlendir
    const adminPanelLink = document.getElementById("adminPanelLink");
    if (adminPanelLink) {
        adminPanelLink.href = `admin.html?dukkan=${encodeURIComponent(gecerliDukkan)}`;
    }

    // 2. Admin panelindeki "Müşteri Paneline Dön" butonunu randevu sayfasına yönlendir.
    //    Yalnızca bilinen ID/metin hedeflenir; randevu sayfasındaki "Ana Sayfa" linki korunur.
    const btnMusteriDon = document.getElementById("backToClientLink") ||
                          document.getElementById("barberBackLink") ||
                          Array.from(document.querySelectorAll("a")).find(el =>
                              el.textContent.includes("Müşteri Paneline Dön") ||
                              el.textContent.includes("Müşteri sayfasına dön"));

    if (btnMusteriDon && btnMusteriDon.tagName === "A") {
        btnMusteriDon.href = `randevu.html?dukkan=${encodeURIComponent(gecerliDukkan)}`;
    }
}

// Sayfa her açıldığında bu düzeltmeyi otomatik çalıştır
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", butonLinkleriniGuncelle);
} else {
    butonLinkleriniGuncelle();
}
// Not: Eski "disaridanSayaciGuncelle" DOM tarayıcı hack'i kaldırıldı.
// Boş slot sayacı artık loadAvailableSlots/loadTodayCount tarafından (çalışma
// saatleri filtresiyle) doğru biçimde hesaplanıyor; ayrıca her tıkta tüm DOM'u
// taramaya gerek yok.
// === YÖNETİM PANELİNDEN DOĞRU DÜKKANA DÖNÜŞ SİHİRBAZI ===
document.addEventListener("DOMContentLoaded", () => {
    const backLink = document.getElementById("backToClientLink");
    if (backLink) {
        // Mevcut URL'deki dükkan parametresini çekiyoruz (Örn: abc veya x-men)
        const urlParams = new URLSearchParams(window.location.search);
        const dukkanParam = urlParams.get('dukkan') || urlParams.get('randevu') || urlParams.get('shop');

        if (dukkanParam) {
            backLink.href = `randevu.html?dukkan=${encodeURIComponent(dukkanParam)}`;
        } else {
            backLink.href = "index.html";
        }
    }
});