/**
 * Shopier entegrasyonu için iskelet — MVP'de mock.
 * İleride webhook/API ile kod otomatik üretilebilir.
 */
import { createActivationCodes } from "./activationCodeService.js";

/** Mock ödeme kaydı (Firestore'a yazılmaz — log only). */
export async function createMockPaymentRecord({ orderId, packageType, amount, customerEmail }) {
    console.info("[paymentService] Mock ödeme kaydı:", { orderId, packageType, amount, customerEmail });
    return {
        success: true,
        mock: true,
        orderId: orderId || `MOCK-${Date.now()}`,
        recordedAt: new Date().toISOString()
    };
}

/** Satılan kodu işaretle (Shopier siparişi ile eşleştirme). */
export async function markCodeAsSold(code, shopierOrderId) {
    console.info("[paymentService] Kod satıldı olarak işaretlendi:", { code, shopierOrderId });
    return { success: true, mock: true, code, shopierOrderId };
}

/**
 * Shopier siparişine aktivasyon kodu bağla ve üret.
 * Gerçek entegrasyonda webhook bu fonksiyonu çağırır.
 */
export async function linkCodeToShopierOrder({ shopierOrderId, packageType, customerEmail }) {
    const codes = await createActivationCodes({ packageType, count: 1, createdBy: "shopier" });
    const code = codes[0];
    await markCodeAsSold(code, shopierOrderId);
    await createMockPaymentRecord({ orderId: shopierOrderId, packageType, customerEmail });
    return { code, shopierOrderId };
}
