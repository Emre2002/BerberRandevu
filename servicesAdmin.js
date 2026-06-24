import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { fetchBarber, syncPublicBarber } from "./firestoreService.js";

export const BARBER_SERVICES_CATALOG = [
    "Saç Kesimi & Yıkama",
    "Sakal Tıraşı (Klasik)",
    "Saç-Sakal Kesimi",
    "Skin Fade",
    "Çocuk Tıraşı",
    "Damat Tıraşı",
    "Saç Yıkama + Fön",
    "Makine ile Saç Kesimi",
    "Sakal Şekillendirme & Tasarım",
    "Sakal Bakımı & Yağlama",
    "Saç Bakımı (Keratin / Botoks)",
    "Yüz Maskesi (Siyah Maske / Kil Maskesi)",
    "Yanak & Kulak Ağda",
    "Kulak & Burun Kılları (Ateş/Ağda)",
    "Yüz Masajı & Buhar Kürü",
    "Kaş Tasarımı / Kaş Alımı",
    "Saç Boyama",
    "Sakal / Bıyık Boyama",
    "Röfle / Balyaj / Renk Açma",
    "Perma",
    "Saç Düzleştirme (Kalıcı)",
    "VIP Saç Kesimi",
    "VIP Sakal Tıraşı",
    "VIP Saç/Sakal Kesimi"
];

export const DEFAULT_BARBER_SERVICES = [
    "Saç Kesimi & Yıkama",
    "Sakal Tıraşı (Klasik)",
    "Saç-Sakal Kesimi"
];

/** Dükkan dokümanından müşteriye gösterilecek hizmet listesini döner (ek read yok). */
export function getEffectiveSelectedServices(barber) {
    const raw = barber?.selectedServices;
    if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((s) => BARBER_SERVICES_CATALOG.includes(s));
    }
    return [...DEFAULT_BARBER_SERVICES];
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function ensureServicesAdminStyles() {
    if (document.getElementById("services-admin-styles")) return;
    const style = document.createElement("style");
    style.id = "services-admin-styles";
    style.textContent = `
        .svc-panel { max-width: 920px; }
        .svc-card-wrap {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 24px;
        }
        .svc-card-wrap__title { margin: 0 0 8px; font-size: 1.1rem; }
        .svc-card-wrap__desc {
            margin: 0 0 18px;
            font-size: 0.875rem;
            color: var(--text-muted);
            line-height: 1.5;
        }
        .svc-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 16px;
            align-items: center;
        }
        .svc-search {
            flex: 1;
            min-width: 200px;
            position: relative;
        }
        .svc-search input {
            width: 100%;
            padding: 11px 12px 11px 36px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            font-family: inherit;
            font-size: 0.9rem;
        }
        .svc-search__icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0.65;
            pointer-events: none;
        }
        .svc-toolbar__actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .svc-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 14px;
        }
        .svc-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
            min-width: 0;
        }
        .svc-item:hover { border-color: var(--accent); }
        .svc-item.is-selected {
            border-color: var(--accent);
            background: rgba(59, 130, 246, 0.1);
            box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.25);
        }
        .svc-item[hidden] { display: none !important; }
        .svc-item__check {
            width: 18px;
            height: 18px;
            margin-top: 2px;
            accent-color: var(--accent);
            flex-shrink: 0;
            cursor: pointer;
        }
        .svc-item__label {
            font-size: 0.84rem;
            color: var(--text-primary);
            line-height: 1.4;
            font-weight: 500;
        }
        .svc-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }
        .svc-count { margin: 0; font-size: 0.82rem; color: var(--text-muted); }
        .svc-empty {
            grid-column: 1 / -1;
            text-align: center;
            padding: 24px;
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        @media (max-width: 900px) {
            .svc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
            .svc-grid { grid-template-columns: 1fr; }
            .svc-toolbar { flex-direction: column; align-items: stretch; }
            .svc-toolbar__actions { width: 100%; }
            .svc-toolbar__actions .btn { flex: 1; }
        }
        .service-cards-grid .slot {
            min-height: 52px;
            height: auto;
            padding: 12px 10px;
            font-size: 0.82rem;
            line-height: 1.35;
            white-space: normal;
            text-align: center;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Müşteri randevu sayfası — seçili hizmetleri kart olarak gösterir.
 * #serviceSelect gizli input olarak değer tutar (mevcut randevu akışı korunur).
 */
export function renderCustomerServicePicker(services, { onChange } = {}) {
    ensureServicesAdminStyles();

    let hidden = document.getElementById("serviceSelect");
    const group = hidden?.closest(".form-group");
    if (!group) return;

    if (hidden.tagName === "SELECT") {
        const input = document.createElement("input");
        input.type = "hidden";
        input.id = "serviceSelect";
        input.value = "";
        hidden.replaceWith(input);
        hidden = input;
    }

    let grid = document.getElementById("serviceCards");
    if (!grid) {
        grid = document.createElement("div");
        grid.id = "serviceCards";
        grid.className = "service-cards-grid slots-grid";
        group.appendChild(grid);
    }

    const list = services?.length ? services : [...DEFAULT_BARBER_SERVICES];
    hidden.value = "";
    grid.innerHTML = list.map((name) =>
        `<button type="button" class="slot slot--available" data-service="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join("");

    grid.querySelectorAll("[data-service]").forEach((btn) => {
        btn.addEventListener("click", () => {
            grid.querySelectorAll(".slot--selected").forEach((el) => el.classList.remove("slot--selected"));
            btn.classList.add("slot--selected");
            hidden.value = btn.dataset.service || "";
            onChange?.();
        });
    });
}

