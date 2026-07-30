#!/usr/bin/env node
/**
 * Sanitized production booking reproduction — no PII or credentials in output.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const slug = process.env.SMOKE_PUBLIC_SLUG || "abc";
const outDir = resolve(ROOT, ".local-private/validation-artifacts/appointment-create");
mkdirSync(outDir, { recursive: true });

function sanitizeUrl(url) {
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch {
        return String(url).slice(0, 200);
    }
}

function tomorrowYmd() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const network = [];
const consoleErrors = [];
const pageErrors = [];

page.on("request", (req) => {
    const url = req.url();
    if (
        url.includes("cloudfunctions")
        || url.includes("create-appointment")
        || url.includes("/api/")
        || url.includes("firestore.googleapis.com")
    ) {
        network.push({ kind: "request", method: req.method(), url: sanitizeUrl(url) });
    }
});

page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("create-appointment") || url.includes("cloudfunctions")) {
        let bodyPreview = null;
        try {
            const text = await resp.text();
            bodyPreview = text.slice(0, 400);
        } catch {
            bodyPreview = null;
        }
        network.push({
            kind: "response",
            status: resp.status(),
            url: sanitizeUrl(url),
            bodyPreview
        });
    }
});

page.on("console", (msg) => {
    if (msg.type() === "error") {
        consoleErrors.push(msg.text().slice(0, 300));
    }
});
page.on("pageerror", (err) => pageErrors.push(err.message.slice(0, 300)));

await page.goto(`${BASE}/randevu.html?dukkan=${encodeURIComponent(slug)}`, {
    waitUntil: "domcontentloaded"
});
await page.waitForTimeout(5000);

const dateStr = tomorrowYmd();
await page.fill("#appointmentDate", dateStr);
await page.dispatchEvent("#appointmentDate", "change");
await page.waitForTimeout(4000);

const slotBtn = page.locator(".slot--available").first();
const slotCount = await page.locator(".slot").count();

if ((await slotBtn.count()) === 0) {
    const diag = { ok: false, reason: "no_slots", slug, dateStr, slotCount, network, consoleErrors, pageErrors };
    writeFileSync(resolve(outDir, "repro-no-slots.json"), JSON.stringify(diag, null, 2));
    console.log(JSON.stringify(diag, null, 2));
    await browser.close();
    process.exit(1);
}

await slotBtn.click();
await page.fill("#customerName", "Test Musteri");
await page.fill("#customerPhone", "05551234567");
await page.dispatchEvent("#customerPhone", "input");

const serviceSelect = page.locator("#serviceSelect");
if (await serviceSelect.count()) {
    const values = await serviceSelect.locator("option").evaluateAll((opts) =>
        opts.map((o) => o.value).filter(Boolean)
    );
    if (values.length) {
        await serviceSelect.selectOption(values[0]);
    }
}

await page.waitForTimeout(4500);
await page.waitForFunction(() => {
    const btn = document.getElementById("btnBook");
    return btn && !btn.disabled;
}, null, { timeout: 15000 }).catch(() => null);

const bookResponsePromise = page.waitForResponse(
    (r) => r.url().includes("create-appointment"),
    { timeout: 30000 }
).catch(() => null);

await page.click("#btnBook");
const bookResp = await bookResponsePromise;
await page.waitForTimeout(4000);

const toastText = await page.locator("#toast").innerText().catch(() => "");
const successModal = await page.locator("#bookingSuccessTitle").count();
const bodyText = await page.locator("body").innerText();

let responseBody = null;
if (bookResp) {
    try {
        responseBody = await bookResp.json();
    } catch {
        responseBody = null;
    }
}

const diag = {
    ok: Boolean(successModal) || responseBody?.ok === true,
    slug,
    dateStr,
    slotCount,
    bookResponseStatus: bookResp?.status() ?? null,
    bookResponseUrl: bookResp ? sanitizeUrl(bookResp.url()) : null,
    responseCode: responseBody?.code ?? null,
    hasAppointmentId: Boolean(responseBody?.appointmentId),
    toast: toastText.slice(0, 200),
    hasGenericFailure: /Randevu oluşturulamadı|Bir sorun oluştu|tekrar deneyin/i.test(bodyText),
    successModalVisible: successModal > 0,
    network,
    consoleErrors,
    pageErrors
};

writeFileSync(resolve(outDir, `repro-${slug}.json`), JSON.stringify(diag, null, 2));
console.log(JSON.stringify(diag, null, 2));
await browser.close();
process.exit(diag.ok ? 0 : 1);
