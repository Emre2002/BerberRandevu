// Presentation only: existing auth, tabs and calendar handlers own all actions.
const panel = document.getElementById("adminPanel");
const navigation = document.getElementById("adminNavigation");
const toggle = document.getElementById("adminMenuToggle");

function setMenuOpen(open) {
    navigation.dataset.menuOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
}

if (panel && navigation && toggle) {
    toggle.addEventListener("click", () => setMenuOpen(toggle.getAttribute("aria-expanded") !== "true"));
    navigation.addEventListener("click", event => {
        if (event.target.closest(".admin-tab:not([hidden]):not(:disabled)")) {
            setMenuOpen(false);
            if (matchMedia("(max-width: 1000px)").matches) toggle.focus();
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
            setMenuOpen(false);
            toggle.focus();
        }
    });
    function syncActiveSection() {
        navigation.querySelectorAll(".admin-tab").forEach(tab => {
            const active = tab.classList.contains("active");
            if (active) tab.setAttribute("aria-current", "page");
            else tab.removeAttribute("aria-current");
            if (active) {
                const title = document.getElementById("adminSectionTitle");
                if (title) title.textContent = tab.textContent.trim().replace(/^\S+\s*/, "");
            }
        });
    }
    new MutationObserver(syncActiveSection).observe(navigation, { subtree: true, attributes: true, attributeFilter: ["class"] });
    syncActiveSection();
    const shopName = document.getElementById("barberShopName");
    const businessName = document.getElementById("adminBusinessName");
    if (shopName && businessName) {
        const syncName = () => { businessName.textContent = shopName.textContent; };
        new MutationObserver(syncName).observe(shopName, { childList: true, subtree: true, characterData: true });
        syncName();
    }
    const calendar = document.getElementById("calendarGrid");
    if (calendar) {
        function labelCalendarCells() {
            const headers = [...calendar.querySelectorAll(".calendar-header")];
            const children = [...calendar.children];
            children.forEach((cell, index) => {
                if (!cell.classList.contains("calendar-cell") || cell.getAttribute("aria-disabled") === "true") return;
                cell.setAttribute("role", "button");
                cell.tabIndex = 0;
                const column = index % 8;
                const rowStart = index - column;
                cell.setAttribute("aria-label", `${headers[column]?.textContent || ""}, ${children[rowStart]?.textContent || ""}, ${cell.title || cell.textContent}`);
            });
        }
        new MutationObserver(labelCalendarCells).observe(calendar, { childList: true });
        labelCalendarCells();
        calendar.addEventListener("keydown", event => {
            const cell = event.target.closest('.calendar-cell[role="button"]');
            if (cell && cell.getAttribute("aria-disabled") !== "true" && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                cell.click();
            }
        });
    }
}
