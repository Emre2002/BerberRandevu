import { firebaseRuntimeEnvironment } from "./firebase-runtime-config.js";

export const PRODUCTION_BASE_URL = "https://berberv1.vercel.app";

export function resolveBaseUrl(environment, origin) {
    if (environment === "production") return PRODUCTION_BASE_URL;
    if (environment === "preview" || environment === "development") {
        const url = new URL(origin);
        if (url.origin !== origin || (url.protocol !== "https:" && !(environment === "development" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
            throw new Error("Invalid development origin");
        }
        return origin;
    }
    throw new Error("Firebase client environment is not configured safely");
}

export function getBaseUrl() {
    return resolveBaseUrl(firebaseRuntimeEnvironment, typeof window === "undefined" ? "" : window.location.origin);
}

function hasValidSlug(slug) {
    return Boolean(String(slug || "").trim());
}

export function getBookingUrl(slug) {
    if (!hasValidSlug(slug)) return null;
    return `${getBaseUrl()}/randevu.html?dukkan=${encodeURIComponent(slug)}`;
}

export function getAdminUrl(slug) {
    if (!hasValidSlug(slug)) return null;
    return `${getBaseUrl()}/admin.html?dukkan=${encodeURIComponent(slug)}`;
}

export function getSuperAdminUrl() {
    return `${getBaseUrl()}/super-admin.html`;
}

export function getWhatsAppBookingMessage(barber) {
    const slug = typeof barber === "string" ? barber : barber?.slug;
    const link = getBookingUrl(slug);
    if (!link) return null;
    return `Merhaba 👋\n\nOnline randevu oluşturmak için aşağıdaki bağlantıya tıklayabilirsiniz:\n\n${link}`;
}
