import { callPrivilegedApi } from "./privilegedApiClient.js";
import { PACKAGE_TYPES } from "./subscriptionTerms.js";

async function requestActivation(route, payload) {
    try {
        return await callPrivilegedApi(route, payload);
    } catch (error) {
        if (error.status && error.code !== "privileged_api_failed") throw error;
        throw new Error("Aktivasyon hizmetine ulaşılamadı. Lütfen tekrar deneyin.", { cause: error });
    }
}

export async function createActivationCodes({ packageType, count = 1 }) {
    const { codes } = await requestActivation("manageActivationCodes", { action: "create", packageType, count });
    return codes;
}

export async function fetchAllActivationCodes() {
    const { codes } = await requestActivation("manageActivationCodes", { action: "list" });
    return codes;
}

export function deleteActivationCode(code) {
    return requestActivation("manageActivationCodes", { action: "delete", code });
}

export function activateSubscriptionCodeViaApi(code) {
    return requestActivation("activateSubscription", { code });
}

export function formatCodeDate(value) {
    if (Number.isFinite(value)) return new Date(value).toLocaleString("tr-TR");
    return "—";
}

export function packageLabel(packageType) {
    return Object.hasOwn(PACKAGE_TYPES, packageType) ? PACKAGE_TYPES[packageType].label : packageType || "—";
}
