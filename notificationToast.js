function safeNotificationUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;

    try {
        const url = new URL(rawUrl, window.location.href);
        return ["http:", "https:"].includes(url.protocol) && url.origin === window.location.origin
            ? url.href
            : null;
    } catch {
        return null;
    }
}

export function showLiveNotificationToast(container, data) {
    if (!container) return;

    const el = document.createElement("div");
    el.className = "live-notif";

    const icon = document.createElement("div");
    icon.className = "live-notif__icon";
    icon.textContent = "🔔";

    const body = document.createElement("div");
    body.className = "live-notif__body";

    const title = document.createElement("strong");
    title.textContent = "Yeni Randevu";

    const safeUrl = safeNotificationUrl(data?.url);
    const customer = document.createElement(safeUrl ? "a" : "div");
    customer.textContent = data?.customerName || "Müşteri";
    if (safeUrl) {
        customer.href = safeUrl;
        customer.style.pointerEvents = "auto";
    }

    const time = document.createElement("div");
    time.className = "live-notif__time";
    time.textContent = `${data?.time || "—"} · ${data?.date || ""}`;

    body.append(title, customer, time);
    el.append(icon, body);
    container.prepend(el);
    setTimeout(() => el.classList.add("live-notif--show"), 10);
    setTimeout(() => {
        el.classList.remove("live-notif--show");
        setTimeout(() => el.remove(), 300);
    }, 6000);
}
