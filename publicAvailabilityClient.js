import { PRODUCTION_BASE_URL } from "./linkService.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";

function getApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
}

let activeAvailabilityKey = "";
let activeAvailabilityController = null;

/**
 * @param {string} businessSlug
 * @param {string} date YYYY-MM-DD
 */
export async function fetchPublicAvailability(businessSlug, date) {
    const requestKey = `${businessSlug}|${date}`;
    if (activeAvailabilityKey !== requestKey && activeAvailabilityController) {
        activeAvailabilityController.abort();
    }
    activeAvailabilityKey = requestKey;
    activeAvailabilityController = new AbortController();
    const signal = activeAvailabilityController.signal;

    const params = new URLSearchParams({
        dukkan: businessSlug,
        date
    });
    const url = `${getApiBaseUrl()}/api/public/availability?${params.toString()}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            signal,
            headers: { Accept: "application/json" }
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            const err = new Error(data?.message || "availability_unavailable");
            err.code = data?.error || "availability_unavailable";
            err.status = response.status;
            throw err;
        }

        return data;
    } catch (err) {
        if (err?.name === "AbortError") {
            const abortErr = new Error("availability_request_aborted");
            abortErr.code = "availability_request_aborted";
            throw abortErr;
        }
        throw err;
    }
}

/**
 * @param {{ businessSlug: string, date: string, phone: string }} payload
 */
export async function checkPublicPhoneDuplicate(payload) {
    const url = `${getApiBaseUrl()}/api/public/check-phone-day`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            dukkan: payload.businessSlug,
            date: payload.date,
            phone: payload.phone
        })
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        return false;
    }

    return Boolean(data?.duplicate);
}

export function mapPublicAvailabilityToDayData(apiPayload) {
    const appointments = {};
    const blocked = new Set(apiPayload.blockedSlots || []);
    const dayClosed = Boolean(apiPayload.isClosed);

    for (const time of apiPayload.busySlots || []) {
        appointments[time] = { legacy: false, status: "confirmed" };
    }

    return { appointments, blocked, dayClosed };
}
