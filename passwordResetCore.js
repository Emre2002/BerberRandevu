export class PasswordResetRequestError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export async function requestPasswordReset(rawEmail, sendPasswordReset) {
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new PasswordResetRequestError("invalid_email", "Geçerli bir e-posta adresi girin.");
    }
    try {
        await sendPasswordReset(email);
    } catch (error) {
        // Eski Firebase projelerinde hesap yokluğu hata dönebilir; bunu kullanıcıya açıklama.
        if (error?.code === "auth/user-not-found") return;
        if (error?.code === "auth/too-many-requests") {
            throw new PasswordResetRequestError("rate_limited", "Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.");
        }
        if (error?.code === "auth/network-request-failed") {
            throw new PasswordResetRequestError("network_error", "Bağlantı kurulamadı. İnternet erişiminizi kontrol edip tekrar deneyin.");
        }
        throw new PasswordResetRequestError("reset_unavailable", "Şifre belirleme isteği tamamlanamadı. Daha sonra tekrar deneyin.");
    }
}

export async function submitPasswordResetForm(form, sendPasswordReset) {
    const status = form.querySelector("[data-reset-status]");
    const button = form.querySelector('button[type="submit"]');
    const email = form.querySelector('[name="resetEmail"]')?.value || "";
    if (status) {
        status.textContent = "";
        status.dataset.state = "";
    }
    if (button) button.disabled = true;
    try {
        await requestPasswordReset(email, sendPasswordReset);
        if (status) {
            status.textContent = "İstek işlendi. Adres kayıtlıysa e-postanızı kontrol edin.";
            status.dataset.state = "success";
        }
    } catch (error) {
        if (status) {
            status.textContent = error instanceof PasswordResetRequestError
                ? error.message : "Şifre belirleme isteği tamamlanamadı. Daha sonra tekrar deneyin.";
            status.dataset.state = "error";
        }
    } finally {
        if (button) button.disabled = false;
    }
}
