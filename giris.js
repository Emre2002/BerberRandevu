import "./devEmulatorPage.js";
import { bootstrapPassiveAuthFoundation } from "./authService.js";
import { subscribeAuthorizedBusinessContext } from "./authorizedBusinessContext.js";
import { withDevEmulatorQuery } from "./devEmulatorGate.js";
import {
    shouldUseEmulatorAuthLogin,
    signInWithEmulatorAuth,
    EMULATOR_AUTH_LOGIN_ERROR,
    EMULATOR_AUTH_UNAVAILABLE_ERROR
} from "./emulatorAuthLogin.js";
import {
    signInWithProductionOwnerAuth,
    PRODUCTION_AUTH_LOGIN_ERROR,
    PRODUCTION_AUTH_UNAVAILABLE_ERROR
} from "./productionAuthLogin.js";

bootstrapPassiveAuthFoundation();

const LOGIN_ERROR = "Kullanıcı adı veya şifre hatalı.";

const form = document.getElementById("girisForm");
const errorEl = document.getElementById("girisError");
const submitBtn = document.getElementById("girisSubmitBtn");

function redirectAfterAuth(businessId) {
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get("return");
    if (returnUrl) {
        window.location.replace(withDevEmulatorQuery(returnUrl));
        return;
    }
    window.location.replace(
        withDevEmulatorQuery(`admin.html?dukkan=${encodeURIComponent(businessId)}`)
    );
}

subscribeAuthorizedBusinessContext((context) => {
    if (context?.businessId) {
        redirectAfterAuth(context.businessId);
    }
});

form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;

    const username = document.getElementById("girisUsername")?.value?.trim() || "";
    const password = document.getElementById("girisPassword")?.value || "";

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Giriş yapılıyor...";
    }

    try {
        if (shouldUseEmulatorAuthLogin()) {
            const { businessId } = await signInWithEmulatorAuth(username, password);
            redirectAfterAuth(businessId);
            return;
        }

        const { businessId } = await signInWithProductionOwnerAuth(username, password);
        redirectAfterAuth(businessId);
    } catch (err) {
        if (errorEl) {
            if (shouldUseEmulatorAuthLogin()) {
                const msg =
                    err?.code === "functions/unavailable" ||
                    err?.message === "emulator_auth_callable_unavailable"
                        ? EMULATOR_AUTH_UNAVAILABLE_ERROR
                        : EMULATOR_AUTH_LOGIN_ERROR;
                errorEl.textContent = msg;
            } else {
                const msg =
                    err?.message === "production_auth_invalid_response" ||
                    err?.code === "auth_failed" ||
                    err?.code === "auth/wrong-password" ||
                    err?.code === "auth/invalid-credential"
                        ? PRODUCTION_AUTH_LOGIN_ERROR
                        : PRODUCTION_AUTH_UNAVAILABLE_ERROR;
                errorEl.textContent = msg;
            }
            errorEl.hidden = false;
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Giriş Yap";
        }
    }
});
