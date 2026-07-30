import { isLocalDevHost } from "./legacyAuthCompat.js";

/**
 * Localhost geliştirmede emulator bağlantı bayrağını otomatik ekler.
 * Yetki üretmez; yalnız Auth/Firestore/Functions emulator hedefini seçer.
 */
export function ensureDevEmulatorQueryFlag() {
    if (typeof window === "undefined" || !isLocalDevHost()) return false;

    const params = new URLSearchParams(window.location.search);
    if (params.get("authEmulator") === "1" || params.get("useEmulators") === "1") {
        return false;
    }

    params.set("authEmulator", "1");
    const qs = params.toString();
    window.location.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    return true;
}

/**
 * Localhost geliştirmede dahili sayfa linklerine emulator bayrağını ekler.
 * @param {string} href
 */
export function withDevEmulatorQuery(href) {
    if (typeof window === "undefined" || !isLocalDevHost() || !href) return href;
    if (/^https?:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
        return href;
    }

    const url = new URL(href, window.location.origin);
    if (!url.searchParams.has("authEmulator")) {
        url.searchParams.set("authEmulator", "1");
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * @param {ParentNode} [root]
 */
export function applyDevEmulatorLinks(root = document) {
    if (typeof window === "undefined" || !isLocalDevHost()) return;

    root.querySelectorAll("a[href]").forEach((anchor) => {
        const href = anchor.getAttribute("href");
        if (!href) return;
        if (!/(giris|admin|super-admin|barber-login|dev-auth-state)\.html/i.test(href)) return;
        anchor.setAttribute("href", withDevEmulatorQuery(href));
    });
}
