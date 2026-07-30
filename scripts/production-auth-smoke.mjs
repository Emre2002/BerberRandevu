#!/usr/bin/env node
/**
 * Production/preview smoke for public booking + super-admin privileged APIs.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE_URL = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");

const PERMISSION_MARKERS = [
    "Missing or insufficient permissions",
    "FirebaseError: Missing or insufficient permissions",
    "permission-denied"
];

function parseCredentialLine(line) {
    const cols = line.split(",").map((s) => s.trim());
    if (cols.length >= 2) {
        return { username: cols[0], password: cols[1] };
    }
    return null;
}

function loadSuperAdminCredentials() {
    const file = resolve(ROOT, ".local-private/superadmin-credentials.txt");
    if (!existsSync(file)) return null;
    const lines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        if (/^username/i.test(line) || /^password/i.test(line)) continue;
        const parsed = parseCredentialLine(line);
        if (parsed?.username && parsed?.password) return parsed;
        if (line.includes(":")) {
            const [username, password] = line.split(":").map((s) => s.trim());
            if (username && password) return { username, password };
        }
    }
    return null;
}

async function collectConsoleErrors(page) {
    const errors = [];
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (PERMISSION_MARKERS.some((m) => text.includes(m))) {
            errors.push(text);
        }
    });
    return errors;
}

async function smokePublicBooking(page) {
    const consoleErrors = await collectConsoleErrors(page);
    const slug = process.env.SMOKE_PUBLIC_SLUG || "x-men";
    await page.goto(`${BASE_URL}/randevu.html?dukkan=${encodeURIComponent(slug)}`, {
        waitUntil: "domcontentloaded"
    });

    await page.waitForTimeout(2500);

    const bodyText = await page.locator("body").innerText();
    for (const marker of PERMISSION_MARKERS) {
        if (bodyText.includes(marker)) {
            throw new Error(`public_booking_permission_marker:${marker}`);
        }
    }

    const dateInput = page.locator("#appointmentDate");
    if (await dateInput.count()) {
        const today = new Date();
        const value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        await dateInput.fill(value);
        await page.waitForTimeout(3000);
    }

    const slotsText = await page.locator("#slotsContainer").innerText().catch(() => "");
    if (PERMISSION_MARKERS.some((m) => slotsText.includes(m))) {
        throw new Error("public_booking_slots_permission_denied");
    }

    if (consoleErrors.length) {
        throw new Error(`public_booking_console_errors:${consoleErrors.join("|")}`);
    }

    return { slug, slotsLoaded: !/Saat bilgileri şu anda yüklenemiyor/.test(slotsText) };
}

async function smokeSuperAdmin(page, creds) {
    if (!creds) {
        return { skipped: true, reason: "super_admin_credentials_missing" };
    }

    const consoleErrors = await collectConsoleErrors(page);
    await page.goto(`${BASE_URL}/super-admin.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#saUsername", creds.username);
    await page.fill("#saPassword", creds.password);
    await page.click("#saLoginBtn");
    await page.waitForTimeout(5000);

    const bodyText = await page.locator("body").innerText();
    if (PERMISSION_MARKERS.some((m) => bodyText.includes(m))) {
        throw new Error("super_admin_permission_denied");
    }

    if (/Panel verileri yüklenemedi/.test(bodyText)) {
        throw new Error("super_admin_panel_load_failed");
    }

    const cards = page.locator(".sad-shop-card");
    const count = await cards.count();
    if (count < 1) {
        throw new Error("super_admin_no_business_cards");
    }

    if (consoleErrors.length) {
        throw new Error(`super_admin_console_errors:${consoleErrors.join("|")}`);
    }

    return { businessCards: count };
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const results = {};

    try {
        results.publicBooking = await smokePublicBooking(page);
        results.superAdmin = await smokeSuperAdmin(page, loadSuperAdminCredentials());
        console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, results }, null, 2));
    } catch (err) {
        console.error(JSON.stringify({ ok: false, baseUrl: BASE_URL, error: err.message }, null, 2));
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
