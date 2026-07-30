import { getAuthInstance } from "./firebase-config.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";
import { PRODUCTION_BASE_URL } from "./linkService.js";

const API_ROUTE_MAP = {
    resolveAuthIdentifier: "/api/resolve-auth-identifier",
    listBusinessesForSuperAdmin: "/api/list-businesses",
    updateBusinessForSuperAdmin: "/api/update-business",
    setOwnerPassword: "/api/set-owner-password",
    setOwnerAccountStatus: "/api/set-owner-status",
    getOwnerBusinessProfile: "/api/get-owner-profile",
    updateOwnerProfile: "/api/update-owner-profile",
    createAppointment: "/api/public/create-appointment",
    createOwnerAppointment: "/api/owner/create-appointment",
    createOwnerAccount: "/api/create-owner-account"
};

export function shouldUsePrivilegedApi(ctx = {}) {
    if (typeof window === "undefined") return false;
    const hostname = ctx.hostname ?? window.location.hostname;
    if (isLocalDevHost(hostname)) {
        const params =
            ctx.search instanceof URLSearchParams
                ? ctx.search
                : new URLSearchParams(ctx.search ?? window.location.search);
        if (params.get("authEmulator") === "1" || params.get("useEmulators") === "1") {
            return false;
        }
        if (params.get("vercelApi") === "1") return true;
        return false;
    }
    return true;
}

export function getPrivilegedApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
}

async function getAuthHeader(forceRefresh = false) {
    const auth = await getAuthInstance();
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken(forceRefresh);
    return { Authorization: `Bearer ${token}` };
}

/**
 * @param {string} routeKey
 * @param {object} [payload]
 * @param {{ auth?: boolean, retryOn401?: boolean }} [opts]
 */
export async function callPrivilegedApi(routeKey, payload = {}, opts = { auth: true, retryOn401: true }) {
    const path = API_ROUTE_MAP[routeKey];
    if (!path) {
        throw new Error("privileged_api_route_unknown");
    }

    const url = `${getPrivilegedApiBaseUrl()}${path}`;
    const headers = { "Content-Type": "application/json" };

    const doRequest = async (forceRefresh) => {
        if (opts.auth !== false) {
            Object.assign(headers, await getAuthHeader(forceRefresh));
        }
        return fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });
    };

    let response = await doRequest(false);

    if (response.status === 401 && opts.auth !== false && opts.retryOn401 !== false) {
        response = await doRequest(true);
    }

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const err = new Error(data?.message || data?.error || "privileged_api_failed");
        err.code = data?.error || "privileged_api_failed";
        err.status = response.status;
        throw err;
    }

    return data;
}

export async function resolveProductionAuthIdentifier(username) {
    return callPrivilegedApi("resolveAuthIdentifier", { username }, { auth: false });
}

export async function listBusinessesForSuperAdminViaApi() {
    return callPrivilegedApi("listBusinessesForSuperAdmin", {});
}

export async function updateBusinessForSuperAdminViaApi(payload) {
    return callPrivilegedApi("updateBusinessForSuperAdmin", payload);
}

export async function setOwnerPasswordViaApi(businessId, password) {
    return callPrivilegedApi("setOwnerPassword", { businessId, password });
}

export async function setOwnerAccountStatusViaApi(businessId, active) {
    return callPrivilegedApi("setOwnerAccountStatus", { businessId, active });
}

export async function createOwnerAppointmentViaApi(payload) {
    return callPrivilegedApi("createOwnerAppointment", payload, { auth: true });
}
