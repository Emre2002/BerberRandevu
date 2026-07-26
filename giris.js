import { bootstrapPassiveAuthFoundation } from "./authService.js";
import { resolveBarberLogin } from "./firestoreService.js";
import {
    loginBarberSession,
    isBarberSessionValid,
    getLoggedInBarberSlug
} from "./sessionAuth.js";
import {
    shouldUseEmulatorAuthLogin,
    signInWithEmulatorAuth,
    EMULATOR_AUTH_LOGIN_ERROR,
    EMULATOR_AUTH_UNAVAILABLE_ERROR
} from "./emulatorAuthLogin.js";

bootstrapPassiveAuthFoundation();

const LOGIN_ERROR = "Kullanıcı adı veya şifre hatalı.";

const form = document.getElementById("girisForm");
const errorEl = document.getElementById("girisError");
const submitBtn = document.getElementById("girisSubmitBtn");

if (isBarberSessionValid()) {
    const slug = getLoggedInBarberSlug();
    if (slug) {
        window.location.replace(`admin.html?dukkan=${encodeURIComponent(slug)}`);
    }
}

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
            loginBarberSession({
                slug: businessId,
                barberName: businessId
            });
            window.location.href = `admin.html?dukkan=${encodeURIComponent(businessId)}`;
            return;
        }

        const { slug, barber } = await resolveBarberLogin(username, password);
        loginBarberSession({
            slug,
            barberName: barber.name || barber.isim || slug
        });
        window.location.href = `admin.html?dukkan=${encodeURIComponent(slug)}`;
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
                errorEl.textContent = LOGIN_ERROR;
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
