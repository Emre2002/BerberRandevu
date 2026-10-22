import { getBaseUrl } from "./linkService.js";

function getApiBaseUrl() {
    return getBaseUrl();
}

const AVAILABILITY_MEMORY_TTL_MS = 15_000;
const inFlightRequests = new Map();
const memoryCache = new Map();

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
        if (key.startsWith(prefix) && (!serviceId || key === buildAvailabilityRequestKey(businessSlug, date, serviceId))) {
            memoryCache.delete(key);
        }
    }
    for (const [key, request] of inFlightRequests) {
        if (key.startsWith(prefix) && (!serviceId || key === buildAvailabilityRequestKey(businessSlug, date, serviceId))) {
            request.controller.abort();
            inFlightRequests.delete(key);
        }
    }
}

/**
 * @param {string} businessSlug
 * @param {string} date YYYY-MM-DD
 * @param {{ serviceId?: string, force?: boolean }} [opts]
 */
export async function fetchPublicAvailability(businessSlug, date, opts = {}) {
    const serviceId = opts.serviceId || "";
    const requestKey = buildAvailabilityRequestKey(businessSlug, date, serviceId);

    const current = inFlightRequests.get(requestKey);
    if (current) {
        if (!opts.force || current.force) return current.promise;
        current.controller.abort();
        inFlightRequests.delete(requestKey);
    }
    if (!opts.force) {
        const cached = readMemoryCache(requestKey);
        if (cached) return cached;
    } else {
        memoryCache.delete(requestKey);
    }

    const controller = new AbortController();
    const request = { controller, force: Boolean(opts.force), promise: null };

    const url = `${getApiBaseUrl()}/api/public/availability?${new URLSearchParams({
        dukkan: businessSlug,
        date
    }).toString()}`;

    request.promise = (async () => {
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
            headers: { Accept: "application/json" }
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (controller.signal.aborted || inFlightRequests.get(requestKey) !== request) {
            const staleErr = new Error("availability_response_stale");
            staleErr.code = "availability_response_stale";
            throw staleErr;
        }

        if (!response.ok) {
            const err = new Error(data?.message || "availability_unavailable");
            err.code = data?.error || data?.code || "availability_unavailable";
            err.status = response.status;
            err.requestId = data?.requestId || response.headers.get("x-request-id") || null;
            throw err;
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
        if (inFlightRequests.get(requestKey) === request) {
            inFlightRequests.delete(requestKey);
        }
    });

    inFlightRequests.set(requestKey, request);
    return request.promise;
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

export function getAvailabilityInFlightCount() {
    return inFlightRequests.size;
}
