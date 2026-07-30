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

class ValidationFailure extends Error {
    constructor(code, diag = {}) {
        super(code);
        this.name = "ValidationFailure";
        this.code = code;
        this.diag = diag;
    }
}

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

function attachPageDiagnostics(page, bucket) {
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (PERMISSION_MARKERS.some((m) => text.includes(m)) || /FirebaseError/.test(text)) {
            bucket.push(text.slice(0, 120));
        }
    });
    page.on("pageerror", (err) => {
        bucket.push(String(err?.message || err).slice(0, 120));
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

function waitForApiResponse(page, pathPart, method = "POST") {
    return page.waitForResponse(
        (resp) => resp.url().includes(pathPart) && resp.request().method() === method,
        { timeout: 45000 }
    );
}

async function readVisibleLoginError(page, selector) {
    const el = page.locator(selector);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) return null;
    const text = (await el.innerText()).trim();
    return text || null;
}

async function performOwnerLogin(page, { username, password, expectedSlug }) {
    const diag = {
        stage: "owner_login",
        username,
        url: "",
        resolveStatus: null,
        resolveError: null,
        visibleError: null
    };

    await page.goto(`${BASE_URL}/giris.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#girisUsername").waitFor({ state: "visible" });
    await page.locator("#girisPassword").waitFor({ state: "visible" });
    if (!(await page.locator("#girisSubmitBtn").isEnabled())) {
        throw new ValidationFailure("submit_disabled", diag);
    }

    await page.fill("#girisUsername", username);
    await page.fill("#girisPassword", password);

    const resolvePromise = waitForApiResponse(page, "/api/resolve-auth-identifier").then(async (resp) => {
        diag.resolveStatus = resp.status();
        try {
            const body = await resp.json();
            diag.resolveError = body?.error || null;
        } catch {
            /* ignore */
        }
    }).catch(() => {
        diag.resolveStatus = diag.resolveStatus ?? "missing";
    });

    const submitPromise = page.locator("#girisForm").evaluate((form) => form.requestSubmit());
    const navigationPromise = page.waitForURL(/admin\.html/i, {
        waitUntil: "domcontentloaded",
        timeout: 45000
    }).catch(() => null);
    const panelPromise = page.waitForSelector("#adminPanel:not([hidden])", { timeout: 45000 }).catch(() => null);

    await Promise.all([submitPromise, resolvePromise]);
    diag.url = page.url();

    diag.visibleError = await readVisibleLoginError(page, "#girisError");
    if (diag.visibleError) {
        throw new ValidationFailure(
            diag.resolveStatus === 404 ? "invalid_credential" : "login_failed",
            diag
        );
    }

    if (diag.resolveStatus === 404) {
        throw new ValidationFailure("auth_resolver_failed", diag);
    }
    if (typeof diag.resolveStatus === "number" && diag.resolveStatus >= 500) {
        throw new ValidationFailure("auth_resolver_unavailable", diag);
    }
    if (typeof diag.resolveStatus === "number" && diag.resolveStatus !== 200) {
        throw new ValidationFailure(`auth_resolver_status_${diag.resolveStatus}`, diag);
    }

    await Promise.race([navigationPromise, panelPromise]);
    diag.url = page.url();

    if (!/admin\.html/i.test(diag.url)) {
        const authState = await page.evaluate(async () => {
            const cfg = await import("/firebase-config.js");
            const auth = await cfg.getAuthInstance();
            return { signedIn: Boolean(auth.currentUser) };
        }).catch(() => ({ signedIn: false }));

        if (!authState.signedIn) {
            throw new ValidationFailure("firebase_sign_in_failed", diag);
        }
        throw new ValidationFailure("admin_panel_not_reached", diag);
    }

    await panelPromise;

    const authState = await page.evaluate(async () => {
        const cfg = await import("/firebase-config.js");
        const auth = await cfg.getAuthInstance();
        return { signedIn: Boolean(auth.currentUser) };
    });
    if (!authState.signedIn) {
        throw new ValidationFailure("firebase_sign_in_failed", diag);
    }

    const slug = new URL(page.url()).searchParams.get("dukkan");
    if (expectedSlug && slug !== expectedSlug) {
        throw new ValidationFailure(`unexpected_slug_${slug ?? "none"}`, { ...diag, slug });
    }

    return diag;
}

async function performSuperAdminLogin(page, creds) {
    const diag = {
        stage: "super_admin_login",
        username: creds.username,
        url: "",
        resolveStatus: null,
        resolveError: null,
        listBusinessesStatus: null,
        visibleError: null
    };

    await page.goto(`${BASE_URL}/super-admin.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#saUsername").waitFor({ state: "visible" });
    await page.locator("#saPassword").waitFor({ state: "visible" });
    if (!(await page.locator("#saLoginBtn").isEnabled())) {
        throw new ValidationFailure("submit_disabled", diag);
    }

    await page.fill("#saUsername", creds.username);
    await page.fill("#saPassword", creds.password);

    const resolvePromise = waitForApiResponse(page, "/api/resolve-auth-identifier").then(async (resp) => {
        diag.resolveStatus = resp.status();
        try {
            const body = await resp.json();
            diag.resolveError = body?.error || null;
        } catch {
            /* ignore */
        }
    }).catch(() => {
        diag.resolveStatus = diag.resolveStatus ?? "missing";
    });

    const listBusinessesPromise = waitForApiResponse(page, "/api/list-businesses").then(async (resp) => {
        diag.listBusinessesStatus = resp.status();
    }).catch(() => {
        diag.listBusinessesStatus = diag.listBusinessesStatus ?? "missing";
    });

    await Promise.all([
        resolvePromise.catch(() => null),
        page.locator("#saLoginForm").evaluate((form) => form.requestSubmit())
    ]);

    await page.waitForSelector("#saLoginScreen[hidden]", { timeout: 45000 }).catch(async () => {
        const loginErrorVisible = await page.evaluate(() => {
            const el = document.getElementById("saLoginError");
            return Boolean(el && el.classList.contains("show") && el.textContent.trim());
        });
        if (loginErrorVisible) {
            diag.visibleError = await readVisibleLoginError(page, "#saLoginError");
        }
        diag.url = page.url();
        if (diag.visibleError) {
            throw new ValidationFailure(
                diag.resolveStatus === 404 ? "invalid_credential" : "super_admin_login_failed",
                diag
            );
        }
        throw new ValidationFailure("super_admin_panel_not_shown", diag);
    });

    await listBusinessesPromise;
    await page.waitForSelector(".sad-shop-card", { timeout: 45000 });
    diag.url = page.url();

    if (diag.resolveStatus === 404) {
        throw new ValidationFailure("auth_resolver_failed", diag);
    }
    if (typeof diag.resolveStatus === "number" && diag.resolveStatus !== 200) {
        throw new ValidationFailure(`auth_resolver_status_${diag.resolveStatus}`, diag);
    }
    if (diag.listBusinessesStatus !== 200) {
        throw new ValidationFailure(`list_businesses_status_${diag.listBusinessesStatus ?? "missing"}`, diag);
    }

    return diag;
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
    attachPageDiagnostics(page, consoleErrors);
    trackFirestoreListQueries(page, firestoreQueries);

    await performSuperAdminLogin(page, creds);

    const authState = await getFirebaseAuthState(page);
    if (!authState.signedIn) throw new ValidationFailure("super_admin_not_signed_in", { stage: "auth_check" });
    if (!authState.hasToken) throw new ValidationFailure("super_admin_missing_id_token", { stage: "auth_check" });
    if (!authState.hasSuperAdminClaim) throw new ValidationFailure("super_admin_missing_claim", { stage: "auth_check" });

    const bodyText = await page.locator("body").innerText();
    if (PERMISSION_MARKERS.some((m) => bodyText.includes(m))) {
        throw new ValidationFailure("super_admin_permission_marker_on_page", { stage: "panel_check" });
    }

    const names = await page.locator(".sad-shop-card__name").allInnerTexts();
    const slugs = await page.locator(".sad-shop-card__slug").allInnerTexts();
    const combined = [...names, ...slugs].join("\n").toLocaleLowerCase("tr");

    const count = await page.locator(".sad-shop-card").count();
    if (count !== 13) throw new ValidationFailure(`super_admin_business_count_${count}`, { stage: "panel_check", count });

    const hasXMen = /x-?men|x men/.test(combined);
    const hasAltinMakas = /altın makas|altin makas|altinmakas/.test(combined);
    if (!hasXMen) throw new ValidationFailure("super_admin_missing_x_men", { stage: "panel_check" });
    if (!hasAltinMakas) throw new ValidationFailure("super_admin_missing_altin_makas", { stage: "panel_check" });

    if (firestoreQueries.some((q) => q.includes("berberler"))) {
        throw new ValidationFailure("super_admin_direct_berberler_query", { stage: "network_check" });
    }
    if (consoleErrors.length) {
        throw new ValidationFailure("super_admin_console_permission_errors", { stage: "console_check" });
    }

    return { businessCount: count, listBusinessesStatus: 200, hasSuperAdminClaim: true };
}

async function smokeOwnerForbiddenApi(page, ownerCreds) {
    await performOwnerLogin(page, {
        username: ownerCreds.username,
        password: ownerCreds.password,
        expectedSlug: ownerCreds.expectedSlug
    });

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
        throw new ValidationFailure(`owner_list_businesses_expected_403_got_${status.status ?? status.reason}`, {
            stage: "owner_security_api",
            username: ownerCreds.username,
            httpStatus: status.status ?? null
        });
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
        throw new ValidationFailure(`storage_flags_bypass_status_${blockedStatus}`, {
            stage: "owner_security_storage",
            username: ownerCreds.username,
            httpStatus: blockedStatus
        });
    }

    return { ownerApiBlocked: true };
}

async function smokeOwnerCalendar(page, account) {
    const consoleErrors = [];
    attachPageDiagnostics(page, consoleErrors);

    await performOwnerLogin(page, account);
    consoleErrors.length = 0;

    await page.locator('.admin-tab[data-tab="calendar"]').click();
    const grid = page.locator("#calendarGrid");
    await grid.waitFor({ state: "visible", timeout: 45000 });
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
            throw new ValidationFailure(`calendar_permission_denied`, {
                stage: "calendar_load",
                username: account.username
            });
        }
    }

    if (consoleErrors.length) {
        throw new ValidationFailure("console_permission_errors", {
            stage: "calendar_console_check",
            username: account.username
        });
    }
    consoleErrors.length = 0;

    const otherSlug = account.expectedSlug === "x-men" ? "altinmakas" : "x-men";

    await page.evaluate((forgeSlug) => {
        localStorage.setItem("businessId", forgeSlug);
        localStorage.setItem("barberSlug", forgeSlug);
        sessionStorage.setItem("businessId", forgeSlug);
        sessionStorage.setItem("barberSlug", forgeSlug);
        sessionStorage.setItem("dukkan", forgeSlug);
    }, otherSlug);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#adminPanel:not([hidden])", { timeout: 45000 }).catch(() => null);
    const slugAfterStorageForge = new URL(page.url()).searchParams.get("dukkan");
    if (slugAfterStorageForge !== account.expectedSlug) {
        throw new ValidationFailure(`storage_forge_bypass_slug_${slugAfterStorageForge ?? "none"}`, {
            stage: "tenant_isolation_storage",
            username: account.username
        });
    }

    await page.goto(`${BASE_URL}/admin.html?dukkan=${encodeURIComponent(otherSlug)}`, {
        waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(3000);
    const afterSlug = new URL(page.url()).searchParams.get("dukkan");
    if (afterSlug !== account.expectedSlug) {
        throw new ValidationFailure(`cross_tenant_slug_changed_to_${afterSlug ?? "none"}`, {
            stage: "tenant_isolation_url",
            username: account.username
        });
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
        throw new ValidationFailure("logout_did_not_hide_admin_panel", {
            stage: "logout_check",
            username: account.username
        });
    }

    return { label: account.label, username: account.username, slug: account.expectedSlug };
}

async function smokePublicSlug(page, slug) {
    const consoleErrors = [];
    const network = { availabilityCalls: 0, appointmentQueries: 0 };

    attachPageDiagnostics(page, consoleErrors);

    page.on("request", (req) => {
        const url = req.url();
        if (url.includes("/api/public/availability")) network.availabilityCalls += 1;
        if (url.includes("firestore.googleapis.com") && url.includes("appointments")) {
            network.appointmentQueries += 1;
        }
    });

    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    const availabilityPromise = page.waitForResponse(
        (resp) => resp.url().includes("/api/public/availability") && resp.url().includes(`date=${date}`),
        { timeout: 45000 }
    );

    await page.goto(`${BASE_URL}/randevu.html?dukkan=${encodeURIComponent(slug)}`, {
        waitUntil: "domcontentloaded"
    });

    const availabilityResp = await availabilityPromise.catch(() => null);
    const httpStatus = availabilityResp?.status() ?? null;
    let body = null;
    if (availabilityResp) {
        try {
            body = await availabilityResp.json();
        } catch {
            body = null;
        }
    }

    await page.waitForTimeout(2000);

    if (httpStatus === 404) {
        throw new ValidationFailure("shop_not_found", { stage: "public_availability", slug, httpStatus });
    }
    if (typeof httpStatus === "number" && httpStatus >= 500) {
        throw new ValidationFailure("availability_server_error", { stage: "public_availability", slug, httpStatus });
    }
    if (httpStatus !== 200) {
        throw new ValidationFailure(`availability_status_${httpStatus ?? "missing"}`, {
            stage: "public_availability",
            slug,
            httpStatus
        });
    }

    if (!body || typeof body !== "object" || !Array.isArray(body.availableSlots)) {
        throw new ValidationFailure("availability_invalid_schema", { stage: "public_availability", slug });
    }

    const serialized = JSON.stringify(body).toLowerCase();
    if (/customername|phone|musteri|telefon|email/.test(serialized)) {
        throw new ValidationFailure("availability_response_contains_pii_keys", { stage: "public_availability", slug });
    }

    const bodyText = await page.locator("body").innerText();
    if (PERMISSION_MARKERS.some((m) => bodyText.includes(m))) {
        throw new ValidationFailure("permission_marker_on_page", { stage: "public_page", slug });
    }

    const slotsText = await page.locator("#slotsContainer").innerText().catch(() => "");
    if (/FirebaseError/.test(slotsText)) {
        throw new ValidationFailure("firebase_error_in_slots", { stage: "public_page", slug });
    }

    if (network.appointmentQueries > 0) {
        throw new ValidationFailure("direct_appointment_firestore_query", { stage: "public_network", slug });
    }
    if (network.availabilityCalls < 1) {
        throw new ValidationFailure("public_availability_api_not_called", { stage: "public_network", slug });
    }

    const slotCount = await page.locator("#slotsContainer .slot").count();
    const availabilityState = body.availableSlots.length > 0
        ? "has_slots"
        : body.isClosed
            ? "closed_day"
            : "valid_no_availability";

    const hasEmptyUi = /kapalı|müsait|uygun|saat|dolu|İşletme Bulunamadı/i.test(bodyText);
    if (
        slotCount < 1
        && availabilityState !== "valid_no_availability"
        && availabilityState !== "closed_day"
        && !hasEmptyUi
    ) {
        throw new ValidationFailure("frontend_render_error", {
            stage: "public_page",
            slug,
            availabilityState
        });
    }

    if (consoleErrors.length) {
        throw new ValidationFailure("console_errors", { stage: "public_console", slug });
    }

    return { slug, slotCount, availabilityCalls: network.availabilityCalls, availabilityState };
}

function formatCaseError(err) {
    if (err instanceof ValidationFailure) {
        return {
            error: err.code,
            stage: err.diag?.stage,
            username: err.diag?.username,
            url: err.diag?.url,
            httpStatus: err.diag?.httpStatus ?? err.diag?.resolveStatus ?? err.diag?.listBusinessesStatus ?? null,
            apiError: err.diag?.resolveError ?? null,
            visibleError: err.diag?.visibleError ?? null
        };
    }
    return { error: err?.message || String(err) };
}

async function runCase(name, fn) {
    try {
        const detail = await fn();
        return { ok: true, ...detail };
    } catch (err) {
        return { ok: false, ...formatCaseError(err) };
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
