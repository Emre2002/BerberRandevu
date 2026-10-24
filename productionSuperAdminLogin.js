import { ensureAuthFoundationInitialized } from "./authService.js";
import { getAuthInstance } from "./firebase-config.js";
import { shouldUseEmulatorAuthLogin } from "./legacyAuthCompat.js";
import { signInSuperAdminEmail } from "./superAdminEmailLoginCore.js";

export const PRODUCTION_SUPER_ADMIN_LOGIN_ERROR =
    "Giriş başarısız. E-posta veya şifre hatalı.";

export const PRODUCTION_SUPER_ADMIN_FORBIDDEN_ERROR =
    "Bu hesap süper admin yetkisine sahip değil.";

export const PRODUCTION_SUPER_ADMIN_UNAVAILABLE_ERROR =
    "Giriş servisi kullanılamıyor. Lütfen daha sonra tekrar deneyin.";

/**
 * Super-admin: direct Firebase email sign-in, followed by a refreshed claim check.
 * @param {string} email
 * @param {string} password
 */
export async function signInWithSuperAdminEmailAuth(email, password) {
    if (shouldUseEmulatorAuthLogin()) {
        throw new Error("production_super_admin_not_allowed_in_emulator_mode");
    }

    await ensureAuthFoundationInitialized();

    const auth = await getAuthInstance();
    const { signInWithEmailAndPassword, signOut } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );
    return signInSuperAdminEmail(email, password, {
        signIn: async (address, secret) => (await signInWithEmailAndPassword(auth, address, secret)).user,
        signOut: () => signOut(auth)
    });
}
