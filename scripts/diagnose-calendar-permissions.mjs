#!/usr/bin/env node
/**
 * Production calendar permission diagnostic — no secrets logged.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");

function loadBedirhanCreds() {
    const csv = readFileSync(resolve(ROOT, ".local-private/business-login-credentials.csv"), "utf8");
    const line = csv.split(/\r?\n/).find((l) => l.includes("bedirhan") && !/^business/i.test(l));
    if (!line) throw new Error("missing_bedirhan_row");
    const cols = line.split(",").map((s) => s.trim());
    return { username: cols[1], password: cols[2] };
}

function sanitizeFirestoreUrl(url) {
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/documents\//, "");
        return path.split("/").slice(0, 6).join("/");
    } catch {
        return "firestore";
    }
}

async function main() {
    const creds = loadBedirhanCreds();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events = [];

    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (/permission|FirebaseError|PERMISSION/i.test(text)) {
            events.push({ kind: "console", text: text.slice(0, 160) });
        }
    });

    page.on("response", (resp) => {
        const url = resp.url();
        if (!url.includes("firestore.googleapis.com")) return;
        if (resp.status() >= 400) {
            events.push({
                kind: "firestore_http",
                status: resp.status(),
                path: sanitizeFirestoreUrl(url)
            });
        }
    });

    await page.goto(`${BASE}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#girisUsername", creds.username);
    await page.fill("#girisPassword", creds.password);
    await Promise.all([
        page.waitForURL(/admin\.html/i, { waitUntil: "domcontentloaded", timeout: 45000 }),
        page.locator("#girisForm").evaluate((f) => f.requestSubmit())
    ]);
    await page.waitForSelector("#adminPanel:not([hidden])", { timeout: 45000 });

    const membership = await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        const user = auth.currentUser;
        if (!user) return { signedIn: false };
        const token = await user.getIdTokenResult(true);
        return {
            signedIn: true,
            businessId: token.claims?.businessId || null,
            urlSlug: new URL(location.href).searchParams.get("dukkan")
        };
    });

    await page.locator('.admin-tab[data-tab="calendar"]').click();
    await page.waitForFunction(
        () => {
            const el = document.getElementById("calendarGrid");
            if (!el) return false;
            const text = el.innerText || "";
            return !/Takvim yükleniyor|Yetki doğrulanıyor/.test(text);
        },
        { timeout: 45000 }
    );

    await page.waitForTimeout(3000);

    const gridSnippet = await page.locator("#calendarGrid").innerText().then((t) => t.slice(0, 80));
    console.log(JSON.stringify({
        ok: events.length === 0,
        membership,
        gridSnippet,
        events
    }, null, 2));

    await browser.close();
    process.exitCode = events.length ? 1 : 0;
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
});
