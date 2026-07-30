#!/usr/bin/env node
/**
 * Direct production auth diagnostic — resolver + Firebase signInWithPassword REST.
 * Reads credentials only from ignored .local-private files. Never logs passwords or tokens.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");

function readProductionApiKey() {
    const configPath = resolve(ROOT, "firebase-config.js");
    const text = readFileSync(configPath, "utf8");
    const match = text.match(/apiKey:\s*"([^"]+)"/);
    if (!match?.[1]) throw new Error("production_firebase_api_key_missing");
    return match[1];
}

const API_KEY = readProductionApiKey();
const IDENTITY_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

const ACCOUNTS = [
    { username: "superadmin", roleHint: "superAdmin", expectedRole: "superAdmin" },
    { username: "bedirhan", roleHint: "owner", expectedRole: "owner" },
    { username: "altinmakas", roleHint: "owner", expectedRole: "owner" },
    { username: "akkus", roleHint: "owner", expectedRole: "owner" }
];

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

function loadPasswordMap() {
    const map = new Map();
    const saFile = resolve(ROOT, ".local-private/superadmin-credentials.txt");
    if (existsSync(saFile)) {
        const text = stripBom(readFileSync(saFile, "utf8"));
        const username = text.match(/^Username=(.+)$/m)?.[1]?.trim();
        const password = text.match(/^Password=(.+)$/m)?.[1]?.trim();
        if (username && password) map.set(username, password);
    }

    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");
    if (existsSync(csvFile)) {
        const lines = stripBom(readFileSync(csvFile, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^businessname/i.test(line)) continue;
            const cols = parseCsvLine(line);
            if (cols.length >= 3 && cols[1] && cols[2]) {
                map.set(cols[1], cols[2]);
            }
        }
    }
    return map;
}

async function resolveUsername(username, roleHint) {
    const resp = await fetch(`${BASE}/api/resolve-auth-identifier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, roleHint })
    });
    let body = null;
    try {
        body = await resp.json();
    } catch {
        body = null;
    }
    return {
        httpStatus: resp.status,
        authEmail: body?.authEmail || null,
        role: body?.role || null,
        businessId: body?.businessId ?? null,
        error: body?.error || null
    };
}

async function firebaseSignIn(authEmail, password) {
    const resp = await fetch(IDENTITY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: authEmail,
            password,
            returnSecureToken: true
        })
    });
    let body = null;
    try {
        body = await resp.json();
    } catch {
        body = null;
    }
    if (!resp.ok) {
        return {
            ok: false,
            errorCode: body?.error?.message || `http_${resp.status}`,
            uid: null,
            idTokenPresent: false,
            superAdminClaim: false
        };
    }
    const idToken = body?.idToken || "";
    let superAdminClaim = false;
    if (idToken) {
        try {
            const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
            superAdminClaim = payload?.superAdmin === true;
        } catch {
            superAdminClaim = false;
        }
    }
    return {
        ok: true,
        errorCode: null,
        uid: body?.localId || null,
        idTokenPresent: Boolean(idToken),
        superAdminClaim
    };
}

function validateResolverShape(account, resolved) {
    if (resolved.httpStatus !== 200) return `resolver_http_${resolved.httpStatus}`;
    if (!resolved.authEmail) return "resolver_missing_authEmail";
    if (resolved.role !== account.expectedRole) return `resolver_role_${resolved.role ?? "missing"}`;
    if (account.expectedRole === "owner" && !resolved.businessId) return "resolver_missing_businessId";
    if (account.username === "superadmin" && !resolved.authEmail.endsWith("@users.berberrandevu.internal")) {
        return "resolver_unexpected_email_domain";
    }
    return null;
}

async function verifyAccount(account, password) {
    const result = {
        username: account.username,
        resolverStatus: null,
        resolverError: null,
        expectedRole: account.expectedRole,
        resolvedEmail: null,
        resolvedBusinessId: null,
        firebaseSignIn: false,
        firebaseErrorCode: null,
        uid: null,
        idTokenPresent: false,
        superAdminClaim: null,
        ok: false
    };

    if (!password) {
        result.resolverError = "missing_local_password";
        return result;
    }

    const resolved = await resolveUsername(account.username, account.roleHint);
    result.resolverStatus = resolved.httpStatus;
    result.resolverError = resolved.error;
    result.resolvedEmail = resolved.authEmail;
    result.resolvedBusinessId = resolved.businessId;

    const shapeError = validateResolverShape(account, resolved);
    if (shapeError) {
        result.resolverError = shapeError;
        return result;
    }

    const signIn = await firebaseSignIn(resolved.authEmail, password);
    result.firebaseSignIn = signIn.ok;
    result.firebaseErrorCode = signIn.errorCode;
    result.uid = signIn.uid;
    result.idTokenPresent = signIn.idTokenPresent;
    result.superAdminClaim = account.expectedRole === "superAdmin" ? signIn.superAdminClaim : null;

    result.ok = signIn.ok
        && signIn.idTokenPresent
        && (account.expectedRole !== "superAdmin" || signIn.superAdminClaim === true);

    return result;
}

async function main() {
    const passwords = loadPasswordMap();
    const results = [];

    for (const account of ACCOUNTS) {
        const password = passwords.get(account.username) || "";
        results.push(await verifyAccount(account, password));
    }

    for (const account of ACCOUNTS) {
        const entry = passwords.get(account.username);
        if (entry) passwords.set(account.username, "");
    }

    const ok = results.every((r) => r.ok);
    console.log(JSON.stringify({ ok, baseUrl: BASE, results }, null, 2));
    process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || "diagnostic_failed" }));
    process.exit(1);
});
