import {
    bootstrapPassiveAuthFoundation,
    subscribeAuthState,
    isAuthFoundationReady,
    isAuthStateKnown
} from "./authService.js";
import { shouldConnectAuthEmulator } from "./legacyAuthCompat.js";
import { AUTH_GUARD_STATE } from "./authGuard.js";

const statusEl = document.getElementById("status");
const guardStateEl = document.getElementById("guardState");
const businessIdEl = document.getElementById("businessId");
const diagEl = document.getElementById("diag");

function renderUnavailable(message) {
    if (statusEl) statusEl.textContent = message;
    if (guardStateEl) guardStateEl.hidden = true;
    if (businessIdEl) businessIdEl.hidden = true;
    if (diagEl) diagEl.hidden = true;
}

function renderDiagnostics(snapshot) {
    if (!diagEl) return;

    const guard = snapshot.guard || {};
    const diag = {
        origin: window.location.origin,
        emulatorGate: shouldConnectAuthEmulator(),
        authInitialized: isAuthFoundationReady(),
        authStateKnown: isAuthStateKnown(),
        authObserverFired: isAuthStateKnown(),
        authUserPresent: Boolean(snapshot.firebaseUser),
        // Lookup başladı mı: loading, başarılı sonuç veya fail-closed error (tamamlanmış hata dahil).
        membershipLookupStarted:
            Boolean(snapshot.firebaseUser) &&
            (snapshot.membershipLoading ||
                Boolean(snapshot.membership) ||
                Boolean(snapshot.error)),
        membershipFound: Boolean(snapshot.membership),
        membershipErrorPresent: Boolean(snapshot.error),
        guardState: guard.state || "unknown",
        businessId: guard.businessId || null
    };

    diagEl.hidden = false;
    diagEl.textContent = JSON.stringify(diag, null, 2);
}

function renderSnapshot(snapshot) {
    const guard = snapshot.guard || {};

    if (!isAuthStateKnown() || snapshot.authLoading) {
        if (statusEl) statusEl.textContent = "Auth yükleniyor…";
    } else if (snapshot.membershipLoading) {
        if (statusEl) statusEl.textContent = "Membership doğrulanıyor…";
    } else if (guard.state === AUTH_GUARD_STATE.ERROR) {
        if (statusEl) statusEl.textContent = "Auth foundation hatası (fail-closed)";
    } else {
        if (statusEl) statusEl.textContent = "Auth foundation aktif (emulator).";
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

    renderDiagnostics(snapshot);
}

if (!shouldConnectAuthEmulator()) {
    renderUnavailable("Bu sayfa yalnız localhost emulator modunda kullanılabilir.");
} else {
    bootstrapPassiveAuthFoundation();

    subscribeAuthState((snapshot) => {
        renderSnapshot(snapshot);
    });
}
