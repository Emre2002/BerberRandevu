import { fetchBarber } from "./firestoreService.js";
import {
    logoutBarberSession,
    getBarberSlugFromUrl,
    isSuperAdminLoggedIn,
    requireBarberSession,
    getLoggedInBarberSlug
} from "./sessionAuth.js";

const urlSlug = getBarberSlugFromUrl();
const fromSuperAdminParam = new URLSearchParams(window.location.search).get("fromSuperAdmin") === "true";

let superAdminMode = false;
const adminPanel = document.getElementById("adminPanel");
const loginGate = document.getElementById("barberLoginGate");

function hideLoginGate() {
    if (loginGate) loginGate.hidden = true;
}

function showAdminPanel() {
    hideLoginGate();
    if (adminPanel) adminPanel.hidden = false;
}

function redirectToLogin() {
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    const params = new URLSearchParams();
    if (returnUrl && returnUrl !== "/giris.html") {
        params.set("return", returnUrl);
    }
    const qs = params.toString();
    window.location.replace(qs ? `giris.html?${qs}` : "giris.html");
}

function grantAdminAccess(slug, { superAdmin = false } = {}) {
    superAdminMode = superAdmin;
    showAdminPanel();
    const detail = { slug, superAdmin };
    window.__barberAdminReadyDetail = detail;
    window.dispatchEvent(new CustomEvent("barberAdminReady", { detail }));
}

function injectSuperAdminBar(shopName) {
    if (!adminPanel) return;
    let bar = document.getElementById("superAdminModeBar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "superAdminModeBar";
        bar.className = "sa-mode-bar";
        bar.innerHTML = `
            <span class="sa-mode-bar__text">👑 Super Admin modu: <strong id="saModeShop">Bu dükkan</strong> panelini denetliyorsunuz.</span>
            <a href="super-admin.html" class="sa-mode-bar__btn">← Super Admin Paneline Dön</a>`;
        adminPanel.prepend(bar);
    }
    const shopEl = document.getElementById("saModeShop");
    if (shopEl && shopName) shopEl.textContent = shopName;
}

function enterSuperAdminMode(slug) {
    injectSuperAdminBar(slug);
    grantAdminAccess(slug, { superAdmin: true });
    fetchBarber(slug).then((barber) => {
        injectSuperAdminBar(barber?.name || slug);
    });
}

function initGate() {
    hideLoginGate();

    // 1) Geçerli Super Admin oturumu — berber session / şifre gerekmez; slug eşleşmesi aranmaz.
    if (isSuperAdminLoggedIn()) {
        if (!urlSlug) {
            redirectToLogin();
            return;
        }
        enterSuperAdminMode(urlSlug);
        return;
    }

    // 2) fromSuperAdmin URL parametresi tek başına bypass değildir.
    if (fromSuperAdminParam) {
        redirectToLogin();
        return;
    }

    // 3) Normal berber oturumu
    if (!urlSlug) {
        const sessionSlug = getLoggedInBarberSlug();
        if (sessionSlug) {
            window.location.replace(`admin.html?dukkan=${encodeURIComponent(sessionSlug)}`);
            return;
        }
        redirectToLogin();
        return;
    }

    const sessionSlug = requireBarberSession(urlSlug);
    if (sessionSlug) {
        grantAdminAccess(sessionSlug, { superAdmin: false });
        return;
    }

    const validSessionSlug = getLoggedInBarberSlug();
    if (validSessionSlug && validSessionSlug !== urlSlug) {
        window.location.replace(`admin.html?dukkan=${encodeURIComponent(validSessionSlug)}`);
        return;
    }

    redirectToLogin();
}

document.getElementById("btnLogout")?.addEventListener("click", () => {
    if (superAdminMode) {
        window.location.href = "super-admin.html";
        return;
    }
    logoutBarberSession();
    redirectToLogin();
});

initGate();
