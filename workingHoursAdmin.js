import { updateBarber } from "./firestoreService.js";
import {
    HOUR_SELECT_OPTIONS,
    validateWorkingHours,
    getBarberWorkingHours,
    generateHourlySlotRanges
} from "./workingHoursService.js";

/**
 * Berber admin — Çalışma Saatleri sekmesi.
 * @param {string} barberSlug
 * @param {(msg: string, type?: string) => void} showToast
 * @param {{ initialBarber?: object, onUpdated?: (hours: {openHour:string, closeHour:string}) => void }} opts
 */
export function initWorkingHoursAdmin(barberSlug, showToast, opts = {}) {
    const panel = document.querySelector('[data-panel="hours"]');
    if (!panel || !barberSlug) return { refresh: () => {} };

    const openSel = panel.querySelector("#whOpenHour");
    const closeSel = panel.querySelector("#whCloseHour");
    const previewEl = panel.querySelector("#whSlotPreview");
    const saveBtn = panel.querySelector("#whSaveBtn");

    const hours = getBarberWorkingHours(opts.initialBarber || {});

    function fillSelects() {
        const options = HOUR_SELECT_OPTIONS.map((h) => `<option value="${h}">${h}</option>`).join("");
        if (openSel) {
            openSel.innerHTML = options;
            openSel.value = HOUR_SELECT_OPTIONS.includes(hours.openHour)
                ? hours.openHour : HOUR_SELECT_OPTIONS[3];
        }
        if (closeSel) {
            closeSel.innerHTML = options;
            closeSel.value = HOUR_SELECT_OPTIONS.includes(hours.closeHour)
                ? hours.closeHour : HOUR_SELECT_OPTIONS[15];
        }
        updatePreview();
    }

    function updatePreview() {
        if (!previewEl || !openSel || !closeSel) return;
        const err = validateWorkingHours(openSel.value, closeSel.value);
        if (err) {
            previewEl.innerHTML = `<span class="wh-preview__error">${err}</span>`;
            return;
        }
        const ranges = generateHourlySlotRanges(openSel.value, closeSel.value);
        previewEl.innerHTML = ranges.length
            ? ranges.map((r) => `<span class="wh-preview__chip">${r}</span>`).join("")
            : `<span class="wh-preview__error">Geçerli slot üretilemedi.</span>`;
    }

    openSel?.addEventListener("change", updatePreview);
    closeSel?.addEventListener("change", updatePreview);

    saveBtn?.addEventListener("click", async () => {
        const openHour = openSel?.value;
        const closeHour = closeSel?.value;
        const err = validateWorkingHours(openHour, closeHour);
        if (err) {
            showToast(err, "error");
            return;
        }

        saveBtn.disabled = true;
        try {
            await updateBarber(barberSlug, { openHour, closeHour });
            hours.openHour = openHour;
            hours.closeHour = closeHour;
            showToast("Çalışma saatleri güncellendi.");
            opts.onUpdated?.({ openHour, closeHour });
        } catch (e) {
            showToast(e.message || "Kayıt başarısız.", "error");
        } finally {
            saveBtn.disabled = false;
        }
    });

    fillSelects();

    return {
        refresh(barber) {
            const h = getBarberWorkingHours(barber || {});
            hours.openHour = h.openHour;
            hours.closeHour = h.closeHour;
            fillSelects();
        }
    };
}
