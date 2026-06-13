import { submitPendingBarber } from "./pendingBarberService.js";
import { getIller, getIlceler } from "./turkiyeAdres.js";

const nav = document.getElementById("mainNav");
const navToggle = document.getElementById("navToggle");
const mobileMenu = document.getElementById("mobileMenu");
const demoSection = document.getElementById("demo-talep");
const demoForm = document.getElementById("demoRequestForm");
const toastEl = document.getElementById("lpToast");

function closeMobileMenu() {
    navToggle?.classList.remove("open");
    mobileMenu?.classList.remove("open");
    document.body.style.overflow = "";
}

function showToast(message, type = "success") {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = `lp-toast lp-toast--${type} show`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toastEl.classList.remove("show"), 4500);
}

function scrollToDemoForm() {
    closeMobileMenu();
    demoSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
        document.getElementById("demoAdSoyad")?.focus({ preventScroll: true });
    }, 600);
}

function buildHourOptions() {
    const hours = [];
    for (let h = 7; h <= 23; h++) {
        hours.push(`${String(h).padStart(2, "0")}:00`);
    }
    return hours;
}

function initFormSelects() {
    const openSel = document.getElementById("demoOpenHour");
    const closeSel = document.getElementById("demoCloseHour");
    const citySel = document.getElementById("demoCity");
    const districtSel = document.getElementById("demoDistrict");
    const hours = buildHourOptions();

    if (openSel) {
        openSel.innerHTML = hours.map((h) => `<option value="${h}"${h === "09:00" ? " selected" : ""}>${h}</option>`).join("");
    }
    if (closeSel) {
        closeSel.innerHTML = hours.map((h) => `<option value="${h}"${h === "21:00" ? " selected" : ""}>${h}</option>`).join("");
    }
    if (citySel) {
        citySel.innerHTML = `<option value="">İl seçiniz</option>${getIller().map((il) => `<option value="${il}">${il}</option>`).join("")}`;
        citySel.addEventListener("change", () => {
            const ilceler = getIlceler(citySel.value);
            if (!districtSel) return;
            districtSel.disabled = !ilceler.length;
            districtSel.innerHTML = ilceler.length
                ? `<option value="">İlçe seçiniz</option>${ilceler.map((ic) => `<option value="${ic}">${ic}</option>`).join("")}`
                : `<option value="">Önce il seçiniz</option>`;
        });
    }
}

window.addEventListener("scroll", () => {
    nav?.classList.toggle("scrolled", window.scrollY > 40);
});

navToggle?.addEventListener("click", () => {
    const isOpen = navToggle.classList.toggle("open");
    mobileMenu?.classList.toggle("open", isOpen);
    document.body.style.overflow = isOpen ? "hidden" : "";
});

document.querySelectorAll(".js-scroll-demo").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToDemoForm();
    });
});

document.querySelectorAll(".lp-faq__question").forEach((btn) => {
    btn.addEventListener("click", () => {
        const item = btn.closest(".lp-faq__item");
        const wasOpen = item.classList.contains("open");
        document.querySelectorAll(".lp-faq__item").forEach((i) => i.classList.remove("open"));
        if (!wasOpen) item.classList.add("open");
    });
});

const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

function animateCounter(el) {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || "";
    const duration = 2000;
    const start = performance.now();

    function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.floor(eased * target);
        el.textContent = value.toLocaleString("tr-TR") + suffix;
        if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

const statsObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.querySelectorAll("[data-count]").forEach(animateCounter);
                statsObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.3 }
);

const statsSection = document.querySelector(".lp-stats");
if (statsSection) statsObserver.observe(statsSection);

initFormSelects();

demoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("demoSubmitBtn");
    const errorEl = document.getElementById("demoFormError");

    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = "Gönderiliyor...";

    try {
        await submitPendingBarber({
            ownerName: document.getElementById("demoAdSoyad").value,
            phone: document.getElementById("demoTelefon").value,
            email: document.getElementById("demoEmail").value,
            shopName: document.getElementById("demoDukkanAdi").value,
            message: document.getElementById("demoMesaj").value,
            city: document.getElementById("demoCity").value,
            district: document.getElementById("demoDistrict").value,
            address: document.getElementById("demoAddress").value,
            mapsLink: document.getElementById("demoMapsLink").value,
            openingHour: document.getElementById("demoOpenHour").value,
            closingHour: document.getElementById("demoCloseHour").value,
            packageType: document.getElementById("demoPackage").value
        });

        demoForm.reset();
        initFormSelects();
        showToast("Başvurunuz alındı! Onay sonrası panel bilgileriniz paylaşılacaktır.");
    } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message || "Gönderim başarısız. Lütfen tekrar deneyin.";
        showToast(err.message || "Gönderim başarısız.", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Başvuruyu Gönder";
    }
});
