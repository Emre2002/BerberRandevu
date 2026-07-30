#!/usr/bin/env node
/**
 * Audit production auth accounts — no passwords, emails, or uids in output.
 */
import { getAdminAuth, getAdminDb } from "../api/_lib/firebase-admin.js";
import { resolveAuthIdentifier } from "../api/_lib/resolve-auth.js";

const USERS = [
    { username: "superadmin", roleHint: "superAdmin" },
    { username: "bedirhan", roleHint: "owner" },
    { username: "altinmakas", roleHint: "owner" },
    { username: "akkus", roleHint: "owner" }
];

async function auditOne(username, roleHint) {
    const result = {
        username,
        resolverOk: false,
        resolverRole: null,
        resolverBusinessId: null,
        authUserExists: false,
        authDisabled: null,
        membershipActive: null,
        membershipBusinessId: null,
        superAdminClaim: null,
        authLoginIndexExists: false,
        authLoginIndexValid: false
    };

    const resolved = await resolveAuthIdentifier(username, { roleHint });
    result.resolverOk = resolved.ok === true;
    result.resolverRole = resolved.role || null;
    result.resolverBusinessId = resolved.businessId || null;

    const db = getAdminDb();
    const indexSnap = await db.collection("authLoginIndex").doc(username).get();
    result.authLoginIndexExists = indexSnap.exists;
    if (indexSnap.exists) {
        const data = indexSnap.data() || {};
        result.authLoginIndexValid = Boolean(data.authEmail && (data.role === "superAdmin" || data.businessId));
    }

    if (!resolved.ok || !resolved.authEmail) {
        return result;
    }

    try {
        const authUser = await getAdminAuth().getUserByEmail(resolved.authEmail);
        result.authUserExists = true;
        result.authDisabled = authUser.disabled === true;

        if (roleHint === "superAdmin") {
            const claims = authUser.customClaims || {};
            result.superAdminClaim = claims.superAdmin === true;
        } else {
            const membership = await db.collection("businessMemberships").doc(authUser.uid).get();
            if (membership.exists) {
                const data = membership.data() || {};
                result.membershipActive = data.status === "active" && data.role === "owner";
                result.membershipBusinessId = data.businessId || null;
            } else {
                result.membershipActive = false;
            }
        }
    } catch {
        result.authUserExists = false;
    }

    return result;
}

async function main() {
    const report = { accounts: [] };
    for (const entry of USERS) {
        report.accounts.push(await auditOne(entry.username, entry.roleHint));
    }
    console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
});
