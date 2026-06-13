import {
    fetchAllPendingBarbers,
    approvePendingBarber,
    rejectPendingBarber,
    formatPendingDate,
    packageLabel,
    buildWhatsAppApprovalLink,
    PACKAGE_OPTIONS
} from "./pendingBarberService.js";

let cache = [];
let filter = { status: "pending", city: "all" };
let showToastFn = () => {};

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function getFiltered() {
    return cache
        .filter((p) => {
            if (filter.status !== "all" && p.status !== filter.status) return false;
            if (filter.city !== "all" && p.city !== filter.city) return false;
            return true;
        })
        .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() || 0;
            const tb = b.createdAt?.toMillis?.() || 0;
            return tb - ta;
        });
}

function statusBadge(status) {
    const map = {
        pending: { cls: "pb-badge--pending", label: "Bekleyen" },
        approved: { cls: "pb-badge--approved", label: "Onaylandı" },
        rejected: { cls: "pb-badge--rejected", label: "Reddedildi" }
    };
    const m = map[status] || map.pending;
    return `<span class="pb-badge ${m.cls}">${m.label}</span>`;
}

function cardHtml(p) {
    const actions = p.status === "pending"
        ? `<div class="pb-card__actions">
            <button type="button" class="sa-btn sa-btn--primary" data-pb-approve="${p.id}">✅ Onayla</button>
            <button type="button" class="sa-btn sa-btn--danger" data-pb-reject="${p.id}">❌ Reddet</button>
           </div>`
        : p.status === "approved" && p.createdSlug
            ? `<div class="pb-card__actions">
                <span class="pb-card__creds">Slug: <code>${escapeHtml(p.createdSlug)}</code></span>
                <a href="${buildWhatsAppApprovalLink(p.phone, { slug: p.createdSlug, username: p.createdUsername, password: p.createdPassword })}" target="_blank" rel="noopener noreferrer" class="sa-btn sa-btn--ghost">📱 WhatsApp Gönder</a>
               </div>`
            : "";

    return `<article class="pb-card" data-pb-id="${p.id}">
        <div class="pb-card__head">
            <h3 class="pb-card__title">${escapeHtml(p.shopName)}</h3>
            ${statusBadge(p.status)}
        </div>
        <div class="pb-card__grid">
            <div><span>Yetkili</span><strong>${escapeHtml(p.ownerName)}</strong></div>
            <div><span>Telefon</span><strong>${escapeHtml(p.phone)}</strong></div>
            <div><span>E-posta</span><strong>${escapeHtml(p.email)}</strong></div>
            <div><span>İl / İlçe</span><strong>${escapeHtml(p.city)} / ${escapeHtml(p.district)}</strong></div>
            <div><span>Çalışma</span><strong>${escapeHtml(p.openingHour)} – ${escapeHtml(p.closingHour)}</strong></div>
            <div><span>Paket</span><strong>${packageLabel(p.packageType)}</strong></div>
            <div><span>Başvuru</span><strong>${formatPendingDate(p.createdAt)}</strong></div>
        </div>
        ${p.address ? `<p class="pb-card__addr">📍 ${escapeHtml(p.address)}</p>` : ""}
        ${p.message ? `<p class="pb-card__msg">💬 ${escapeHtml(p.message)}</p>` : ""}
        ${actions}
    </article>`;
}

function getPendingCount() {
    return cache.filter((p) => p.status === "pending").length;
}

function patchCacheItem(id, patch) {
    const idx = cache.findIndex((p) => p.id === id);
    if (idx >= 0) cache[idx] = { ...cache[idx], ...patch };
    renderFilters();
    renderCards();
    return cache[idx];
}

