import { ensureAuthFoundationInitialized } from "./authService.js";
import { getAuthInstance, getResolveAuthIdentifierCallable } from "./firebase-config.js";
import { shouldUseEmulatorAuthLogin } from "./legacyAuthCompat.js";

export { shouldUseEmulatorAuthLogin };

/** Emulator sign-in hatası — generic; kullanıcı varlığı sızdırmaz. */
export const EMULATOR_AUTH_LOGIN_ERROR =
    "Emulator girişi başarısız. Kullanıcı adı, şifre ve Auth Emulator hesabını kontrol edin.";

export const EMULATOR_AUTH_UNAVAILABLE_ERROR =
    "Emulator giriş servisi kullanılamıyor. Functions/Auth emulator çalışıyor mu?";

/**
 * Development-only: username → CF resolver → signInWithEmailAndPassword.
 * Client sentetik e-posta üretmez; password CF'ye gönderilmez.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ businessId: string }>}
 */
export async function signInWithEmulatorAuth(username, password) {
    if (!shouldUseEmulatorAuthLogin()) {
        throw new Error("emulator_auth_not_allowed");
    }

    const callable = await getResolveAuthIdentifierCallable();
    if (!callable) {
        throw new Error("emulator_auth_callable_unavailable");
    }

    const response = await callable({ username });
    const authEmail = response?.data?.authEmail;
    const businessId = response?.data?.businessId;

    if (!authEmail || !businessId) {
        throw new Error("emulator_auth_invalid_response");
    }

    // Persistence + emulator listener sign-in'den ÖNCE kurulmalı; aksi halde oturum kalıcı olmaz.
    await ensureAuthFoundationInitialized();

    const auth = await getAuthInstance();
    const { signInWithEmailAndPassword } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
    );

    await signInWithEmailAndPassword(auth, authEmail, password);

    if (!auth.currentUser) {
        throw new Error("emulator_auth_signin_failed");
    }

    return { businessId };
}
