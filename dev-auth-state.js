import { bootstrapPassiveAuthFoundation, subscribeAuthState } from "./authService.js";
import { shouldConnectAuthEmulator } from "./legacyAuthCompat.js";
import { AUTH_GUARD_STATE } from "./authGuard.js";

const statusEl = document.getElementById("status");
const guardStateEl = document.getElementById("guardState");
const businessIdEl = document.getElementById("businessId");

function renderUnavailable(message) {
    if (statusEl) statusEl.textContent = message;
    if (guardStateEl) guardStateEl.hidden = true;
    if (businessIdEl) businessIdEl.hidden = true;
}

if (!shouldConnectAuthEmulator()) {
    renderUnavailable("Bu sayfa yalnız localhost emulator modunda kullanılabilir.");
} else {
    bootstrapPassiveAuthFoundation();

    subscribeAuthState((snapshot) => {
        const guard = snapshot.guard || {};
        if (statusEl) {
            statusEl.textContent =
                snapshot.authLoading || snapshot.membershipLoading
                    ? "Yükleniyor…"
                    : "Auth foundation aktif (emulator).";
        }
        if (guardStateEl) {
            guardStateEl.hidden = false;
            guardStateEl.textContent = `guard.state: ${guard.state || "unknown"}`;
        }
        if (businessIdEl) {
            if (guard.state === AUTH_GUARD_STATE.AUTHENTICATED_OWNER && guard.businessId) {
                businessIdEl.hidden = false;
                businessIdEl.textContent = `businessId: ${guard.businessId}`;
            } else {
                businessIdEl.hidden = true;
                businessIdEl.textContent = "";
            }
        }
    });
}
