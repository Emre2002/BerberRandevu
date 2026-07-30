#!/usr/bin/env node
/**
 * Sync production Firebase Auth passwords from secure stdin JSON or local credential files.
 * Never logs passwords, tokens, emails, or uids.
 *
 * Stdin JSON:
 * { "accounts": [ { "username": "superadmin", "password": "...", "roleHint": "superAdmin" } ] }
 *
 * Or: node scripts/sync-production-auth-passwords.mjs --from-local-credentials
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { loadLocalEnvFile } from "./_lib/load-local-env.mjs";
import { resolveAuthIdentifier } from "../api/_lib/resolve-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROJECT_ID = "berberrandevu-20a3e";

const SYNC_USERNAMES = [
    { username: "superadmin", roleHint: "superAdmin" },
    { username: "altinmakas", roleHint: "owner" },
    { username: "akkus", roleHint: "owner" }
];

function initAdminApp() {
    if (getApps().length) return getApps()[0];

    loadLocalEnvFile();
    const extraEnv = resolve(ROOT, ".env.vercel.production");
    if (existsSync(extraEnv)) {
        const text = readFileSync(extraEnv, "utf8");
        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const idx = line.indexOf("=");
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim();
            let value = line.slice(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!process.env[key]) process.env[key] = value;
        }
    }

    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (rawJson) {
        const serviceAccount = JSON.parse(rawJson);
        return initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id || PROJECT_ID
        });
    }

    if (privateKey && clientEmail) {
        return initializeApp({
            credential: cert({
                project_id: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
                client_email: clientEmail,
                private_key: privateKey.replace(/\\n/g, "\n")
            }),
            projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID
        });
    }

    return initializeApp({
        credential: applicationDefault(),
        projectId: PROJECT_ID
    });
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
        const text = readFileSync(saFile, "utf8");
        const username = text.match(/^Username=(.+)$/m)?.[1]?.trim();
        const password = text.match(/^Password=(.+)$/m)?.[1]?.trim();
        if (username && password) {
            accounts.push({ username, password, roleHint: "superAdmin" });
        }
    }

    if (existsSync(csvFile)) {
        const lines = readFileSync(csvFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^businessname/i.test(line)) continue;
            const cols = line.split(",").map((s) => s.trim());
            if (cols.length < 3) continue;
            if (cols[1] === "bedirhan") continue;
            if (cols[1] === "altinmakas" || cols[1] === "akkus") {
                accounts.push({ username: cols[1], password: cols[2], roleHint: "owner" });
            }
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
    const resolved = await resolveAuthIdentifier(username, { roleHint: roleHint || "owner" });
    if (!resolved.ok || !resolved.authEmail) {
        return { username, ok: false, reason: "resolver_failed" };
    }

    const user = await auth.getUserByEmail(resolved.authEmail);
    const existingClaims = user.customClaims || {};

    await auth.updateUser(user.uid, {
        password,
        disabled: false
    });

    if (roleHint === "superAdmin") {
        if (existingClaims.superAdmin !== true) {
            await auth.setCustomUserClaims(user.uid, { ...existingClaims, superAdmin: true });
        }
    }

    const indexState = await ensureAuthLoginIndex(db, username, resolved, user);
    return { username, ok: true, indexState };
}

async function main() {
    const fromFiles = process.argv.includes("--from-local-credentials");
    const payload = fromFiles ? loadFromCredentialFiles() : await readStdinJson();
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];

    if (!accounts.length) {
        console.error(JSON.stringify({ ok: false, error: "no_accounts" }));
        process.exit(1);
    }

    initAdminApp();
    const auth = getAuth();
    const db = getFirestore();
    const results = [];

    for (const account of accounts) {
        if (!account?.username || !account?.password) {
            results.push({ username: account?.username || "unknown", ok: false, reason: "missing_fields" });
            continue;
        }
        try {
            results.push(await syncAccount(auth, db, account));
        } catch (err) {
            results.push({
                username: account.username,
                ok: false,
                reason: err?.code || err?.message || "sync_failed"
            });
        }
        account.password = "";
    }

    const ok = results.every((r) => r.ok);
    console.log(JSON.stringify({ ok, results: results.map(({ username, ok: passed, reason, indexState }) => ({
        username,
        ok: passed,
        reason: reason || null,
        indexState: indexState || null
    })) }, null, 2));
    process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || "sync_failed" }));
    process.exit(1);
});
