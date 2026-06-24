const nav = document.getElementById("mainNav");
const navToggle = document.getElementById("navToggle");
const mobileMenu = document.getElementById("mobileMenu");
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

window.addEventListener("scroll", () => {
    nav?.classList.toggle("scrolled", window.scrollY > 40);
});

navToggle?.addEventListener("click", () => {
    const isOpen = navToggle.classList.toggle("open");
    mobileMenu?.classList.toggle("open", isOpen);
    document.body.style.overflow = isOpen ? "hidden" : "";
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
