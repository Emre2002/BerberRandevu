import { resolveBarberLogin } from "./firestoreService.js";
import {
    loginBarberSession,
    isBarberSessionValid,
    getLoggedInBarberSlug
} from "./sessionAuth.js";

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
        const { slug, barber } = await resolveBarberLogin(username, password);
        loginBarberSession({
            slug,
            barberName: barber.name || barber.isim || slug
        });
        window.location.href = `admin.html?dukkan=${encodeURIComponent(slug)}`;
    } catch {
        if (errorEl) {
            errorEl.textContent = LOGIN_ERROR;
            errorEl.hidden = false;
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Giriş Yap";
        }
    }
});
