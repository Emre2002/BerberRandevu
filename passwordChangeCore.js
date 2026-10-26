export class PasswordChangeError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function passwordChangeErrorMessage(error) {
    switch (error?.code) {
        case "auth/wrong-password":
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials":
            return "Mevcut şifre yanlış. Lütfen tekrar deneyin.";
        case "auth/weak-password":
            return "Yeni şifre yeterince güçlü değil.";
        case "auth/requires-recent-login":
            return "Oturumunuzu yenileyip tekrar deneyin.";
        case "auth/network-request-failed":
        case "auth/unavailable":
            return "Ağ bağlantısı nedeniyle şifre değiştirilemedi. Tekrar deneyin.";
        case "auth/too-many-requests":
            return "Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.";
        default:
            return "Şifre değiştirilemedi. Lütfen tekrar deneyin.";
    }
}

export async function changePasswordWithAuth(
    { user, currentPassword, newPassword, confirmPassword },
    { credential, reauthenticate, updatePassword, isCurrentUser = () => true }
) {
    if (!user?.email) {
        throw new PasswordChangeError("auth_required", "Oturum bulunamadı. Yeniden giriş yapın.");
    }
    if (!currentPassword) {
        throw new PasswordChangeError("current_password_required", "Mevcut şifrenizi girin.");
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
        throw new PasswordChangeError("weak_password", "Yeni şifre en az 8 karakter olmalıdır.");
    }
    if (newPassword !== confirmPassword) {
        throw new PasswordChangeError("password_mismatch", "Yeni şifreler eşleşmiyor.");
    }
    if (newPassword === currentPassword) {
        throw new PasswordChangeError("password_unchanged", "Yeni şifre mevcut şifreden farklı olmalıdır.");
    }

    try {
        await reauthenticate(user, credential(user.email, currentPassword));
        if (!isCurrentUser(user)) {
            throw new PasswordChangeError("auth_required", "Oturum değişti. Yeniden giriş yapın.");
        }
        await updatePassword(user, newPassword);
    } catch (error) {
        if (error instanceof PasswordChangeError) throw error;
        throw new PasswordChangeError(error?.code || "auth_error", passwordChangeErrorMessage(error));
    }
}

export async function submitPasswordChangeForm(form, changePassword) {
    const status = form.querySelector("[data-password-status]");
    const button = form.querySelector('button[type="submit"]');
    const currentPassword = form.querySelector('[name="currentPassword"]')?.value || "";
    const newPassword = form.querySelector('[name="newPassword"]')?.value || "";
    const confirmPassword = form.querySelector('[name="confirmPassword"]')?.value || "";

    if (status) {
        status.textContent = "";
        status.dataset.state = "";
    }
    if (button) button.disabled = true;
    try {
        await changePassword({ currentPassword, newPassword, confirmPassword });
        if (status) {
            status.textContent = "Şifreniz değiştirildi.";
            status.dataset.state = "success";
        }
    } catch (error) {
        if (status) {
            status.textContent = error instanceof PasswordChangeError
                ? error.message : passwordChangeErrorMessage(error);
            status.dataset.state = "error";
        }
    } finally {
        form.reset();
        if (button) button.disabled = false;
    }
}
