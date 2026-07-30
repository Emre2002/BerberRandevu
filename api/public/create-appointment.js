import { getAdminDb } from "../_lib/firebase-admin.js";
import { applyCors, readJsonBody, sendJson, sendRateLimited } from "../_lib/http.js";
import { getClientIp } from "../_lib/rate-limit.js";
import { enforcePublicRouteBurstLimit } from "../_lib/booking-rate-limit.js";
import {
    createPublicAppointment,
    mapBookingErrorToHttp
} from "../_lib/create-appointment-core.js";

export default async function handler(req, res) {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, code: "method_not_allowed" });
        return;
    }

    const ip = getClientIp(req);

    try {
        const db = getAdminDb();
        await enforcePublicRouteBurstLimit(db, "public-create-appointment", ip);
    } catch (err) {
        if (err?.code === "rate_limited") {
            sendRateLimited(res, {
                retryAfterSeconds: err.retryAfterSeconds,
                limit: err.rateLimitLimit,
                remaining: 0,
                resetAtSeconds: err.rateLimitReset
            });
            return;
        }
        console.error("[public/create-appointment] burst_limiter_failed");
        sendJson(res, 500, { ok: false, code: "internal_error" });
        return;
    }

    try {
        const body = await readJsonBody(req);
        const db = getAdminDb();
        const result = await createPublicAppointment(db, body, { clientIp: ip });
        sendJson(res, 201, {
            ok: true,
            appointmentId: result.appointmentId
        });
    } catch (err) {
        if (err?.message === "payload_too_large" || err?.message === "invalid_json") {
            sendJson(res, 400, { ok: false, code: "invalid_request" });
            return;
        }

        const mapped = mapBookingErrorToHttp(err);
        console.error("[public/create-appointment]", err?.code || "internal_error");
        sendJson(res, mapped.status, mapped.body, mapped.headers || {});
    }
}
