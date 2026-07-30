import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./_lib/firebase-admin.js";
import { requireSuperAdmin } from "./_lib/auth.js";
import { sanitizeBusinessForSuperAdmin } from "./_lib/business-sanitize.js";
import { applyCors, readJsonBody, sendError, sendJson } from "./_lib/http.js";
import { normalizeSlug } from "./_lib/normalize-slug.js";

const ALLOWED_UPDATE_FIELDS = new Set([
    "name", "address", "city", "district", "neighborhood", "addressDetail",
    "phone", "whatsapp", "email", "openHour", "closeHour", "logoUrl", "coverUrl",
    "mapsLink", "status", "subscriptionStatus", "subscriptionEndDate", "username",
    "telegramChatId", "selectedServices", "password"
]);

function buildPublicProjection(barber, slug) {
    return {
        slug,
        name: barber.name || "",
        address: barber.address || "",
        city: barber.city || "",
        district: barber.district || "",
        neighborhood: barber.neighborhood || "",
        addressDetail: barber.addressDetail || "",
        phone: barber.phone || "",
        whatsapp: barber.whatsapp || "",
        openHour: barber.openHour || "09:00",
        closeHour: barber.closeHour || "21:00",
        logoUrl: barber.logoUrl || "",
        coverUrl: barber.coverUrl || "",
        mapsLink: barber.mapsLink || "",
        status: barber.status || "active",
        selectedServices: barber.selectedServices || [],
        bookingOpen: barber.status !== "passive"
    };
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

    try {
        const body = await readJsonBody(req);
        const auth = await requireSuperAdmin(req);
        if (!auth.ok) {
            sendError(res, auth.status, auth.code, auth.message);
            return;
        }

        const slug = normalizeSlug(body.businessId || body.slug);
        const action = String(body.action || "update").trim();

        if (!slug) {
            sendError(res, 400, "invalid_business", "Invalid business identifier.");
            return;
        }

        const db = getAdminDb();
        const ref = db.collection("berberler").doc(slug);

        if (action === "delete") {
            await ref.delete();
            await db.collection("publicBarbers").doc(slug).delete().catch(() => {});
            sendJson(res, 200, { ok: true, slug, deleted: true });
            return;
        }

        if (action === "toggle_status") {
            const snap = await ref.get();
            if (!snap.exists) {
                sendError(res, 404, "shop_not_found", "Business not found.");
                return;
            }
            const current = snap.data()?.status || "active";
            const next = current === "active" ? "passive" : "active";
            await ref.update({ status: next, updatedAt: FieldValue.serverTimestamp() });
            const updated = (await ref.get()).data();
            await db.collection("publicBarbers").doc(slug).set(buildPublicProjection(updated, slug), { merge: true });
            sendJson(res, 200, { ok: true, slug, status: next, business: sanitizeBusinessForSuperAdmin(slug, updated) });
            return;
        }

        if (action === "extend_subscription") {
            const months = Number(body.months);
            if (!Number.isFinite(months) || months <= 0 || months > 24) {
                sendError(res, 400, "invalid_months", "Invalid subscription extension.");
                return;
            }
            const snap = await ref.get();
            if (!snap.exists) {
                sendError(res, 404, "shop_not_found", "Business not found.");
                return;
            }
            const barber = snap.data();
            let base = new Date();
            if (barber.subscriptionEndDate) {
                const end = new Date(barber.subscriptionEndDate);
                if (end > base) base = end;
            }
            base.setMonth(base.getMonth() + months);
            const subscriptionEndDate = base.toISOString().split("T")[0];
            await ref.update({
                subscriptionStatus: "active",
                subscriptionEndDate,
                subscriptionRenewedAt: FieldValue.serverTimestamp(),
                lastSubscriptionUpdate: FieldValue.serverTimestamp()
            });
            const updated = (await ref.get()).data();
            await db.collection("publicBarbers").doc(slug).set(buildPublicProjection(updated, slug), { merge: true });
            sendJson(res, 200, {
                ok: true,
                slug,
                subscriptionEndDate,
                business: sanitizeBusinessForSuperAdmin(slug, updated)
            });
            return;
        }

        const updates = {};
        for (const [key, value] of Object.entries(body.updates || body)) {
            if (!ALLOWED_UPDATE_FIELDS.has(key)) continue;
            updates[key] = typeof value === "string" ? value.trim() : value;
        }

        if (!Object.keys(updates).length) {
            sendError(res, 400, "invalid_request", "No valid fields to update.");
            return;
        }

        updates.updatedAt = FieldValue.serverTimestamp();
        await ref.set(updates, { merge: true });
        const updated = (await ref.get()).data();
        await db.collection("publicBarbers").doc(slug).set(buildPublicProjection(updated, slug), { merge: true });

        sendJson(res, 200, {
            ok: true,
            slug,
            business: sanitizeBusinessForSuperAdmin(slug, updated)
        });
    } catch (err) {
        console.error("[update-business]", err?.code || "internal");
        sendError(res, 500, "internal_error", "Business update failed.");
    }
}
