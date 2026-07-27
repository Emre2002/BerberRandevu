/**
 * publicBarbers projection — Firebase bağımlılığı yok.
 * firestoreService.js ve emulator backfill tarafından paylaşılır.
 */

/** Private belgeden asla kopyalanmaması gereken alanlar. */
export const PUBLIC_BARBER_SENSITIVE_FIELDS = [
    "password",
    "passwordHash",
    "username",
    "telegramChatId",
    "subscriptionStatus",
    "subscriptionEndDate",
    "subscriptionRenewedAt",
    "lastActivationCode",
    "lastSubscriptionUpdate",
    "ownerUid",
    "authUid",
    "role",
    "membership",
    "billing",
    "payment",
    "isAdmin",
    "approved"
];

function trimStr(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {object|null|undefined} barber
 * @param {string} slug
 * @param {{ bookingOpen?: boolean }} [opts]
 * @returns {Record<string, unknown>}
 */
export function buildPublicBarberProjection(barber, slug, opts = {}) {
    const resolvedSlug = slug || barber?.slug || "";
    const payload = {
        slug: resolvedSlug,
        name: trimStr(barber?.name),
        address: trimStr(barber?.address),
        city: trimStr(barber?.city),
        district: trimStr(barber?.district),
        neighborhood: trimStr(barber?.neighborhood),
        addressDetail: trimStr(barber?.addressDetail),
        phone: trimStr(barber?.phone),
        whatsapp: trimStr(barber?.whatsapp),
        openHour: trimStr(barber?.openHour || barber?.openingHour),
        closeHour: trimStr(barber?.closeHour || barber?.closingHour),
        logoUrl: trimStr(barber?.logoUrl),
        coverUrl: trimStr(barber?.coverUrl),
        mapsLink: trimStr(barber?.mapsLink),
        status: barber?.status || "active",
        bookingOpen: opts.bookingOpen
    };

    if (Array.isArray(barber?.selectedServices) && barber.selectedServices.length > 0) {
        payload.selectedServices = barber.selectedServices.filter((s) => typeof s === "string");
    }

    return payload;
}

/** @returns {string[]} */
export function publicBarberAllowlistKeys() {
    return [
        "slug",
        "name",
        "address",
        "city",
        "district",
        "neighborhood",
        "addressDetail",
        "phone",
        "whatsapp",
        "openHour",
        "closeHour",
        "logoUrl",
        "coverUrl",
        "mapsLink",
        "status",
        "bookingOpen",
        "selectedServices"
    ];
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {string[]} unexpected keys
 */
export function findUnexpectedProjectionKeys(projection) {
    const allowed = new Set(publicBarberAllowlistKeys());
    return Object.keys(projection).filter((k) => !allowed.has(k));
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {string[]} leaked sensitive keys
 */
export function findLeakedSensitiveKeys(projection) {
    const sensitive = new Set(PUBLIC_BARBER_SENSITIVE_FIELDS);
    return Object.keys(projection).filter((k) => sensitive.has(k));
}
