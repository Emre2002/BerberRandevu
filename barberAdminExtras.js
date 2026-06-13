import { fetchCustomersByBarber } from "./customerService.js";
import {
    sendCampaign, fetchCampaignsByBarber, BARBER_TEMPLATES, buildTemplateMessage
} from "./campaignService.js";
import {
    subscribeBarberNotifications, playNotificationSound, showLiveNotificationToast
} from "./notificationService.js";

/**
 * Berber paneli: canlı randevu bildirimleri.
 */
export function initBarberLiveNotifications(barberSlug) {
    const container = document.getElementById("liveNotificationCenter");
    if (!container || !barberSlug) return;

    const unsubscribe = subscribeBarberNotifications(barberSlug, {
        onNew: (data) => {
            showLiveNotificationToast(container, data);
            playNotificationSound();
        },
        onError: (err) => console.error("Bildirim dinleyici hatası:", err)
    });

    // Bellek sızıntısını önlemek için sayfa kapanışında dinleyiciyi kapat.
    const cleanup = () => {
        try { unsubscribe?.(); } catch { /* zaten kapalıysa yoksay */ }
    };
    window.addEventListener("pagehide", cleanup, { once: true });
    window.addEventListener("beforeunload", cleanup, { once: true });

    return unsubscribe;
}

/**
 * Berber paneli: müşterilere toplu mesaj sekmesi.
 */
export function initBarberMessaging(barberSlug, showToast) {
    const templateSelect = document.getElementById("barberTemplateSelect");
    const messagePreview = document.getElementById("barberMessagePreview");
    const customMessage = document.getElementById("barberCustomMessage");
    const sendBtn = document.getElementById("barberSendCampaignBtn");
    const customerCountEl = document.getElementById("barberCustomerCount");
    const historyEl = document.getElementById("barberCampaignHistory");

    if (!templateSelect) return;

    templateSelect.innerHTML = Object.values(BARBER_TEMPLATES)
        .map((t) => `<option value="${t.id}">${t.label}</option>`)
        .join("");

    function updatePreview() {
        const tpl = BARBER_TEMPLATES[templateSelect.value];
        const custom = customMessage?.value?.trim();
        messagePreview.textContent = custom || buildTemplateMessage(tpl);
    }

    async function loadCustomers() {
        const customers = await fetchCustomersByBarber(barberSlug);
        if (customerCountEl) customerCountEl.textContent = customers.length;
        return customers;
    }

    async function loadHistory() {
        if (!historyEl) return;
        const history = await fetchCampaignsByBarber(barberSlug);
        if (!history.length) {
            historyEl.innerHTML = `<p class="msg-empty">Henüz mesaj gönderilmedi.</p>`;
            return;
        }
        historyEl.innerHTML = history.map((c) => {
            const date = c.createdAt?.toDate?.() ? c.createdAt.toDate().toLocaleString("tr-TR") : "—";
            return `<div class="msg-history-item">
                <div class="msg-history-item__meta">${date} · ${c.recipientCount} alıcı</div>
                <div class="msg-history-item__text">${c.message}</div>
            </div>`;
        }).join("");
    }

    templateSelect.addEventListener("change", updatePreview);
    customMessage?.addEventListener("input", updatePreview);

    sendBtn?.addEventListener("click", async () => {
        sendBtn.disabled = true;
        try {
            const result = await sendCampaign({
                target: "barber",
                barberSlug,
                templateId: templateSelect.value,
                customMessage: customMessage?.value || "",
                sentBy: barberSlug,
                templates: BARBER_TEMPLATES
            });
            showToast(`${result.recipientCount} müşteriye mesaj kaydedildi (mock).`);
            await loadHistory();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            sendBtn.disabled = false;
        }
    });

    updatePreview();
    loadCustomers();
    loadHistory();
}

export function initAdminTabs() {
    const tabs = document.querySelectorAll(".admin-tab");
    const panels = document.querySelectorAll(".admin-tab-panel");

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            panels.forEach((p) => p.hidden = true);
            tab.classList.add("active");
            const panel = document.querySelector(`[data-panel="${tab.dataset.tab}"]`);
            if (panel) panel.hidden = false;
        });
    });
}
