import {
    createActivationCodes,
    fetchAllActivationCodes,
    deleteActivationCode,
    formatCodeDate,
    packageLabel
} from "./activationCodeService.js";
import { PACKAGE_TYPES } from "./subscriptionService.js";

let codesCache = [];
let codesFilter = { used: "all", package: "all" };
let showToastFn = () => {};

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function getFilteredCodes() {
    return codesCache.filter((c) => {
        if (codesFilter.used === "unused" && c.isUsed) return false;
        if (codesFilter.used === "used" && !c.isUsed) return false;
        if (codesFilter.package !== "all" && c.packageType !== codesFilter.package) return false;
        return true;
    });
}

function renderCodesTable() {
    const tbody = document.getElementById("acTableBody");
    const cards = document.getElementById("acCards");
    const countEl = document.getElementById("acCount");
    if (!tbody) return;

    const list = getFilteredCodes();
    if (countEl) countEl.textContent = `${list.length} / ${codesCache.length} kod`;

    if (!list.length) {
        const msg = codesCache.length ? "Filtreye uygun kod yok." : "Henüz kod üretilmedi.";
        tbody.innerHTML = `<tr><td colspan="7" class="sa-table__empty">${msg}</td></tr>`;
        if (cards) cards.innerHTML = `<div class="sa-table__empty">${msg}</div>`;
        return;
    }

    const row = (c) => {
        const usedBadge = c.isUsed
            ? `<span class="sa-badge sa-badge--gray">Kullanıldı</span>`
            : `<span class="sa-badge sa-badge--green">Boş</span>`;
        const actions = c.isUsed
            ? "—"
            : `<button type="button" class="sa-btn sa-btn--ghost" data-ac-copy="${escapeHtml(c.code)}">Kopyala</button>
               <button type="button" class="sa-btn sa-btn--danger" data-ac-delete="${escapeHtml(c.code)}">Sil</button>`;
        return `
            <td class="ac-code">${escapeHtml(c.code)}</td>
            <td>${packageLabel(c.packageType)}</td>
            <td>${c.durationDays || "—"}</td>
            <td>${usedBadge}</td>
            <td>${escapeHtml(c.usedByBarberSlug || "—")}</td>
            <td>${formatCodeDate(c.createdAt)}</td>
            <td><div class="sa-table__actions">${actions}</div></td>`;
    };

    tbody.innerHTML = list.map((c) => `<tr>${row(c)}</tr>`).join("");
    if (cards) {
        cards.innerHTML = list.map((c) => `
            <div class="sad-card">
                <div class="sad-card__head">
                    <span class="ac-code">${escapeHtml(c.code)}</span>
                    ${c.isUsed ? '<span class="sa-badge sa-badge--gray">Kullanıldı</span>' : '<span class="sa-badge sa-badge--green">Boş</span>'}
                </div>
                <div class="sad-card__grid">
                    <div><span>Paket</span><strong>${packageLabel(c.packageType)}</strong></div>
                    <div><span>Gün</span><strong>${c.durationDays}</strong></div>
                    <div><span>Kullanan</span><strong>${escapeHtml(c.usedByBarberSlug || "—")}</strong></div>
                </div>
                ${!c.isUsed ? `<div class="sad-card__actions">
                    <button type="button" class="sa-btn sa-btn--ghost" data-ac-copy="${escapeHtml(c.code)}">Kopyala</button>
                    <button type="button" class="sa-btn sa-btn--danger" data-ac-delete="${escapeHtml(c.code)}">Sil</button>
                </div>` : ""}
            </div>`).join("");
    }
}

