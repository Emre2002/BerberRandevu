import crypto from "node:crypto";
import { getAdminDb } from "../_lib/firebase-admin.js";
import { applyCors, sendError, sendJson, sendRateLimited } from "../_lib/http.js";
import { getClientIp } from "../_lib/rate-limit.js";
import { enforceAvailabilityBurstLimit, logRateLimitEvent } from "../_lib/booking-rate-limit.js";
import { computePublicAvailability, validateAvailabilityDate } from "../_lib/availability.js";
import { resolvePublicBusinessSlug } from "../_lib/resolve-public-business-slug.js";

export default async function handler(req, res) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method not allowed.");
        return;
    }

    const ip = getClientIp(req);

    try {
        const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
        const slugRaw = url.searchParams.get("dukkan")
            || url.searchParams.get("shop")
            || url.searchParams.get("businessId")
            || "";
        const date = String(url.searchParams.get("date") || "").trim();

        if (!String(slugRaw).trim()) {
            sendError(res, 400, "invalid_business", "Business identifier is required.");
            return;
        }

        const db = getAdminDb();
        const resolveStarted = Date.now();
        const businessSlug = await resolvePublicBusinessSlug(db, slugRaw);
        const resolveMs = Date.now() - resolveStarted;

        if (!businessSlug) {
            sendError(res, 404, "shop_not_found", "Business not found.");
            return;
        }

        try {
            await enforceAvailabilityBurstLimit(db, businessSlug, ip);
        } catch (err) {
            if (err?.code === "rate_limited") {
                logRateLimitEvent(err.rateLimitScope, {
                    requestId,
                    limit: err.rateLimitLimit,
                    remaining: 0,
                    retryAfterSeconds: err.retryAfterSeconds,
                    elapsedMs: Date.now() - startedAt
                });
                sendRateLimited(res, {
                    retryAfterSeconds: err.retryAfterSeconds,
                    limit: err.rateLimitLimit,
                    remaining: 0,
                    resetAtSeconds: err.rateLimitReset,
                    scope: err.rateLimitScope,
                    requestId
                });
                return;
            }
            throw err;
        }

        const dateCheck = validateAvailabilityDate(date);
        if (!dateCheck.ok) {
            sendError(res, 400, dateCheck.code, "Invalid date.");
            return;
        }

        const result = await computePublicAvailability(db, { businessSlug, date, requestId });

        if (!result.ok) {
            if (result.code === "shop_not_found") {
                sendError(res, 404, "shop_not_found", "Business not found.");
                return;
            }
            if (result.code === "shop_passive") {
                sendError(res, 403, "shop_passive", "Business is not accepting bookings.");
                return;
            }
            if (result.code === "booking_closed") {
                sendError(res, 403, "booking_closed", "Online booking is temporarily closed.");
                return;
            }
            sendError(res, 400, "availability_failed", "Availability could not be loaded.");
            return;
        }

        const elapsedMs = Date.now() - startedAt;
        console.info("[public/availability]", {
            requestId,
            elapsedMs,
            resolveMs,
            computeMs: result.timings?.totalMs ?? null
        });

        sendJson(res, 200, result.payload, {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
            "X-Request-Id": requestId
        });
    } catch (err) {
        if (err?.code === "rate_limit_config_error") {
            console.error("[public/availability] rate_limit_config_error", { requestId });
            sendJson(res, 503, {
                ok: false,
                code: "rate_limit_config_error",
                message: "Randevu sistemi yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
                requestId
            }, { "X-Request-Id": requestId });
            return;
        }
        console.error("[public/availability]", { requestId, code: err?.code || "internal" });
        sendError(res, 500, "internal_error", "Availability could not be loaded.");
    }
}
