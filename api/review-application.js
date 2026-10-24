import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "./_lib/firebase-admin.js";
import { requireSuperAdmin } from "./_lib/auth.js";
import { reviewApplication } from "./_lib/review-application-core.js";
import { CreateBusinessError } from "./_lib/create-business-core.js";
import { applyCors, readJsonBody, sendError, sendJson } from "./_lib/http.js";

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (req.method !== "POST") { sendError(res, 405, "method_not_allowed", "Method not allowed."); return; }
    try {
        const authorization = await requireSuperAdmin(req);
        if (!authorization.ok) { sendError(res, authorization.status, authorization.code, authorization.message); return; }
        const body = await readJsonBody(req);
        if (!body || Object.keys(body).some(key => !["applicationId", "action"].includes(key))) {
            throw new CreateBusinessError("invalid_request", 400, "Başvuru isteği geçersiz.");
        }
        const result = await reviewApplication({ db: getAdminDb(), auth: getAdminAuth(),
            timestamp: () => FieldValue.serverTimestamp(), applicationId: body.applicationId,
            action: body.action, reviewerUid: authorization.decoded.uid });
        sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
        const malformed = ["invalid_json", "payload_too_large"].includes(error?.message);
        sendError(res, error instanceof CreateBusinessError ? error.status : malformed ? 400 : 500,
            error instanceof CreateBusinessError ? error.code : malformed ? "invalid_request" : "internal_error",
            error instanceof CreateBusinessError ? error.message : "Başvuru işlemi tamamlanamadı; sonucu kontrol edin.");
    }
}
