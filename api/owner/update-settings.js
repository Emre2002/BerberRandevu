import { getAdminDb } from "../_lib/firebase-admin.js";
import { requireOwnerMembership } from "../_lib/auth.js";
import { applyCors, readJsonBody, sendError, sendJson } from "../_lib/http.js";
import { checkRateLimit, getClientIp } from "../_lib/rate-limit.js";
import { updateOwnerSettings, OwnerSettingsError } from "../_lib/owner-settings-core.js";

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (req.method !== "POST") { sendError(res, 405, "method_not_allowed", "Method not allowed."); return; }
    if (!checkRateLimit(`owner-settings:${getClientIp(req)}`, { limit: 60, windowMs: 60_000 })) {
        sendError(res, 429, "rate_limited", "Lütfen daha sonra tekrar deneyin."); return;
    }
    try {
        const auth = await requireOwnerMembership(req);
        if (!auth.ok) { sendError(res, auth.status, auth.code, auth.message); return; }
        const body = await readJsonBody(req);
        if (!body || body.businessId !== auth.membership.businessId
            || Object.keys(body).some(key => !["businessId", "updates"].includes(key))) {
            sendError(res, 403, "forbidden", "İşletme ayarlarına erişilemiyor."); return;
        }
        const result = await updateOwnerSettings(getAdminDb(), {
            uid: auth.decoded.uid, businessId: auth.membership.businessId, updates: body.updates
        });
        sendJson(res, 200, result);
    } catch (err) {
        const invalidBody = ["invalid_json", "payload_too_large"].includes(err?.message);
        const status = err instanceof OwnerSettingsError ? err.status : invalidBody ? 400 : 500;
        const code = err instanceof OwnerSettingsError ? err.code : invalidBody ? "invalid_request" : "internal_error";
        sendError(res, status, code, "Ayarlar kaydedilemedi. Lütfen tekrar deneyin.");
    }
}
