import { validateBarberLogin, fetchBarber } from "./firestoreService.js";
import { loginBarber, getBarberSlugFromUrl } from "./sessionAuth.js";

const slug = getBarberSlugFromUrl();
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const shopNameEl = document.getElementById("shopName");
const shopSlugEl = document.getElementById("shopSlug");
const backLink = document.getElementById("backLink");
const missingSlugEl = document.getElementById("missingSlugMsg");

if (!slug) {
    if (missingSlugEl) missingSlugEl.hidden = false;
    if (loginForm) loginForm.hidden = true;
} else {
    if (missingSlugEl) missingSlugEl.hidden = true;
    shopSlugEl.textContent = slug;
    backLink.href = `randevu.html?dukkan=${encodeURIComponent(slug)}`;

    fetchBarber(slug).then((barber) => {
        if (barber?.name) shopNameEl.textContent = barber.name;
    });
}

loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!slug) return;

    loginError.hidden = true;

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const btn = document.getElementById("loginBtn");

    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor...";

    try {
        await validateBarberLogin(slug, username, password);
        loginBarber(slug);
        window.location.href = `admin.html?dukkan=${encodeURIComponent(slug)}`;
    } catch (err) {
        loginError.hidden = false;
        loginError.textContent = err.message || "Giriş başarısız.";
        btn.disabled = false;
        btn.textContent = "Giriş Yap";
    }
});
