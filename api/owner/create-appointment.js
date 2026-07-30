import crypto from "node:crypto";
import { getAdminDb } from "../_lib/firebase-admin.js";
import { requireOwnerMembership } from "../_lib/auth.js";
import { applyCors, readJsonBody, sendJson, sendRateLimited } from "../_lib/http.js";
import { checkRateLimit, getClientIp } from "../_lib/rate-limit.js";
import { createPublicAppointment } from "../_lib/create-appointment-core.js";
import {
    mapOwnerAuthError,
    mapOwnerBookingErrorToHttp
} from "../_lib/owner-booking-errors.js";

function createRequestId() {
    return crypto.randomUUID();
}

export default async function handler(req, res) {
    const requestId = createRequestId();
    const startedAt = Date.now();
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, code: "VALIDATION_ERROR", requestId });
        return;
    }

    const ip = getClientIp(req);
    if (!checkRateLimit(`owner-create-appointment:${ip}`, { limit: 60, windowMs: 60_000 })) {
        sendRateLimited(res, { retryAfterSeconds: 60, limit: 60, remaining: 0 });
        return;
    }

    try {
        const ownerAuth = await requireOwnerMembership(req);
        if (!ownerAuth.ok) {
            const mapped = mapOwnerAuthError(ownerAuth, requestId);
            sendJson(res, mapped.status, mapped.body);
            return;
        }

        const body = await readJsonBody(req);
        const db = getAdminDb();
        const result = await createPublicAppointment(
            db,
            {
                ...body,
                dukkan: ownerAuth.membership.businessId,
                website: ""
            },
            { clientIp: ip, ownerContext: true }
        );

        const elapsedMs = Date.now() - startedAt;
        console.info("[owner/create-appointment]", {
            requestId,
            elapsedMs,
            businessId: ownerAuth.membership.businessId,
            idempotentReplay: Boolean(result.idempotentReplay)
        });

        sendJson(res, 201, {
            ok: true,
            appointment: {
                id: result.appointmentId,
                businessId: ownerAuth.membership.businessId,
                barberId: ownerAuth.membership.businessId,
                date: result.date,
                time: result.time,
                status: result.status || "confirmed"
            },
            requestId
        });
    } catch (err) {
        if (err?.message === "payload_too_large" || err?.message === "invalid_json") {
            sendJson(res, 400, {
                ok: false,
                code: "VALIDATION_ERROR",
                message: "Lütfen randevu bilgilerini kontrol edin.",
                requestId
            });
            return;
        }

        const mapped = mapOwnerBookingErrorToHttp(err, requestId);
        console.error("[owner/create-appointment]", {
            requestId,
            code: mapped.body.code,
            elapsedMs: Date.now() - startedAt
        });
        sendJson(res, mapped.status, mapped.body, mapped.headers || {});
    }
}
