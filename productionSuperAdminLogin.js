import { ensureAuthFoundationInitialized } from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";
import { shouldUseEmulatorAuthLogin } from "./legacyAuthCompat.js";
import { callPrivilegedApi } from "./privilegedApiClient.js";

export const PRODUCTION_SUPER_ADMIN_LOGIN_ERROR =
    "Giriş başarısız. Kullanıcı adı veya şifre hatalı.";

export const PRODUCTION_SUPER_ADMIN_FORBIDDEN_ERROR =
    "Bu hesap süper admin yetkisine sahip değil.";

export const PRODUCTION_SUPER_ADMIN_UNAVAILABLE_ERROR =
    "Giriş servisi kullanılamıyor. Lütfen daha sonra tekrar deneyin.";

/**
 * Production super-admin: username resolver → Firebase sign-in → claim doğrulama.
 * @param {string} username
 * @param {string} password
 */
export async function signInWithProductionSuperAdminAuth(username, password) {
    if (shouldUseEmulatorAuthLogin()) {
        throw new Error("production_super_admin_not_allowed_in_emulator_mode");
    }

    const response = await callPrivilegedApi(
        "resolveAuthIdentifier",
        { username, roleHint: "superAdmin" },
        { auth: false }
    );

    const authEmail = response?.authEmail;
    const role = response?.role;

    if (!authEmail || role !== "superAdmin") {
        throw new Error("production_super_admin_invalid_response");
    }

    await ensureAuthFoundationInitialized();

    const auth = await getAuthInstance();
    const { signInWithEmailAndPassword } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );

    await signInWithEmailAndPassword(auth, authEmail, password);

    if (!auth.currentUser) {
        throw new Error("production_super_admin_signin_failed");
    }

    const tokenResult = await auth.currentUser.getIdTokenResult(true);
    if (tokenResult.claims?.superAdmin !== true) {
        await auth.signOut();
        throw new Error("production_super_admin_missing_claim");
    }

    return { authEmail };
}
