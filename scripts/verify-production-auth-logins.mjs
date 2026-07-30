#!/usr/bin/env node
/**
 * Verify Firebase Auth sign-in only — no secrets in output.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");

function loadAccounts() {
    const accounts = [];
    const saFile = resolve(ROOT, ".local-private/superadmin-credentials.txt");
    if (existsSync(saFile)) {
        const text = readFileSync(saFile, "utf8");
        const username = text.match(/^Username=(.+)$/m)?.[1]?.trim();
        const password = text.match(/^Password=(.+)$/m)?.[1]?.trim();
        if (username && password) accounts.push({ username, password, mode: "superAdmin" });
    }

    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");
    if (existsSync(csvFile)) {
        for (const line of readFileSync(csvFile, "utf8").split(/\r?\n/)) {
            if (!line.trim() || /^businessname/i.test(line)) continue;
            const cols = line.split(",").map((s) => s.trim());
            if (cols.length >= 3) accounts.push({ username: cols[1], password: cols[2], mode: "owner" });
        }
    }
    return accounts;
}

async function verifyOwner(page, { username, password }) {
    await page.goto(`${BASE}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#girisUsername", username);
    await page.fill("#girisPassword", password);
    await Promise.all([
        page.waitForURL(/admin\.html/i, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null),
        page.locator("#girisForm").evaluate((f) => f.requestSubmit())
    ]);
    const signedIn = await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        return Boolean((await cfg.getAuthInstance()).currentUser);
    });
    return signedIn;
}

async function verifySuperAdmin(page, { username, password }) {
    await page.goto(`${BASE}/super-admin.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#saUsername", username);
    await page.fill("#saPassword", password);
    await page.locator("#saLoginForm").evaluate((f) => f.requestSubmit());
    await page.waitForTimeout(8000);
    return page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        const user = auth.currentUser;
        if (!user) return false;
        const token = await user.getIdTokenResult(true);
        return token.claims?.superAdmin === true;
    });
}

async function main() {
    const accounts = loadAccounts();
    const browser = await chromium.launch({ headless: true });
    const results = [];

    for (const account of accounts) {
        const page = await browser.newPage();
        try {
            const ok = account.mode === "superAdmin"
                ? await verifySuperAdmin(page, account)
                : await verifyOwner(page, account);
            results.push({ username: account.username, ok: Boolean(ok) });
        } catch {
            results.push({ username: account.username, ok: false });
        } finally {
            await page.close();
        }
        account.password = "";
    }

    await browser.close();
    const allOk = results.every((r) => r.ok);
    console.log(JSON.stringify({ ok: allOk, results }, null, 2));
    process.exitCode = allOk ? 0 : 1;
}

main();
