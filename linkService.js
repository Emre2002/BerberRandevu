export const PRODUCTION_BASE_URL = "https://berberv1.vercel.app";

export function getBaseUrl() {
    return PRODUCTION_BASE_URL;
}

function hasValidSlug(slug) {
    return Boolean(String(slug || "").trim());
}

export function getBookingUrl(slug) {
    if (!hasValidSlug(slug)) return null;
    return `${PRODUCTION_BASE_URL}/randevu.html?dukkan=${encodeURIComponent(slug)}`;
}

export function getAdminUrl(slug) {
    if (!hasValidSlug(slug)) return null;
    return `${PRODUCTION_BASE_URL}/admin.html?dukkan=${encodeURIComponent(slug)}`;
}

export function getSuperAdminUrl() {
    return `${PRODUCTION_BASE_URL}/super-admin.html`;
}

export function getWhatsAppBookingMessage(barber) {
    const slug = typeof barber === "string" ? barber : barber?.slug;
    const link = getBookingUrl(slug);
    if (!link) return null;
    return `Merhaba 👋\n\nOnline randevu oluşturmak için aşağıdaki bağlantıya tıklayabilirsiniz:\n\n${link}`;
}
