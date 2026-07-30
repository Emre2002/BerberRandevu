import { getAdminDb } from "../_lib/firebase-admin.js";
import { applyCors, readJsonBody, sendError, sendJson } from "../_lib/http.js";
import { normalizeSlug } from "../_lib/normalize-slug.js";
import { checkRateLimit, getClientIp } from "../_lib/rate-limit.js";
import { hasActivePhoneAppointmentOnDay, validateAvailabilityDate } from "../_lib/availability.js";

function normalizePhone(raw) {
    if (!raw) return "";
    let digits = String(raw).replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

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
    if (!checkRateLimit(`public-phone-check:${ip}`, { limit: 60, windowMs: 60_000 })) {
        sendError(res, 429, "rate_limited", "Too many requests. Please try again later.");
        return;
    }

    try {
        const body = await readJsonBody(req);
        const businessSlug = normalizeSlug(body.businessId || body.dukkan || body.shop);
        const date = String(body.date || "").trim();
        const phoneNorm = normalizePhone(body.phone);

        if (!businessSlug || !phoneNorm || phoneNorm.length !== 10) {
            sendError(res, 400, "invalid_request", "Invalid request.");
            return;
        }

        const dateCheck = validateAvailabilityDate(date);
        if (!dateCheck.ok) {
            sendError(res, 400, "invalid_date", "Invalid date.");
            return;
        }

        const db = getAdminDb();
        const publicSnap = await db.collection("publicBarbers").doc(businessSlug).get();
        if (!publicSnap.exists) {
            sendError(res, 404, "shop_not_found", "Business not found.");
            return;
        }

        const duplicate = await hasActivePhoneAppointmentOnDay(db, {
            businessSlug,
            date,
            phoneNorm
        });

        sendJson(res, 200, { duplicate });
    } catch (err) {
        console.error("[public/check-phone-day]", err?.code || "internal");
        sendError(res, 500, "internal_error", "Request could not be processed.");
    }
}
