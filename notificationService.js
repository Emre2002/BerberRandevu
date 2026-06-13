import {
    collection, addDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { fetchBarber } from "./firestoreService.js";

const NOTIFICATIONS = "notifications";

/**
 * Yeni randevu bildirimi oluşturur ve Telegram mock tetikler.
 */
export async function notifyNewAppointment({ barberSlug, customerName, phone, date, time }) {
    await addDoc(collection(db, NOTIFICATIONS), {
        type: "newAppointment",
        barberSlug,
        customerName,
        phone: phone || "—",
        date,
        time,
        read: false,
        createdAt: serverTimestamp()
    });

    const barber = await fetchBarber(barberSlug);
    if (barber?.telegramChatId) {
        await sendTelegramNotification({
            chatId: barber.telegramChatId,
            text: buildTelegramAppointmentMessage({ customerName, phone, date, time, barberName: barber.name })
        });
    }

    return true;
}

export function buildTelegramAppointmentMessage({ customerName, phone, date, time, barberName }) {
    return `🔔 Yeni Randevu\n\nBerber: ${barberName || "—"}\nMüşteri: ${customerName}\nTelefon: ${phone}\nTarih: ${date}\nSaat: ${time}`;
}

/**
 * Telegram Bot API — mock implementasyon.
 * Gerçek entegrasyon: TELEGRAM_BOT_TOKEN env + fetch to api.telegram.org
 */
export async function sendTelegramNotification({ chatId, text }) {
    const token = window.TELEGRAM_BOT_TOKEN || null;

    if (!token) {
        console.info("[Telegram Mock]", { chatId, text });
        return { success: true, mock: true, messageId: `mock-${Date.now()}` };
    }

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
        });
        const data = await res.json();
        return { success: data.ok, data };
    } catch (err) {
        console.error("[Telegram]", err);
        return { success: false, error: err.message };
    }
}

export const TelegramAdapter = {
    sendMessage: sendTelegramNotification,
    setWebhook: async (url) => {
        console.info("[Telegram] setWebhook placeholder", url);
        return { ok: true, mock: true };
    }
};

export async function fetchNotificationsByBarber(barberSlug, limit = 50) {
    const q = query(
        collection(db, NOTIFICATIONS),
        where("barberSlug", "==", barberSlug),
        orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list.slice(0, limit);
}

/**
 * Berber panelinde canlı bildirim dinleyicisi.
 *
 * MALİYET NOTU: Sorgu yalnızca dinleyici bağlandıktan SONRA oluşturulan
 * bildirimleri çeker (createdAt > now). Böylece panel her açıldığında tüm
 * bildirim geçmişi okunmaz; ilk snapshot ~0 okuma ile başlar.
 *
 * Gereken composite index (Firestore ilk çalıştırmada tek tıkla link verir):
 *   collection: notifications | barberSlug ASC, createdAt ASC
 *
 * @returns {Function} unsubscribe — sayfa/komponent kapanışında çağrılmalı.
 */
export function subscribeBarberNotifications(barberSlug, { onNew, onError }) {
    const since = Timestamp.now();
    const q = query(
        collection(db, NOTIFICATIONS),
        where("barberSlug", "==", barberSlug),
        where("createdAt", ">", since),
        orderBy("createdAt", "asc"),
        limit(30)
    );

    return onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            if (data.type === "newAppointment") {
                onNew({ id: change.doc.id, ...data });
            }
        });
    }, onError);
}

export function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 200);
    } catch {
        /* ses desteklenmiyorsa sessiz devam */
    }
}

export function showLiveNotificationToast(container, data) {
    if (!container) return;

    const el = document.createElement("div");
    el.className = "live-notif";
    el.innerHTML = `
        <div class="live-notif__icon">🔔</div>
        <div class="live-notif__body">
            <strong>Yeni Randevu</strong>
            <div>${data.customerName || "Müşteri"}</div>
            <div class="live-notif__time">${data.time || "—"} · ${data.date || ""}</div>
        </div>
    `;
    container.prepend(el);
    setTimeout(() => el.classList.add("live-notif--show"), 10);
    setTimeout(() => {
        el.classList.remove("live-notif--show");
        setTimeout(() => el.remove(), 300);
    }, 6000);
}
