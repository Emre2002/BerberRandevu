import { ensureAuthFoundationInitialized } from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";
import { shouldUseEmulatorAuthLogin } from "./legacyAuthCompat.js";
import { resolveProductionAuthIdentifier } from "./privilegedApiClient.js";

export const PRODUCTION_AUTH_LOGIN_ERROR =
    "Giriş başarısız. Kullanıcı adı veya şifre hatalı.";

export const PRODUCTION_AUTH_UNAVAILABLE_ERROR =
    "Giriş servisi kullanılamıyor. Lütfen daha sonra tekrar deneyin.";

/**
 * Production: username → Vercel API resolver → signInWithEmailAndPassword.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ businessId: string }>}
 */
export async function signInWithProductionOwnerAuth(username, password) {
    if (shouldUseEmulatorAuthLogin()) {
        throw new Error("production_auth_not_allowed_in_emulator_mode");
    }

    const response = await resolveProductionAuthIdentifier(username);
    const authEmail = response?.authEmail;
    const businessId = response?.businessId;
    const role = response?.role;

    if (!authEmail || role !== "owner" || !businessId) {
        throw new Error("production_auth_invalid_response");
    }

    await ensureAuthFoundationInitialized();

    const auth = await getAuthInstance();
    const { signInWithEmailAndPassword } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );

    await signInWithEmailAndPassword(auth, authEmail, password);

    if (!auth.currentUser) {
        throw new Error("production_auth_signin_failed");
    }

    return { businessId };
}
