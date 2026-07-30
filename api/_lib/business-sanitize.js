const SUPER_ADMIN_FIELDS = [
    "slug", "name", "address", "city", "district", "neighborhood", "addressDetail",
    "phone", "whatsapp", "email", "openHour", "closeHour", "logoUrl", "coverUrl",
    "mapsLink", "status", "subscriptionStatus", "subscriptionEndDate", "username",
    "telegramChatId", "selectedServices", "createdAt", "updatedAt", "subscriptionRenewedAt",
    "lastActivationCode", "lastSubscriptionUpdate"
];

export function sanitizeBusinessForSuperAdmin(slug, data = {}) {
    const out = { slug };
    for (const key of SUPER_ADMIN_FIELDS) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}

export function sanitizeBusinessList(docs) {
    return docs.map((docSnap) => sanitizeBusinessForSuperAdmin(docSnap.id, docSnap.data()));
}
