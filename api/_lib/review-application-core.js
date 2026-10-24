import { randomUUID } from "node:crypto";
import { normalizeSlug } from "./normalize-slug.js";
import { createBusiness, CreateBusinessError } from "./create-business-core.js";

function fail(code, status, message) { throw new CreateBusinessError(code, status, message); }
function validateApplication(p) {
    for (const [key, max] of Object.entries({ ownerName: 120, shopName: 120, phone: 32, email: 254, city: 120, district: 120, address: 300 })) {
        if (typeof p[key] !== "string" || !p[key].trim() || p[key].length > max) {
            fail("invalid_application", 400, "Başvuru bilgileri eksik veya geçersiz.");
        }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())
        || !/^(?:\+?90|0)?5\d{9}$/.test(p.phone.replace(/[\s()-]/g, ""))
        || ![p.openingHour, p.closingHour].every(value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
        || p.openingHour >= p.closingHour
        || (p.mapsLink != null && (typeof p.mapsLink !== "string" || p.mapsLink.length > 500))) {
        fail("invalid_application", 400, "Başvuru e-posta, telefon veya çalışma saatleri geçersiz.");
    }
}

async function availableIdentity(db, name) {
    const base = (normalizeSlug(name) || "dukkan").slice(0, 60);
    for (let n = 1; n <= 100; n++) {
        const slug = n === 1 ? base : `${base}-${n}`;
        const username = `${base.replace(/-/g, "").slice(0, 24) || "berber"}${n === 1 ? "" : n}`.padEnd(3, "0");
        const [business, publicProfile, login, legacy] = await Promise.all([
            db.collection("berberler").doc(slug).get(), db.collection("publicBarbers").doc(slug).get(),
            db.collection("authLoginIndex").doc(username).get(),
            db.collection("berberler").where("username", "==", username).limit(1).get()
        ]);
        if (!business.exists && !publicProfile.exists && !login.exists && legacy.empty) return { slug, username };
    }
    fail("identity_conflict", 409, "Uygun işletme kimliği bulunamadı; yönetici kontrolü gerekir.");
}

export async function reviewApplication({ db, auth, timestamp, applicationId, action, reviewerUid }) {
    if (typeof applicationId !== "string" || !applicationId.trim() || applicationId.includes("/")
        || applicationId.length > 150 || !["approve", "reject"].includes(action) || !reviewerUid) {
        fail("invalid_request", 400, "Başvuru isteği geçersiz.");
    }
    const ref = db.collection("pendingBarbers").doc(applicationId);
    const approvalToken = randomUUID();
    const claim = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) fail("application_not_found", 404, "Başvuru bulunamadı.");
        const p = snap.data();
        if (action === "reject" && p.status === "rejected") return { replay: { status: "rejected", idempotentReplay: true } };
        if (action === "approve" && p.status === "approved" && p.createdSlug && p.createdUsername) {
            return { replay: { status: "approved", slug: p.createdSlug, username: p.createdUsername, idempotentReplay: true } };
        }
        if (p.status !== "pending") fail("application_conflict", 409, "Başvuru zaten işlendi veya kontrol bekliyor; tekrar oluşturulamaz.");
        if (action === "reject") {
            tx.update(ref, { status: "rejected", rejectedAt: timestamp(), rejectedByUid: reviewerUid });
            return { replay: { status: "rejected" } };
        }
        validateApplication(p);
        tx.update(ref, { status: "processing", processingAt: timestamp(), reviewedByUid: reviewerUid, approvalToken });
        return { application: p };
    });
    if (claim.replay) return claim.replay;
    // A claimed operation is never automatically reset, including ambiguous Auth/network failures.
    // Retrying after a lost response can replay an approved result, but cannot create another account.
    const p = claim.application;
    try {
        const identity = await availableIdentity(db, p.shopName);
        const tomorrow = new Date(Date.now() + 86_400_000);
        const trialEnd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
        const result = await createBusiness({ db, auth, timestamp, approvalToken, input: {
            ...identity, pendingId: applicationId, name: p.shopName.trim(), email: p.email.trim(), phone: p.phone.trim(),
            city: p.city.trim(), district: p.district.trim(), addressDetail: p.address.trim(),
            address: [p.city, p.district, p.address].map(value => value.trim()).join(", "),
            whatsapp: p.phone.replace(/\D/g, "").replace(/^0/, "90"), openHour: p.openingHour,
            closeHour: p.closingHour, mapsLink: p.mapsLink || "", subscriptionEndDate: trialEnd
        } });
        return { status: "approved", slug: result.slug, username: result.username, subscriptionEndDate: trialEnd };
    } catch {
        fail("application_review_required", 503, "İşlem tamamlanamadı veya sonucu doğrulanamadı. Tekrar onaylamayın; yönetici kontrolü gerekir.");
    }
}
