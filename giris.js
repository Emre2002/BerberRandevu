import "./devEmulatorPage.js";
import { bootstrapPassiveAuthFoundation } from "./authService.js";
import { subscribeAuthorizedBusinessContext } from "./authorizedBusinessContext.js";
import { withDevEmulatorQuery } from "./devEmulatorGate.js";
import { getAuthInstance } from "./firebase-config.js";
import { submitPasswordResetForm } from "./passwordResetCore.js";
import { signInWithEmailOwnerAuth } from "./emailOwnerAuthLogin.js";
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
const resetToggle = document.getElementById("openPasswordReset");
const resetPanel = document.getElementById("passwordResetPanel");
const resetForm = document.getElementById("passwordResetForm");

resetToggle?.addEventListener("click", () => {
    const visible = resetPanel.hidden;
    resetPanel.hidden = !visible;
    resetToggle.setAttribute("aria-expanded", String(visible));
    if (visible) document.getElementById("resetEmail")?.focus();
});

resetForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPasswordResetForm(resetForm, async (email) => {
        const auth = await getAuthInstance();
        const { sendPasswordResetEmail } = await import(
            "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
        );
        await sendPasswordResetEmail(auth, email);
    });
});

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
        if (username.includes("@")) {
            const { businessId } = await signInWithEmailOwnerAuth(username, password);
            redirectAfterAuth(businessId);
            return;
        }
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
