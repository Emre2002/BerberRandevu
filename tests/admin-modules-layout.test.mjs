import { it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const html = read("admin.html").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link[^>]+(?:stylesheet|preconnect)[^>]*>/g, "");
const css = ["styles.css", "super-admin.css", "crm.css", "subscription.css", "working-hours.css", "deleted-appointments.css", "admin-dashboard.css"].map(read).join("\n");
const strip = source => source.replace(/import\s[\s\S]*?from\s*"[^"]+";/g, "").replace(/export\s*\{[^}]*\};/g, "").replace(/export /g, "");
const modules = Object.fromEntries(["servicesAdmin.js", "workingHoursAdmin.js", "workingHoursService.js", "customerCrm.js", "barberAdminExtras.js", "campaignHistoryView.js", "deletedAppointmentsPanel.js", "subscriptionAdmin.js"].map(name => [name, strip(read(name))]));

it("all admin modules fit seven widths and retain their existing form/search handlers using isolated fixtures", async () => {
    const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" && existsSync(chrome) ? { executablePath: chrome } : {}) });
    try {
        for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            await page.route("**/*", route => route.abort());
            await page.setContent(html);
            await page.addStyleTag({ content: css });
            await page.evaluate(async sources => {
                // Dependency injection replaces every backend operation; real modules own DOM handlers.
                const load = (file, result, dependencies = {}) => new Function(...Object.keys(dependencies), `${sources[file]}; return ${result};`)(...Object.values(dependencies));
                document.getElementById("barberLoginGate").hidden = true;
                document.getElementById("adminPanel").hidden = false;
                window.saves = [];
                const updateOwnerBarberSettings = async (_slug, payload) => { window.saves.push(payload); };
                const toast = (message, type) => { window.lastToast = { message, type }; };
                load("barberAdminExtras.js", "initAdminTabs")();
                load("servicesAdmin.js", "initServicesAdmin", { updateOwnerBarberSettings })("fixture", toast, { initialBarber: {} });
                const hours = load("workingHoursService.js", "({ HOUR_SELECT_OPTIONS, validateWorkingHours, getBarberWorkingHours, generateHourlySlotRanges })");
                load("workingHoursAdmin.js", "initWorkingHoursAdmin", { updateOwnerBarberSettings, ...hours })("fixture", toast, { initialBarber: { openHour: "09:00", closeHour: "18:00" } });
                const customers = Array.from({ length: 14 }, (_, i) => ({ customerId: `fixture-${i}`, fullName: i === 0 ? "Örnek Uzun İsimli Müşteri" : `Deneme ${i}`, phone: "05550000000", totalVisits: i + 1, status: i % 2 ? "risky" : "active", isVip: i > 10, firstVisit: new Date(2026, 8, 1), lastVisit: new Date(2026, 9, 1) }));
                const CUSTOMER_STATUS = { active: { label: "Aktif", emoji: "" }, risky: { label: "Riskli", emoji: "" }, lost: { label: "Kaybedilmiş", emoji: "" } };
                await load("customerCrm.js", "initCustomerCrm", {
                    fetchCustomersByBarber: async () => customers, fetchAppointmentsByBarber: async () => [],
                    normalizeCustomerRecord: record => record, normalizePhone: phone => phone, CUSTOMER_STATUS, VIP_THRESHOLD: 10
                })("fixture").activate();
                const renderCampaignHistory = load("campaignHistoryView.js", "renderCampaignHistory");
                load("barberAdminExtras.js", "initBarberMessaging", {
                    fetchCustomersByBarber: async () => customers, fetchCampaignsByBarber: async () => [{ message: "Örnek mesaj geçmişi", recipientCount: 14 }],
                    sendCampaign: async () => { window.fixtureMessages = (window.fixtureMessages || 0) + 1; return { recipientCount: 14 }; },
                    BARBER_TEMPLATES: { greeting: { id: "greeting", label: "Örnek şablon" } }, buildTemplateMessage: () => "Örnek şablon mesajı", renderCampaignHistory
                })("fixture", toast);
                const archive = load("deletedAppointmentsPanel.js", "initDeletedAppointmentsPanel", {
                    fetchActiveDeletedAppointments: async () => [{ customerName: "Örnek Uzun İsimli Müşteri", customerPhone: "05550000000", appointmentDate: "2026-10-23", appointmentTime: "10:00", serviceName: "Saç Kesimi", deletedBy: "İşletme sahibi", note: "Örnek arşiv notu" }],
                    formatDeletedAt: () => "23.10.2026", formatArchiveExpiry: () => "6 gün kaldı"
                })("fixture");
                await archive.refresh();
                load("subscriptionAdmin.js", "initSubscriptionAdmin", {
                    fetchBarber: async () => ({}), getSubscriptionState: () => ({ tone: "green", label: "Aktif", remainingDays: 45, endDateFormatted: "07.12.2026" }),
                    activateSubscriptionCode: async () => { window.fixtureActivations = (window.fixtureActivations || 0) + 1; return { newEndDate: "2026-12-07" }; },
                    getAdminCalendarLockMessage: () => "Abonelik gerekli", isSubscriptionWarningDue: () => false, isSubscriptionWarningDismissed: () => false,
                    dismissSubscriptionWarning: () => {}, SHOPIER_URL: "https://example.test/fixture-only"
                })("fixture", toast, { initialBarber: {} });
            }, modules);
            await page.addScriptTag({ content: read("admin-dashboard.js") });
            for (const tab of ["customers", "services", "hours", "messages", "deleted", "subscription", "account"]) {
                await page.evaluate(tab => document.querySelector(`[data-tab="${tab}"]`).click(), tab);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${tab} overflow`);
                assert.equal(await page.locator(`[data-panel="${tab}"]`).isVisible(), true);
                if (process.env.ADMIN_MODULE_SCREENSHOTS && [390, 1440].includes(width)) {
                    await page.screenshot({ path: `${process.env.ADMIN_MODULE_SCREENSHOTS}-${tab}-${width}.png`, fullPage: true });
                }
            }
            const show = async tab => page.evaluate(tab => document.querySelector(`[data-tab="${tab}"]`).click(), tab);
            await show("services");
            await page.locator("#svcSearch").fill("Skin");
            assert.equal(await page.locator(".svc-item:visible").count(), 1);
            await page.locator("#svcSelectAll").click();
            await page.locator("#svcSaveBtn").click();
            assert.ok(await page.evaluate(() => window.saves[0].selectedServices.includes("Skin Fade")));
            await show("hours");
            await page.locator("#whCloseHour").selectOption("08:00");
            assert.equal(await page.locator(".wh-preview__error").count(), 1);
            await page.locator("#whSaveBtn").click();
            assert.equal(await page.evaluate(() => window.saves.length), 1);
            await page.locator("#whCloseHour").selectOption("17:00");
            await page.locator("#whSaveBtn").click();
            assert.equal(await page.evaluate(() => window.saves[1].closeHour), "17:00");
            await show("customers");
            await page.locator("#crmSearch").fill("Örnek");
            await page.waitForFunction(() => document.querySelectorAll(".crm-row").length === 1);
            await page.locator(".crm-card__btn[data-action=detail]:visible, .crm-row:visible").first().click();
            assert.equal(await page.locator("#crmModalOverlay").isVisible(), true);
            await page.locator("#crmModalClose").click();
            await page.locator("#crmSearch").fill("bulunmayan-isim");
            await page.waitForFunction(() => !document.querySelector("#crmEmpty").hidden);
            await page.locator("#crmSearch").fill("");
            await page.locator('[data-filter="risky"]').click();
            await page.waitForFunction(() => document.querySelectorAll(".crm-row").length === 7);
            await show("messages");
            await page.locator("#barberCustomMessage").fill("Deneme önizlemesi");
            assert.equal(await page.locator("#barberMessagePreview").textContent(), "Deneme önizlemesi");
            assert.equal(await page.evaluate(() => window.fixtureMessages || 0), 0);
            await page.locator("#barberSendCampaignBtn").click();
            assert.equal(await page.evaluate(() => window.fixtureMessages), 1);
            await show("subscription");
            await page.locator("#btnActivateCode").click();
            assert.equal(await page.evaluate(() => window.fixtureActivations || 0), 0);
            await page.locator("#activationCodeInput").fill("FIXTURE-ONLY");
            await page.locator("#btnActivateCode").click();
            assert.equal(await page.evaluate(() => window.fixtureActivations), 1);
            await show("account");
            assert.equal(await page.locator("#ownerPasswordChangeForm").evaluate(form => form.checkValidity()), false);
            await page.close();
        }
    } finally { await browser.close(); }
});
