import {
    fetchCustomersByBarber,
    fetchAppointmentsByBarber,
    normalizeCustomerRecord,
    normalizePhone,
    CUSTOMER_STATUS,
    VIP_THRESHOLD
} from "./customerService.js";

/**
 * Berber admin paneli — Müşteri Yönetimi (CRM) modülü.
 *
 * MALİYET STRATEJİSİ:
 *  - Müşteriler sekmesi İLK açıldığında tek bir `where(barberSlug==)` sorgusu
 *    ile o berberin tüm müşterileri okunur ve bellekte tutulur (realtime YOK).
 *  - Arama / sıralama / filtre / sayfalama tamamen istemci tarafında çalışır;
 *    ekstra Firestore okuması üretmez.
 *  - Randevu geçmişi için berberin randevuları oturum başına bir kez okunup
 *    cache'lenir (detay modalı her açıldığında tekrar okunmaz).
 */
export function initCustomerCrm(barberSlug) {
    const panel = document.querySelector('[data-panel="customers"]');
    if (!panel || !barberSlug) return { activate: () => {} };

    const el = {
        stats: panel.querySelector("#crmStats"),
        filters: panel.querySelector("#crmFilters"),
        search: panel.querySelector("#crmSearch"),
        tableHead: panel.querySelector("#crmTableHead"),
        tableBody: panel.querySelector("#crmTableBody"),
        cards: panel.querySelector("#crmCards"),
        empty: panel.querySelector("#crmEmpty"),
        pagination: panel.querySelector("#crmPagination"),
        modalOverlay: panel.querySelector("#crmModalOverlay"),
        modalBody: panel.querySelector("#crmModalBody"),
        modalClose: panel.querySelector("#crmModalClose")
    };

    const PAGE_SIZE = 12;
    const SORT_COLUMNS = [
        { key: "fullName", label: "Ad Soyad", type: "text" },
        { key: "phone", label: "Telefon", type: "text" },
        { key: "totalVisits", label: "Toplam Ziyaret", type: "number" },
        { key: "firstVisit", label: "İlk Geliş", type: "date" },
        { key: "lastVisit", label: "Son Geliş", type: "date" }
    ];
    const FILTERS = [
        { id: "all", label: "Tüm Müşteriler", icon: "👥" },
        { id: "active", label: "Aktif", icon: "🟢" },
        { id: "risky", label: "Riskli", icon: "🟡" },
        { id: "lost", label: "Kaybedilmiş", icon: "🔴" },
        { id: "vip", label: "VIP", icon: "⭐" }
    ];

    let loaded = false;
    let loading = false;
    let allCustomers = [];
    let appointmentsCache = null;

    const state = {
        search: "",
        filter: "all",
        sortKey: "lastVisit",
        sortDir: "desc",
        page: 1
    };

    // --- yardımcılar --------------------------------------------------------

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function fmtDate(date) {
        if (!date) return "—";
        return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    function statusBadge(status, isVip) {
        const s = CUSTOMER_STATUS[status] || CUSTOMER_STATUS.lost;
        const vip = isVip ? `<span class="crm-badge crm-badge--vip">⭐ VIP</span>` : "";
        return `<span class="crm-badge crm-badge--${status}">${s.emoji} ${s.label}</span>${vip}`;
    }

    // Farklı yazılan isimleri (telefonla birleşmiş müşteri) sayaçlarıyla gösterir.
    function nameVariantsHtml(variants) {
        if (!variants) return "";
        const entries = Object.entries(variants).sort((a, b) => b[1] - a[1]);
        if (entries.length <= 1) return "";
        return `<div class="crm-detail__variants">
            <h4>Kullanılan İsimler</h4>
            <div class="crm-variant-list">
                ${entries.map(([name, count]) => `
                    <span class="crm-variant">
                        <span class="crm-variant__name">${escapeHtml(name)}</span>
                        <span class="crm-variant__count">${count}</span>
                    </span>`).join("")}
            </div>
        </div>`;
    }

    function isSameMonth(date) {
        if (!date) return false;
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }

    // --- veri yükleme -------------------------------------------------------

    async function load() {
        if (loaded || loading) return;
        loading = true;
        renderLoading();
        try {
            const raw = await fetchCustomersByBarber(barberSlug);
            allCustomers = raw.map(normalizeCustomerRecord);
            loaded = true;
            renderAll();
        } catch (err) {
            console.error("Müşteriler yüklenemedi:", err);
            if (el.tableBody) el.tableBody.innerHTML = "";
            if (el.cards) el.cards.innerHTML = "";
            if (el.empty) {
                el.empty.hidden = false;
                el.empty.innerHTML = `<div class="crm-empty__icon">⚠️</div><p>Müşteriler yüklenemedi. Lütfen tekrar deneyin.</p>`;
            }
        } finally {
            loading = false;
        }
    }

    async function getAppointments() {
        if (appointmentsCache) return appointmentsCache;
        appointmentsCache = await fetchAppointmentsByBarber(barberSlug);
        return appointmentsCache;
    }

    // --- görünüm hesaplama --------------------------------------------------

    function getFilteredSorted() {
        const term = state.search.trim().toLowerCase();
        const termDigits = term.replace(/\D/g, "");

        let list = allCustomers.filter((c) => {
            if (state.filter === "vip" && !c.isVip) return false;
            if (["active", "risky", "lost"].includes(state.filter) && c.status !== state.filter) return false;

            if (!term) return true;
            const nameHit = c.fullName.toLowerCase().includes(term);
            const phoneHit = termDigits && normalizePhone(c.phone).includes(termDigits);
            return nameHit || phoneHit;
        });

        const col = SORT_COLUMNS.find((s) => s.key === state.sortKey) || SORT_COLUMNS[0];
        const dir = state.sortDir === "asc" ? 1 : -1;
        list = [...list].sort((a, b) => {
            let av = a[col.key];
            let bv = b[col.key];
            if (col.type === "date") {
                av = av ? av.getTime() : -Infinity;
                bv = bv ? bv.getTime() : -Infinity;
            } else if (col.type === "number") {
                av = av || 0; bv = bv || 0;
            } else {
                return dir * String(av || "").localeCompare(String(bv || ""), "tr");
            }
            return dir * (av - bv);
        });
        return list;
    }

    // --- render -------------------------------------------------------------

    function renderLoading() {
        if (el.tableBody) {
            el.tableBody.innerHTML = `<tr><td colspan="6" class="crm-loading">Müşteriler yükleniyor...</td></tr>`;
        }
        if (el.cards) el.cards.innerHTML = `<div class="crm-loading">Müşteriler yükleniyor...</div>`;
    }

    function renderAll() {
        renderStats();
        renderFilters();
        renderTableHead();
        renderList();
    }

    function renderStats() {
        if (!el.stats) return;
        const total = allCustomers.length;
        const thisMonth = allCustomers.filter((c) => isSameMonth(c.lastVisit)).length;
        const newThisMonth = allCustomers.filter((c) => isSameMonth(c.firstVisit)).length;
        const vip = allCustomers.filter((c) => c.isVip).length;
        const lost = allCustomers.filter((c) => c.status === "lost").length;

        const cards = [
            { label: "Toplam Müşteri", value: total, icon: "👥", tone: "accent" },
            { label: "Bu Ay Gelen", value: thisMonth, icon: "📅", tone: "info" },
            { label: "Yeni Müşteri", value: newThisMonth, icon: "✨", tone: "success" },
            { label: "VIP Müşteri", value: vip, icon: "⭐", tone: "gold" },
            { label: "Kaybedilmiş", value: lost, icon: "🔴", tone: "danger" }
        ];

        el.stats.innerHTML = cards.map((c) => `
            <div class="crm-stat crm-stat--${c.tone}">
                <div class="crm-stat__icon">${c.icon}</div>
                <div class="crm-stat__body">
                    <div class="crm-stat__value">${c.value}</div>
                    <div class="crm-stat__label">${c.label}</div>
                </div>
            </div>`).join("");
    }

    function renderFilters() {
        if (!el.filters) return;
        const counts = {
            all: allCustomers.length,
            active: allCustomers.filter((c) => c.status === "active").length,
            risky: allCustomers.filter((c) => c.status === "risky").length,
            lost: allCustomers.filter((c) => c.status === "lost").length,
            vip: allCustomers.filter((c) => c.isVip).length
        };
        el.filters.innerHTML = FILTERS.map((f) => `
            <button type="button" class="crm-filter ${state.filter === f.id ? "active" : ""}" data-filter="${f.id}">
                <span class="crm-filter__icon">${f.icon}</span>
                <span class="crm-filter__label">${f.label}</span>
                <span class="crm-filter__count">${counts[f.id]}</span>
            </button>`).join("");
    }

    function renderTableHead() {
        if (!el.tableHead) return;
        el.tableHead.innerHTML = `<tr>
            ${SORT_COLUMNS.map((c) => {
                const active = state.sortKey === c.key;
                const arrow = active ? (state.sortDir === "asc" ? "▲" : "▼") : "⇅";
                return `<th class="crm-th ${active ? "active" : ""}" data-sort="${c.key}">
                    ${c.label} <span class="crm-th__arrow">${arrow}</span>
                </th>`;
            }).join("")}
            <th class="crm-th crm-th--status">Durum</th>
        </tr>`;
    }

    function renderList() {
        const list = getFilteredSorted();
        const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (state.page > totalPages) state.page = totalPages;
        const start = (state.page - 1) * PAGE_SIZE;
        const pageItems = list.slice(start, start + PAGE_SIZE);

        const showEmpty = list.length === 0;
        if (el.empty) {
            el.empty.hidden = !showEmpty;
            if (showEmpty) {
                el.empty.innerHTML = `<div class="crm-empty__icon">🔍</div>
                    <p>${allCustomers.length === 0 ? "Henüz müşteri kaydı yok. Randevular oluştukça otomatik eklenecek." : "Aramanıza uygun müşteri bulunamadı."}</p>`;
            }
        }

        if (el.tableBody) {
            el.tableBody.innerHTML = pageItems.map((c) => `
                <tr class="crm-row" data-id="${escapeHtml(c.customerId)}">
                    <td class="crm-td--name">${escapeHtml(c.fullName)}</td>
                    <td class="crm-td--phone">${escapeHtml(c.phone || "—")}</td>
                    <td class="crm-td--center">${c.totalVisits}</td>
                    <td>${fmtDate(c.firstVisit)}</td>
                    <td>${fmtDate(c.lastVisit)}</td>
                    <td>${statusBadge(c.status, c.isVip)}</td>
                </tr>`).join("");
        }

        if (el.cards) {
            el.cards.innerHTML = pageItems.map((c) => `
                <div class="crm-card" data-id="${escapeHtml(c.customerId)}">
                    <div class="crm-card__top">
                        <div class="crm-card__name">${escapeHtml(c.fullName)}</div>
                        <div class="crm-card__badges">${statusBadge(c.status, c.isVip)}</div>
                    </div>
                    <div class="crm-card__phone">📞 ${escapeHtml(c.phone || "—")}</div>
                    <div class="crm-card__meta">
                        <span>🔁 ${c.totalVisits} ziyaret</span>
                        <span>🕞 Son: ${fmtDate(c.lastVisit)}</span>
                    </div>
                </div>`).join("");
        }

        renderPagination(list.length, totalPages);
    }

    function renderPagination(totalItems, totalPages) {
        if (!el.pagination) return;
        if (totalItems <= PAGE_SIZE) {
            el.pagination.innerHTML = totalItems
                ? `<span class="crm-page-info">${totalItems} müşteri</span>` : "";
            return;
        }
        el.pagination.innerHTML = `
            <button type="button" class="crm-page-btn" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>← Önceki</button>
            <span class="crm-page-info">Sayfa ${state.page} / ${totalPages} · ${totalItems} müşteri</span>
            <button type="button" class="crm-page-btn" data-page="next" ${state.page >= totalPages ? "disabled" : ""}>Sonraki →</button>`;
    }

    // --- detay modalı -------------------------------------------------------

    async function openDetail(customerId) {
        const c = allCustomers.find((x) => x.customerId === customerId);
        if (!c || !el.modalOverlay || !el.modalBody) return;

        el.modalBody.innerHTML = `
            <div class="crm-detail__header">
                <div class="crm-detail__avatar">${escapeHtml(c.fullName.charAt(0).toUpperCase())}</div>
                <div>
                    <div class="crm-detail__name">${escapeHtml(c.fullName)} ${c.isVip ? '<span class="crm-badge crm-badge--vip">⭐ VIP</span>' : ""}</div>
                    <div class="crm-detail__phone">📞 ${escapeHtml(c.phone || "—")}</div>
                </div>
                <div class="crm-detail__status">${statusBadge(c.status, false)}</div>
            </div>
            <div class="crm-detail__grid">
                <div class="crm-detail__stat"><span>İlk Geliş</span><strong>${fmtDate(c.firstVisit)}</strong></div>
                <div class="crm-detail__stat"><span>Son Geliş</span><strong>${fmtDate(c.lastVisit)}</strong></div>
                <div class="crm-detail__stat"><span>Toplam Ziyaret</span><strong>${c.totalVisits}</strong></div>
                <div class="crm-detail__stat"><span>Toplam Harcama</span><strong id="crmDetailSpend">—</strong></div>
            </div>
            ${nameVariantsHtml(c.nameVariants)}
            <div class="crm-detail__history">
                <h4>Randevu Geçmişi</h4>
                <div id="crmDetailHistory" class="crm-history"><div class="crm-loading">Geçmiş yükleniyor...</div></div>
            </div>`;

        el.modalOverlay.classList.add("open");
        document.body.style.overflow = "hidden";

        try {
            const all = await getAppointments();
            const history = all
                .filter((a) => normalizePhone(a.phone) === c.phone)
                .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

            const historyEl = el.modalBody.querySelector("#crmDetailHistory");
            const spendEl = el.modalBody.querySelector("#crmDetailSpend");

            if (spendEl) {
                const total = history.reduce((sum, a) => sum + (Number(a.price ?? a.fiyat) || 0), 0);
                spendEl.textContent = total > 0 ? `${total.toLocaleString("tr-TR")} ₺` : "—";
            }

            if (!historyEl) return;
            if (!history.length) {
                historyEl.innerHTML = `<p class="crm-history__empty">Kayıtlı randevu geçmişi bulunamadı.</p>`;
                return;
            }
            historyEl.innerHTML = history.map((a) => {
                const d = a.date ? new Date(a.date) : null;
                const dateStr = d && !isNaN(d.getTime())
                    ? d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })
                    : (a.date || "—");
                return `<div class="crm-history__item">
                    <div class="crm-history__date">${escapeHtml(dateStr)}${a.time ? ` · ${escapeHtml(a.time)}` : ""}</div>
                    <div class="crm-history__service">${escapeHtml(a.service || "Hizmet")}</div>
                </div>`;
            }).join("");
        } catch (err) {
            console.error("Randevu geçmişi yüklenemedi:", err);
            const historyEl = el.modalBody.querySelector("#crmDetailHistory");
            if (historyEl) historyEl.innerHTML = `<p class="crm-history__empty">Geçmiş yüklenemedi.</p>`;
        }
    }

    function closeDetail() {
        el.modalOverlay?.classList.remove("open");
        document.body.style.overflow = "";
    }

    // --- olaylar ------------------------------------------------------------

    let searchTimer = null;
    el.search?.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.search = el.search.value;
            state.page = 1;
            renderList();
        }, 200);
    });

    el.filters?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-filter]");
        if (!btn) return;
        state.filter = btn.dataset.filter;
        state.page = 1;
        renderFilters();
        renderList();
    });

    el.tableHead?.addEventListener("click", (e) => {
        const th = e.target.closest("[data-sort]");
        if (!th) return;
        const key = th.dataset.sort;
        if (state.sortKey === key) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
            state.sortKey = key;
            state.sortDir = key === "fullName" || key === "phone" ? "asc" : "desc";
        }
        renderTableHead();
        renderList();
    });

    el.pagination?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-page]");
        if (!btn) return;
        if (btn.dataset.page === "prev" && state.page > 1) state.page--;
        if (btn.dataset.page === "next") state.page++;
        renderList();
    });

    function onRowClick(e) {
        const row = e.target.closest("[data-id]");
        if (!row) return;
        openDetail(row.dataset.id);
    }
    el.tableBody?.addEventListener("click", onRowClick);
    el.cards?.addEventListener("click", onRowClick);

    el.modalClose?.addEventListener("click", closeDetail);
    el.modalOverlay?.addEventListener("click", (e) => {
        if (e.target === el.modalOverlay) closeDetail();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && el.modalOverlay?.classList.contains("open")) closeDetail();
    });

    return { activate: load };
}
