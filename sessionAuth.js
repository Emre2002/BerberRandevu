/** Süper Admin oturum anahtarları */
export const SUPER_ADMIN_KEY = "superAdminLoggedIn";
export const SUPER_ADMIN_SESSION = "superAdminSessionToken";
export const SUPER_ADMIN_ROLE = "superAdminRole";
export const SUPER_ADMIN_LOGIN_TIME = "superAdminLoginTime";

/** Süper Admin oturum süresi: 8 saat. */
export const SUPER_ADMIN_SESSION_DURATION = 8 * 60 * 60 * 1000;

/** Berber oturum anahtarları */
export const BARBER_KEYS = {
    loggedIn: "barberLoggedIn",
    slug: "barberSlug",
    name: "barberName",
    loginTime: "barberLoginTime"
};

/** Berber oturum süresi: 8 saat. */
export const BARBER_SESSION_DURATION = 8 * 60 * 60 * 1000;

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
    sessionStorage.removeItem(SUPER_ADMIN_KEY);
    sessionStorage.removeItem(SUPER_ADMIN_SESSION);
    sessionStorage.removeItem(SUPER_ADMIN_ROLE);
    sessionStorage.removeItem(SUPER_ADMIN_LOGIN_TIME);
}

export function logoutBarberSession() {
    Object.values(BARBER_KEYS).forEach((key) => sessionStorage.removeItem(key));
    sessionStorage.removeItem("isLoggedIn");
}

export function loginBarberSession({ slug, barberName }) {
    if (!slug) return;
    sessionStorage.setItem(BARBER_KEYS.loggedIn, "true");
    sessionStorage.setItem(BARBER_KEYS.slug, slug);
    sessionStorage.setItem(BARBER_KEYS.name, barberName || "");
    sessionStorage.setItem(BARBER_KEYS.loginTime, Date.now().toString());
    sessionStorage.removeItem("isLoggedIn");
}

export function isBarberSessionValid() {
    if (sessionStorage.getItem(BARBER_KEYS.loggedIn) !== "true") return false;
    const slug = sessionStorage.getItem(BARBER_KEYS.slug);
    if (!slug) return false;

    const loginTime = Number(sessionStorage.getItem(BARBER_KEYS.loginTime));
    if (!loginTime || Date.now() - loginTime > BARBER_SESSION_DURATION) {
        logoutBarberSession();
        return false;
    }
    return true;
}

export function getLoggedInBarberSlug() {
    if (!isBarberSessionValid()) return null;
    return sessionStorage.getItem(BARBER_KEYS.slug);
}

export function getLoggedInBarberName() {
    if (!isBarberSessionValid()) return null;
    return sessionStorage.getItem(BARBER_KEYS.name) || null;
}

/** Geçerli oturum yoksa null; expectedSlug verilmişse uyuşmazlıkta null döner. */
export function requireBarberSession(expectedSlug) {
    if (!isBarberSessionValid()) return null;
    const slug = sessionStorage.getItem(BARBER_KEYS.slug);
    if (expectedSlug && slug !== expectedSlug) return null;
    return slug;
}

/** @deprecated Geriye dönük uyum — loginBarberSession kullanın. */
export function loginBarber(slug) {
    loginBarberSession({ slug, barberName: "" });
}

/** @deprecated Geriye dönük uyum — logoutBarberSession kullanın. */
export function logoutBarber() {
    logoutBarberSession();
}

export function isBarberLoggedIn(slug) {
    return requireBarberSession(slug) === slug;
}

export function getBarberSlugFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("dukkan") || params.get("shop");
}

export function guardBarberAdmin() {
    const slug = getBarberSlugFromUrl();
    if (!slug) return null;
    return requireBarberSession(slug);
}

export function guardSuperAdmin() {
    if (!isSuperAdminLoggedIn()) {
        return false;
    }
    return true;
}
