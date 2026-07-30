import "./devEmulatorPage.js";
import { authSignOut, bootstrapPassiveAuthFoundation } from "./authService.js";
import { AUTH_GUARD_STATE } from "./authGuard.js";
import { subscribeAuthorizedBusinessContext } from "./authorizedBusinessContext.js";

const urlSlug = new URLSearchParams(window.location.search).get("dukkan")
    || new URLSearchParams(window.location.search).get("shop");
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
    const current = new URLSearchParams(window.location.search);
    if (current.get("authEmulator") === "1") params.set("authEmulator", "1");
    if (current.get("useEmulators") === "1") params.set("useEmulators", "1");
    const qs = params.toString();
    window.location.replace(qs ? `giris.html?${qs}` : "giris.html");
}

function grantAdminAccess(slug) {
    showAdminPanel();
    const detail = { slug, superAdmin: false };
    window.__barberAdminReadyDetail = detail;
    window.dispatchEvent(new CustomEvent("barberAdminReady", { detail }));
}

function initGate() {
    hideLoginGate();
    bootstrapPassiveAuthFoundation();

    let authorized = false;
    subscribeAuthorizedBusinessContext((context, snapshot) => {
        if (authorized) return;
        if (snapshot.authLoading || snapshot.membershipLoading) return;

        if (!context || snapshot.guard?.state !== AUTH_GUARD_STATE.AUTHENTICATED_OWNER) {
            redirectToLogin();
            return;
        }

        if (urlSlug && urlSlug !== context.businessId) {
            const params = new URLSearchParams();
            params.set("dukkan", context.businessId);
            const current = new URLSearchParams(window.location.search);
            if (current.get("authEmulator") === "1") params.set("authEmulator", "1");
            if (current.get("useEmulators") === "1") params.set("useEmulators", "1");
            window.location.replace(`admin.html?${params.toString()}`);
            return;
        }

        authorized = true;
        grantAdminAccess(context.businessId);
    });
}

document.getElementById("btnLogout")?.addEventListener("click", async () => {
    try {
        await authSignOut();
    } catch {
        /* fail-closed: Firebase signOut reddedilse bile oturum temizlenir */
    }
    redirectToLogin();
});

initGate();
