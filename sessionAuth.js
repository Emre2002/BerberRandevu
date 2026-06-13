/** Süper Admin oturum anahtarları */
export const SUPER_ADMIN_KEY = "superAdminLoggedIn";
export const SUPER_ADMIN_SESSION = "superAdminSessionToken";
export const SUPER_ADMIN_ROLE = "superAdminRole";
export const SUPER_ADMIN_LOGIN_TIME = "superAdminLoginTime";

/** Süper Admin oturum süresi: 8 saat. */
export const SUPER_ADMIN_SESSION_DURATION = 8 * 60 * 60 * 1000;

/** Berber oturum anahtarları */
export const BARBER_KEYS = {
    isLoggedIn: "isLoggedIn",
    barberSlug: "barberSlug"
};

/**
 * NOT: Süper Admin oturumu localStorage'da tutulur. Çünkü "Admin" hızlı erişim
 * butonu paneli YENİ SEKMEDE açar ve sessionStorage yeni sekmeye güvenilir
 * şekilde taşınmaz (özellikle rel="noopener"). localStorage ise aynı origin'deki
 * tüm sekmelerde paylaşılır → bypass her sekmede algılanır.
 * (Berber oturumu sekme-bazlı kalsın diye sessionStorage'da bırakıldı.)
 */
function generateToken() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `sa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Geçerli bir Süper Admin oturumu var mı?
 * Kontroller: oturum bayrağı + token + role === "superAdmin" + süre dolmamış.
 */
export function isSuperAdminLoggedIn() {
    if (localStorage.getItem(SUPER_ADMIN_KEY) !== "true") return false;
    if (!localStorage.getItem(SUPER_ADMIN_SESSION)) return false;
    if (localStorage.getItem(SUPER_ADMIN_ROLE) !== "superAdmin") return false;

    const loginTime = Number(localStorage.getItem(SUPER_ADMIN_LOGIN_TIME));
    if (!loginTime || Date.now() - loginTime > SUPER_ADMIN_SESSION_DURATION) {
        logoutSuperAdmin();
        return false;
    }
    return true;
}

/** Geçerliyse Süper Admin oturum bilgisini döndürür, değilse null. */
export function getSuperAdminSession() {
    if (!isSuperAdminLoggedIn()) return null;
    return {
        token: localStorage.getItem(SUPER_ADMIN_SESSION),
        role: localStorage.getItem(SUPER_ADMIN_ROLE),
        loginTime: Number(localStorage.getItem(SUPER_ADMIN_LOGIN_TIME))
    };
}

export function loginSuperAdmin() {
    localStorage.setItem(SUPER_ADMIN_KEY, "true");
    localStorage.setItem(SUPER_ADMIN_SESSION, generateToken());
    localStorage.setItem(SUPER_ADMIN_ROLE, "superAdmin");
    localStorage.setItem(SUPER_ADMIN_LOGIN_TIME, Date.now().toString());
}

export function logoutSuperAdmin() {
    localStorage.removeItem(SUPER_ADMIN_KEY);
    localStorage.removeItem(SUPER_ADMIN_SESSION);
    localStorage.removeItem(SUPER_ADMIN_ROLE);
    localStorage.removeItem(SUPER_ADMIN_LOGIN_TIME);
    // Eski sessionStorage kalıntılarını da temizle (geriye dönük uyum).
    sessionStorage.removeItem(SUPER_ADMIN_KEY);
    sessionStorage.removeItem(SUPER_ADMIN_SESSION);
    sessionStorage.removeItem(SUPER_ADMIN_ROLE);
    sessionStorage.removeItem(SUPER_ADMIN_LOGIN_TIME);
}

export function isBarberLoggedIn(slug) {
    return (
        sessionStorage.getItem(BARBER_KEYS.isLoggedIn) === "true" &&
        sessionStorage.getItem(BARBER_KEYS.barberSlug) === slug
    );
}

export function loginBarber(slug) {
    sessionStorage.setItem(BARBER_KEYS.isLoggedIn, "true");
    sessionStorage.setItem(BARBER_KEYS.barberSlug, slug);
}

export function logoutBarber() {
    sessionStorage.removeItem(BARBER_KEYS.isLoggedIn);
    sessionStorage.removeItem(BARBER_KEYS.barberSlug);
}

export function getBarberSlugFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("dukkan") || params.get("shop");
}

export function guardBarberAdmin() {
    const slug = getBarberSlugFromUrl();
    if (!slug) return null;
    if (!isBarberLoggedIn(slug)) return null;
    return slug;
}

export function guardSuperAdmin() {
    if (!isSuperAdminLoggedIn()) {
        return false;
    }
    return true;
}
