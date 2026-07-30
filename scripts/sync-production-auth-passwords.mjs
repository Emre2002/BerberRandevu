#!/usr/bin/env node
/**
 * Sync production Firebase Auth passwords from secure stdin JSON or local credential files.
 * Never logs passwords, tokens, emails, or uids.
 *
 * Preflight: node scripts/sync-production-auth-passwords.mjs --check-admin-credentials
 * Local files: node scripts/sync-production-auth-passwords.mjs --from-local-credentials
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { getAdminAuth, getAdminDb } from "../api/_lib/firebase-admin.js";
import { resolveAuthIdentifier } from "../api/_lib/resolve-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_PROJECT_ID = "berberrandevu-20a3e";
const MIN_PASSWORD_LENGTH = 6;

const SYNC_USERNAMES = [
    { username: "superadmin", roleHint: "superAdmin" },
    { username: "bedirhan", roleHint: "owner" },
    { username: "altinmakas", roleHint: "owner" },
    { username: "akkus", roleHint: "owner" }
];

function mapErrorCode(err) {
    const message = String(err?.message || "");
    const code = String(err?.code || "");
    if (
        message === "firebase_admin_credentials_missing"
        || code === "auth/invalid-credential"
        || code === "app/invalid-credential"
        || message.includes("Could not load the default credentials")
        || message.includes("ENOTFOUND metadata.google.internal")
    ) {
        return "firebase_admin_credentials_missing";
    }
    if (
        message === "firebase_admin_permission_denied"
        || code.includes("permission-denied")
        || message.includes("insufficient permission")
    ) {
        return "firebase_admin_permission_denied";
    }
    return "firebase_admin_initialization_failed";
}

function stripBom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function parseCsvLine(line) {
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === "," && !inQuotes) {
            cols.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    cols.push(current);
    return cols.map((s) => s.trim());
}

function validatePassword(password, username) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
        return "password_too_short";
    }
    if (/^\s|\s$/.test(password)) {
        return "password_has_edge_whitespace";
    }
    if (!password.trim()) {
        return "password_empty";
    }
    if (password === username) {
        return "password_equals_username";
    }
    return null;
}

async function checkAdminCredentials() {
    try {
        const auth = getAdminAuth();
        await auth.listUsers(1);
        console.log(JSON.stringify({
            ok: true,
            credentials: "found",
            projectId: DEFAULT_PROJECT_ID
        }));
        process.exit(0);
    } catch (err) {
        console.log(JSON.stringify({ ok: false, code: mapErrorCode(err) }));
        process.exit(1);
    }
}

function readStdinJson() {
    return new Promise((resolvePromise, reject) => {
        let data = "";
        const rl = createInterface({ input: process.stdin });
        rl.on("line", (line) => { data += `${line}\n`; });
        rl.on("close", () => {
            try {
                resolvePromise(JSON.parse(data));
            } catch (err) {
                reject(err);
            }
        });
        rl.on("error", reject);
    });
}

function loadFromCredentialFiles() {
    const accounts = [];
    const saFile = resolve(ROOT, ".local-private/superadmin-credentials.txt");
    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");

    if (existsSync(saFile)) {
        const text = stripBom(readFileSync(saFile, "utf8"));
        const username = text.match(/^Username=(.+)$/m)?.[1]?.trim();
        const password = text.match(/^Password=(.+)$/m)?.[1]?.trim();
        if (username && password) {
            accounts.push({ username, password, roleHint: "superAdmin" });
        }
    }

    if (existsSync(csvFile)) {
        const lines = stripBom(readFileSync(csvFile, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^businessname/i.test(line)) continue;
            const cols = parseCsvLine(line);
            if (cols.length < 3) continue;
            const username = cols[1];
            const password = cols[2];
            if (!username || !password) continue;
            accounts.push({ username, password, roleHint: "owner" });
        }
    }

    return { accounts };
}

async function ensureAuthLoginIndex(db, username, resolved, authUser) {
    const ref = db.collection("authLoginIndex").doc(username);
    const snap = await ref.get();
    const payload = {
        authEmail: resolved.authEmail,
        role: resolved.role,
        businessId: resolved.businessId || null,
        uid: authUser.uid,
        updatedAt: new Date().toISOString()
    };

    if (!snap.exists || !snap.data()?.authEmail || !snap.data()?.uid) {
        await ref.set(payload, { merge: true });
        return "repaired";
    }
    return "ok";
}

async function syncAccount(auth, db, { username, password, roleHint }) {
    const passwordError = validatePassword(password, username);
    if (passwordError) {
        return { username, ok: false, updated: false, errorCode: passwordError };
    }

    const resolved = await resolveAuthIdentifier(username, { roleHint: roleHint || "owner" });
    if (!resolved.ok || !resolved.authEmail) {
        return { username, ok: false, updated: false, errorCode: "resolver_failed" };
    }

    let user;
    try {
        user = await auth.getUserByEmail(resolved.authEmail);
    } catch (err) {
        return {
            username,
            authEmail: resolved.authEmail,
            ok: false,
            updated: false,
            errorCode: err?.code || "auth_user_missing"
        };
    }

    if (user.disabled) {
        return {
            username,
            authEmail: resolved.authEmail,
            ok: false,
            updated: false,
            errorCode: "auth_user_disabled"
        };
    }

    const existingClaims = user.customClaims || {};

    await auth.updateUser(user.uid, {
        password,
        disabled: false
    });

    if (roleHint === "superAdmin") {
        await auth.setCustomUserClaims(user.uid, { ...existingClaims, superAdmin: true });
    }

    const refreshed = await auth.getUser(user.uid);
    if (refreshed.disabled) {
        return {
            username,
            authEmail: resolved.authEmail,
            ok: false,
            updated: false,
            errorCode: "auth_user_still_disabled"
        };
    }

    if (roleHint === "superAdmin") {
        const claims = refreshed.customClaims || {};
        if (claims.superAdmin !== true) {
            return {
                username,
                authEmail: resolved.authEmail,
                ok: false,
                updated: false,
                errorCode: "superadmin_claim_missing"
            };
        }
    }

    const indexState = await ensureAuthLoginIndex(db, username, resolved, refreshed);
    return {
        username,
        authEmail: resolved.authEmail,
        ok: true,
        updated: true,
        indexState,
        errorCode: null
    };
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("check-admin-credentials") || argv.includes("--check-admin-credentials")) {
        await checkAdminCredentials();
        return;
    }

    const fromFiles = argv.includes("from-local-credentials") || argv.includes("--from-local-credentials");
    const payload = fromFiles ? loadFromCredentialFiles() : await readStdinJson();
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];

    if (!accounts.length) {
        console.error(JSON.stringify({ ok: false, error: "no_accounts" }));
        process.exit(1);
    }

    let auth;
    let db;
    try {
        auth = getAdminAuth();
        db = getAdminDb();
    } catch (err) {
        console.error(JSON.stringify({ ok: false, code: mapErrorCode(err) }));
        process.exit(1);
    }

    const results = [];

    for (const account of accounts) {
        if (!account?.username || !account?.password) {
            results.push({
                username: account?.username || "unknown",
                ok: false,
                updated: false,
                errorCode: "missing_fields"
            });
            continue;
        }
        const allowed = SYNC_USERNAMES.find((entry) => entry.username === account.username);
        if (!allowed) {
            results.push({
                username: account.username,
                ok: false,
                updated: false,
                errorCode: "not_allowed"
            });
            continue;
        }
        try {
            results.push(await syncAccount(auth, db, { ...account, roleHint: allowed.roleHint }));
        } catch (err) {
            results.push({
                username: account.username,
                ok: false,
                updated: false,
                errorCode: err?.code || mapErrorCode(err)
            });
        }
        account.password = "";
    }

    const ok = results.every((r) => r.ok);
    console.log(JSON.stringify({
        ok,
        results: results.map(({ username, authEmail, ok: passed, updated, indexState, errorCode }) => ({
            username,
            authEmail: authEmail || null,
            ok: passed,
            updated,
            indexState: indexState || null,
            errorCode: errorCode || null
        }))
    }, null, 2));
    process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, code: mapErrorCode(err) }));
    process.exit(1);
});
