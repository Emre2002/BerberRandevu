import { createHash, randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { parseOwnerMembership } from "../../authGuard.js";
import { calculatePublicBookingOpen } from "../../publicBookingAccess.js";
import { buildPublicBarberProjection } from "../../publicBarberProjection.js";
import { extendSubscriptionEndDate, PACKAGE_TYPES } from "../../subscriptionTerms.js";
import { consumeCounter, getNamespace } from "./booking-rate-limit.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class ActivationCodeError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function readCode(rawCode) {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!code) throw new ActivationCodeError(400, "code_required", "Lütfen aktivasyon kodunu girin.");
    const match = /^BRB-(AYLIK|3AY|YIL)-[A-Z0-9]{6}$/.exec(code);
    if (!match) throw new ActivationCodeError(400, "invalid_code", "Geçersiz aktivasyon kodu.");
    return { code, prefix: match[1] };
}

function getPackage(packageType) {
    return typeof packageType === "string" && Object.hasOwn(PACKAGE_TYPES, packageType)
        ? PACKAGE_TYPES[packageType]
        : null;
}

function isUsed(data) {
    return Boolean(data.isUsed || data.usedAt || data.usedByBarberSlug);
}

function requireUnusedCode(snapshot) {
    if (!snapshot.exists) throw new ActivationCodeError(404, "invalid_code", "Geçersiz aktivasyon kodu.");
    const data = snapshot.data();
    if (isUsed(data)) throw new ActivationCodeError(409, "code_used", "Bu kod daha önce kullanılmış.");
    return data;
}

export async function createActivationCodes(db, { packageType, count = 1 }) {
    const pkg = getPackage(packageType);
    if (!pkg) throw new ActivationCodeError(400, "invalid_package", "Geçersiz paket türü.");
    if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw new ActivationCodeError(400, "invalid_count", "Kod adedi 1 ile 100 arasında olmalıdır.");
    }

    const collection = db.collection("activationCodes");
    for (let attempt = 0; attempt < 8; attempt++) {
        const codes = new Set();
        while (codes.size < count) {
            const segment = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
            codes.add(`BRB-${pkg.prefix}-${segment}`);
        }

        const batch = db.batch();
        for (const code of codes) {
            batch.create(collection.doc(code), {
                code,
                packageType,
                durationDays: pkg.durationDays,
                isUsed: false,
                usedByBarberSlug: null,
                usedAt: null,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: "superAdmin"
            });
        }
        try {
            await batch.commit();
            return [...codes];
        } catch (error) {
            // A concurrent create or an existing code rejects the entire batch.
            if (error.code !== 6) throw error;
        }
    }
    throw new ActivationCodeError(503, "code_generation_failed", "Kodlar oluşturulamadı. Lütfen tekrar deneyin.");
}

export async function listActivationCodes(db) {
    const snapshot = await db.collection("activationCodes").get();
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            code: doc.id,
            packageType: data.packageType ?? null,
            durationDays: data.durationDays ?? null,
            isUsed: isUsed(data),
            usedByBarberSlug: data.usedByBarberSlug ?? null,
            createdAt: data.createdAt?.toMillis?.() ?? null
        };
    }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function deleteActivationCode(db, rawCode) {
    const { code } = readCode(rawCode);
    const ref = db.collection("activationCodes").doc(code);
    await db.runTransaction(async (tx) => {
        requireUnusedCode(await tx.get(ref));
        tx.delete(ref);
    });
}

export async function activateSubscriptionCode(db, { uid, businessId, rawCode }) {
    if (!uid || !businessId || /\//.test(uid + businessId)) {
        throw new ActivationCodeError(403, "forbidden", "Bu işletme için abonelik etkinleştirilemiyor.");
    }
    const businessKey = createHash("sha256").update(businessId).digest("hex");
    // Count failed guesses across server instances. The quota must survive a rejected redemption.
    await consumeCounter(db, `rl_${getNamespace()}_activation_${businessKey}`, {
        limit: 10, windowSeconds: 900, type: "activation_attempt", scope: "activation_business"
    });

    const { code, prefix } = readCode(rawCode);
    const codeRef = db.collection("activationCodes").doc(code);
    const memberRef = db.collection("businessMemberships").doc(uid);
    const barberRef = db.collection("berberler").doc(businessId);
    const publicRef = db.collection("publicBarbers").doc(businessId);
    const now = new Date();

    return db.runTransaction(async (tx) => {
        const member = await tx.get(memberRef);
        if (parseOwnerMembership(member.data(), uid)?.businessId !== businessId) {
            throw new ActivationCodeError(403, "forbidden", "Bu işletme için abonelik etkinleştirilemiyor.");
        }

        const codeData = requireUnusedCode(await tx.get(codeRef));
        const { packageType } = codeData;
        const pkg = getPackage(packageType);
        const durationDays = codeData.durationDays ?? pkg?.durationDays;
        if (pkg?.prefix !== prefix || !Number.isSafeInteger(durationDays) || durationDays < 1) {
            throw new ActivationCodeError(400, "invalid_package", "Aktivasyon kodunun paketi veya süresi geçersiz.");
        }

        const barberSnap = await tx.get(barberRef);
        if (!barberSnap.exists) throw new ActivationCodeError(404, "business_not_found", "İşletme kaydı bulunamadı.");
        const barber = barberSnap.data();
        const newEndDate = extendSubscriptionEndDate(barber.subscriptionEndDate, durationDays, now);
        if (!newEndDate) throw new ActivationCodeError(400, "invalid_package", "Abonelik bitiş tarihi hesaplanamadı.");
        const bookingOpen = calculatePublicBookingOpen({ ...barber, subscriptionEndDate: newEndDate });

        tx.update(barberRef, {
            subscriptionStatus: "active",
            subscriptionEndDate: newEndDate,
            lastActivationCode: code,
            lastSubscriptionUpdate: FieldValue.serverTimestamp()
        });
        tx.update(codeRef, {
            isUsed: true,
            usedByBarberSlug: businessId,
            usedAt: FieldValue.serverTimestamp()
        });
        tx.set(publicRef, {
            ...buildPublicBarberProjection(barber, businessId, { bookingOpen }),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return { newEndDate, durationDays, packageType };
    });
}
