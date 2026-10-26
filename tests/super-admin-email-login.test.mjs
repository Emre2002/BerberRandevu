import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { signInSuperAdminEmail } from "../superAdminEmailLoginCore.js";
import resolveAuthHandler from "../api/resolve-auth-identifier.js";

describe("Superadmin email login", () => {
    it("signs in by email and requires a refreshed Superadmin claim", async () => {
        let received;
        const result = await signInSuperAdminEmail("admin@example.test", "test-password", {
            signIn: async (email, password) => {
                received = { email, password };
                return { getIdTokenResult: async (forceRefresh) => {
                    assert.equal(forceRefresh, true);
                    return { claims: { superAdmin: true } };
                } };
            },
            signOut: async () => assert.fail("authorized user was signed out")
        });
        assert.deepEqual(received, { email: "admin@example.test", password: "test-password" });
        assert.deepEqual(result, { email: "admin@example.test" });
    });

    it("rejects usernames before any Auth call", async () => {
        let called = false;
        await assert.rejects(signInSuperAdminEmail("testsuperadmin", "test-password", {
            signIn: async () => { called = true; }, signOut: async () => {}
        }), /super_admin_invalid_credentials/);
        assert.equal(called, false);
    });

    it("signs out accounts without the claim", async () => {
        let signedOut = false;
        await assert.rejects(signInSuperAdminEmail("admin@example.test", "test-password", {
            signIn: async () => ({ getIdTokenResult: async () => ({ claims: {} }) }),
            signOut: async () => { signedOut = true; }
        }), /super_admin_missing_claim/);
        assert.equal(signedOut, true);
    });

    it("does not leave an Auth session on token errors", async () => {
        let signedOut = false;
        await assert.rejects(signInSuperAdminEmail("admin@example.test", "test-password", {
            signIn: async () => ({ getIdTokenResult: async () => { throw new Error("token unavailable"); } }),
            signOut: async () => { signedOut = true; }
        }), /super_admin_claim_unavailable/);
        assert.equal(signedOut, true);
    });

    it("anonymous resolver refuses Superadmin username lookup without a database read", async () => {
        const req = Readable.from([JSON.stringify({ username: "testsuperadmin", roleHint: "superAdmin" })]);
        req.method = "POST";
        req.headers = {};
        req.socket = { remoteAddress: "127.0.0.1" };
        const headers = {};
        let response;
        const res = {
            statusCode: 200,
            setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
            end: (body) => { response = JSON.parse(body); }
        };
        await resolveAuthHandler(req, res);
        assert.equal(res.statusCode, 404);
        assert.equal(response.error, "auth_failed");
        assert.equal(response.authEmail, undefined);
        assert.match(headers["content-type"], /application\/json/);
    });

    it("published pages route owners and Superadmins to their distinct login screens", () => {
        const root = resolve(import.meta.dirname, "..");
        const superAdminHtml = readFileSync(resolve(root, "super-admin.html"), "utf8");
        const ownerHtml = readFileSync(resolve(root, "giris.html"), "utf8");
        const loginSource = readFileSync(resolve(root, "productionSuperAdminLogin.js"), "utf8");
        assert.match(superAdminHtml, /E-posta \(yerel emulatörde kullanıcı adı\)/);
        assert.match(ownerHtml, /href="super-admin.html"/);
        assert.doesNotMatch(loginSource, /resolveAuthIdentifier/);
    });
});
