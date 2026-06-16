import {
    fetchAllBarbers, fetchBarber, createBarber, updateBarber,
    toggleBarberStatus, extendSubscription, removeBarber, normalizeSlug, formatDate
} from "./firestoreService.js";
import {
    getBookingUrl, getAdminUrl, getWhatsAppBookingMessage
} from "./linkService.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getPendingBarbersPanelHtml,
    bindPendingBarbersEvents,
    loadPendingBarbersPanel
} from "./pendingBarbersPanel.js";
import { fetchAllCustomers, toDateSafe } from "./customerService.js";
import { saveFirebaseConfig, hasFirebaseConfig } from "./firebase-config.js";
import { getIller, getIlceler } from "./turkiyeAdres.js";
import {
    calculateRemainingDays,
    deriveSubscriptionStatusFromEndDate,
    formatDateTR
} from "./subscriptionService.js";
import {
    getActivationCodesPanelHtml,
    bindActivationCodesEvents,
    loadActivationCodesPanel
} from "./activationCodesPanel.js";

let barbersCache = [];
let pendingBarbersCount = 0;
let panelMounted = false;
let showToastFn = () => {};

// --- Dashboard durumu (tüm filtre/sıralama/arama frontend'de; ekstra read YOK) ---
let statsBySlug = {};            // slug -> { customers, appointments, revenue }
let dashCitySel = null;
let dashDistrictSel = null;
const dashView = {
    search: "",
    status: "all",      // all | active | passive | suspended | pending
    sub: "all",         // all | expired | today | 7days | 15days | 30days | active
    city: "",
    district: "",
    sort: "newest",
    selected: new Set()
};

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
}

function getBarberName(b) { return b.name || b.slug; }

// Adres parçalarından eski sistemle uyumlu tek satırlık adres metni üretir.
function composeAddressText({ city, district, neighborhood, addressDetail }) {
    const parts = [];
    const loc = [city, district].filter(Boolean).join(" / ");
    if (loc) parts.push(loc);
    if (neighborhood) parts.push(neighborhood);
    if (addressDetail) parts.push(addressDetail);
    return parts.join(", ");
}

// ---- Hafif, vanilla, mobil uyumlu, akış-içi (modal/scroll güvenli) searchable select ----
function createSearchableSelect(root, { placeholder = "Seçiniz", searchPlaceholder = "Ara...", onChange = () => {} } = {}) {
    if (!root) return null;
    root.classList.add("sa-select");
    root.innerHTML = `
        <button type="button" class="sa-select__trigger">
            <span class="sa-select__value sa-select__value--placeholder">${escapeHtml(placeholder)}</span>
            <span class="sa-select__arrow" aria-hidden="true">▾</span>
        </button>
        <div class="sa-select__panel" hidden>
            <input type="text" class="sa-select__search" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off">
            <ul class="sa-select__list"></ul>
        </div>`;

    const trigger = root.querySelector(".sa-select__trigger");
    const valueEl = root.querySelector(".sa-select__value");
    const panel = root.querySelector(".sa-select__panel");
    const search = root.querySelector(".sa-select__search");
    const list = root.querySelector(".sa-select__list");

    let options = [];
    let value = "";
    let disabled = false;

    function renderValue() {
        valueEl.textContent = value || placeholder;
        valueEl.classList.toggle("sa-select__value--placeholder", !value);
    }

    function renderList() {
        const q = search.value.trim().toLocaleLowerCase("tr");
        list.innerHTML = "";
        const filtered = q ? options.filter(o => o.toLocaleLowerCase("tr").includes(q)) : options;
        if (!filtered.length) {
            const li = document.createElement("li");
            li.className = "sa-select__empty";
            li.textContent = options.length ? "Sonuç bulunamadı" : "Seçenek yok";
            list.appendChild(li);
            return;
        }
        const frag = document.createDocumentFragment();
        filtered.forEach(opt => {
            const li = document.createElement("li");
            li.className = "sa-select__option" + (opt === value ? " is-selected" : "");
            li.textContent = opt;
            li.addEventListener("click", () => { set(opt, true); close(); });
            frag.appendChild(li);
        });
        list.appendChild(frag);
    }

    function open() {
        if (disabled) return;
        panel.hidden = false;
        root.classList.add("is-open");
        search.value = "";
        renderList();
        setTimeout(() => search.focus({ preventScroll: true }), 0);
    }
    function close() {
        panel.hidden = true;
        root.classList.remove("is-open");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.hidden ? open() : close();
    });
    search.addEventListener("input", renderList);
    search.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });

    function set(val, fire) {
        value = options.includes(val) ? val : "";
        renderValue();
        if (fire) onChange(value);
    }

    const api = {
        setOptions(opts, keepValue = false) {
            options = Array.isArray(opts) ? opts.slice() : [];
            if (!keepValue || !options.includes(value)) value = "";
            renderValue();
            if (!panel.hidden) renderList();
            return api;
        },
        setValue(val) { set(val, false); return api; },
        getValue() { return value; },
        setDisabled(d) {
            disabled = !!d;
            trigger.disabled = disabled;
            root.classList.toggle("is-disabled", disabled);
            if (disabled) close();
            return api;
        }
    };

    renderValue();
    return api;
}

// İl/İlçe ikilisini kurar; il değişince ilçe listesi otomatik güncellenir.
function setupAddressSelector(prefix) {
    const cityRoot = document.getElementById(prefix + "CitySelect");
    const districtRoot = document.getElementById(prefix + "DistrictSelect");
    if (!cityRoot || !districtRoot) return null;

    const districtSel = createSearchableSelect(districtRoot, {
        placeholder: "İlçe seçiniz", searchPlaceholder: "İlçe ara..."
    });
    districtSel.setDisabled(true);

    const citySel = createSearchableSelect(cityRoot, {
        placeholder: "İl seçiniz",
        searchPlaceholder: "İl ara...",
        onChange: (city) => {
            const ilceler = getIlceler(city);
            districtSel.setOptions(ilceler);
            districtSel.setDisabled(ilceler.length === 0);
        }
    });
    citySel.setOptions(getIller());

    // Mevcut değerleri yükler (düzenleme için).
    function load({ city = "", district = "" }) {
        citySel.setValue(city);
        const ilceler = getIlceler(city);
        districtSel.setOptions(ilceler);
        districtSel.setDisabled(ilceler.length === 0);
        districtSel.setValue(district);
    }
    function reset() {
        citySel.setValue("");
        districtSel.setOptions([]);
        districtSel.setDisabled(true);
    }

    return { citySel, districtSel, load, reset };
}

let createAddress = null;
let editAddress = null;