function renderFilters() {
    const host = document.getElementById("acFilters");
    if (!host) return;
    const usedCounts = {
        all: codesCache.length,
        unused: codesCache.filter((c) => !c.isUsed).length,
        used: codesCache.filter((c) => c.isUsed).length
    };
    host.innerHTML = `
        <button type="button" class="ac-chip ${codesFilter.used === "all" ? "active" : ""}" data-ac-used="all">Tümü (${usedCounts.all})</button>
        <button type="button" class="ac-chip ${codesFilter.used === "unused" ? "active" : ""}" data-ac-used="unused">Boş (${usedCounts.unused})</button>
        <button type="button" class="ac-chip ${codesFilter.used === "used" ? "active" : ""}" data-ac-used="used">Kullanılmış (${usedCounts.used})</button>
        <span style="width:1px;height:24px;background:var(--sa-border);margin:0 4px;"></span>
        <button type="button" class="ac-chip ${codesFilter.package === "all" ? "active" : ""}" data-ac-pkg="all">Tüm Paketler</button>
        ${Object.entries(PACKAGE_TYPES).map(([k, v]) =>
            `<button type="button" class="ac-chip ${codesFilter.package === k ? "active" : ""}" data-ac-pkg="${k}">${v.label}</button>`
        ).join("")}`;
}

export async function loadActivationCodesPanel() {
    codesCache = await fetchAllActivationCodes();
    renderFilters();
    renderCodesTable();
}

export function bindActivationCodesEvents(showToast) {
    showToastFn = showToast;

    document.getElementById("acGenerateForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
            const packageType = document.getElementById("acPackageType").value;
            const count = Number(document.getElementById("acCountInput").value) || 1;
            const created = await createActivationCodes({ packageType, count });
            showToastFn(`${created.length} kod oluşturuldu.`);
            await loadActivationCodesPanel();
        } catch (err) {
            showToastFn(err.message, "error");
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById("acFilters")?.addEventListener("click", (e) => {
        const used = e.target.closest("[data-ac-used]");
        const pkg = e.target.closest("[data-ac-pkg]");
        if (used) { codesFilter.used = used.dataset.acUsed; renderFilters(); renderCodesTable(); }
        if (pkg) { codesFilter.package = pkg.dataset.acPkg; renderFilters(); renderCodesTable(); }
    });

    async function handleAcAction(e) {
        const copyBtn = e.target.closest("[data-ac-copy]");
        const delBtn = e.target.closest("[data-ac-delete]");
        if (copyBtn) {
            await navigator.clipboard.writeText(copyBtn.dataset.acCopy);
            showToastFn("Kod panoya kopyalandı.");
        }
        if (delBtn) {
            if (!confirm("Bu kodu silmek istediğinize emin misiniz?")) return;
            await deleteActivationCode(delBtn.dataset.acDelete);
            showToastFn("Kod silindi.");
            await loadActivationCodesPanel();
        }
    }
    document.getElementById("acTableBody")?.addEventListener("click", handleAcAction);
    document.getElementById("acCards")?.addEventListener("click", handleAcAction);
}

export function getActivationCodesPanelHtml() {
    const pkgOptions = Object.entries(PACKAGE_TYPES)
        .map(([k, v]) => `<option value="${k}">${v.label} (${v.durationDays} gün)</option>`)
        .join("");

    return `
        <div class="ac-panel">
            <section class="sa-card">
                <h2 class="sa-card__title">➕ Yeni Aktivasyon Kodu Üret</h2>
                <form id="acGenerateForm" class="ac-generate">
                    <div class="sa-form-group">
                        <label for="acPackageType">Paket</label>
                        <select id="acPackageType">${pkgOptions}</select>
                    </div>
                    <div class="sa-form-group">
                        <label for="acCountInput">Adet</label>
                        <input type="number" id="acCountInput" min="1" max="100" value="5">
                    </div>
                    <button type="submit" class="sa-btn sa-btn--primary">Kod Üret</button>
                </form>
            </section>
            <section class="sa-card">
                <div class="sad-card-head">
                    <h2 class="sa-card__title" style="margin:0;">📋 Kod Havuzu</h2>
                    <span class="sad-result-count" id="acCount"></span>
                </div>
                <div class="ac-filters" id="acFilters"></div>
                <div class="sa-table-wrap ac-table-wrap">
                    <table class="sa-table">
                        <thead><tr>
                            <th>Kod</th><th>Paket</th><th>Gün</th><th>Durum</th>
                            <th>Kullanan</th><th>Oluşturma</th><th>İşlem</th>
                        </tr></thead>
                        <tbody id="acTableBody"><tr><td colspan="7" class="sa-loading">Yükleniyor...</td></tr></tbody>
                    </table>
                </div>
                <div class="ac-cards" id="acCards"></div>
            </section>
        </div>`;
}
