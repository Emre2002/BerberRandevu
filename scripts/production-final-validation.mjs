#!/usr/bin/env node
/**
 * Production final validation — super-admin, owner calendars, public booking, tenant isolation.
 * Credentials via env or ignored local files only (never logged or passed on CLI).
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE_URL = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");

const PASSWORD_ENV_KEYS = [
    "SMOKE_SA_PASS",
    "SMOKE_PASS",
    "SMOKE_PASS_BEDIRHAN",
    "SMOKE_PASS_ALTINMAKAS",
    "SMOKE_PASS_AKKUS"
];

const PERMISSION_MARKERS = [
    "Missing or insufficient permissions",
    "FirebaseError: Missing or insufficient permissions",
    "permission-denied",
    "Randevu takvimine erişilemiyor",
    "Bu işletmeye erişim yetkiniz bulunmuyor"
];

const OWNER_ACCOUNT_DEFS = [
    { label: "X-Men", username: "bedirhan", envKey: "SMOKE_PASS_BEDIRHAN", defaultSlug: "x-men" },
    { label: "Altın Makas", username: "altinmakas", envKey: "SMOKE_PASS_ALTINMAKAS", defaultSlug: "altinmakas" },
    { label: "Akkus", username: "akkus", envKey: "SMOKE_PASS_AKKUS", defaultSlug: "akkus" }
];

function secureEnv(name) {
    const value = process.env[name];
    return value && String(value).trim() ? String(value).trim() : null;
}

function loadSuperAdminCreds() {
    const file = resolve(ROOT, ".local-private/superadmin-credentials.txt");
    if (existsSync(file)) {
        const text = readFileSync(file, "utf8");
        const usernameMatch = text.match(/^Username=(.+)$/m);
        const passwordMatch = text.match(/^Password=(.+)$/m);
        if (usernameMatch?.[1] && passwordMatch?.[1]) {
            return {
                username: usernameMatch[1].trim(),
                password: passwordMatch[1].trim()
            };
        }
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (line.includes(":")) {
                const [username, password] = line.split(":").map((s) => s.trim());
                if (username && password) return { username, password };
            }
            const cols = line.split(",").map((s) => s.trim());
            if (cols.length >= 2 && !/^username$/i.test(cols[0])) {
                return { username: cols[0], password: cols[1] };
            }
        }
    }
    const username = secureEnv("SMOKE_SA_USER");
    const password = secureEnv("SMOKE_SA_PASS");
    if (username && password) return { username, password };
    return null;
}

function loadOwnerAccounts() {
    const csvFile = resolve(ROOT, ".local-private/business-login-credentials.csv");
    const csvByUsername = new Map();

    if (existsSync(csvFile)) {
        const lines = readFileSync(csvFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^businessname/i.test(line)) continue;
            const cols = line.split(",").map((s) => s.trim());
            if (cols.length >= 4) {
                csvByUsername.set(cols[1], {
                    label: cols[0],
                    username: cols[1],
                    password: cols[2],
                    expectedSlug: cols[3]
                });
            }
        }
    }

    const accounts = [];
    for (const def of OWNER_ACCOUNT_DEFS) {
        const fromCsv = csvByUsername.get(def.username);
        const password = fromCsv?.password || secureEnv(def.envKey) || secureEnv("SMOKE_PASS");
        if (!password) return null;
        accounts.push({
            label: fromCsv?.label || def.label,
            username: def.username,
            password,
            expectedSlug: fromCsv?.expectedSlug || def.defaultSlug
        });
    }
    return accounts;
}

function clearPasswordEnv() {
    for (const key of PASSWORD_ENV_KEYS) {
        delete process.env[key];
    }
}

function trackPermissionConsole(page, bucket) {
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (PERMISSION_MARKERS.some((m) => text.includes(m))) {
            bucket.push(text.slice(0, 120));
        }
    });
}

function trackFirestoreListQueries(page, bucket) {
    page.on("request", (req) => {
        const url = req.url();
        if (!url.includes("firestore.googleapis.com")) return;
        if (url.includes(":runQuery") || url.includes(":batchGet")) {
            bucket.push(url.split("?")[0].slice(-80));
        }
    });
}

async function getFirebaseAuthState(page) {
    return page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        const user = auth.currentUser;
        if (!user) return { signedIn: false };
        const tokenResult = await user.getIdTokenResult(true);
        return {
            signedIn: true,
            hasSuperAdminClaim: tokenResult.claims?.superAdmin === true,
            hasToken: Boolean(tokenResult.token)
        };
    });
}

async function smokeSuperAdmin(page, creds) {
    const consoleErrors = [];
    const firestoreQueries = [];
    trackPermissionConsole(page, consoleErrors);
    trackFirestoreListQueries(page, firestoreQueries);

    let listBusinessesStatus = null;
    page.on("response", (resp) => {
        if (resp.url().includes("/api/list-businesses")) {
            listBusinessesStatus = resp.status();
        }
    });

    await page.goto(`${BASE_URL}/super-admin.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#saUsername", creds.username);
    await page.fill("#saPassword", creds.password);
    await page.click("#saLoginBtn");

    await page.waitForFunction(
        () => {
            const mount = document.getElementById("saAppMount");
            return mount && mount.querySelector(".sad-shop-card");
        },
        { timeout: 45000 }
    );

    const authState = await getFirebaseAuthState(page);
    if (!authState.signedIn) throw new Error("super_admin_not_signed_in");
    if (!authState.hasToken) throw new Error("super_admin_missing_id_token");
    if (!authState.hasSuperAdminClaim) throw new Error("super_admin_missing_claim");

    if (listBusinessesStatus !== 200) {
        throw new Error(`list_businesses_status_${listBusinessesStatus ?? "missing"}`);
    }

    const bodyText = await page.locator("body").innerText();
    if (PERMISSION_MARKERS.some((m) => bodyText.includes(m))) {
        throw new Error("super_admin_permission_marker_on_page");
    }

    const names = await page.locator(".sad-shop-card__name").allInnerTexts();
    const slugs = await page.locator(".sad-shop-card__slug").allInnerTexts();
    const combined = [...names, ...slugs].join("\n").toLocaleLowerCase("tr");

    const count = await page.locator(".sad-shop-card").count();
    if (count !== 13) throw new Error(`super_admin_business_count_${count}`);

    const hasXMen = /x-?men|x men/.test(combined);
    const hasAltinMakas = /altın makas|altin makas|altinmakas/.test(combined);
    if (!hasXMen) throw new Error("super_admin_missing_x_men");
    if (!hasAltinMakas) throw new Error("super_admin_missing_altin_makas");

    const berberListQuery = firestoreQueries.some((q) => q.includes("berberler"));
    if (berberListQuery) throw new Error("super_admin_direct_berberler_query");

    if (consoleErrors.length) throw new Error("super_admin_console_permission_errors");

    return { businessCount: count, listBusinessesStatus, hasSuperAdminClaim: true };
}

async function smokeOwnerForbiddenApi(page, ownerCreds) {
    await page.goto(`${BASE_URL}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#girisUsername", ownerCreds.username);
    await page.fill("#girisPassword", ownerCreds.password);
    await page.click("#girisSubmitBtn");
    await page.waitForURL(/admin\.html/, { timeout: 30000 });

    const status = await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        const user = auth.currentUser;
        if (!user) return { ok: false, reason: "no_user" };
        const token = await user.getIdToken(true);
        const resp = await fetch("/api/list-businesses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: "{}"
        });
        return { ok: resp.status === 403, status: resp.status };
    });

    if (!status.ok) {
        throw new Error(`owner_list_businesses_expected_403_got_${status.status ?? status.reason}`);
    }

    await page.evaluate(() => {
        localStorage.setItem("isAdmin", "true");
        localStorage.setItem("superAdminLoggedIn", "true");
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("barberLoggedIn", "true");
    });

    const blockedStatus = await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        const user = auth.currentUser;
        if (!user) return 401;
        const token = await user.getIdToken(true);
        const resp = await fetch("/api/list-businesses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: "{}"
        });
        return resp.status;
    });

    if (blockedStatus !== 403) {
        throw new Error(`storage_flags_bypass_status_${blockedStatus}`);
    }

    return { ownerApiBlocked: true };
}

async function smokeOwnerCalendar(page, account) {
    const consoleErrors = [];
    trackPermissionConsole(page, consoleErrors);

    await page.goto(`${BASE_URL}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#girisUsername", account.username);
    await page.fill("#girisPassword", account.password);
    await page.click("#girisSubmitBtn");
    await page.waitForURL(/admin\.html/, { timeout: 30000 });
    await page.waitForSelector("#adminPanel:not([hidden])", { timeout: 30000 });

    const currentUrl = page.url();
    const currentSlug = new URL(currentUrl).searchParams.get("dukkan");
    if (currentSlug !== account.expectedSlug) {
        throw new Error(`unexpected_slug_${currentSlug ?? "none"}`);
    }

    await page.locator('.admin-tab[data-tab="calendar"]').click();
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

    const gridText = await grid.innerText();
    for (const marker of PERMISSION_MARKERS) {
        if (gridText.includes(marker)) {
            throw new Error(`calendar_permission_${marker}`);
        }
    }

    const otherSlug = account.expectedSlug === "x-men" ? "altinmakas" : "x-men";

    await page.evaluate((forgeSlug) => {
        localStorage.setItem("businessId", forgeSlug);
        localStorage.setItem("barberSlug", forgeSlug);
        sessionStorage.setItem("businessId", forgeSlug);
        sessionStorage.setItem("barberSlug", forgeSlug);
        sessionStorage.setItem("dukkan", forgeSlug);
    }, otherSlug);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const slugAfterStorageForge = new URL(page.url()).searchParams.get("dukkan");
    if (slugAfterStorageForge !== account.expectedSlug) {
        throw new Error(`storage_forge_bypass_slug_${slugAfterStorageForge ?? "none"}`);
    }

    await page.goto(`${BASE_URL}/admin.html?dukkan=${encodeURIComponent(otherSlug)}`, {
        waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(3000);
    const afterCrossTenantUrl = page.url();
    const afterSlug = new URL(afterCrossTenantUrl).searchParams.get("dukkan");
    if (afterSlug !== account.expectedSlug) {
        throw new Error(`cross_tenant_slug_changed_to_${afterSlug ?? "none"}`);
    }

    await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        await auth.signOut();
    });
    await page.goto(`${BASE_URL}/admin.html?dukkan=${encodeURIComponent(account.expectedSlug)}`, {
        waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(2000);
    const postLogoutHidden = await page.locator("#adminPanel").isHidden().catch(() => true);
    const redirectedToLogin = page.url().includes("giris.html");
    if (!postLogoutHidden && !redirectedToLogin) {
        throw new Error("logout_did_not_hide_admin_panel");
    }

    if (consoleErrors.length) {
        throw new Error("console_permission_errors");
    }

    return { label: account.label, username: account.username, slug: account.expectedSlug };
}

async function smokePublicSlug(page, slug) {
    const consoleErrors = [];
    const network = { availabilityCalls: 0, appointmentQueries: 0, availabilityBody: null };

    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (PERMISSION_MARKERS.some((m) => text.includes(m)) || /FirebaseError/.test(text)) {
            consoleErrors.push(text.slice(0, 120));
        }
    });

    page.on("request", (req) => {
        const url = req.url();
        if (url.includes("/api/public/availability")) network.availabilityCalls += 1;
        if (url.includes("firestore.googleapis.com") && url.includes("appointments")) {
            network.appointmentQueries += 1;
        }
    });

    page.on("response", async (resp) => {
        if (!resp.url().includes("/api/public/availability")) return;
        try {
            const json = await resp.json();
            network.availabilityBody = json;
        } catch {
            /* ignore */
        }
    });

    await page.goto(`${BASE_URL}/randevu.html?dukkan=${encodeURIComponent(slug)}`, {
        waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(6000);

    const bodyText = await page.locator("body").innerText();
    if (PERMISSION_MARKERS.some((m) => bodyText.includes(m))) {
        throw new Error("permission_marker_on_page");
    }

    const slotsText = await page.locator("#slotsContainer").innerText().catch(() => "");
    if (/FirebaseError/.test(slotsText)) throw new Error("firebase_error_in_slots");

    const slotCount = await page.locator("#slotsContainer .slot").count();
    if (slotCount < 1 && !/İşletme Bulunamadı/.test(bodyText)) {
        throw new Error("no_slots_loaded");
    }

    if (network.appointmentQueries > 0) {
        throw new Error("direct_appointment_firestore_query");
    }

    if (network.availabilityCalls < 1) {
        throw new Error("public_availability_api_not_called");
    }

    const body = network.availabilityBody;
    if (body) {
        const serialized = JSON.stringify(body).toLowerCase();
        if (/customername|phone|musteri|telefon|email/.test(serialized)) {
            throw new Error("availability_response_contains_pii_keys");
        }
    }

    if (consoleErrors.length) throw new Error("console_errors");

    return { slug, slotCount, availabilityCalls: network.availabilityCalls };
}

async function runCase(name, fn) {
    try {
        const detail = await fn();
        return { ok: true, ...detail };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

async function main() {
    const saCreds = loadSuperAdminCreds();
    if (!saCreds) {
        console.error(JSON.stringify({ ok: false, baseUrl: BASE_URL, error: "missing_super_admin_credentials" }, null, 2));
        process.exitCode = 1;
        return;
    }

    const owners = loadOwnerAccounts();
    if (!owners) {
        console.error(JSON.stringify({ ok: false, baseUrl: BASE_URL, error: "missing_owner_credentials" }, null, 2));
        process.exitCode = 1;
        return;
    }

    const browser = await chromium.launch({ headless: true });
    const report = { ok: true, baseUrl: BASE_URL, accounts: {} };

    try {
        {
            const page = await browser.newPage();
            report.accounts.superAdmin = await runCase("superAdmin", () => smokeSuperAdmin(page, saCreds));
            await page.close();
        }

        {
            const page = await browser.newPage();
            report.accounts.ownerSecurity = await runCase("ownerSecurity", () =>
                smokeOwnerForbiddenApi(page, owners[0])
            );
            await page.close();
        }

        for (const owner of owners) {
            const page = await browser.newPage();
            report.accounts[owner.username] = await runCase(owner.username, () =>
                smokeOwnerCalendar(page, owner)
            );
            await page.close();
        }

        report.accounts.public = {};
        for (const slug of ["abc", "x-men"]) {
            const page = await browser.newPage();
            report.accounts.public[slug] = await runCase(`public_${slug}`, () => smokePublicSlug(page, slug));
            await page.close();
        }

        report.ok =
            report.accounts.superAdmin?.ok === true
            && report.accounts.ownerSecurity?.ok === true
            && owners.every((owner) => report.accounts[owner.username]?.ok === true)
            && ["abc", "x-men"].every((slug) => report.accounts.public[slug]?.ok === true);

        if (!report.ok) process.exitCode = 1;
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
        clearPasswordEnv();
    }
}

main();
