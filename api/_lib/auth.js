import { getAdminAuth, getAdminDb } from "./firebase-admin.js";
import { parseOwnerMembership } from "../../authGuard.js";

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

export async function requireOwnerMembership(req) {
    const auth = await verifyBearerToken(req);
    if (!auth.ok) return auth;

    const uid = auth.decoded.uid;
    const db = getAdminDb();
    const snap = await db.collection("businessMemberships").doc(uid).get();
    const membership = parseOwnerMembership(snap.exists ? snap.data() : null, uid);
    if (!membership) {
        return {
            ok: false,
            status: 403,
            code: "forbidden",
            message: "Active owner membership required."
        };
    }

    return { ok: true, decoded: auth.decoded, membership };
}