function renderFilters() {
    const host = document.getElementById("pbFilters");
    const cityHost = document.getElementById("pbCityFilter");
    if (!host) return;

    const counts = {
        all: cache.length,
        pending: cache.filter((p) => p.status === "pending").length,
        approved: cache.filter((p) => p.status === "approved").length,
        rejected: cache.filter((p) => p.status === "rejected").length
    };

    host.innerHTML = `
        <button type="button" class="pb-chip ${filter.status === "all" ? "active" : ""}" data-pb-status="all">Tümü (${counts.all})</button>
        <button type="button" class="pb-chip ${filter.status === "pending" ? "active" : ""}" data-pb-status="pending">Bekleyen (${counts.pending})</button>
        <button type="button" class="pb-chip ${filter.status === "approved" ? "active" : ""}" data-pb-status="approved">Onaylanan (${counts.approved})</button>
        <button type="button" class="pb-chip ${filter.status === "rejected" ? "active" : ""}" data-pb-status="rejected">Reddedilen (${counts.rejected})</button>`;

    if (cityHost) {
        const cities = [...new Set(cache.map((p) => p.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
        cityHost.innerHTML = `<option value="all">Tüm İller</option>${cities.map((c) =>
            `<option value="${escapeHtml(c)}" ${filter.city === c ? "selected" : ""}>${escapeHtml(c)}</option>`
        ).join("")}`;
    }
}

function renderCards() {
    const host = document.getElementById("pbCards");
    const countEl = document.getElementById("pbCount");
    if (!host) return;

    const list = getFiltered();
    if (countEl) countEl.textContent = `${list.length} başvuru`;

    if (!list.length) {
        host.innerHTML = `<div class="sa-table__empty">${cache.length ? "Filtreye uygun başvuru yok." : "Henüz başvuru yok."}</div>`;
        return;
    }
    host.innerHTML = list.map(cardHtml).join("");
}

export async function loadPendingBarbersPanel() {
    cache = await fetchAllPendingBarbers();
    renderFilters();
    renderCards();
    return getPendingCount();
}

export function getPendingBarbersCache() {
    return cache;
}

export function bindPendingBarbersEvents(showToast, onApproved) {
    showToastFn = showToast;

    document.getElementById("pbFilters")?.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-pb-status]");
        if (!chip) return;
        filter.status = chip.dataset.pbStatus;
        renderFilters();
        renderCards();
    });

    document.getElementById("pbCityFilter")?.addEventListener("change", (e) => {
        filter.city = e.target.value;
        renderCards();
    });

    document.getElementById("pbCards")?.addEventListener("click", async (e) => {
        const approveBtn = e.target.closest("[data-pb-approve]");
        const rejectBtn = e.target.closest("[data-pb-reject]");

        if (approveBtn) {
            const id = approveBtn.dataset.pbApprove;
            approveBtn.disabled = true;
            try {
                const result = await approvePendingBarber(id);
                const pending = patchCacheItem(id, {
                    status: "approved",
                    createdSlug: result.slug,
                    createdUsername: result.username,
                    createdPassword: result.password
                });
                showToastFn(`"${result.slug}" dükkanı oluşturuldu.`);
                onApproved?.({ result, pending, pendingCount: getPendingCount() });
            } catch (err) {
                showToastFn(err.message, "error");
            } finally {
                approveBtn.disabled = false;
            }
        }

        if (rejectBtn) {
            if (!confirm("Bu başvuruyu reddetmek istediğinize emin misiniz?")) return;
            rejectBtn.disabled = true;
            try {
                await rejectPendingBarber(rejectBtn.dataset.pbReject);
                patchCacheItem(rejectBtn.dataset.pbReject, { status: "rejected" });
                showToastFn("Başvuru reddedildi.");
                onApproved?.({ pendingCount: getPendingCount() });
            } catch (err) {
                showToastFn(err.message, "error");
            } finally {
                rejectBtn.disabled = false;
            }
        }
    });
}

export function getPendingBarbersPanelHtml() {
    return `
        <div class="pb-panel">
            <section class="sa-card">
                <div class="sad-card-head">
                    <h2 class="sa-card__title" style="margin:0;">🏪 Bekleyen Dükkanlar</h2>
                    <span class="sad-result-count" id="pbCount"></span>
                </div>
                <div class="pb-toolbar">
                    <div class="pb-filters" id="pbFilters"></div>
                    <select id="pbCityFilter" class="sad-select-native pb-city-select">
                        <option value="all">Tüm İller</option>
                    </select>
                </div>
                <div class="pb-cards" id="pbCards">
                    <div class="sa-loading">Yükleniyor...</div>
                </div>
            </section>
        </div>`;
}

export { PACKAGE_OPTIONS };
