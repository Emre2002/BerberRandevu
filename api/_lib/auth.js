import { getAdminAuth } from "./firebase-admin.js";

export async function verifyBearerToken(req) {
    const token = String(req.headers.authorization || req.headers.Authorization || "")
        .replace(/^Bearer\s+/i, "")
        .trim();
    if (!token) {
        return { ok: false, status: 401, code: "auth_required", message: "Authentication required." };
    }

    try {
        const decoded = await getAdminAuth().verifyIdToken(token, true);
        return { ok: true, decoded };
    } catch (err) {
        const code = err?.code === "auth/id-token-expired" ? "token_expired" : "auth_invalid";
        return { ok: false, status: 401, code, message: "Invalid or expired token." };
    }
}

export async function requireSuperAdmin(req) {
    const auth = await verifyBearerToken(req);
    if (!auth.ok) return auth;
    if (auth.decoded?.superAdmin !== true) {
        return {
            ok: false,
            status: 403,
            code: "forbidden",
            message: "Super-admin access required."
        };
    }
    return auth;
}
