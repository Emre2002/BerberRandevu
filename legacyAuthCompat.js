import { isBarberSessionValid, isSuperAdminLoggedIn } from "./sessionAuth.js";

export const AUTH_EMULATOR_HOST = "127.0.0.1";
export const AUTH_EMULATOR_PORT = 9099;

/**
 * Geçiş durumu — yetkilendirme değildir.
 */
export const AUTH_MODE = {
    FIREBASE: "firebase",
    LEGACY: "legacy",
    NONE: "none"
};

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDevHost(hostname) {
    const host = hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
    return LOCAL_DEV_HOSTS.has(host);
}

/**
 * Auth Emulator: localhost + ?authEmulator=1 veya ?useEmulators=1
 * @param {{ hostname?: string, search?: string|URLSearchParams }} [ctx]
 */
export function shouldConnectAuthEmulator(ctx = {}) {
    const hostname =
        ctx.hostname ??
        (typeof window !== "undefined" ? window.location.hostname : "");
    if (!isLocalDevHost(hostname)) return false;

    const params =
        ctx.search instanceof URLSearchParams
            ? ctx.search
            : new URLSearchParams(
                  ctx.search ?? (typeof window !== "undefined" ? window.location.search : "")
              );

    return params.get("authEmulator") === "1" || params.get("useEmulators") === "1";
}

export function detectLegacyAuthMode() {
    if (typeof window === "undefined") {
        return { authMode: AUTH_MODE.NONE, source: null };
    }

    if (isBarberSessionValid()) {
        return { authMode: AUTH_MODE.LEGACY, source: "sessionStorage_barber" };
    }

    if (isSuperAdminLoggedIn()) {
        return { authMode: AUTH_MODE.LEGACY, source: "localStorage_super_admin" };
    }

    return { authMode: AUTH_MODE.NONE, source: null };
}

export function hasForgedAdminStorageFlags() {
    if (typeof window === "undefined") return false;
    if (localStorage.getItem("isAdmin") === "true") return true;
    if (localStorage.getItem("superAdminLoggedIn") === "true") return true;
    if (localStorage.getItem("superAdminRole") === "superAdmin") return true;
    return false;
}

export function isLegacyOnlySession(firebaseUser) {
    if (firebaseUser) return false;
    return detectLegacyAuthMode().authMode === AUTH_MODE.LEGACY;
}
