import { validateBarberLogin, fetchBarber } from "./firestoreService.js";
import {
    isBarberLoggedIn,
    loginBarber,
    logoutBarber,
    getBarberSlugFromUrl,
    isSuperAdminLoggedIn
} from "./sessionAuth.js";

const slug = getBarberSlugFromUrl();

// Super Admin modu: geçerli Super Admin oturumu varsa berber şifresi sorulmadan
// panel açılır. Güvenlik query parametresine DEĞİL, gerçek oturuma dayanır.
let superAdminMode = false;
const loginGate = document.getElementById("barberLoginGate");
const adminPanel = document.getElementById("adminPanel");
const loginForm = document.getElementById("barberLoginForm");
const loginError = document.getElementById("barberLoginError");
const shopNameEl = document.getElementById("barberShopName");
const shopSlugEl = document.getElementById("barberShopSlug");
const missingSlugEl = document.getElementById("barberMissingSlug");
const backLink = document.getElementById("barberBackLink");

function showLoginGate() {
    if (loginGate) loginGate.hidden = false;
    if (adminPanel) adminPanel.hidden = true;
}

function showAdminPanel() {
    if (loginGate) loginGate.hidden = true;
    if (adminPanel) adminPanel.hidden = false;
}

// Admin panelinin üstüne "Super Admin modu" bilgi barını ekler.
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

function enterSuperAdminMode() {
    superAdminMode = true;
    if (shopSlugEl) shopSlugEl.textContent = slug;
    injectSuperAdminBar(slug);
    showAdminPanel();
    fetchBarber(slug).then((barber) => {
        if (barber?.name && shopNameEl) shopNameEl.textContent = barber.name;
        injectSuperAdminBar(barber?.name || slug);
    });
}

function initGate() {
    // Geçici debug — üretimde kaldırılabilir.
    console.log("Super admin session:", isSuperAdminLoggedIn());
    console.log("Admin slug:", slug);

    if (!slug) {
        if (missingSlugEl) missingSlugEl.hidden = false;
        if (loginForm) loginForm.hidden = true;
        showLoginGate();
        return;
    }

    // 1) Geçerli Super Admin oturumu varsa berber girişi atlanır.
    if (isSuperAdminLoggedIn()) {
        enterSuperAdminMode();
        return;
    }

    // 2) Normal berber giriş akışı (değişmedi).
    if (missingSlugEl) missingSlugEl.hidden = true;
    if (loginForm) loginForm.hidden = false;
    if (shopSlugEl) shopSlugEl.textContent = slug;
    if (backLink) backLink.href = `randevu.html?dukkan=${encodeURIComponent(slug)}`;

    fetchBarber(slug).then((barber) => {
        if (barber?.name && shopNameEl) shopNameEl.textContent = barber.name;
    });

    if (isBarberLoggedIn(slug)) {
        showAdminPanel();
    } else {
        showLoginGate();
    }
}

loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!slug) return;

    loginError.hidden = true;
    const btn = document.getElementById("barberLoginBtn");
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor...";

    try {
        await validateBarberLogin(
            slug,
            document.getElementById("barberUsername").value,
            document.getElementById("barberPassword").value
        );
        loginBarber(slug);
        showAdminPanel();
    } catch (err) {
        loginError.hidden = false;
        loginError.textContent = err.message || "Giriş başarısız.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Giriş Yap";
    }
});

document.getElementById("btnLogout")?.addEventListener("click", () => {
    // Super Admin modunda: oturumu SİLME, sadece Super Admin paneline dön.
    if (superAdminMode) {
        window.location.href = "super-admin.html";
        return;
    }
    logoutBarber();
    showLoginGate();
    loginForm?.reset();
});

initGate();
