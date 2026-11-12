import {
    ActivationCodeError, createActivationCodes, listActivationCodes, deleteActivationCode, activateSubscriptionCode
} from "./activation-codes.js";
import { requireOwnerMembership, requireSuperAdmin } from "./auth.js";
import { getAdminDb } from "./firebase-admin.js";
import { applyCors, readJsonBody, sendError, sendJson } from "./http.js";
import { checkRateLimit, getClientIp } from "./rate-limit.js";

async function handleActivationRequest(req, res, { authorize, scope, forbiddenMessage, operation }) {
    applyCors(req, res);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }
    if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Bu istek yöntemi desteklenmiyor.");
        return;
    }

    try {
        if (!checkRateLimit(`${scope}:${getClientIp(req)}`, { limit: 60, windowMs: 60_000 })) {
            throw new ActivationCodeError(429, "rate_limited", "Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.");
        }
        const auth = await authorize(req);
        if (!auth.ok) {
            sendError(res, auth.status, auth.code, auth.status === 401
                ? "Oturumunuz doğrulanamadı. Lütfen tekrar giriş yapın."
                : forbiddenMessage);
            return;
        }
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new ActivationCodeError(400, "invalid_request", "Geçersiz istek.");
        }
        const result = await operation(getAdminDb(), body, auth);
        sendJson(res, 200, result);
    } catch (error) {
        if (error instanceof ActivationCodeError) {
            sendError(res, error.status, error.code, error.message);
        } else if (error.code === "rate_limited") {
            res.setHeader("Retry-After", String(error.retryAfterSeconds));
            sendError(res, 429, "rate_limited", "Çok fazla kod denediniz. Lütfen daha sonra tekrar deneyin.");
        } else if (["invalid_json", "payload_too_large"].includes(error.message)) {
            sendError(res, 400, "invalid_request", "Geçersiz istek.");
        } else {
            sendError(res, 500, "internal_error", "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
        }
    }
}

export function handleAdminActivationCodes(req, res) {
    return handleActivationRequest(req, res, {
        authorize: requireSuperAdmin,
        scope: "admin-activation",
        forbiddenMessage: "Aktivasyon kodlarını yönetme yetkiniz yok.",
        async operation(db, body) {
            switch (body.action) {
                case "create":
                    return { codes: await createActivationCodes(db, body) };
                case "list":
                    return { codes: await listActivationCodes(db) };
                case "delete":
                    await deleteActivationCode(db, body.code);
                    return { ok: true };
                default:
                    throw new ActivationCodeError(400, "invalid_request", "Geçersiz aktivasyon kodu işlemi.");
            }
        }
    });
}

export function handleOwnerSubscriptionActivation(req, res) {
    const forbiddenMessage = "Bu işletme için abonelik etkinleştirilemiyor.";
    return handleActivationRequest(req, res, {
        authorize: requireOwnerMembership,
        scope: "owner-activation",
        forbiddenMessage,
        operation(db, body, auth) {
            if (Object.keys(body).some((key) => key !== "code")) {
                throw new ActivationCodeError(403, "forbidden", forbiddenMessage);
            }
            return activateSubscriptionCode(db, {
                uid: auth.decoded.uid,
                businessId: auth.membership.businessId,
                rawCode: body.code
            });
        }
    });
}
