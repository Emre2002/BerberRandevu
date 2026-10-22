import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";

const source = readFileSync(resolve("super-admin-panel.js"), "utf8");

function sliceBetween(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}

test("dashboard markup keeps all functional sections and controls", () => {
    const context = {
        hasFirebaseConfig: () => true,
        shouldUseEmulatorAuthLogin: () => true,
        getActivationCodesPanelHtml: () => '<div id="codesFixture"></div>',
        getPendingBarbersPanelHtml: () => '<div id="pendingFixture"></div>'
    };
    runInNewContext(sliceBetween("const dashboardIcons =", "// ===================== DASHBOARD: HESAPLAMA") + "\nglobalThis.html = getPanelHtml();", context);
    const html = context.html;
    for (const tab of ["overview", "barbers", "codes", "pending"]) {
        assert.match(html, new RegExp(`data-tab="${tab}"`));
        assert.match(html, new RegExp(`data-panel="${tab}"`));
    }
    for (const id of ["saSidebarToggle", "saStatCards", "saSecondaryStats", "sadSearch", "sadStatusChips", "sadSubChips", "sadCitySelect", "sadSort", "sadCards", "openCreateBarberBtn", "saSyncPublicBarbersBtn", "barberForm", "editForm", "pendingBarbersBadge"]) {
        assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
    }
    assert.match(html, /aria-controls="saSidebar" aria-expanded="false"/);
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="createBarberTitle"/);
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="editBarberTitle"/);
});

test("navigation shows the requested section and updates its accessible state", () => {
    const names = ["overview", "barbers", "codes", "pending"];
    const tabs = names.map((name) => ({
        dataset: { tab: name },
        active: name === "overview",
        attrs: new Map(),
        classList: { toggle(_class, value) { this.owner.active = value; } },
        setAttribute(key, value) { this.attrs.set(key, value); },
        removeAttribute(key) { this.attrs.delete(key); }
    }));
    tabs.forEach((tab) => { tab.classList.owner = tab; });
    const panels = names.map((name) => ({ dataset: { panel: name }, hidden: name !== "overview" }));
    const title = { textContent: "Genel Bakış" };
    const contextLabel = { textContent: "Genel Bakış" };
    const root = { classList: { remove() {}, contains() { return false; } } };
    const toggle = { setAttribute() {} };
    let codesLoaded = 0;
    const context = {
        document: {
            querySelectorAll(selector) { return selector.includes(".sa-tab-panel") ? panels : tabs; },
            getElementById(id) { return ({ saPanel: root, saSidebarToggle: toggle, saPageTitle: title, saPageContext: contextLabel })[id]; }
        },
        loadActivationCodesPanel() { codesLoaded += 1; }
    };
    runInNewContext(sliceBetween("function syncSidebarAccessibility()", "function openCreateBarberModal()") + "\nactivatePanelTab('codes');", context);
    assert.equal(title.textContent, "Aktivasyon Kodları");
    assert.equal(contextLabel.textContent, "Aktivasyon Kodları");
    assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false, true]);
    assert.equal(tabs[2].attrs.get("aria-current"), "page");
    assert.equal(codesLoaded, 1);
});

test("mobile sidebar opens, closes and removes hidden links from tab order", () => {
    let open = false;
    let focused = false;
    const attrs = new Map();
    const root = { classList: {
        toggle() { open = !open; return open; },
        remove() { open = false; },
        contains() { return open; }
    } };
    const toggle = { setAttribute(key, value) { attrs.set(key, value); } };
    const sidebar = { inert: true, setAttribute(key, value) { attrs.set(`sidebar-${key}`, value); } };
    const context = {
        window: { matchMedia: () => ({ matches: true }) },
        document: {
            getElementById(id) { return ({ saPanel: root, saSidebarToggle: toggle, saSidebar: sidebar })[id]; },
            querySelector() { return { focus() { focused = true; } }; }
        }
    };
    createContext(context);
    runInContext(sliceBetween("function syncSidebarAccessibility()", "function openCreateBarberModal()") + "\ntoggleSidebar();", context);
    assert.equal(open, true);
    assert.equal(sidebar.inert, false);
    assert.equal(attrs.get("aria-expanded"), "true");
    assert.equal(focused, true);
    runInContext("toggleSidebar();", context);
    assert.equal(open, false);
    assert.equal(sidebar.inert, true);
    assert.equal(attrs.get("aria-expanded"), "false");
});

test("metrics distinguish loading and unavailable counts from zero", () => {
    const primary = { innerHTML: "" };
    const secondary = { innerHTML: "" };
    const context = {
        document: { getElementById(id) { return id === "saStatCards" ? primary : secondary; } },
        barbersLoaded: false,
        barbersLoadError: false,
        barbersCache: [{ slug: "example", status: "active" }],
        statsBySlug: {},
        pendingBarbersCount: null,
        toDateSafe: () => null,
        getEnrichedBarbers: () => [],
        matchSub: () => false
    };
    createContext(context);
    runInContext(sliceBetween("function renderStatCards()", "function renderAlertZone()") + "\nrenderStatCards();", context);
    assert.match(primary.innerHTML, /Veriler yükleniyor/);
    assert.doesNotMatch(primary.innerHTML, />0</);
    runInContext("barbersLoaded = true; renderStatCards();", context);
    assert.match(primary.innerHTML, /Toplam İşletme/);
    assert.match(primary.innerHTML, /Toplam Randevu/);
    assert.match(primary.innerHTML, /—/);
    assert.match(secondary.innerHTML, /Toplam Müşteri/);
});

test("business search and filters keep the existing list selection logic", () => {
    const businesses = [
        { name: "Ankara Berber", slug: "ankara", city: "Ankara", district: "Çankaya", status: "active", phone: "555111", _sub: { key: "green" } },
        { name: "İzmir Berber", slug: "izmir", city: "İzmir", district: "Konak", status: "passive", phone: "555222", _sub: { key: "expired" } }
    ];
    const context = {
        dashView: { search: "ankara", status: "active", sub: "all", city: "Ankara", district: "", sort: "newest" },
        getEnrichedBarbers: () => businesses,
        matchSub: (sub, filter) => filter === "all" || sub.key === filter,
        sortComparator: () => () => 0
    };
    runInNewContext(sliceBetween("function getDashView()", "// ===================== DASHBOARD: RENDER") + "\nglobalThis.result = getDashView();", context);
    assert.equal(context.result.length, 1);
    assert.equal(context.result[0].slug, "ankara");
});
