import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("admin.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]+(?:stylesheet|preconnect)[^>]*>/g, "");
const css = ["styles.css", "super-admin.css", "crm.css", "subscription.css", "working-hours.css", "deleted-appointments.css", "admin-dashboard.css"].map(read).join("\n");
const tabsSource = read("barberAdminExtras.js").slice(read("barberAdminExtras.js").indexOf("export function initAdminTabs()" )).replace("export ", "");
const app = read("app.js");
const weekSource = app.slice(app.indexOf('    document.getElementById("btnPrevWeek")?.addEventListener'), app.indexOf('    modalOverlay?.addEventListener("click"', app.indexOf('    document.getElementById("btnPrevWeek")?.addEventListener')));

it("admin shell, navigation, calendar keyboard actions and locks work at seven widths without live data", async () => {
    const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const browser = await chromium.launch({ headless: true,
        ...(process.platform === "win32" && existsSync(chrome) ? { executablePath: chrome } : {}) });
    try {
        for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            // All resources are local fixtures: never authenticate or query Firebase.
            await page.route("**/*", route => route.abort());
            await page.setContent(html);
            await page.addStyleTag({ content: css });
            assert.equal(await page.locator("#adminPanel").isVisible(), false);
            assert.equal(await page.locator("#barberLoginForm").isVisible(), true);
            await page.evaluate(() => {
                document.getElementById("barberLoginGate").hidden = true;
                document.getElementById("adminPanel").hidden = false;
                document.getElementById("barberShopName").textContent = "Uzun İşletme Adı Berber ve Kuaför Salonu";
                const grid = document.getElementById("calendarGrid");
                grid.replaceChildren();
                for (const day of ["Saat", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]) {
                    const el = document.createElement("div");
                    el.className = "calendar-header" + (day === "Saat" ? " calendar-header--corner" : day === "Cuma" ? " calendar-header--today" : "");
                    el.textContent = day;
                    grid.appendChild(el);
                }
                for (let hour = 9; hour < 19; hour++) {
                    const label = document.createElement("div");
                    label.className = "time-label"; label.textContent = `${hour}:00`; grid.appendChild(label);
                    for (let day = 0; day < 7; day++) {
                        const cell = document.createElement("div");
                        const kind = hour === 11 && day === 2 ? "booked" : hour === 13 ? "closed" : hour === 9 ? "past-empty" : "available";
                        cell.className = `calendar-cell calendar-cell--${kind}`;
                        cell.textContent = kind === "booked" ? "Örnek randevu" : kind === "closed" ? "Kapalı" : kind === "available" ? "Boş" : "";
                        if (kind === "past-empty") cell.setAttribute("aria-disabled", "true");
                        cell.addEventListener("click", () => { window.fixtureClicks = (window.fixtureClicks || 0) + 1; });
                        grid.appendChild(cell);
                    }
                }
                document.getElementById("weekLabel").textContent = "19.10.2026 — 25.10.2026";
                for (const day of ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]) {
                    const button = document.createElement("button");
                    button.className = "btn btn-secondary btn-sm";
                    button.textContent = `${day} — Günü Kapat`;
                    document.getElementById("dayActions").appendChild(button);
                }
            });
            await page.addScriptTag({ content: `${tabsSource}\ninitAdminTabs();` });
            await page.addScriptTag({ content: `let currentMonday = new Date(2026,9,19); function renderCalendar() { window.fixtureMonday = currentMonday.getDate(); } ${weekSource}` });
            await page.addScriptTag({ content: read("admin-dashboard.js") });
            if (width <= 1000) {
                await page.locator("#adminMenuToggle").click();
                assert.equal(await page.locator("#adminMenuToggle").getAttribute("aria-expanded"), "true");
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            }
            await page.locator('[data-tab="services"]').click();
            assert.equal(await page.locator('[data-panel="services"]').isVisible(), true);
            assert.equal(await page.locator("#adminSectionTitle").textContent(), "Hizmetler");
            assert.ok(await page.locator(".admin-title").evaluate(el => getComputedStyle(el).fontFamily.includes("sans-serif")));
            if (width <= 1000) {
                assert.equal(await page.locator("#adminMenuToggle").getAttribute("aria-expanded"), "false");
                await page.locator("#adminMenuToggle").click();
                await page.keyboard.press("Escape");
                assert.equal(await page.locator("#adminMenuToggle").getAttribute("aria-expanded"), "false");
                await page.locator("#adminMenuToggle").click();
            }
            await page.locator('[data-tab="calendar"]').click();
            await page.locator("#btnNextWeek").click();
            assert.equal(await page.evaluate(() => window.fixtureMonday), 26);
            await page.locator("#btnPrevWeek").click();
            assert.equal(await page.evaluate(() => window.fixtureMonday), 19);
            await page.locator(".calendar-cell--booked").focus();
            await page.keyboard.press("Enter");
            assert.equal(await page.evaluate(() => window.fixtureClicks), 1);
            assert.equal(await page.locator(".calendar-cell--past-empty").first().getAttribute("tabindex"), null);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px page overflow`);
            assert.ok(await page.locator(".calendar-wrapper").evaluate(el => el.scrollWidth > el.clientWidth || innerWidth >= 1440), `${width}px controlled calendar scroll`);
            if (process.env.ADMIN_DASHBOARD_SCREENSHOT && [390, 1440].includes(width)) {
                await page.locator(".calendar-wrapper").evaluate(el => { el.scrollLeft = 0; });
                await page.screenshot({ path: `${process.env.ADMIN_DASHBOARD_SCREENSHOT}-${width}.png`, fullPage: true });
            }
            await page.evaluate(() => {
                document.querySelector('[data-tab="customers"]').hidden = true;
                document.querySelector('[data-panel="calendar"] .admin-header').hidden = true;
                document.getElementById("dayActions").hidden = true;
            });
            if (width <= 1000) await page.locator("#adminMenuToggle").click();
            assert.equal(await page.locator('[data-tab="customers"]').isVisible(), false);
            assert.equal(await page.locator("#dayActions").isVisible(), false);
            assert.equal(await page.locator('[data-panel="calendar"] .admin-header').isVisible(), false);
            await page.evaluate(() => {
                document.getElementById("modalOverlay").classList.add("show");
                document.getElementById("modalBody").textContent = "Uzun randevu notu ".repeat(50);
            });
            assert.ok(await page.locator("#modalOverlay .modal").evaluate(el => el.getBoundingClientRect().width <= innerWidth), `${width}px modal fits`);
            await page.close();
        }
    } finally { await browser.close(); }
});