function getPanelHtml() {
    const firebaseSetup = hasFirebaseConfig() ? "" : `
        <section class="sa-card sa-card--warn" id="firebaseSetupCard">
            <h2 class="sa-card__title">⚙️ Firebase Bağlantısı (Tek Seferlik)</h2>
            <p class="sa-hint" style="margin-bottom:16px;">Firestore bağlantısı henüz yapılandırılmamış. Bilgileri yalnızca siz giriyorsunuz; kayıttan sonra bu form bir daha görünmez.</p>
            <form id="firebaseConfigForm">
                <div class="sa-form-grid">
                    <div class="sa-form-group"><label for="cfgApiKey">apiKey</label><input type="password" id="cfgApiKey" required autocomplete="off"></div>
                    <div class="sa-form-group"><label for="cfgAuthDomain">authDomain</label><input type="text" id="cfgAuthDomain" required autocomplete="off"></div>
                    <div class="sa-form-group"><label for="cfgProjectId">projectId</label><input type="text" id="cfgProjectId" required autocomplete="off"></div>
                    <div class="sa-form-group"><label for="cfgStorageBucket">storageBucket</label><input type="text" id="cfgStorageBucket" autocomplete="off"></div>
                    <div class="sa-form-group"><label for="cfgMessagingSenderId">messagingSenderId</label><input type="text" id="cfgMessagingSenderId" autocomplete="off"></div>
                    <div class="sa-form-group"><label for="cfgAppId">appId</label><input type="text" id="cfgAppId" required autocomplete="off"></div>
                </div>
                <p class="sa-form-error" id="firebaseConfigError"></p>
                <button type="submit" class="sa-btn sa-btn--primary" style="margin-top:12px;">Firebase Kaydet ve Yenile</button>
            </form>
        </section>`;

    return `
        <div id="saPanel" class="sa-panel">
            <header class="sa-header">
                <h1 class="sa-header__title">Süper Admin <span class="sa-header__badge">SaaS</span></h1>
                <div class="sa-header__actions">
                    <a href="index.html" class="sa-btn sa-btn--ghost">Ana Sayfa</a>
                    <button type="button" class="sa-logout" id="saLogoutBtn">Çıkış Yap</button>
                </div>
            </header>
            ${firebaseSetup}
            <div class="sa-stats sa-stats--dash" id="saStatCards" style="margin-bottom:24px;"></div>
            <div id="saAlertZone" style="margin-bottom:24px;"></div>
            <nav class="sa-tabs" id="mainTabs">
                <button class="sa-tab active" data-tab="barbers">✂️ Dükkan Yönetimi</button>
                <button class="sa-tab" data-tab="codes">🔑 Aktivasyon Kodları</button>
                <button class="sa-tab" data-tab="pending">🏪 Bekleyen Dükkanlar <span class="sa-tab-badge" id="pendingBarbersBadge" hidden>0</span></button>
            </nav>
            <div class="sa-tab-panel" data-panel="barbers">
                <div class="sad-toolbar-head">
                    <button type="button" class="sa-btn sa-btn--primary" id="openCreateBarberBtn">➕ Yeni Berber Ekle</button>
                </div>
                <section class="sa-card">
                    <div class="sad-card-head">
                        <h2 class="sa-card__title" style="margin:0;">📋 Dükkan Yönetimi</h2>
                        <span class="sad-result-count" id="sadResultCount"></span>
                    </div>

                    <div class="sad-toolbar-pro">
                        <div class="sad-toolbar-pro__row">
                            <div class="sad-search sad-search--pro">
                                <span class="sad-search__icon">🔍</span>
                                <input type="text" id="sadSearch" placeholder="Dükkan, telefon, şehir veya slug ara..." autocomplete="off">
                            </div>
                            <label class="sad-select-all">
                                <input type="checkbox" id="sadSelectAll" aria-label="Tümünü seç">
                                <span>Tümünü Seç</span>
                            </label>
                        </div>
                        <div class="sad-toolbar-pro__row sad-toolbar-pro__row--filters">
                            <div class="sad-filter-block">
                                <span class="sad-filter-block__label">Durum</span>
                                <div class="sad-chips sad-chips--toolbar" id="sadStatusChips" data-group="status"></div>
                            </div>
                            <div class="sad-filter-block">
                                <span class="sad-filter-block__label">Abonelik</span>
                                <div class="sad-chips sad-chips--toolbar" id="sadSubChips" data-group="sub"></div>
                            </div>
                        </div>
                        <div class="sad-toolbar-pro__row sad-toolbar-pro__row--meta">
                            <div class="sad-meta-filters">
                                <div class="sad-loc sad-loc--compact">
                                    <span class="sad-filter-block__label">Şehir</span>
                                    <div class="sa-select" id="sadCitySelect"></div>
                                </div>
                                <div class="sad-loc sad-loc--compact">
                                    <span class="sad-filter-block__label">İlçe</span>
                                    <div class="sa-select" id="sadDistrictSelect"></div>
                                </div>
                                <div class="sad-loc sad-loc--compact">
                                    <span class="sad-filter-block__label">Sıralama</span>
                                    <select id="sadSort" class="sad-select-native sad-select-native--compact">
                                        <optgroup label="Operasyonel">
                                            <option value="newest">En Yeni Eklenen</option>
                                            <option value="oldest">En Eski Eklenen</option>
                                            <option value="az">A → Z</option>
                                            <option value="za">Z → A</option>
                                            <option value="subSoonest">Aboneliği En Yakın Bitecek</option>
                                            <option value="subLatest">Aboneliği En Geç Bitecek</option>
                                        </optgroup>
                                        <optgroup label="Kullanım">
                                            <option value="mostCustomers">En Çok Müşterisi Olan</option>
                                            <option value="leastCustomers">En Az Müşterisi Olan</option>
                                            <option value="mostAppointments">En Çok Randevusu Olan</option>
                                            <option value="leastAppointments">En Az Randevusu Olan</option>
                                            <option value="mostRevenue">En Çok Gelir Üreten</option>
                                            <option value="leastRevenue">En Az Gelir Üreten</option>
                                        </optgroup>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="sad-filters sad-filters--legacy" id="sadFilters" hidden></div>

                    <div class="sad-bulkbar" id="sadBulkBar" hidden>
                        <span class="sad-bulkbar__count"><strong id="sadSelectedCount">0</strong> dükkan seçili</span>
                        <div class="sad-bulkbar__actions">
                            <button type="button" class="sa-btn sa-btn--ghost" data-bulk="activate">🟢 Aktif Et</button>
                            <button type="button" class="sa-btn sa-btn--ghost" data-bulk="passive">🔴 Pasif Et</button>
                            <button type="button" class="sa-btn sa-btn--ghost" data-bulk="extend">📅 Abonelik Uzat</button>
                            <button type="button" class="sa-btn sa-btn--ghost" data-bulk="message">💬 Mesaj Gönder</button>
                            <button type="button" class="sa-btn sa-btn--ghost" data-bulk="clear">✕ Temizle</button>
                        </div>
                    </div>

                    <div class="sa-table-wrap sad-table-wrap sad-table-wrap--legacy" hidden>
                        <table class="sa-table sad-table">
                            <thead><tr>
                                <th class="sad-col-check"></th>
                                <th>Dükkan</th><th>Konum</th><th>Telefon</th>
                                <th>Abonelik</th><th>Bitiş</th><th>Kalan</th>
                                <th>Durum</th><th>İşlemler</th>
                            </tr></thead>
                            <tbody id="barbersTableBody"></tbody>
                        </table>
                    </div>
                    <div class="sad-cards sad-cards--grid" id="sadCards"></div>
                </section>
            </div>
            <div class="sa-tab-panel" data-panel="codes" hidden>
                ${getActivationCodesPanelHtml()}
            </div>
            <div class="sa-tab-panel" data-panel="pending" hidden>
                ${getPendingBarbersPanelHtml()}
            </div>
        </div>
        <div class="sa-modal-overlay" id="createBarberModal">
            <div class="sa-modal sa-modal--wide sa-modal--scroll">
                <div class="sa-modal__head">
                    <h3 class="sa-modal__title">➕ Yeni Berber Ekle</h3>
                    <button type="button" class="sa-modal__close" id="closeCreateBarberModal" aria-label="Kapat">×</button>
                </div>
                <form id="barberForm">
                    <div class="sa-form-grid">
                        <div class="sa-form-group"><label for="fieldName">Dükkan Adı</label><input type="text" id="fieldName" required></div>
                        <div class="sa-form-group"><label for="fieldSlug">URL Slug</label><input type="text" id="fieldSlug" required placeholder="x-men-barber"></div>
                        <div class="sa-form-group"><label for="fieldPhone">Telefon</label><input type="tel" id="fieldPhone" required></div>
                        <div class="sa-form-group"><label for="fieldWhatsapp">WhatsApp</label><input type="tel" id="fieldWhatsapp" placeholder="905551234567"></div>
                        <div class="sa-form-group"><label for="fieldOpenHour">Açılış Saati</label><input type="time" id="fieldOpenHour" value="09:00" required></div>
                        <div class="sa-form-group"><label for="fieldCloseHour">Kapanış Saati</label><input type="time" id="fieldCloseHour" value="21:00" required></div>
                        <div class="sa-form-group"><label for="fieldUsername">Kullanıcı Adı</label><input type="text" id="fieldUsername" required placeholder="elite_admin"></div>
                        <div class="sa-form-group"><label for="fieldPassword">Şifre</label><input type="password" id="fieldPassword" required placeholder="••••••" minlength="4" autocomplete="new-password"></div>
                        <div class="sa-form-group"><label for="fieldTelegram">Telegram Chat ID</label><input type="text" id="fieldTelegram" placeholder="123456789"></div>
                        <div class="sa-form-group"><label for="fieldLogoUrl">Logo URL</label><input type="url" id="fieldLogoUrl" placeholder="https://..."></div>
                        <div class="sa-form-group"><label for="fieldCoverUrl">Kapak URL</label><input type="url" id="fieldCoverUrl" placeholder="https://..."></div>
                        <div class="sa-form-group"><label for="fieldMapsLink">Google Maps Linki</label><input type="url" id="fieldMapsLink" placeholder="https://maps.app.goo.gl/..."></div>
                    </div>
                    <div class="sa-address-card">
                        <div class="sa-address-card__head"><span>📍</span> Adres Bilgisi</div>
                        <div class="sa-address-grid">
                            <div class="sa-form-group">
                                <label>İl</label>
                                <div class="sa-select" id="createCitySelect"></div>
                            </div>
                            <div class="sa-form-group">
                                <label>İlçe</label>
                                <div class="sa-select" id="createDistrictSelect"></div>
                            </div>
                            <div class="sa-form-group">
                                <label for="fieldNeighborhood">Mahalle</label>
                                <input type="text" id="fieldNeighborhood" placeholder="Örn: Gaziler Mahallesi">
                            </div>
                            <div class="sa-form-group sa-form-group--full">
                                <label for="fieldAddressDetail">Açık Adres</label>
                                <textarea id="fieldAddressDetail" rows="2" placeholder="Cadde, sokak, kapı no..."></textarea>
                            </div>
                        </div>
                    </div>
                    <p class="sa-form-error" id="formError"></p>
                    <div class="sa-modal__actions">
                        <button type="button" class="sa-btn sa-btn--ghost" id="cancelCreateBarberModal">İptal</button>
                        <button type="submit" class="sa-btn sa-btn--primary">Kaydet</button>
                    </div>
                </form>
            </div>
        </div>
        <div class="sa-modal-overlay" id="editModal">
            <div class="sa-modal sa-modal--wide">
                <h3 class="sa-modal__title">Berber Düzenle</h3>
                <form id="editForm">
                    <input type="hidden" id="editSlug">
                    <div class="sa-form-grid">
                        <div class="sa-form-group"><label>Dükkan Adı</label><input type="text" id="editName" required></div>
                        <div class="sa-form-group"><label>Telefon</label><input type="tel" id="editPhone" required></div>
                        <div class="sa-form-group"><label>WhatsApp</label><input type="tel" id="editWhatsapp"></div>
                        <div class="sa-form-group"><label>Açılış</label><input type="time" id="editOpenHour" required></div>
                        <div class="sa-form-group"><label>Kapanış</label><input type="time" id="editCloseHour" required></div>
                        <div class="sa-form-group"><label>Kullanıcı Adı</label><input type="text" id="editUsername" required></div>
                        <div class="sa-form-group"><label>Şifre</label><input type="password" id="editPassword" required autocomplete="new-password"></div>
                        <div class="sa-form-group"><label>Telegram Chat ID</label><input type="text" id="editTelegram"></div>
                        <div class="sa-form-group"><label>Logo URL</label><input type="url" id="editLogoUrl"></div>
                        <div class="sa-form-group"><label>Kapak URL</label><input type="url" id="editCoverUrl"></div>
                        <div class="sa-form-group"><label>Google Maps Linki</label><input type="url" id="editMapsLink" placeholder="https://maps.app.goo.gl/..."></div>
                        <div class="sa-form-group"><label>Durum</label><select id="editStatus"><option value="active">Aktif</option><option value="passive">Pasif</option></select></div>
                        <div class="sa-form-group"><label for="editSubEndDate">Abonelik Bitiş Tarihi</label><input type="date" id="editSubEndDate" required></div>
                        <div class="sa-form-group"><label>Abonelik Durumu</label><input type="text" id="editSubStatusDisplay" readonly class="sa-input-readonly" placeholder="Otomatik hesaplanır"></div>
                    </div>
                    <div class="sa-address-card">
                        <div class="sa-address-card__head"><span>📍</span> Adres Bilgisi</div>
                        <div class="sa-address-grid">
                            <div class="sa-form-group">
                                <label>İl</label>
                                <div class="sa-select" id="editCitySelect"></div>
                            </div>
                            <div class="sa-form-group">
                                <label>İlçe</label>
                                <div class="sa-select" id="editDistrictSelect"></div>
                            </div>
                            <div class="sa-form-group">
                                <label for="editNeighborhood">Mahalle</label>
                                <input type="text" id="editNeighborhood" placeholder="Örn: Gaziler Mahallesi">
                            </div>
                            <div class="sa-form-group sa-form-group--full">
                                <label for="editAddressDetail">Açık Adres</label>
                                <textarea id="editAddressDetail" rows="2" placeholder="Cadde, sokak, kapı no..."></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="sa-sub-extend">
                        <span class="sa-sub-extend__label">Abonelik Uzat:</span>
                        <button type="button" class="sa-btn sa-btn--ghost" data-extend="1">1 Ay</button>
                        <button type="button" class="sa-btn sa-btn--ghost" data-extend="3">3 Ay</button>
                        <button type="button" class="sa-btn sa-btn--ghost" data-extend="6">6 Ay</button>
                        <button type="button" class="sa-btn sa-btn--ghost" data-extend="12">12 Ay</button>
                        <span id="editSubEnd" class="sa-sub-end"></span>
                    </div>
                    <div class="sa-link-tools">
                        <p id="editSlugWarning" class="sa-link-tools__warning" hidden>Bu dükkan için slug bulunamadı.</p>
                        <button type="button" class="sa-btn sa-btn--ghost" id="copyLinkBtn">🔗 Randevu Linki Kopyala</button>
                        <button type="button" class="sa-btn sa-btn--ghost" id="whatsappMsgBtn">💬 WhatsApp Mesajı</button>
                        <a class="sa-btn sa-btn--ghost" id="openAdminLink" href="#" target="_blank" rel="noopener">🔐 Berber Paneli</a>
                    </div>
                    <div class="sa-modal__actions">
                        <button type="button" class="sa-btn sa-btn--ghost" id="closeEditModal">İptal</button>
                        <button type="submit" class="sa-btn sa-btn--primary">Kaydet</button>
                    </div>
                </form>
            </div>
        </div>`;
}

