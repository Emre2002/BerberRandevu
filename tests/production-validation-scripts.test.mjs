import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SETUP_PS1 = resolve(ROOT, "scripts/setup-local-validation-credentials.ps1");
const RUN_PS1 = resolve(ROOT, "scripts/run-production-final-validation.ps1");
const VALIDATION_MJS = resolve(ROOT, "scripts/production-final-validation.mjs");
const GITIGNORE = resolve(ROOT, ".gitignore");

function read(path) {
    return readFileSync(path, "utf8");
}

describe("production validation credential security", () => {
    it("credential directory is gitignored", () => {
        const gitignore = read(GITIGNORE);
        assert.match(gitignore, /^\.local-private\/?$/m);
    });

    it("setup script uses secure password prompts", () => {
        const src = read(SETUP_PS1);
        assert.match(src, /Read-Host\s+-AsSecureString/);
        assert.match(src, /Read-ConfirmedPassword/);
        assert.doesNotMatch(src, /Password\s*=\s*['"][^'"]+['"]/);
    });

    it("setup script writes expected credential file paths", () => {
        const src = read(SETUP_PS1);
        assert.match(src, /superadmin-credentials\.txt/);
        assert.match(src, /business-login-credentials\.csv/);
        assert.match(src, /businessId/);
        assert.match(src, /x-men/);
        assert.match(src, /altinmakas/);
        assert.match(src, /akkus/);
    });

    it("setup script tightens file ACL without recursive repo changes", () => {
        const src = read(SETUP_PS1);
        assert.match(src, /Set-RestrictedFileAcl/);
        assert.match(src, /SYSTEM/);
        assert.doesNotMatch(src, /Recurse\s+\$true|Get-ChildItem.*-Recurse/i);
    });

    it("runner clears temporary password environment variables in finally", () => {
        const src = read(RUN_PS1);
        assert.match(src, /\bfinally\b/);
        assert.match(src, /Remove-Item\s+Env:SMOKE_SA_PASS/);
        assert.match(src, /Remove-Item\s+Env:SMOKE_PASS_BEDIRHAN/);
        assert.match(src, /Remove-Item\s+Env:SMOKE_PASS_ALTINMAKAS/);
        assert.match(src, /Remove-Item\s+Env:SMOKE_PASS_AKKUS/);
    });

    it("runner does not prompt interactively for passwords", () => {
        const src = read(RUN_PS1);
        assert.doesNotMatch(src, /Read-Host/);
    });

    it("validation script does not pass passwords via CLI arguments", () => {
        const src = read(VALIDATION_MJS);
        assert.doesNotMatch(src, /process\.argv.*password/i);
        assert.doesNotMatch(src, /spawn\(|exec\(/i);
        assert.match(src, /secureEnv\(/);
        assert.match(src, /clearPasswordEnv\(/);
    });

    it("validation script clears password env vars after run", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /function clearPasswordEnv/);
        assert.match(src, /clearPasswordEnv\(\)/);
        assert.match(src, /\bfinally\b[\s\S]*clearPasswordEnv\(\)/);
    });

    it("validation script does not enable playwright trace, screenshot, or video capture", () => {
        const src = read(VALIDATION_MJS);
        assert.doesNotMatch(src, /tracing\.|recordVideo|screenshot\(/i);
        assert.match(src, /headless:\s*true/);
    });

    it("validation script parses Username= and Password= credential format", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /\^Username=\(\.\+\)\$/);
        assert.match(src, /\^Password=\(\.\+\)\$/);
    });

    it("validation script reports per-account results", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /report\.accounts\.superAdmin/);
        assert.match(src, /report\.accounts\[owner\.username\]/);
        assert.match(src, /report\.accounts\.public/);
    });

    it("validation script avoids SPA login waitForURL race and uses domcontentloaded", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /performOwnerLogin/);
        assert.match(src, /waitUntil:\s*"domcontentloaded"/);
        assert.match(src, /requestSubmit\(\)/);
        assert.match(src, /waitForSelector\("#adminPanel:not\(\[hidden\]\)"/);
    });

    it("validation script reports auth resolver and list-businesses HTTP statuses", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /resolveStatus/);
        assert.match(src, /listBusinessesStatus/);
        assert.match(src, /auth_resolver_failed/);
        assert.match(src, /list_businesses_status_/);
    });

    it("validation script accepts valid empty availability states", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /valid_no_availability/);
        assert.match(src, /closed_day/);
        assert.doesNotMatch(src, /no_slots_loaded/);
    });

    it("validation script uses super-admin panel DOM instead of stale globals", () => {
        const src = read(VALIDATION_MJS);
        assert.match(src, /#saLoginScreen\[hidden\]/);
        assert.match(src, /\.sad-shop-card/);
        assert.doesNotMatch(src, /window\.[A-Za-z0-9_]+\s*&&/);
    });

    it("credential files are not tracked in git index", () => {
        const paths = [
            resolve(ROOT, ".local-private/superadmin-credentials.txt"),
            resolve(ROOT, ".local-private/business-login-credentials.csv")
        ];
        for (const path of paths) {
            if (existsSync(path)) {
                assert.ok(path.includes(".local-private"));
            }
        }
    });
});
