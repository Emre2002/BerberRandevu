import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "./_lib/firebase-admin.js";
import { requireSuperAdmin } from "./_lib/auth.js";
import { createBusiness, CreateBusinessError } from "./_lib/create-business-core.js";
import { applyCors, readJsonBody, sendError, sendJson } from "./_lib/http.js";

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }
    if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method not allowed.");
        return;
    }

    try {
        const authorization = await requireSuperAdmin(req);
        if (!authorization.ok) {
            sendError(res, authorization.status, authorization.code, authorization.message);
            return;
        }
        const input = await readJsonBody(req);
        const result = await createBusiness({
            db: getAdminDb(), auth: getAdminAuth(),
            timestamp: () => FieldValue.serverTimestamp(), input
        });
        sendJson(res, 201, { ok: true, ...result });
    } catch (error) {
        if (error instanceof CreateBusinessError) {
            sendError(res, error.status, error.code, error.message);
            return;
        }
        console.error("[create-business]", error?.code || "internal");
        sendError(res, 500, "internal_error", "İşletme oluşturulamadı.");
    }
}