// ===================== DASHBOARD: HESAPLAMA YARDIMCILARI =====================

const STATUS_FILTERS = [
    { id: "all", label: "Tümü" },
    { id: "active", label: "Aktif" },
    { id: "passive", label: "Pasif" },
    { id: "suspended", label: "Askıda" },
    { id: "pending", label: "Onay Bekleyen" }
];
const SUB_FILTERS = [
    { id: "all", label: "Tümü" },
    { id: "expired", label: "Aboneliği Bitmiş" },
    { id: "today", label: "Bugün Bitecek" },
    { id: "7days", label: "7 Gün İçinde" },
    { id: "15days", label: "15 Gün İçinde" },
    { id: "30days", label: "30 Gün İçinde" },
    { id: "active", label: "Aktif Aboneler" }
];

function tsMillis(value) {
    const d = toDateSafe(value);
    return d ? d.getTime() : 0;
}

function remainingDays(barber) {
    return calculateRemainingDays(barber?.subscriptionEndDate);
}

// Abonelik rengi: 30+ yeşil, 8-30 turuncu, 0-7 kırmızı, dolmuş koyu kırmızı.
function subInfo(barber) {
    const days = remainingDays(barber);
    const expired = days === null || days < 0;
    if (expired) return { key: "expired", days: days ?? -1 };
    if (days <= 7) return { key: "red", days };
    if (days <= 30) return { key: "orange", days };
    return { key: "green", days };
}

