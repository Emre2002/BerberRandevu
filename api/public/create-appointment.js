import crypto from "node:crypto";
import { getAdminDb } from "../_lib/firebase-admin.js";
import { applyCors, readJsonBody, sendJson, sendRateLimited } from "../_lib/http.js";
import { getClientIp } from "../_lib/rate-limit.js";
import { enforcePublicRouteBurstLimit, logRateLimitEvent } from "../_lib/booking-rate-limit.js";
import {
    createPublicAppointment,
    mapBookingErrorToHttp
} from "../_lib/create-appointment-core.js";

export default async function handler(req, res) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, code: "method_not_allowed" }, { "X-Request-Id": requestId });
        return;
    }

    const ip = getClientIp(req);

    try {
        const db = getAdminDb();
        await enforcePublicRouteBurstLimit(db, "public-create-appointment", ip);
    } catch (err) {
        if (err?.code === "rate_limit_config_error") {
            console.error("[public/create-appointment] rate_limit_config_error", { requestId });
            sendJson(res, 503, {
                ok: false,
                code: "rate_limit_config_error",
                message: "Randevu sistemi yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
                requestId
            }, { "X-Request-Id": requestId });
            return;
        }
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
        console.error("[public/create-appointment] burst_limiter_failed", { requestId });
        sendJson(res, 500, { ok: false, code: "internal_error", requestId }, { "X-Request-Id": requestId });
        return;
    }

    try {
        const body = await readJsonBody(req);
        const db = getAdminDb();
        const createStarted = Date.now();
        const result = await createPublicAppointment(db, body, { clientIp: ip });
        const createMs = Date.now() - createStarted;
        console.info("[public/create-appointment]", {
            requestId,
            createMs,
            totalMs: Date.now() - startedAt,
            idempotentReplay: Boolean(result.idempotentReplay)
        });
        sendJson(res, 201, {
            ok: true,
            appointmentId: result.appointmentId,
            idempotentReplay: Boolean(result.idempotentReplay),
            requestId
        }, { "X-Request-Id": requestId });
    } catch (err) {
        if (err?.message === "payload_too_large" || err?.message === "invalid_json") {
            sendJson(res, 400, { ok: false, code: "invalid_request", requestId }, { "X-Request-Id": requestId });
            return;
        }

        if (err?.code === "rate_limit_config_error") {
            console.error("[public/create-appointment] rate_limit_config_error", { requestId });
            sendJson(res, 503, {
                ok: false,
                code: "rate_limit_config_error",
                message: "Randevu sistemi yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
                requestId
            }, { "X-Request-Id": requestId });
            return;
        }

        const mapped = mapBookingErrorToHttp(err, { requestId });
        if (mapped.status === 429) {
            logRateLimitEvent(err.rateLimitScope || mapped.body?.scope, {
                requestId,
                limit: mapped.body?.limit ?? err.rateLimitLimit,
                remaining: 0,
                retryAfterSeconds: mapped.body?.retryAfterSeconds ?? err.retryAfterSeconds,
                elapsedMs: Date.now() - startedAt
            });
        }
        console.error("[public/create-appointment]", {
            requestId,
            code: err?.code || "internal_error",
            totalMs: Date.now() - startedAt
        });
        sendJson(res, mapped.status, mapped.body, {
            "X-Request-Id": requestId,
            ...(mapped.headers || {})
        });
    }
}
