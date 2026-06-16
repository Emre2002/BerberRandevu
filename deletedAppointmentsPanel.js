import {
    fetchActiveDeletedAppointments,
    formatDeletedAt,
    formatArchiveExpiry
} from "./deletedAppointmentsService.js";

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return "—";
    const [y, m, d] = dateStr.split("-");
    return `${d}.${m}.${y}`;
}

function renderTableRow(item) {
    return `<tr>
        <td>${escapeHtml(item.customerName || "—")}</td>
        <td>${escapeHtml(item.customerPhone || "—")}</td>
        <td>${formatDisplayDate(item.appointmentDate)}</td>
        <td>${escapeHtml(item.appointmentTime || "—")}</td>
        <td>${escapeHtml(item.serviceName || "—")}</td>
        <td>${formatDeletedAt(item.deletedAt)}</td>
        <td>${escapeHtml(item.deletedBy || "—")}</td>
        <td>${escapeHtml(item.note || "—")}</td>
    </tr>`;
}

function renderCard(item) {
    const expiry = formatArchiveExpiry(item.deleteExpireAt);
    return `<div class="da-card">
        <div class="da-card__head">
            <strong>${escapeHtml(item.customerName || "—")}</strong>
            ${expiry ? `<span class="da-card__expiry">${escapeHtml(expiry)}</span>` : ""}
        </div>
        <div class="da-card__grid">
            <div><span>Telefon</span><strong>${escapeHtml(item.customerPhone || "—")}</strong></div>
            <div><span>Tarih</span><strong>${formatDisplayDate(item.appointmentDate)}</strong></div>
            <div><span>Saat</span><strong>${escapeHtml(item.appointmentTime || "—")}</strong></div>
            <div><span>Hizmet</span><strong>${escapeHtml(item.serviceName || "—")}</strong></div>
            <div><span>Silinme</span><strong>${formatDeletedAt(item.deletedAt)}</strong></div>
            <div><span>Silen</span><strong>${escapeHtml(item.deletedBy || "—")}</strong></div>
        </div>
        ${item.note ? `<p class="da-card__note"><span>Not:</span> ${escapeHtml(item.note)}</p>` : ""}
    </div>`;
}

export function initDeletedAppointmentsPanel(barberSlug) {
    const tableBody = document.getElementById("daTableBody");
    const cardsHost = document.getElementById("daCards");
    const emptyEl = document.getElementById("daEmpty");
    const loadingEl = document.getElementById("daLoading");
    const countEl = document.getElementById("daCount");

    let loaded = false;

    async function load({ force = false } = {}) {
        if (!tableBody) return;
        if (loaded && !force) return;

        if (loadingEl) loadingEl.hidden = false;
        if (emptyEl) emptyEl.hidden = true;
        tableBody.innerHTML = "";
        if (cardsHost) cardsHost.innerHTML = "";

        try {
            const items = await fetchActiveDeletedAppointments(barberSlug);
            loaded = true;

            if (countEl) countEl.textContent = String(items.length);

            if (!items.length) {
                if (emptyEl) {
                    emptyEl.hidden = false;
                    emptyEl.textContent = "Son 7 gün içinde silinen randevu bulunmuyor.";
                }
                return;
            }

            tableBody.innerHTML = items.map(renderTableRow).join("");
            if (cardsHost) cardsHost.innerHTML = items.map(renderCard).join("");
        } catch (err) {
            console.error("Silinen randevular yüklenemedi:", err);
            if (emptyEl) {
                emptyEl.hidden = false;
                emptyEl.textContent = "Silinen randevular yüklenemedi. Lütfen tekrar deneyin.";
            }
        } finally {
            if (loadingEl) loadingEl.hidden = true;
        }
    }

    return {
        activate() {
            load({ force: true });
        },
        refresh() {
            loaded = false;
            return load({ force: true });
        }
    };
}