function subStatusLabel(status) {
    return status === "active" ? "Aktif" : "Süresi Dolmuş";
}

function updateEditSubStatusPreview(endDate) {
    const status = deriveSubscriptionStatusFromEndDate(endDate);
    const display = document.getElementById("editSubStatusDisplay");
    const hint = document.getElementById("editSubEnd");
    if (display) {
        display.value = subStatusLabel(status);
        display.dataset.status = status;
    }
    if (hint) {
        hint.textContent = endDate ? `Bitiş: ${formatDateTR(endDate)}` : "";
    }
}

function matchSub(sub, key) {
    const d = sub.days;
    switch (key) {
        case "expired": return sub.key === "expired";
        case "today": return sub.key !== "expired" && d === 0;
        case "7days": return sub.key !== "expired" && d >= 0 && d <= 7;
        case "15days": return sub.key !== "expired" && d >= 0 && d <= 15;
        case "30days": return sub.key !== "expired" && d >= 0 && d <= 30;
        case "active": return sub.key !== "expired" && d > 0;
        default: return true;
    }
}

function aggregateCustomerStats(customers) {
    const map = {};
    customers.forEach((c) => {
        const slug = c.barberSlug;
        if (!slug) return;
        if (!map[slug]) map[slug] = { customers: 0, appointments: 0, revenue: 0 };
        map[slug].customers += 1;
        map[slug].appointments += (c.totalVisits ?? c.totalAppointments ?? 0);
    });
    return map;
}

function getEnrichedBarbers() {
    return barbersCache.map((b) => {
        const s = statsBySlug[b.slug] || { customers: 0, appointments: 0, revenue: 0 };
        return {
            ...b,
            _customers: s.customers,
            _appointments: s.appointments,
            _revenue: s.revenue,
            _sub: subInfo(b),
            _created: tsMillis(b.createdAt)
        };
    });
}

function sortComparator(sort) {
    const byName = (a, b) => String(getBarberName(a)).localeCompare(String(getBarberName(b)), "tr");
    const subDays = (b) => (b._sub.key === "expired" ? -Infinity : b._sub.days);
    switch (sort) {
        case "az": return byName;
        case "za": return (a, b) => byName(b, a);
        case "newest": return (a, b) => b._created - a._created;
        case "oldest": return (a, b) => a._created - b._created;
        case "subSoonest": return (a, b) => subDays(a) - subDays(b);
        case "subLatest": return (a, b) => subDays(b) - subDays(a);
        case "mostCustomers": return (a, b) => b._customers - a._customers;
        case "leastCustomers": return (a, b) => a._customers - b._customers;
        case "mostAppointments": return (a, b) => b._appointments - a._appointments;
        case "leastAppointments": return (a, b) => a._appointments - b._appointments;
        case "mostRevenue": return (a, b) => b._revenue - a._revenue;
        case "leastRevenue": return (a, b) => a._revenue - b._revenue;
        default: return (a, b) => b._created - a._created;
    }
}

// Tüm filtre + arama + sıralama YALNIZCA frontend'de (ekstra Firestore read yok).
function getDashView() {
    const term = dashView.search.trim().toLocaleLowerCase("tr");
    const termDigits = term.replace(/\D/g, "");

    const list = getEnrichedBarbers().filter((b) => {
        if (dashView.status !== "all" && (b.status || "active") !== dashView.status) return false;
        if (dashView.sub !== "all" && !matchSub(b._sub, dashView.sub)) return false;
        if (dashView.city && (b.city || "") !== dashView.city) return false;
        if (dashView.district && (b.district || "") !== dashView.district) return false;
        if (term) {
            const hay = [b.name, b.slug, b.city, b.district]
                .map((x) => (x || "").toLocaleLowerCase("tr")).join(" ");
            const phone = (b.phone || "").replace(/\D/g, "");
            if (!hay.includes(term) && !(termDigits && phone.includes(termDigits))) return false;
        }
        return true;
    });

    return list.sort(sortComparator(dashView.sort));
}

// ===================== DASHBOARD: RENDER =====================

