import { fetchBarber } from "./firestoreService.js";
import {
    getSubscriptionState,
    activateSubscriptionCode,
    getAdminCalendarLockMessage,
    isSubscriptionWarningDue,
    isSubscriptionWarningDismissed,
    dismissSubscriptionWarning,
    SHOPIER_URL
} from "./subscriptionService.js";

let warningModalOpen = false;

function openSubscriptionTabWithFocus() {
    document.querySelector('.admin-tab[data-tab="subscription"]')?.click();
    setTimeout(() => {
        document.getElementById("activationCodeInput")?.focus({ preventScroll: true });
    }, 80);
}

function setBodyScrollLocked(locked) {
    document.body.style.overflow = locked ? "hidden" : "";
}

function closeWarningModal() {
    const overlay = document.getElementById("subWarningModal");
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.remove("open");
    warningModalOpen = false;
    setBodyScrollLocked(false);
}

function showWarningModal(remainingDays) {
    const overlay = document.getElementById("subWarningModal");
    const daysEl = document.getElementById("subWarningDays");
    if (!overlay || warningModalOpen) return;

    if (daysEl) daysEl.textContent = String(remainingDays);
    overlay.hidden = false;
    overlay.classList.add("open");
    warningModalOpen = true;
    setBodyScrollLocked(true);
}

function bindWarningModal(barberSlug, barberData) {
    const overlay = document.getElementById("subWarningModal");
    if (!overlay) return;

    overlay.querySelector("#subWarningClose")?.addEventListener("click", closeWarningModal);
    overlay.querySelector("#subWarningLater")?.addEventListener("click", closeWarningModal);
    overlay.querySelector("#subWarningNever")?.addEventListener("click", () => {
        dismissSubscriptionWarning(barberSlug, barberData?.subscriptionEndDate);
        closeWarningModal();
    });
    overlay.querySelector("#subWarningActivate")?.addEventListener("click", () => {
        closeWarningModal();
        openSubscriptionTabWithFocus();
    });
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeWarningModal();
    });
}

export function maybeShowSubscriptionWarning(barberSlug, barberData) {
    if (!barberSlug || !barberData) return;
    if (!isSubscriptionWarningDue(barberData)) return;
    if (isSubscriptionWarningDismissed(barberSlug, barberData.subscriptionEndDate)) return;

    const state = getSubscriptionState(barberData);
    const days = state.remainingDays ?? 0;
    showWarningModal(days >= 0 ? days : 0);
}

function renderTopbar(state) {
    const topbar = document.getElementById("adminSubTopbar");
    if (!topbar) return;

    topbar.hidden = false;
    const statusEl = topbar.querySelector("#subTopStatus");
    const endEl = topbar.querySelector("#subTopEnd");
    const remainEl = topbar.querySelector("#subTopRemaining");
    const badgeEl = topbar.querySelector("#subTopBadge");

    if (statusEl) statusEl.textContent = state.label;
    if (endEl) endEl.textContent = state.endDateFormatted;
    if (remainEl) {
        remainEl.textContent = state.remainingDays === null
            ? "—"
            : `${state.remainingDays < 0 ? 0 : state.remainingDays} gün`;
    }
    if (badgeEl) {
        badgeEl.className = `sub-badge sub-badge--${state.tone}`;
        badgeEl.textContent = state.label;
    }
}

/**
 * Berber admin paneli — Abonelik / Kod Etkinleştir bölümü.
 * @param {string} barberSlug
 * @param {(msg: string, type?: string) => void} showToast
 * @param {{ onActivated?: (barber: object) => void, initialBarber?: object }} opts
 */
export function initSubscriptionAdmin(barberSlug, showToast, opts = {}) {
    const panel = document.querySelector('[data-panel="subscription"]');
    if (!panel || !barberSlug) return { refresh: () => {} };

    const el = {
        status: panel.querySelector("#subStatus"),
        endDate: panel.querySelector("#subEndDate"),
        remaining: panel.querySelector("#subRemaining"),
        badge: panel.querySelector("#subBadge"),
        alert: panel.querySelector("#subAlert"),
        codeInput: panel.querySelector("#activationCodeInput"),
        activateBtn: panel.querySelector("#btnActivateCode"),
        lockMsg: panel.querySelector("#subLockMessage")
    };

    let barberData = opts.initialBarber ? { ...opts.initialBarber } : null;

    function render(state) {
        if (el.status) el.status.textContent = state.label;
        if (el.endDate) el.endDate.textContent = state.endDateFormatted;
        if (el.remaining) {
            el.remaining.textContent = state.remainingDays === null
                ? "—"
                : `${state.remainingDays < 0 ? 0 : state.remainingDays} gün`;
        }
        if (el.badge) {
            el.badge.className = `sub-badge sub-badge--${state.tone}`;
            el.badge.textContent = state.label;
        }
        if (el.alert) {
            el.alert.hidden = state.tone === "green";
            el.alert.className = `sub-alert sub-alert--${state.tone}`;
            if (state.remainingDays !== null && state.remainingDays >= 0 && state.remainingDays <= 30) {
                el.alert.textContent = state.remainingDays <= 7
                    ? `⚠️ Aboneliğinizin bitmesine ${state.remainingDays} gün kaldı. Yenilemek için kod etkinleştirin.`
                    : `Aboneliğinizin bitmesine ${state.remainingDays} gün kaldı.`;
            } else if (state.tone === "locked" || state.tone === "darkred") {
                el.alert.textContent = getAdminCalendarLockMessage();
            } else if (state.remainingDays !== null && state.remainingDays < 0) {
                el.alert.textContent = "Abonelik süreniz doldu. Müşteri randevu sayfası kısa süre içinde kapanacak veya kapandı.";
            }
        }
        renderTopbar(state);
    }

    function applyBarberData(data) {
        if (!data) return null;
        barberData = { slug: barberSlug, ...data };
        const state = getSubscriptionState(barberData);
        render(state);
        return barberData;
    }

    async function refresh() {
        const fetched = await fetchBarber(barberSlug);
        return applyBarberData(fetched);
    }

    el.activateBtn?.addEventListener("click", async () => {
        const code = el.codeInput?.value?.trim();
        if (!code) {
            showToast("Lütfen aktivasyon kodunu girin.", "error");
            return;
        }
        el.activateBtn.disabled = true;
        try {
            const result = await activateSubscriptionCode(code, barberSlug);
            showToast("Aboneliğiniz başarıyla uzatıldı.");
            if (el.codeInput) el.codeInput.value = "";
            if (barberData) {
                barberData.subscriptionEndDate = result.newEndDate;
                barberData.subscriptionStatus = "active";
                barberData.lastActivationCode = code;
            }
            applyBarberData(barberData);
            opts.onActivated?.(barberData);
            closeWarningModal();
        } catch (err) {
            showToast(err.message || "Kod etkinleştirilemedi.", "error");
        } finally {
            el.activateBtn.disabled = false;
        }
    });

    if (barberData) {
        applyBarberData(barberData);
    } else {
        refresh();
    }

    document.querySelectorAll(".sub-shopier-btn").forEach((link) => {
        link.href = SHOPIER_URL;
    });

    bindWarningModal(barberSlug, barberData);
    maybeShowSubscriptionWarning(barberSlug, barberData);

    return {
        refresh,
        getBarberData: () => barberData,
        updateBarberData: applyBarberData,
        openSubscriptionTab: openSubscriptionTabWithFocus
    };
}

export { openSubscriptionTabWithFocus };
