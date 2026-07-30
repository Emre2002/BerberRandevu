import { getAdminDb } from "../_lib/firebase-admin.js";
import { requireOwnerMembership } from "../_lib/auth.js";
import { applyCors, readJsonBody, sendJson } from "../_lib/http.js";
import { checkRateLimit, getClientIp } from "../_lib/rate-limit.js";
import {
    archiveOwnerAppointment,
    mapArchiveErrorToHttp
} from "../_lib/archive-appointment-core.js";

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
    if (!checkRateLimit(`owner-archive-appointment:${ip}`, { limit: 60, windowMs: 60_000 })) {
        sendJson(res, 429, { ok: false, code: "rate_limited" });
        return;
    }

    try {
        const ownerAuth = await requireOwnerMembership(req);
        if (!ownerAuth.ok) {
            sendJson(res, ownerAuth.status, { ok: false, code: ownerAuth.code });
            return;
        }

        const body = await readJsonBody(req);
        const appointmentId = String(body.appointmentId || "").trim();
        if (!appointmentId) {
            sendJson(res, 400, { ok: false, code: "invalid_request" });
            return;
        }

        const db = getAdminDb();
        const result = await archiveOwnerAppointment(db, {
            businessId: ownerAuth.membership.businessId,
            appointmentId,
            archivedByUid: ownerAuth.decoded.uid,
            deletedBy: String(body.deletedBy || ownerAuth.decoded.uid || "owner").slice(0, 64),
            deletedByMode: String(body.deletedByMode || "adminPanel").slice(0, 32),
            archiveReason: body.archiveReason ? String(body.archiveReason).slice(0, 200) : undefined
        });

        sendJson(res, 200, result);
    } catch (err) {
        if (err?.message === "payload_too_large" || err?.message === "invalid_json") {
            sendJson(res, 400, { ok: false, code: "invalid_request" });
            return;
        }

        const mapped = mapArchiveErrorToHttp(err);
        console.error("[owner/archive-appointment]", err?.code || "internal_error");
        sendJson(res, mapped.status, mapped.body);
    }
}
