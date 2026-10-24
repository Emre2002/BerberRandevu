import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requestPasswordReset, submitPasswordResetForm } from "../passwordResetCore.js";
import { signInEmailOwner } from "../emailOwnerLoginCore.js";

function formMock(email = "owner@example.test") {
    const status = { textContent: "", dataset: {} };
    const button = { disabled: false };
    return {
        status, button,
        form: {
            querySelector(selector) {
                if (selector === "[data-reset-status]") return status;
                if (selector === 'button[type="submit"]') return button;
                if (selector === '[name="resetEmail"]') return { value: email };
                return null;
            }
        }
    };
}

describe("email-based password setup", () => {
    it("calls Firebase reset only for a valid normalized email", async () => {
        const addresses = [];
        await requestPasswordReset(" Owner@Example.Test ", async (email) => addresses.push(email));
        assert.deepEqual(addresses, ["owner@example.test"]);
        await assert.rejects(requestPasswordReset("invalid-address", async () => addresses.push("unexpected")),
            (error) => error.code === "invalid_email");
        assert.equal(addresses.length, 1);
    });

    it("does not reveal whether an account exists", async () => {
        const normal = formMock();
        const unknown = formMock();
        await submitPasswordResetForm(normal.form, async () => {});
        await submitPasswordResetForm(unknown.form, async () => {
            throw { code: "auth/user-not-found" };
        });
        assert.equal(normal.status.textContent, unknown.status.textContent);
        assert.doesNotMatch(normal.status.textContent, /gönderildi/i);
    });

    it("does not report success when Firebase rejects a network or rate-limit request", async () => {
        for (const code of ["auth/network-request-failed", "auth/too-many-requests", "auth/internal-error"]) {
            const { form, status, button } = formMock();
            await submitPasswordResetForm(form, async () => { throw { code }; });
            assert.equal(status.dataset.state, "error");
            assert.doesNotMatch(status.textContent, /İstek işlendi/);
            assert.equal(button.disabled, false);
        }
    });

    it("uses the configured Auth instance without email or secret URL parameters", () => {
        const login = readFileSync(resolve("giris.js"), "utf8");
        const page = readFileSync(resolve("giris.html"), "utf8");
        const approval = readFileSync(resolve("pendingBarbersPanel.js"), "utf8");
        assert.match(login, /sendPasswordResetEmail\(auth, email\)/);
        assert.match(login, /getAuthInstance\(\)/);
        assert.match(login, /signInWithProductionOwnerAuth/);
        assert.match(login, /signInWithEmailOwnerAuth/);
        assert.match(page, /id="passwordResetForm"/);
        assert.match(page, /aria-live="polite"/);
        assert.match(approval, /Kullanıcı, kayıtlı e-posta adresiyle giriş ekranındaki Şifre Belirle seçeneğini kullanabilir/);
        assert.doesNotMatch(approval, /showOneTimeCredential|result\.password/);
    });

    it("signs in with email and requires an active matching owner membership", async () => {
        const calls = [];
        const result = await signInEmailOwner(" Owner@Example.Test ", "test-secret", {
            signIn: async (email) => { calls.push(email); return { uid: "owner-1" }; },
            fetchMembership: async () => ({ uid: "owner-1", role: "owner", status: "active", businessId: "shop-1" }),
            signOut: async () => { calls.push("sign-out"); }
        });
        assert.deepEqual(result, { businessId: "shop-1" });
        assert.deepEqual(calls, ["owner@example.test"]);
    });

    it("rejects an email login without owner membership and signs out", async () => {
        let signedOut = false;
        await assert.rejects(signInEmailOwner("owner@example.test", "test-secret", {
            signIn: async () => ({ uid: "owner-1" }),
            fetchMembership: async () => ({ uid: "different", role: "owner", status: "active", businessId: "shop-1" }),
            signOut: async () => { signedOut = true; }
        }), /email_owner_membership_required/);
        assert.equal(signedOut, true);
    });
});
