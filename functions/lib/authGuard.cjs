/** CJS mirror — client authGuard.js ile parity (membership parse). */

const BUSINESS_MEMBERSHIPS_COLLECTION = "businessMemberships";
const MEMBERSHIP_ROLE_OWNER = "owner";
const MEMBERSHIP_STATUS_ACTIVE = "active";

/**
 * @param {unknown} data
 * @param {string} uid
 */
function parseOwnerMembership(data, uid) {
    if (!data || typeof data !== "object" || !uid) return null;

    const businessId = typeof data.businessId === "string" ? data.businessId.trim() : "";
    const role = data.role;
    const status = data.status;
    const docUid = typeof data.uid === "string" ? data.uid : uid;

    if (docUid !== uid) return null;
    if (role !== MEMBERSHIP_ROLE_OWNER) return null;
    if (!businessId) return null;
    if (status !== MEMBERSHIP_STATUS_ACTIVE) return null;

    return { uid, businessId, role: MEMBERSHIP_ROLE_OWNER, status };
}

module.exports = {
    BUSINESS_MEMBERSHIPS_COLLECTION,
    MEMBERSHIP_ROLE_OWNER,
    MEMBERSHIP_STATUS_ACTIVE,
    parseOwnerMembership
};