function renderStatCards() {
    const host = document.getElementById("saStatCards");
    if (!host) return;

    const total = barbersCache.length;
    const active = barbersCache.filter((b) => (b.status || "active") === "active").length;
    const passive = barbersCache.filter((b) => b.status === "passive").length;

    const now = new Date();
    const renewedThisMonth = barbersCache.filter((b) => {
        const d = toDateSafe(b.subscriptionRenewedAt);
        return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    const enriched = getEnrichedBarbers();
    const endingThisWeek = enriched.filter((b) => matchSub(b._sub, "7days")).length;

    let totalCustomers = 0;
    let totalAppointments = 0;
    Object.values(statsBySlug).forEach((s) => {
        totalCustomers += s.customers;
        totalAppointments += s.appointments;
    });

    const cards = [
        { label: "Toplam Dükkan", value: total, mod: "total" },
        { label: "Aktif Dükkan", value: active, mod: "active" },
        { label: "Pasif Dükkan", value: passive, mod: "passive" },
        { label: "Bu Ay Yenilenen", value: renewedThisMonth, mod: "renewed" },
        { label: "Bu Hafta Bitecek", value: endingThisWeek, mod: "expired" },
        { label: "Toplam Müşteri", value: totalCustomers, mod: "appointments" },
        { label: "Toplam Randevu", value: totalAppointments, mod: "revenue" },
        { label: "Bekleyen Başvuru", value: pendingBarbersCount, mod: "passive", id: "statPendingBarbers" }
    ];

    host.innerHTML = cards.map((c) => `
        <div class="sa-stat-card sa-stat-card--${c.mod}">
            <div class="sa-stat-card__label">${c.label}</div>
            <div class="sa-stat-card__value"${c.id ? ` id="${c.id}"` : ""}>${c.value}</div>
        </div>`).join("");
}

function renderAlertZone() {
    const host = document.getElementById("saAlertZone");
    if (!host) return;
    const soon = getEnrichedBarbers().filter((b) => matchSub(b._sub, "7days"));
    if (!soon.length) { host.innerHTML = ""; return; }
    host.innerHTML = `<button type="button" class="sad-alert" id="sadAlertBtn">
        <span class="sad-alert__icon">⚠️</span>
        <span class="sad-alert__text"><strong>${soon.length} dükkanın</strong> aboneliği bu hafta sona eriyor. Listeyi görmek için tıklayın.</span>
        <span class="sad-alert__arrow">→</span>
    </button>`;
    host.querySelector("#sadAlertBtn")?.addEventListener("click", () => {
        dashView.sub = "7days";
        renderDashChips();
        renderBarberTable();
        document.getElementById("sadFilters")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
}

function chipHtml(group, f, isActive, count) {
    return `<button type="button" class="sad-chip ${isActive ? "active" : ""}" data-${group}="${f.id}">
        ${f.label}<span class="sad-chip__count">${count || 0}</span>
    </button>`;
}

function renderDashChips() {
    const en = getEnrichedBarbers();
    const statusEl = document.getElementById("sadStatusChips");
    const subEl = document.getElementById("sadSubChips");

    if (statusEl) {
        statusEl.innerHTML = STATUS_FILTERS.map((f) => {
            const count = f.id === "all" ? en.length : en.filter((b) => (b.status || "active") === f.id).length;
            return chipHtml("status", f, dashView.status === f.id, count);
        }).join("");
    }
    if (subEl) {
        subEl.innerHTML = SUB_FILTERS.map((f) => {
            const count = f.id === "all" ? en.length : en.filter((b) => matchSub(b._sub, f.id)).length;
            return chipHtml("sub", f, dashView.sub === f.id, count);
        }).join("");
    }
}

function buildCityOptions() {
    return [...new Set(barbersCache.map((b) => b.city).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "tr"));
}
function buildDistrictOptions(city) {
    return [...new Set(barbersCache.filter((b) => !city || b.city === city).map((b) => b.district).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "tr"));
}
function refreshDistrictOptions() {
    if (!dashDistrictSel) return;
    dashDistrictSel.setOptions(["Tüm İlçeler", ...buildDistrictOptions(dashView.city)]);
    if (dashView.district) dashDistrictSel.setValue(dashView.district);
    dashDistrictSel.setDisabled(false);
}
function refreshDashSelectors() {
    if (dashCitySel) dashCitySel.setOptions(["Tüm Şehirler", ...buildCityOptions()], true);
    refreshDistrictOptions();
}

function subBadge(sub) {
    const map = {
        expired: { cls: "expired", label: "Süresi Dolmuş" },
        red: { cls: "red", label: "Kritik" },
        orange: { cls: "orange", label: "Yaklaşıyor" },
        green: { cls: "green", label: "Aktif" }
    };
    const m = map[sub.key] || map.green;
    return `<span class="sad-pill sad-pill--sub-${m.cls}">${m.label}</span>`;
}

function shopStatusBadge(b) {
    const status = b.status || "active";
    const map = {
        active: { cls: "active", label: "Aktif" },
        passive: { cls: "passive", label: "Pasif" },
        suspended: { cls: "suspended", label: "Askıda" },
        pending: { cls: "pending", label: "Onay Bekleyen" }
    };
    const m = map[status] || map.active;
    return `<span class="sad-pill sad-pill--shop-${m.cls}">${m.label}</span>`;
}

function shopAvatarHtml(b) {
    const name = getBarberName(b);
    if (b.logoUrl) {
        return `<img src="${escapeHtml(b.logoUrl)}" alt="" class="sad-shop-card__logo" loading="lazy">`;
    }
    const initial = (name || b.slug || "?").charAt(0).toUpperCase();
    return `<div class="sad-shop-card__avatar" aria-hidden="true">${escapeHtml(initial)}</div>`;
}

function remainingDaysHtml(sub) {
    if (sub.key === "expired") {
        return `<span class="sad-remain sad-remain--expired">⏳ Doldu</span>`;
    }
    if (sub.days === 0) {
        return `<span class="sad-remain sad-remain--today">⚠ Bugün Bitiyor</span>`;
    }
    let tone = "mild";
    if (sub.days >= 60) tone = "green";
    else if (sub.days < 7) tone = "red";
    else if (sub.days < 30) tone = "orange";
    return `<span class="sad-remain sad-remain--${tone}">⏳ ${sub.days} Gün</span>`;
}

function shopActionsBar(b) {
    if (!b.slug) {
        return `<p class="sad-act-disabled">Bu dükkan için slug bulunamadı.</p>`;
    }
    const baseAdmin = getAdminUrl(b.slug);
    const adminUrl = escapeHtml(baseAdmin ? `${baseAdmin}&fromSuperAdmin=true` : "#");
    const bookingUrl = escapeHtml(getBookingUrl(b.slug) || "#");
    const status = b.status || "active";
    const toggleLabel = status === "active" ? "Pasif Et" : "Aktif Et";
    const toggleIcon = status === "active" ? "🔴" : "🟢";
    const slug = escapeHtml(b.slug);

    return `<div class="sad-act-bar">
        <a href="${adminUrl}" target="_blank" rel="noopener noreferrer" class="sad-act-btn sad-act-btn--admin"><span aria-hidden="true">⚙️</span> Admin</a>
        <a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" class="sad-act-btn sad-act-btn--booking"><span aria-hidden="true">📅</span> Randevu</a>
        <button type="button" class="sad-act-btn sad-act-btn--edit" data-action="edit" data-slug="${slug}"><span aria-hidden="true">✏️</span> Düzenle</button>
        <button type="button" class="sad-act-btn sad-act-btn--copy" data-action="copy" data-slug="${slug}"><span aria-hidden="true">🔗</span> Kopyala</button>
        <button type="button" class="sad-act-btn sad-act-btn--toggle" data-action="toggle" data-slug="${slug}" data-status="${status}"><span aria-hidden="true">${toggleIcon}</span> ${toggleLabel}</button>
        <button type="button" class="sad-act-btn sad-act-btn--delete" data-action="delete" data-slug="${slug}"><span aria-hidden="true">🗑️</span> Sil</button>
    </div>`;
}

function cardHtml(b) {
    const checked = dashView.selected.has(b.slug) ? "checked" : "";
    const selectedClass = dashView.selected.has(b.slug) ? " is-selected" : "";
    const loc = [b.city, b.district].filter(Boolean).join(" / ") || "—";

    return `<article class="sad-shop-card${selectedClass}">
        <div class="sad-shop-card__top">
            <label class="sad-shop-card__check" title="Seç">
                <input type="checkbox" class="sad-row-check sad-check-pro" data-check-slug="${b.slug}" ${checked}>
            </label>
            ${shopAvatarHtml(b)}
            <div class="sad-shop-card__identity">
                <h3 class="sad-shop-card__name">${escapeHtml(getBarberName(b))}</h3>
                <p class="sad-shop-card__slug">${escapeHtml(b.slug)}</p>
            </div>
            <div class="sad-shop-card__badges">
                ${shopStatusBadge(b)}
                ${subBadge(b._sub)}
            </div>
        </div>
        <div class="sad-shop-card__body">
            <div class="sad-shop-card__col">
                <div class="sad-meta-row"><span class="sad-meta-row__ico">📍</span><span>${escapeHtml(loc)}</span></div>
                <div class="sad-meta-row"><span class="sad-meta-row__ico">📞</span><span>${escapeHtml(b.phone || "—")}</span></div>
            </div>
            <div class="sad-shop-card__col">
                <div class="sad-meta-row"><span class="sad-meta-row__ico">📅</span><span>${b.subscriptionEndDate ? formatDateTR(b.subscriptionEndDate) : "—"}</span></div>
                <div class="sad-meta-row sad-meta-row--days">${remainingDaysHtml(b._sub)}</div>
            </div>
        </div>
        ${shopActionsBar(b)}
    </article>`;
}

function renderBulkBar() {
    const bar = document.getElementById("sadBulkBar");
    const cnt = document.getElementById("sadSelectedCount");
    if (!bar) return;
    bar.hidden = dashView.selected.size === 0;
    if (cnt) cnt.textContent = dashView.selected.size;
}

function renderBarberTable() {
    const cardsHost = document.getElementById("sadCards");
    const countEl = document.getElementById("sadResultCount");
    if (!cardsHost) return;

    const list = getDashView();
    if (countEl) countEl.textContent = `${list.length} / ${barbersCache.length} dükkan`;

    if (!list.length) {
        const msg = barbersCache.length ? "Filtreye uygun dükkan bulunamadı." : "Henüz berber yok.";
        cardsHost.innerHTML = `<div class="sad-empty-state">${msg}</div>`;
        renderBulkBar();
        return;
    }

    cardsHost.innerHTML = list.map(cardHtml).join("");

    const selAll = document.getElementById("sadSelectAll");
    if (selAll) selAll.checked = list.length > 0 && list.every((b) => dashView.selected.has(b.slug));

    renderBulkBar();
}

function updatePendingBarbersBadge(count) {
    pendingBarbersCount = count;
    const badge = document.getElementById("pendingBarbersBadge");
    const stat = document.getElementById("statPendingBarbers");
    if (badge) {
        badge.textContent = count;
        badge.hidden = count === 0;
    }
    if (stat) stat.textContent = count;
}

async function loadPanelData() {
    if (!hasFirebaseConfig()) return;

    barbersCache = await fetchAllBarbers();
    try {
        const customers = await fetchAllCustomers();
        statsBySlug = aggregateCustomerStats(customers);
    } catch (err) {
        console.warn("Müşteri istatistikleri yüklenemedi:", err);
        statsBySlug = {};
    }
    refreshBarberStatsUI();
    try {
        const pending = await loadPendingBarbersPanel();
        updatePendingBarbersBadge(pending);
    } catch (err) {
        console.warn("Bekleyen dükkanlar yüklenemedi:", err);
    }
}

// Dashboard'u YALNIZCA bellekteki cache'lerden yeniden çizer (Firestore read YOK).
function refreshBarberStatsUI() {
    renderStatCards();
    renderDashChips();
    renderAlertZone();
    refreshDashSelectors();
    renderBarberTable();
}

function sortBarbersCache() {
    barbersCache.sort((a, b) =>
        (a.name || a.slug || "").localeCompare(b.name || b.slug || "", "tr")
    );
}

function updateEditLinkTools(slug) {
    const hasSlug = Boolean(String(slug || "").trim());
    const copyBtn = document.getElementById("copyLinkBtn");
    const waBtn = document.getElementById("whatsappMsgBtn");
    const adminLink = document.getElementById("openAdminLink");
    const slugWarning = document.getElementById("editSlugWarning");

    if (copyBtn) {
        copyBtn.disabled = !hasSlug;
        copyBtn.title = hasSlug ? "" : "Bu dükkan için slug bulunamadı.";
    }
    if (waBtn) {
        waBtn.disabled = !hasSlug;
        waBtn.title = hasSlug ? "" : "Bu dükkan için slug bulunamadı.";
    }
    if (adminLink) {
        adminLink.href = getAdminUrl(slug) || "#";
        adminLink.setAttribute("aria-disabled", hasSlug ? "false" : "true");
        adminLink.classList.toggle("sa-btn--disabled", !hasSlug);
    }
    if (slugWarning) slugWarning.hidden = hasSlug;
}

function openEditModal(barber) {
    document.getElementById("editSlug").value = barber.slug;
    document.getElementById("editName").value = barber.name || "";
    document.getElementById("editPhone").value = barber.phone || "";

    // Yapısal adres alanlarını yükle; eski (yalnızca "address" olan) kayıtlarda
    // veriyi kaybetmemek için tek-satır adresi "Açık Adres" alanına taşı.
    const hasStructuredAddress = Boolean(barber.city || barber.district || barber.neighborhood || barber.addressDetail);
    document.getElementById("editNeighborhood").value = barber.neighborhood || "";
    document.getElementById("editAddressDetail").value = barber.addressDetail || (hasStructuredAddress ? "" : (barber.address || ""));
    editAddress?.load({ city: barber.city || "", district: barber.district || "" });
    document.getElementById("editWhatsapp").value = barber.whatsapp || "";
    document.getElementById("editOpenHour").value = barber.openHour || "09:00";
    document.getElementById("editCloseHour").value = barber.closeHour || "21:00";
    document.getElementById("editUsername").value = barber.username || "";
    document.getElementById("editPassword").value = barber.password || "";
    document.getElementById("editTelegram").value = barber.telegramChatId || "";
    document.getElementById("editLogoUrl").value = barber.logoUrl || "";
    document.getElementById("editCoverUrl").value = barber.coverUrl || "";
    document.getElementById("editMapsLink").value = barber.mapsLink || "";
    document.getElementById("editStatus").value = barber.status || "active";
    const endDate = barber.subscriptionEndDate ? String(barber.subscriptionEndDate).slice(0, 10) : "";
    document.getElementById("editSubEndDate").value = endDate;
    updateEditSubStatusPreview(endDate);
    updateEditLinkTools(barber.slug);

    document.getElementById("editModal").classList.add("open");
    // Popup açıkken arkadaki ana sayfanın kaymasını engelle
    document.body.style.overflow = "hidden";
}

function closeEditModal() {
    document.getElementById("editModal")?.classList.remove("open");
    // Popup kapanınca ana sayfanın kaydırması normale dönsün
    document.body.style.overflow = "";
}

async function copyToClipboard(text, toastMessage = "Panoya kopyalandı!") {
    await navigator.clipboard.writeText(text);
    showToastFn(toastMessage);
}

async function copyBookingLink(slug) {
    const url = getBookingUrl(slug);
    if (!url) {
        showToastFn("Bu dükkan için slug bulunamadı.", "error");
        return;
    }
    await copyToClipboard(url, "Randevu linki kopyalandı.");
}

function bindDashboardEvents() {
    // Şehir / İlçe searchable selectleri (veriden türetilir; ekstra read yok)
    dashCitySel = createSearchableSelect(document.getElementById("sadCitySelect"), {
        placeholder: "Tüm Şehirler", searchPlaceholder: "İl ara...",
        onChange: (val) => {
            dashView.city = (val === "Tüm Şehirler") ? "" : val;
            dashView.district = "";
            refreshDistrictOptions();
            renderBarberTable();
        }
    });
    dashDistrictSel = createSearchableSelect(document.getElementById("sadDistrictSelect"), {
        placeholder: "Tüm İlçeler", searchPlaceholder: "İlçe ara...",
        onChange: (val) => {
            dashView.district = (val === "Tüm İlçeler") ? "" : val;
            renderBarberTable();
        }
    });
    dashDistrictSel?.setDisabled(true);

    document.getElementById("sadSearch")?.addEventListener("input", (e) => {
        dashView.search = e.target.value;
        renderBarberTable();
    });


    document.getElementById("sadStatusChips")?.addEventListener("click", (e) => {
        const c = e.target.closest("[data-status]"); if (!c) return;
        dashView.status = c.dataset.status;
        renderDashChips();
        renderBarberTable();
    });
    document.getElementById("sadSubChips")?.addEventListener("click", (e) => {
        const c = e.target.closest("[data-sub]"); if (!c) return;
        dashView.sub = c.dataset.sub;
        renderDashChips();
        renderBarberTable();
    });

    document.getElementById("sadSort")?.addEventListener("change", (e) => {
        dashView.sort = e.target.value;
        renderBarberTable();
    });

    document.getElementById("sadSelectAll")?.addEventListener("change", (e) => {
        const view = getDashView();
        if (e.target.checked) view.forEach((b) => dashView.selected.add(b.slug));
        else view.forEach((b) => dashView.selected.delete(b.slug));
        renderBarberTable();
    });

    function onRowCheck(e) {
        const c = e.target.closest(".sad-row-check"); if (!c) return;
        const slug = c.dataset.checkSlug;
        if (c.checked) dashView.selected.add(slug);
        else dashView.selected.delete(slug);
        const card = c.closest(".sad-shop-card");
        if (card) card.classList.toggle("is-selected", c.checked);
        renderBulkBar();
        const view = getDashView();
        const selAll = document.getElementById("sadSelectAll");
        if (selAll) selAll.checked = view.length > 0 && view.every((b) => dashView.selected.has(b.slug));
    }
    document.getElementById("sadCards")?.addEventListener("change", onRowCheck);

    document.getElementById("sadBulkBar")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-bulk]"); if (!b) return;
        handleBulkAction(b.dataset.bulk);
    });
}

async function handleBulkAction(action) {
    const slugs = [...dashView.selected];
    if (action === "clear") { dashView.selected.clear(); renderBarberTable(); return; }
    if (!slugs.length) return;

    try {
        if (action === "message") {
            showToastFn(`${slugs.length} dükkana mesaj kuyruğa alındı (mock).`);
            return;
        }
        if (action === "extend") {
            const months = Number(prompt("Seçili dükkanların aboneliği kaç ay uzatılsın?", "1"));
            if (!months || months < 1) return;
            for (const slug of slugs) {
                const end = await extendSubscription(slug, months);
                const c = barbersCache.find((b) => b.slug === slug);
                if (c) { c.subscriptionEndDate = end; c.subscriptionStatus = "active"; }
            }
            showToastFn(`${slugs.length} dükkanın aboneliği ${months} ay uzatıldı.`);
        } else if (action === "activate" || action === "passive") {
            const status = action === "activate" ? "active" : "passive";
            for (const slug of slugs) {
                await updateBarber(slug, { status }, slug);
                const c = barbersCache.find((b) => b.slug === slug);
                if (c) c.status = status;
            }
            showToastFn(`${slugs.length} dükkan ${status === "active" ? "aktif" : "pasif"} edildi.`);
        }
        dashView.selected.clear();
        refreshBarberStatsUI();
    } catch (err) {
        showToastFn(err.message || "Toplu işlem başarısız.", "error");
    }
}

function addApprovedBarberToCache({ result, pending }) {
    if (!result?.slug || !pending) return;
    const composedAddress = [pending.city, pending.district, pending.address].filter(Boolean).join(", ");
    barbersCache.push({
        slug: result.slug,
        name: pending.shopName,
        city: pending.city,
        district: pending.district,
        address: composedAddress,
        addressDetail: pending.address,
        phone: pending.phone,
        email: pending.email,
        openHour: pending.openingHour,
        closeHour: pending.closingHour,
        mapsLink: pending.mapsLink || "",
        username: result.username,
        status: "active",
        subscriptionStatus: "active",
        subscriptionEndDate: result.subscriptionEndDate,
        createdAt: new Date()
    });
    sortBarbersCache();
    refreshBarberStatsUI();
}

function closeAllActionMenus() {
    document.querySelectorAll(".sad-menu.is-open").forEach((menu) => {
        menu.classList.remove("is-open");
        const panel = menu.querySelector(".sad-menu__panel");
        if (panel) panel.hidden = true;
    });
}

function openCreateBarberModal() {
    const modal = document.getElementById("createBarberModal");
    if (!modal) return;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
}

function closeCreateBarberModal() {
    const modal = document.getElementById("createBarberModal");
    if (!modal) return;
    modal.classList.remove("open");
    document.body.style.overflow = "";
}

function bindPanelEvents(onLogout) {
    document.getElementById("saLogoutBtn")?.addEventListener("click", onLogout);

    // Adres (İl/İlçe searchable + Mahalle + Açık Adres) seçicilerini kur
    createAddress = setupAddressSelector("create");
    editAddress = setupAddressSelector("edit");

    document.querySelectorAll(".sa-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".sa-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".sa-tab-panel").forEach(p => p.hidden = true);
            tab.classList.add("active");
            document.querySelector(`[data-panel="${tab.dataset.tab}"]`).hidden = false;
            if (tab.dataset.tab === "codes") loadActivationCodesPanel();
        });
    });

    bindActivationCodesEvents(showToastFn);
    bindPendingBarbersEvents(showToastFn, (payload) => {
        if (payload?.result && payload?.pending) addApprovedBarberToCache(payload);
        if (typeof payload?.pendingCount === "number") updatePendingBarbersBadge(payload.pendingCount);
    });

    const slugInput = document.getElementById("fieldSlug");
    const nameInput = document.getElementById("fieldName");
    const usernameInput = document.getElementById("fieldUsername");
    nameInput?.addEventListener("blur", () => {
        if (!slugInput.value.trim()) slugInput.value = normalizeSlug(nameInput.value);
        if (!usernameInput.value.trim()) usernameInput.value = normalizeSlug(nameInput.value).replace(/-/g, "_");
    });

    document.getElementById("openCreateBarberBtn")?.addEventListener("click", openCreateBarberModal);
    document.getElementById("closeCreateBarberModal")?.addEventListener("click", closeCreateBarberModal);
    document.getElementById("cancelCreateBarberModal")?.addEventListener("click", closeCreateBarberModal);
    document.getElementById("createBarberModal")?.addEventListener("click", (e) => {
        if (e.target.id === "createBarberModal") closeCreateBarberModal();
    });

    document.getElementById("saPanel")?.addEventListener("click", (e) => {
        const trigger = e.target.closest(".sad-menu__trigger");
        if (trigger) {
            e.stopPropagation();
            const menu = trigger.closest(".sad-menu");
            const panel = menu?.querySelector(".sad-menu__panel");
            const wasOpen = menu?.classList.contains("is-open");
            closeAllActionMenus();
            if (menu && panel && !wasOpen) {
                menu.classList.add("is-open");
                panel.hidden = false;
            }
            return;
        }
        if (e.target.closest(".sad-menu__item")) closeAllActionMenus();
    });
    document.addEventListener("click", closeAllActionMenus);

    document.getElementById("firebaseConfigForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const errEl = document.getElementById("firebaseConfigError");
        errEl?.classList.remove("show");
        try {
            saveFirebaseConfig({
                apiKey: document.getElementById("cfgApiKey").value,
                authDomain: document.getElementById("cfgAuthDomain").value,
                projectId: document.getElementById("cfgProjectId").value,
                storageBucket: document.getElementById("cfgStorageBucket").value,
                messagingSenderId: document.getElementById("cfgMessagingSenderId").value,
                appId: document.getElementById("cfgAppId").value
            });
            window.location.reload();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message;
                errEl.classList.add("show");
            }
        }
    });

    document.getElementById("barberForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = document.getElementById("formError");
        errEl.classList.remove("show");
        const btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;

        try {
            const city = createAddress?.citySel.getValue() || "";
            const district = createAddress?.districtSel.getValue() || "";
            const neighborhood = document.getElementById("fieldNeighborhood").value.trim();
            const addressDetail = document.getElementById("fieldAddressDetail").value.trim();

            const created = await createBarber({
                slug: document.getElementById("fieldSlug").value,
                name: document.getElementById("fieldName").value,
                city,
                district,
                neighborhood,
                addressDetail,
                address: composeAddressText({ city, district, neighborhood, addressDetail }),
                phone: document.getElementById("fieldPhone").value,
                whatsapp: document.getElementById("fieldWhatsapp").value,
                openHour: document.getElementById("fieldOpenHour").value,
                closeHour: document.getElementById("fieldCloseHour").value,
                username: document.getElementById("fieldUsername").value,
                password: document.getElementById("fieldPassword").value,
                telegramChatId: document.getElementById("fieldTelegram").value,
                logoUrl: document.getElementById("fieldLogoUrl").value,
                coverUrl: document.getElementById("fieldCoverUrl").value,
                mapsLink: document.getElementById("fieldMapsLink").value
            });
            e.target.reset();
            createAddress?.reset();
            closeCreateBarberModal();
            showToastFn("Berber başarıyla oluşturuldu.");
            // Tüm listeyi tekrar çekmek yerine yalnızca yeni kaydı oku ve cache'e ekle.
            const newBarber = await fetchBarber(created.slug);
            if (newBarber) {
                barbersCache.push(newBarber);
                sortBarbersCache();
            }
            refreshBarberStatsUI();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.classList.add("show");
        } finally {
            btn.disabled = false;
        }
    });

    // Berber satır/kart aksiyonları — hem masaüstü tablo hem mobil kart için ortak.
    async function handleBarberAction(e) {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const { action, slug } = btn.dataset;

        if (action === "toggle") {
            const newStatus = await toggleBarberStatus(slug, btn.dataset.status);
            const cached = barbersCache.find(b => b.slug === slug);
            if (cached) cached.status = newStatus;
            showToastFn("Durum güncellendi.");
            refreshBarberStatsUI();
        } else if (action === "edit") {
            const barber = barbersCache.find(b => b.slug === slug) || await fetchBarber(slug);
            if (barber) openEditModal(barber);
        } else if (action === "copy") {
            await copyBookingLink(slug);
        } else if (action === "delete") {
            if (confirm("Bu berberi silmek istediğinize emin misiniz?")) {
                await removeBarber(slug);
                const idx = barbersCache.findIndex(b => b.slug === slug);
                if (idx !== -1) barbersCache.splice(idx, 1);
                dashView.selected.delete(slug);
                showToastFn("Berber silindi.");
                refreshBarberStatsUI();
            }
        }
    }
    document.getElementById("barbersTableBody")?.addEventListener("click", handleBarberAction);
    document.getElementById("sadCards")?.addEventListener("click", handleBarberAction);

    bindDashboardEvents();

    document.getElementById("editSubEndDate")?.addEventListener("change", (e) => {
        updateEditSubStatusPreview(e.target.value);
    });

    document.getElementById("editForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const slug = document.getElementById("editSlug").value;
        try {
            const city = editAddress?.citySel.getValue() || "";
            const district = editAddress?.districtSel.getValue() || "";
            const neighborhood = document.getElementById("editNeighborhood").value.trim();
            const addressDetail = document.getElementById("editAddressDetail").value.trim();

            const subscriptionEndDate = document.getElementById("editSubEndDate").value;
            const subscriptionStatus = deriveSubscriptionStatusFromEndDate(subscriptionEndDate);

            const updates = {
                name: document.getElementById("editName").value,
                city,
                district,
                neighborhood,
                addressDetail,
                address: composeAddressText({ city, district, neighborhood, addressDetail }),
                phone: document.getElementById("editPhone").value,
                whatsapp: document.getElementById("editWhatsapp").value,
                openHour: document.getElementById("editOpenHour").value,
                closeHour: document.getElementById("editCloseHour").value,
                username: document.getElementById("editUsername").value,
                password: document.getElementById("editPassword").value,
                telegramChatId: document.getElementById("editTelegram").value,
                logoUrl: document.getElementById("editLogoUrl").value,
                coverUrl: document.getElementById("editCoverUrl").value,
                mapsLink: document.getElementById("editMapsLink").value,
                status: document.getElementById("editStatus").value,
                subscriptionEndDate,
                subscriptionStatus,
                lastSubscriptionUpdate: serverTimestamp()
            };
            await updateBarber(slug, updates, slug);
            const cached = barbersCache.find(b => b.slug === slug);
            if (cached) {
                const { lastSubscriptionUpdate, ...cacheFields } = updates;
                Object.assign(cached, cacheFields);
                cached.lastSubscriptionUpdate = new Date();
                sortBarbersCache();
            }
            showToastFn("Berber güncellendi.");
            closeEditModal();
            refreshBarberStatsUI();
        } catch (err) {
            showToastFn(err.message, "error");
        }
    });

    document.querySelectorAll("[data-extend]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const slug = document.getElementById("editSlug").value;
            const months = Number(btn.dataset.extend);
            const newEnd = await extendSubscription(slug, months);
            const cached = barbersCache.find(b => b.slug === slug);
            if (cached) {
                cached.subscriptionEndDate = newEnd;
                cached.subscriptionStatus = "active";
            }
            document.getElementById("editSubEndDate").value = newEnd;
            updateEditSubStatusPreview(newEnd);
            showToastFn(`${months} ay uzatıldı.`);
            refreshBarberStatsUI();
        });
    });

    document.getElementById("openAdminLink")?.addEventListener("click", (e) => {
        const slug = document.getElementById("editSlug")?.value;
        if (!getAdminUrl(slug)) {
            e.preventDefault();
            showToastFn("Bu dükkan için slug bulunamadı.", "error");
        }
    });

    document.getElementById("copyLinkBtn")?.addEventListener("click", () => {
        copyBookingLink(document.getElementById("editSlug").value);
    });

    document.getElementById("whatsappMsgBtn")?.addEventListener("click", () => {
        const slug = document.getElementById("editSlug").value;
        const message = getWhatsAppBookingMessage(slug);
        if (!message) {
            showToastFn("Bu dükkan için slug bulunamadı.", "error");
            return;
        }
        copyToClipboard(message, "WhatsApp mesajı kopyalandı.");
    });

    document.getElementById("closeEditModal")?.addEventListener("click", closeEditModal);
    document.getElementById("editModal")?.addEventListener("click", (e) => {
        if (e.target.id === "editModal") closeEditModal();
    });
}

export async function mountSuperAdminPanel(mountEl, { showToast, onLogout }) {
    if (!mountEl || panelMounted) return;

    showToastFn = showToast;
    mountEl.innerHTML = getPanelHtml();
    bindPanelEvents(onLogout);
    panelMounted = true;
    await loadPanelData();
}

export function unmountSuperAdminPanel(mountEl) {
    if (mountEl) mountEl.innerHTML = "";
    panelMounted = false;
    barbersCache = [];
    pendingBarbersCount = 0;
}
