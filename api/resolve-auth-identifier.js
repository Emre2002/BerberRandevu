import { applyCors, readJsonBody, sendError, sendJson } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rate-limit.js";
import { resolveAuthIdentifier, GENERIC_AUTH_ERROR } from "./_lib/resolve-auth.js";

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

    const ip = getClientIp(req);
    if (!checkRateLimit(`resolve-auth:${ip}`, { limit: 30, windowMs: 60_000 })) {
        sendError(res, 429, "rate_limited", "Too many requests. Please try again later.");
        return;
    }

    try {
        const body = await readJsonBody(req);
        if (Object.prototype.hasOwnProperty.call(body, "password")) {
            sendError(res, 400, GENERIC_AUTH_ERROR, "Invalid request.");
            return;
        }

        const roleHint = body.roleHint === "superAdmin" ? "superAdmin" : "owner";
        const result = await resolveAuthIdentifier(body.username, { roleHint });

        if (!result.ok) {
            sendError(res, 404, GENERIC_AUTH_ERROR, "Invalid credentials.");
            return;
        }

        sendJson(res, 200, {
            authEmail: result.authEmail,
            businessId: result.businessId,
            role: result.role
        });
    } catch (err) {
        console.error("[resolve-auth-identifier]", err?.code || "internal");
        sendError(res, 500, "internal_error", "Authentication service unavailable.");
    }
}
