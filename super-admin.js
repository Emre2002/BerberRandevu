import { bootstrapPassiveAuthFoundation } from "./authService.js";
import { authSignOut } from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";
import {
    isSuperAdminLoggedIn,
    loginSuperAdmin,
    logoutSuperAdmin
} from "./sessionAuth.js";
import { validateSuperAdminLogin } from "./superAdminAuth.js";
import {
    signInWithProductionSuperAdminAuth,
    PRODUCTION_SUPER_ADMIN_LOGIN_ERROR,
    PRODUCTION_SUPER_ADMIN_FORBIDDEN_ERROR,
    PRODUCTION_SUPER_ADMIN_UNAVAILABLE_ERROR
} from "./productionSuperAdminLogin.js";
import { shouldUseEmulatorAuthLogin } from "./legacyAuthCompat.js";
import { mountSuperAdminPanel, unmountSuperAdminPanel } from "./super-admin-panel.js";
import { migrateVisitDates } from "./migrateVisitDates.js";
import { syncAllPublicBarbersForMigration } from "./firestoreService.js";

bootstrapPassiveAuthFoundation();

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

async function ensureSuperAdminAuthSession() {
    const auth = await getAuthInstance();
    const user = auth.currentUser;
    if (!user) {
        throw Object.assign(new Error("super_admin_auth_required"), { code: "auth_required" });
    }

    const tokenResult = await user.getIdTokenResult(true);
    if (tokenResult.claims?.superAdmin !== true) {
        await authSignOut();
        throw Object.assign(new Error("super_admin_forbidden"), { code: "forbidden" });
    }
}

async function showPanel() {
    loginError?.classList.remove("show");
    registerSuperAdminGlobals();
    try {
        await ensureSuperAdminAuthSession();
        await mountSuperAdminPanel(mountEl, {
            showToast,
            onLogout: showLogin
        });
        loginScreen.hidden = true;
    } catch (err) {
        console.error("[SuperAdmin] panel_load_failed", err?.code || "unknown");
        loginScreen.hidden = false;
        if (err?.code === "forbidden") {
            showToast("Bu hesap süper admin yetkisine sahip değil.", "error");
        } else {
            showToast("Panel verileri yüklenemedi. Oturumunuzu yenileyip tekrar deneyin.", "error");
        }
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

        if (shouldUseEmulatorAuthLogin()) {
            const valid = await validateSuperAdminLogin(username, password);
            if (!valid) {
                loginError?.classList.add("show");
                return;
            }
            loginSuperAdmin();
            await showPanel();
            return;
        }

        await signInWithProductionSuperAdminAuth(username, password);
        loginSuperAdmin();
        await showPanel();
    } catch (err) {
        if (err?.message === "production_super_admin_missing_claim") {
            loginError.textContent = PRODUCTION_SUPER_ADMIN_FORBIDDEN_ERROR;
        } else if (
            err?.message === "production_super_admin_invalid_response" ||
            err?.code === "auth/wrong-password" ||
            err?.code === "auth/invalid-credential" ||
            err?.code === "auth_failed"
        ) {
            loginError.textContent = PRODUCTION_SUPER_ADMIN_LOGIN_ERROR;
        } else {
            loginError.textContent = PRODUCTION_SUPER_ADMIN_UNAVAILABLE_ERROR;
        }
        loginError?.classList.add("show");
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Giriş Yap";
    }
});

(async () => {
    if (!isSuperAdminLoggedIn()) return;
    try {
        await ensureSuperAdminAuthSession();
        await showPanel();
    } catch {
        showLogin();
    }
})();
