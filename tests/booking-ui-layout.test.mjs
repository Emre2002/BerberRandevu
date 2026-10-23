import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "randevu.html"), "utf8");
const css = readFileSync(resolve(root, "styles.css"), "utf8") + "\n" + readFileSync(resolve(root, "booking.css"), "utf8");
const appSource = readFileSync(resolve(root, "app.js"), "utf8");

it("booking layout fits mobile and desktop viewports with an accessible fixed confirmation", async () => {
    const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const browser = await chromium.launch({
        headless: true,
        ...(process.platform === "win32" && existsSync(chromePath) ? { executablePath: chromePath } : {})
    });
    try {
        for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            await page.route("**/app.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
            await page.route("https://fonts.googleapis.com/**", route => route.abort());
            await page.route("https://fonts.gstatic.com/**", route => route.abort());
            await page.setContent(html.replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
                .replace('<link rel="stylesheet" href="booking.css">', ""));
            await page.evaluate(() => {
                const strip = document.querySelector("#bookingDateChoices");
                for (let i = 0; i < 7; i++) {
                    const card = document.createElement("button");
                    card.className = "booking-date-choice";
                    card.innerHTML = `<span>${i === 0 ? "Bugün" : "Cmt"}</span><strong>${23 + i}</strong><span>Eki</span>`;
                    card.setAttribute("aria-pressed", String(i === 0));
                    strip.appendChild(card);
                }
                const slots = document.querySelector("#slotsContainer");
                slots.replaceChildren();
                for (const [index, time] of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"].entries()) {
                    const button = document.createElement("button");
                    button.className = `slot slot--${index === 1 ? "selected" : index === 2 ? "booked" : index === 3 ? "closed" : "available"}`;
                    button.textContent = time;
                    slots.appendChild(button);
                }
                document.querySelector("#serviceSelect").insertAdjacentHTML("afterend", '<div id="serviceCards" class="service-cards-grid slots-grid"><button class="slot slot--selected">Saç Kesimi</button><button class="slot slot--available">Sakal Tıraşı</button></div>');
            });
            const result = await page.evaluate(() => {
                document.querySelector("#barberName").textContent = "Çok Uzun İşletme Adı Berber ve Kuaför Salonu İstanbul";
                document.querySelector("#barberAddress").textContent = "Uzun mahalle ve sokak adresi, numara 123, İstanbul";
                const footer = document.querySelector(".booking-checkout").getBoundingClientRect();
                const button = document.querySelector("#btnBook").getBoundingClientRect();
                const app = document.querySelector(".app");
                const appBottom = app.getBoundingClientRect().bottom + window.scrollY;
                return {
                    overflow: document.documentElement.scrollWidth - innerWidth,
                    footerVisible: footer.bottom <= innerHeight + 1 && footer.top < innerHeight,
                    buttonHeight: button.height,
                    disabled: document.querySelector("#btnBook").disabled,
                    contentClearance: appBottom - document.querySelector(".booking-home-link").getBoundingClientRect().bottom - window.scrollY >= footer.height
                };
            });
            assert.ok(result.overflow <= 1, `${width}px horizontal overflow: ${result.overflow}`);
            assert.equal(result.footerVisible, true, `${width}px fixed footer visible`);
            assert.ok(result.buttonHeight >= 44, `${width}px confirmation target`);
            assert.equal(result.disabled, true);
            assert.equal(result.contentClearance, true, `${width}px content clearance`);
            if (width === 390 && process.env.BOOKING_VISUAL_SCREENSHOT) {
                await page.screenshot({ path: process.env.BOOKING_VISUAL_SCREENSHOT, fullPage: true });
            }
            await page.close();
        }
    } finally {
        await browser.close();
    }
});

it("quick date cards update the native date input and selected state", async () => {
    const browser = await chromium.launch({
        headless: true,
        ...(process.platform === "win32" && existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
            ? { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" } : {})
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html.replace(/<script type="module" src="app.js"><\/script>/, ""));
        const source = appSource.slice(appSource.indexOf('    const dateChoices = document.getElementById("bookingDateChoices");'),
            appSource.indexOf("    function isValidTurkishPhone(raw)"));
        const result = await page.evaluate(source => {
            const dateInput = document.getElementById("appointmentDate");
            dateInput.value = "2026-10-23";
            const run = new Function("getToday", "dateInput", "selectedSlot", "bookingInProgress", `${source}; return { renderBookingDateChoices };`);
            const { renderBookingDateChoices } = run(() => "2026-10-23", dateInput, null, false);
            let changes = 0;
            dateInput.addEventListener("change", () => { changes++; renderBookingDateChoices(); });
            document.querySelectorAll("#bookingDateChoices button")[1].click();
            return { value: dateInput.value, changes,
                selected: [...document.querySelectorAll("#bookingDateChoices button")].map(b => b.getAttribute("aria-pressed")) };
        }, source);
        assert.equal(result.value, "2026-10-24");
        assert.equal(result.changes, 1);
        assert.equal(result.selected.filter(value => value === "true").length, 1);
        assert.equal(result.selected[1], "true");
    } finally {
        await browser.close();
    }
});
