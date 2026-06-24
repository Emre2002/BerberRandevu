import {
    isSuperAdminLoggedIn,
    loginSuperAdmin,
    logoutSuperAdmin
} from "./sessionAuth.js";
import { validateSuperAdminLogin } from "./superAdminAuth.js";
import { mountSuperAdminPanel, unmountSuperAdminPanel } from "./super-admin-panel.js";
import { migrateVisitDates } from "./migrateVisitDates.js";
import { syncAllPublicBarbersForMigration } from "./firestoreService.js";

const loginScreen = document.getElementById("saLoginScreen");
const mountEl = document.getElementById("saAppMount");
const toastEl = document.getElementById("saToast");
const loginError = document.getElementById("saLoginError");
const loginForm = document.getElementById("saLoginForm");
const loginBtn = document.getElementById("saLoginBtn");

function showToast(msg, type = "success") {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = `sa-toast sa-toast--${type} show`;
    setTimeout(() => toastEl.classList.remove("show"), 3500);
}

function showLogin() {
    logoutSuperAdmin();
    clearSuperAdminGlobals();
    unmountSuperAdminPanel(mountEl);
    loginScreen.hidden = false;
    loginForm?.reset();
    loginError?.classList.remove("show");
}

function registerSuperAdminGlobals() {
    window.migrateVisitDates = migrateVisitDates;
    window.syncAllPublicBarbersForMigration = syncAllPublicBarbersForMigration;
}

function clearSuperAdminGlobals() {
    delete window.migrateVisitDates;
    delete window.syncAllPublicBarbersForMigration;
}

async function showPanel() {
    loginError?.classList.remove("show");
    registerSuperAdminGlobals();
    try {
        await mountSuperAdminPanel(mountEl, {
            showToast,
            onLogout: showLogin
        });
        loginScreen.hidden = true;
    } catch (err) {
        console.error("[SuperAdmin] Panel yüklenemedi:", err);
        loginScreen.hidden = false;
        showToast("Panel yüklenemedi. Sayfayı yenileyin.", "error");
    }
}

loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError?.classList.remove("show");
    loginBtn.disabled = true;
    loginBtn.textContent = "Doğrulanıyor...";

    try {
        const username = document.getElementById("saUsername").value;
        const password = document.getElementById("saPassword").value;
        const valid = await validateSuperAdminLogin(username, password);

        if (valid) {
            loginSuperAdmin();
            await showPanel();
        } else {
            loginError?.classList.add("show");
        }
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Giriş Yap";
    }
});

if (isSuperAdminLoggedIn()) {
    showPanel();
}
