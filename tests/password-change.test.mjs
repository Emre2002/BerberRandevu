import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    changePasswordWithAuth, PasswordChangeError, submitPasswordChangeForm
} from "../passwordChangeCore.js";

const values = {
    user: { uid: "owner-1", email: "owner@example.test" },
    currentPassword: "OldPassword123", newPassword: "NewPassword123",
    confirmPassword: "NewPassword123"
};

function authMock(failure = null) {
    const calls = [];
    return {
        calls,
        credential: (email, password) => ({ email, password }),
        reauthenticate: async (_user, credential) => {
            calls.push("reauthenticate");
            assert.equal(credential.email, values.user.email);
            assert.equal(credential.password, values.currentPassword);
            if (failure?.phase === "reauthenticate") throw { code: failure.code };
        },
        updatePassword: async (_user, password) => {
            calls.push("updatePassword");
            assert.equal(password, values.newPassword);
            if (failure?.phase === "updatePassword") throw { code: failure.code };
        }
    };
}

function formMock() {
    const status = { textContent: "", dataset: {} };
    const button = { disabled: false };
    const inputs = {
        currentPassword: { value: values.currentPassword },
        newPassword: { value: values.newPassword },
        confirmPassword: { value: values.confirmPassword }
    };
    return {
        status, button, inputs,
        form: {
            querySelector(selector) {
                if (selector === "[data-password-status]") return status;
                if (selector === 'button[type="submit"]') return button;
                const name = /\[name="([^"]+)"\]/.exec(selector)?.[1];
                return inputs[name] || null;
            },
            reset() {
                for (const field of Object.values(inputs)) field.value = "";
            }
        }
    };
}

describe("current-user password change", () => {
    it("reauthenticates with the current password before updating Firebase Auth", async () => {
        const auth = authMock();
        await changePasswordWithAuth(values, auth);
        assert.deepEqual(auth.calls, ["reauthenticate", "updatePassword"]);
    });

    it("rejects a wrong current password without updating", async () => {
        const auth = authMock({ phase: "reauthenticate", code: "auth/wrong-password" });
        await assert.rejects(changePasswordWithAuth(values, auth),
            (error) => error instanceof PasswordChangeError && /Mevcut şifre yanlış/.test(error.message));
        assert.deepEqual(auth.calls, ["reauthenticate"]);
    });

    it("rejects weak and mismatched new passwords before any Auth call", async () => {
        const auth = authMock();
        await assert.rejects(changePasswordWithAuth({ ...values, newPassword: "short" }, auth),
            (error) => error.code === "weak_password");
        await assert.rejects(changePasswordWithAuth({ ...values, confirmPassword: "different" }, auth),
            (error) => error.code === "password_mismatch");
        assert.deepEqual(auth.calls, []);
    });

    it("shows a useful message for Auth recent-login and network failures", async () => {
        for (const [code, message] of [
            ["auth/requires-recent-login", /Oturumunuzu yenileyip/],
            ["auth/network-request-failed", /Ağ bağlantısı/]
        ]) {
            const auth = authMock({ phase: "updatePassword", code });
            await assert.rejects(changePasswordWithAuth(values, auth),
                (error) => message.test(error.message));
        }
    });

    it("never reports success after failure and clears entered passwords", async () => {
        const { form, status, button, inputs } = formMock();
        await submitPasswordChangeForm(form, async () => {
            throw new PasswordChangeError("auth_error", "Şifre değiştirilemedi.");
        });
        assert.equal(status.dataset.state, "error");
        assert.doesNotMatch(status.textContent, /değiştirildi/);
        assert.equal(button.disabled, false);
        assert.ok(Object.values(inputs).every((field) => field.value === ""));
    });

    it("reports success only after Auth update and clears the form", async () => {
        const { form, status, inputs } = formMock();
        const auth = authMock();
        await submitPasswordChangeForm(form, (data) => changePasswordWithAuth({ ...values, ...data }, auth));
        assert.equal(status.dataset.state, "success");
        assert.deepEqual(auth.calls, ["reauthenticate", "updatePassword"]);
        assert.ok(Object.values(inputs).every((field) => field.value === ""));
    });

    it("does not write or log passwords, and leaves existing login code in place", () => {
        const core = readFileSync(resolve("passwordChangeCore.js"), "utf8");
        const ui = readFileSync(resolve("passwordChangeUI.js"), "utf8");
        const login = readFileSync(resolve("productionAuthLogin.js"), "utf8");
        const ownerPage = readFileSync(resolve("admin.html"), "utf8");
        const ownerEntry = readFileSync(resolve("admin-auth.js"), "utf8");
        const superAdminPanel = readFileSync(resolve("super-admin-panel.js"), "utf8");
        const updateRoute = readFileSync(resolve("api/update-business.js"), "utf8");
        assert.doesNotMatch(core + ui, /setDoc|updateDoc|localStorage|console\.|URLSearchParams/);
        assert.match(ui, /reauthenticateWithCredential/);
        assert.match(ui, /updatePassword/);
        assert.match(login, /signInWithEmailAndPassword/);
        assert.match(ownerPage, /id="ownerPasswordChangeForm"/);
        assert.match(ownerEntry, /bindPasswordChangeForm\(document\.getElementById\("ownerPasswordChangeForm"\)\)/);
        assert.match(superAdminPanel, /bindPasswordChangeForm\(document\.getElementById\("superAdminPasswordChangeForm"\)\)/);
        assert.doesNotMatch(superAdminPanel, /id="editPassword"/);
        assert.match(updateRoute, /password_update_not_allowed/);
    });
});