export function clearCustomerServiceSelection() {
    const hidden = document.getElementById("serviceSelect");
    if (hidden) hidden.value = "";
    document.querySelectorAll("#serviceCards .slot--selected").forEach((el) => {
        el.classList.remove("slot--selected");
    });
}

/**
 * Berber admin — Hizmetler sekmesi.
 */
export function initServicesAdmin(barberSlug, showToast, opts = {}) {
    const panel = document.querySelector('[data-panel="services"]');
    if (!panel || !barberSlug) return { refresh: () => {} };

    ensureServicesAdminStyles();

    const gridEl = panel.querySelector("#svcGrid");
    const searchEl = panel.querySelector("#svcSearch");
    const countEl = panel.querySelector("#svcCount");
    const saveBtn = panel.querySelector("#svcSaveBtn");
    const selectAllBtn = panel.querySelector("#svcSelectAll");
    const clearAllBtn = panel.querySelector("#svcClearAll");

    const selected = new Set(
        getEffectiveSelectedServices(opts.initialBarber || {}).filter((s) => BARBER_SERVICES_CATALOG.includes(s))
    );

    function updateCount() {
        if (countEl) countEl.textContent = `${selected.size} hizmet seçili`;
    }

    function syncCardState(card, isOn) {
        card.classList.toggle("is-selected", isOn);
        const cb = card.querySelector(".svc-item__check");
        if (cb) cb.checked = isOn;
    }

    function renderGrid() {
        if (!gridEl) return;
        const term = (searchEl?.value || "").trim().toLocaleLowerCase("tr");

        gridEl.innerHTML = BARBER_SERVICES_CATALOG.map((name) => {
            const match = !term || name.toLocaleLowerCase("tr").includes(term);
            const isOn = selected.has(name);
            return `<label class="svc-item${isOn ? " is-selected" : ""}" data-svc="${escapeHtml(name)}"${match ? "" : " hidden"}>
                <input type="checkbox" class="svc-item__check" value="${escapeHtml(name)}" ${isOn ? "checked" : ""}>
                <span class="svc-item__label">${escapeHtml(name)}</span>
            </label>`;
        }).join("");

        const visible = gridEl.querySelectorAll(".svc-item:not([hidden])");
        if (!visible.length) {
            gridEl.innerHTML = `<div class="svc-empty">Aramanızla eşleşen hizmet bulunamadı.</div>`;
        }

        gridEl.querySelectorAll(".svc-item").forEach((card) => {
            const name = card.dataset.svc;
            const cb = card.querySelector(".svc-item__check");
            const toggle = (on) => {
                if (on) selected.add(name);
                else selected.delete(name);
                syncCardState(card, on);
                updateCount();
            };
            cb?.addEventListener("change", () => toggle(cb.checked));
            card.addEventListener("click", (e) => {
                if (e.target === cb) return;
                e.preventDefault();
                toggle(!selected.has(name));
            });
        });

        updateCount();
    }

    searchEl?.addEventListener("input", renderGrid);

    selectAllBtn?.addEventListener("click", () => {
        const term = (searchEl?.value || "").trim().toLocaleLowerCase("tr");
        BARBER_SERVICES_CATALOG.forEach((name) => {
            if (!term || name.toLocaleLowerCase("tr").includes(term)) selected.add(name);
        });
        renderGrid();
    });

    clearAllBtn?.addEventListener("click", () => {
        const term = (searchEl?.value || "").trim().toLocaleLowerCase("tr");
        if (!term) {
            selected.clear();
        } else {
            BARBER_SERVICES_CATALOG.forEach((name) => {
                if (name.toLocaleLowerCase("tr").includes(term)) selected.delete(name);
            });
        }
        renderGrid();
    });

    saveBtn?.addEventListener("click", async () => {
        const payload = [...selected].filter((s) => BARBER_SERVICES_CATALOG.includes(s));
        if (!payload.length) {
            showToast("En az bir hizmet seçmelisiniz.", "error");
            return;
        }

        saveBtn.disabled = true;
        try {
            await updateDoc(doc(db, "berberler", barberSlug), { selectedServices: payload });
            const updated = await fetchBarber(barberSlug);
            if (updated) await syncPublicBarber(barberSlug, updated);
            showToast("Hizmetler kaydedildi.");
            opts.onUpdated?.(payload);
        } catch (e) {
            showToast(e.message || "Kayıt başarısız.", "error");
        } finally {
            saveBtn.disabled = false;
        }
    });

    function refresh(barber) {
        selected.clear();
        getEffectiveSelectedServices(barber || opts.initialBarber || {}).forEach((s) => selected.add(s));
        if (searchEl) searchEl.value = "";
        renderGrid();
    }

    renderGrid();

    return { refresh };
}
