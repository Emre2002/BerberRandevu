import { PRODUCTION_BASE_URL } from "./linkService.js";
import { isLocalDevHost } from "./legacyAuthCompat.js";

function getApiBaseUrl() {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalDevHost(window.location.hostname)) {
        return window.location.origin;
    }
    return PRODUCTION_BASE_URL;
}

const AVAILABILITY_MEMORY_TTL_MS = 15_000;
const inFlightRequests = new Map();
const memoryCache = new Map();
let activeRequestKey = "";
let activeRequestSequence = 0;
let activeAbortController = null;

export function buildAvailabilityRequestKey(businessSlug, date, serviceId = "") {
    return `${businessSlug}|${date}|${serviceId || "-"}`;
}

function readMemoryCache(requestKey) {
    const cached = memoryCache.get(requestKey);
    if (!cached) return null;
    if (Date.now() - cached.ts > AVAILABILITY_MEMORY_TTL_MS) {
        memoryCache.delete(requestKey);
        return null;
    }
    return cached.data;
}

export function primeAvailabilityMemoryCache(businessSlug, date, data, serviceId = "") {
    const requestKey = buildAvailabilityRequestKey(businessSlug, date, serviceId);
    memoryCache.set(requestKey, { ts: Date.now(), data });
}

export function invalidateAvailabilityMemoryCache(businessSlug, date, serviceId = "") {
    const prefix = `${businessSlug}|${date}|`;
    for (const key of [...memoryCache.keys()]) {
        if (key.startsWith(prefix)) memoryCache.delete(key);
    }
    if (serviceId) {
        memoryCache.delete(buildAvailabilityRequestKey(businessSlug, date, serviceId));
    }
}

/**
 * @param {string} businessSlug
 * @param {string} date YYYY-MM-DD
 * @param {{ serviceId?: string, force?: boolean, sequence?: number }} [opts]
 */
export async function fetchPublicAvailability(businessSlug, date, opts = {}) {
    const serviceId = opts.serviceId || "";
    const requestKey = buildAvailabilityRequestKey(businessSlug, date, serviceId);

    if (!opts.force) {
        const cached = readMemoryCache(requestKey);
        if (cached) return cached;
    }

    if (inFlightRequests.has(requestKey)) {
        return inFlightRequests.get(requestKey);
    }

    const sequence = Number.isFinite(opts.sequence) ? opts.sequence : ++activeRequestSequence;

    if (activeRequestKey !== requestKey && activeAbortController) {
        activeAbortController.abort();
    }
    activeRequestKey = requestKey;
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    const url = `${getApiBaseUrl()}/api/public/availability?${new URLSearchParams({
        dukkan: businessSlug,
        date
    }).toString()}`;

    const promise = (async () => {
        const response = await fetch(url, {
            method: "GET",
            signal,
            cache: "no-store",
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
            err.code = data?.error || data?.code || "availability_unavailable";
            err.status = response.status;
            err.requestId = data?.requestId || response.headers.get("x-request-id") || null;
            throw err;
        }

        if (sequence !== activeRequestSequence) {
            const staleErr = new Error("availability_response_stale");
            staleErr.code = "availability_response_stale";
            throw staleErr;
        }

        memoryCache.set(requestKey, { ts: Date.now(), data });
        return data;
    })().catch((err) => {
        if (err?.name === "AbortError") {
            const abortErr = new Error("availability_request_aborted");
            abortErr.code = "availability_request_aborted";
            throw abortErr;
        }
        throw err;
    }).finally(() => {
        if (inFlightRequests.get(requestKey) === promise) {
            inFlightRequests.delete(requestKey);
        }
    });

    inFlightRequests.set(requestKey, promise);
    return promise;
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

    const busyTimes = apiPayload.busySlots
        || (apiPayload.occupiedIntervals || []).map((interval) => interval.start);

    for (const time of busyTimes) {
        appointments[time] = { legacy: false, status: "confirmed" };
    }

    return { appointments, blocked, dayClosed };
}

export function nextAvailabilityRequestSequence() {
    return ++activeRequestSequence;
}

export function getAvailabilityInFlightCount() {
    return inFlightRequests.size;
}
