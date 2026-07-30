import { getAdminDb } from "./_lib/firebase-admin.js";
import { requireSuperAdmin } from "./_lib/auth.js";
import { sanitizeBusinessList } from "./_lib/business-sanitize.js";
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
        await readJsonBody(req);
        const auth = await requireSuperAdmin(req);
        if (!auth.ok) {
            sendError(res, auth.status, auth.code, auth.message);
            return;
        }

        const db = getAdminDb();
        const snapshot = await db.collection("berberler").get();
        const businesses = sanitizeBusinessList(snapshot.docs);
        businesses.sort((a, b) =>
            (a.name || a.slug || "").localeCompare(b.name || b.slug || "", "tr")
        );

        sendJson(res, 200, {
            businesses,
            count: businesses.length
        });
    } catch (err) {
        console.error("[list-businesses]", err?.code || "internal");
        sendError(res, 500, "internal_error", "Business list could not be loaded.");
    }
}
