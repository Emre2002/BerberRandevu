#!/usr/bin/env node
/**
 * Production/preview smoke: owner login → admin Takvim tab → calendar loads without permission errors.
 *
 * Credentials (first match wins):
 *   SMOKE_CREDENTIALS_FILE (default: .local-private/business-login-credentials.csv)
 *   or SMOKE_USER + SMOKE_PASS for a single account
 *
 * CSV columns (header optional): business,username,password
 * Default accounts when file missing: bedirhan, altinmakas, akkus (passwords from env SMOKE_PASS_<USER>)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BASE_URL = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const CREDENTIALS_FILE =
    process.env.SMOKE_CREDENTIALS_FILE ||
    resolve(ROOT, ".local-private/business-login-credentials.csv");

const PERMISSION_MARKERS = [
    "Missing or insufficient permissions",
    "Randevu takvimine erişilemiyor",
    "Bu işletmeye erişim yetkiniz bulunmuyor",
    "permission-denied"
];

const DEFAULT_USERNAMES = ["bedirhan", "altinmakas", "akkus"];

function parseCsvLine(line) {
    const parts = line.split(",").map((s) => s.trim());
    return parts;
}

function loadAccounts() {
    if (process.env.SMOKE_USER && process.env.SMOKE_PASS) {
        return [{ label: process.env.SMOKE_USER, username: process.env.SMOKE_USER, password: process.env.SMOKE_PASS }];
    }

    if (existsSync(CREDENTIALS_FILE)) {
        const lines = readFileSync(CREDENTIALS_FILE, "utf8")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        const accounts = [];
        for (const line of lines) {
            if (/^business/i.test(line) || /^username/i.test(line)) continue;
            const cols = parseCsvLine(line);
            if (cols.length >= 3) {
                accounts.push({ label: cols[0], username: cols[1], password: cols[2] });
            } else if (cols.length === 2) {
                accounts.push({ label: cols[0], username: cols[0], password: cols[1] });
            }
        }
        if (accounts.length) return accounts;
    }

    const fromEnv = DEFAULT_USERNAMES.map((username) => {
        const key = `SMOKE_PASS_${username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
        const password = process.env[key] || process.env.SMOKE_PASS;
        if (!password) {
            throw new Error(
                `Missing credentials for ${username}. Set ${key}, SMOKE_PASS, or provide ${CREDENTIALS_FILE}`
            );
        }
        return { label: username, username, password };
    });
    return fromEnv;
}

async function loginAndCheckCalendar(page, { label, username, password }) {
    await page.goto(`${BASE_URL}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#girisUsername", username);
    await page.fill("#girisPassword", password);
    await page.click("#girisSubmitBtn");

    await page.waitForURL(/admin\.html/, { timeout: 30000 });
    await page.waitForSelector("#adminPanel:not([hidden])", { timeout: 30000 });

    const calendarTab = page.locator('.admin-tab[data-tab="calendar"]');
    await calendarTab.click();

    const grid = page.locator("#calendarGrid");
    await grid.waitFor({ state: "visible", timeout: 30000 });

    await page.waitForFunction(
        () => {
            const el = document.getElementById("calendarGrid");
            if (!el) return false;
            const text = el.innerText || "";
            if (/Takvim yükleniyor|Yetki doğrulanıyor/.test(text)) return false;
            return true;
        },
        { timeout: 45000 }
    );

    const bodyText = await page.locator("#calendarGrid").innerText();
    for (const marker of PERMISSION_MARKERS) {
        if (bodyText.includes(marker)) {
            throw new Error(`[${label}] Permission error on calendar: "${marker}"`);
        }
    }

    const cellCount = await page.locator("#calendarGrid > *").count();
    if (cellCount < 4) {
        throw new Error(`[${label}] Calendar grid did not render (cells=${cellCount})`);
    }

    return { label, username, ok: true };
}

async function main() {
    const accounts = loadAccounts();
    console.log(`Smoke base URL: ${BASE_URL}`);
    console.log(`Accounts: ${accounts.map((a) => a.label).join(", ")}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const results = [];

    try {
        for (const account of accounts) {
            const page = await context.newPage();
            try {
                const result = await loginAndCheckCalendar(page, account);
                results.push(result);
                console.log(`PASS  ${account.label} (${account.username})`);
            } finally {
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }

    console.log(`All ${results.length} calendar smoke checks passed.`);
}

main().catch((err) => {
    console.error("SMOKE FAILED:", err.message || err);
    process.exit(1);
});
