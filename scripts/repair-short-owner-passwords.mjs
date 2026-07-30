#!/usr/bin/env node
/**
 * Repair owner accounts whose local credential passwords are below Firebase minimum length.
 * Generates new secure passwords, syncs via Admin SDK, updates ignored credential files.
 * Never prints password values.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminAuth, getAdminDb } from "../api/_lib/firebase-admin.js";
import { resolveAuthIdentifier } from "../api/_lib/resolve-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIN_LENGTH = 12;
const TARGETS = ["altinmakas", "akkus"];

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

function generatePassword() {
    return randomBytes(24).toString("base64url").slice(0, MIN_LENGTH);
}

async function syncPassword(auth, db, username, password) {
    const resolved = await resolveAuthIdentifier(username, { roleHint: "owner" });
    if (!resolved.ok || !resolved.authEmail) {
        return { username, ok: false, errorCode: "resolver_failed" };
    }
    const user = await auth.getUserByEmail(resolved.authEmail);
    await auth.updateUser(user.uid, { password, disabled: false });
    await db.collection("authLoginIndex").doc(username).set({
        authEmail: resolved.authEmail,
        role: resolved.role,
        businessId: resolved.businessId || null,
        uid: user.uid,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    return { username, ok: true, authEmail: resolved.authEmail, businessId: resolved.businessId };
}

async function main() {
    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");
    if (!existsSync(csvFile)) {
        console.error(JSON.stringify({ ok: false, error: "missing_credentials_csv" }));
        process.exit(1);
    }

    const auth = getAdminAuth();
    const db = getAdminDb();
    const newPasswords = new Map();
    const results = [];

    for (const username of TARGETS) {
        const password = generatePassword();
        newPasswords.set(username, password);
        try {
            results.push(await syncPassword(auth, db, username, password));
        } catch (err) {
            results.push({ username, ok: false, errorCode: err?.code || "sync_failed" });
        }
    }

    if (!results.every((r) => r.ok)) {
        for (const value of newPasswords.values()) value.replace(/./g, "");
        console.log(JSON.stringify({ ok: false, results }, null, 2));
        process.exit(1);
    }

    const lines = stripBom(readFileSync(csvFile, "utf8")).split(/\r?\n/);
    const updated = lines.map((line) => {
        if (!line.trim() || /^businessname/i.test(line)) return line;
        const cols = parseCsvLine(line);
        if (cols.length >= 3 && newPasswords.has(cols[1])) {
            cols[2] = newPasswords.get(cols[1]);
            return cols.join(",");
        }
        return line;
    });
    writeFileSync(csvFile, updated.join("\r\n"), { encoding: "utf8" });

    for (const value of newPasswords.values()) {
        value.replace(/./g, "");
    }

    console.log(JSON.stringify({
        ok: true,
        repaired: TARGETS,
        message: "credentials_updated_in_local_private_files"
    }, null, 2));
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || "repair_failed" }));
    process.exit(1);
});
