import { randomBytes } from "node:crypto";
import { normalizeSlug } from "./normalize-slug.js";
import { normalizeAndValidateUsername } from "./normalize-username.js";
import { buildPublicBarberProjection } from "../../publicBarberProjection.js";

const DEFAULT_SERVICES = ["Saç Kesimi & Yıkama", "Sakal Tıraşı (Klasik)", "Saç-Sakal Kesimi"];

export class CreateBusinessError extends Error {
    constructor(code, status, message) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

function requiredText(value, field) {
    if (typeof value !== "string" || !value.trim()) {
        throw new CreateBusinessError("invalid_request", 400, `${field} zorunludur.`);
    }
    return value.trim();
}

function optionalText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function validHour(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function subscriptionEndDate() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
}

export async function createBusiness({ db, auth, timestamp, input = {} }) {
    const slug = normalizeSlug(requiredText(input.slug, "İşletme kimliği"));
    const name = requiredText(input.name, "İşletme adı");
    const validated = normalizeAndValidateUsername(input.username);
    const pendingId = optionalText(input.pendingId);
    if (pendingId && (pendingId.includes("/") || pendingId.length > 150
        || Object.hasOwn(input, "password"))) {
        throw new CreateBusinessError("invalid_request", 400, "Başvuru isteği geçersiz.");
    }
    if (!slug || !validated.ok) {
        throw new CreateBusinessError("invalid_request", 400, "Geçerli işletme kimliği ve kullanıcı adı giriniz.");
    }
    if (!pendingId && (typeof input.password !== "string" || input.password.length < 6)) {
        throw new CreateBusinessError("invalid_request", 400, "Şifre en az 6 karakter olmalıdır.");
    }
    const openHour = input.openHour || "09:00";
    const closeHour = input.closeHour || "21:00";
    if (!validHour(openHour) || !validHour(closeHour) || openHour >= closeHour) {
        throw new CreateBusinessError("invalid_request", 400, "Çalışma saatleri geçersiz.");
    }

    const username = validated.normalized;
    const businessRef = db.collection("berberler").doc(slug);
    const publicRef = db.collection("publicBarbers").doc(slug);
    const loginRef = db.collection("authLoginIndex").doc(username);
    const pendingRef = pendingId ? db.collection("pendingBarbers").doc(pendingId) : null;

    // Avoid provisioning Auth for a known duplicate. The transaction repeats these checks.
    const [existingBusiness, existingPublic, existingLogin, legacyUsername, pendingApplication] = await Promise.all([
        businessRef.get(),
        publicRef.get(),
        loginRef.get(),
        db.collection("berberler").where("username", "==", username).limit(1).get(),
        pendingRef ? pendingRef.get() : Promise.resolve(null)
    ]);
    if (existingBusiness.exists || existingPublic.exists || existingLogin.exists || !legacyUsername.empty) {
        throw new CreateBusinessError("business_exists", 409, "İşletme veya kullanıcı adı zaten kullanılıyor.");
    }
    if (pendingRef && (!pendingApplication.exists || pendingApplication.data()?.status !== "processing"
        || pendingApplication.data()?.shopName !== name
        || pendingApplication.data()?.email !== optionalText(input.email)
        || pendingApplication.data()?.phone !== optionalText(input.phone))) {
        throw new CreateBusinessError("pending_mismatch", 409, "Başvuru bilgileri uyuşmuyor.");
    }

    const authEmail = pendingRef
        ? pendingApplication.data().email.trim().toLowerCase()
        : `${username}@users.berberrandevu.internal`;
    if (pendingRef && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) {
        throw new CreateBusinessError("invalid_email", 400, "Başvurunun e-posta adresi geçersiz.");
    }
    const password = pendingRef ? randomBytes(32).toString("base64url") : input.password;

    let user;
    try {
        user = await auth.createUser({ email: authEmail, password, displayName: name });
    } catch (error) {
        if (error?.code === "auth/email-already-exists") {
            throw new CreateBusinessError("owner_exists", 409, "Kullanıcı adı zaten kullanılıyor; mevcut hesabı kontrol edin.");
        }
        throw error;
    }

    const membershipRef = db.collection("businessMemberships").doc(user.uid);
    const barber = {
        slug, name, username, ownerUid: user.uid,
        address: optionalText(input.address), city: optionalText(input.city),
        district: optionalText(input.district), neighborhood: optionalText(input.neighborhood),
        addressDetail: optionalText(input.addressDetail), phone: optionalText(input.phone),
        email: optionalText(input.email), whatsapp: optionalText(input.whatsapp),
        logoUrl: optionalText(input.logoUrl), coverUrl: optionalText(input.coverUrl),
        telegramChatId: optionalText(input.telegramChatId), mapsLink: optionalText(input.mapsLink),
        openHour, closeHour, selectedServices: [...DEFAULT_SERVICES],
        status: "active", subscriptionStatus: "active",
        subscriptionEndDate: optionalText(input.subscriptionEndDate) || subscriptionEndDate(),
        lastActivationCode: "", lastSubscriptionUpdate: null,
        createdAt: timestamp()
    };
    const publicBarber = buildPublicBarberProjection(barber, slug, { bookingOpen: true });

    try {
        await db.runTransaction(async (tx) => {
            const [business, login, membership, publicProfile, pending] = await Promise.all([
                tx.get(businessRef), tx.get(loginRef), tx.get(membershipRef), tx.get(publicRef),
                pendingRef ? tx.get(pendingRef) : Promise.resolve(null)
            ]);
            if (business.exists || login.exists || membership.exists || publicProfile.exists) {
                throw new CreateBusinessError("business_exists", 409, "İşletme kayıtları çakışıyor.");
            }
            if (pendingRef && (!pending.exists || pending.data()?.status !== "processing"
                || pending.data()?.shopName !== name || pending.data()?.email !== barber.email
                || pending.data()?.phone !== barber.phone)) {
                throw new CreateBusinessError("pending_mismatch", 409, "Başvuru bilgileri uyuşmuyor.");
            }
            tx.create(businessRef, barber);
            tx.create(publicRef, { ...publicBarber, createdAt: timestamp() });
            tx.create(membershipRef, {
                uid: user.uid, businessId: slug, role: "owner", status: "active",
                createdAt: timestamp(), updatedAt: timestamp()
            });
            tx.create(loginRef, {
                uid: user.uid, businessId: slug, role: "owner", authEmail,
                ...(pendingRef ? { loginMode: "email" } : {}),
                createdAt: timestamp()
            });
            if (pendingRef) {
                tx.update(pendingRef, {
                    status: "approved", approvedAt: timestamp(),
                    createdSlug: slug, createdUsername: username
                });
            }
        });
    } catch {
        // Auth and Firestore cannot share a transaction. Never delete an account automatically.
        throw new CreateBusinessError(
            "provisioning_incomplete", 503,
            "Authentication hesabı oluşturuldu ancak işletme kayıtları tamamlanamadı. Tekrar göndermeyin; yönetici kontrolü gerekir."
        );
    }

    return { slug, username, ownerUid: user.uid };
}
