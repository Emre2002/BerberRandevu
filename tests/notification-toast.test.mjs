import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { showLiveNotificationToast } from "../notificationToast.js";

class TestElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = {};
        this.classList = { add() {}, remove() {} };
        this.ownText = "";
    }

    set textContent(value) {
        this.ownText = String(value);
        this.children = [];
    }

    get textContent() {
        return this.ownText + this.children.map((child) => child.textContent).join("");
    }

    set innerHTML(_) {
        throw new Error("HTML parsing is forbidden for notification content");
    }

    append(...children) {
        this.children.push(...children);
    }

    prepend(child) {
        this.children.unshift(child);
    }

    remove() {}
}

function render(data) {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.document = { createElement: (tagName) => new TestElement(tagName) };
    globalThis.window = { location: new URL("https://preview.example.test/admin.html") };
    globalThis.setTimeout = () => 0;

    try {
        const container = new TestElement("div");
        showLiveNotificationToast(container, data);
        const toast = container.children[0];
        const [icon, body] = toast.children;
        const [title, customer, time] = body.children;
        return { toast, icon, title, customer, time };
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
        globalThis.setTimeout = originalSetTimeout;
    }
}

describe("live notification toast", () => {
    it("renders the normal title, customer and date as text", () => {
        const { toast, icon, title, customer, time } = render({
            customerName: "Ayşe", time: "14:30", date: "2026-10-22"
        });
        assert.equal(toast.className, "live-notif");
        assert.equal(icon.textContent, "🔔");
        assert.equal(title.textContent, "Yeni Randevu");
        assert.equal(customer.textContent, "Ayşe");
        assert.equal(customer.tagName, "DIV");
        assert.equal(time.textContent, "14:30 · 2026-10-22");
    });

    it("renders HTML and event-handler payloads as inert text", () => {
        const payload = '<img src=x onerror="globalThis.xssRan=true">';
        const { customer, time, toast } = render({
            customerName: payload, time: '<svg onload="globalThis.xssRan=true">', date: payload
        });
        assert.equal(customer.textContent, payload);
        assert.match(time.textContent, /<svg onload=/);
        assert.equal(toast.children[1].children.length, 3);
        assert.equal(globalThis.xssRan, undefined);
    });

    it("rejects unsafe and cross-origin notification URLs", () => {
        for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "https://evil.example/"]) {
            const { customer } = render({ customerName: "Test", url });
            assert.equal(customer.tagName, "DIV");
            assert.equal(customer.href, undefined);
        }
    });

    it("keeps a same-origin notification link usable", () => {
        const { customer } = render({ customerName: "Randevu", url: "/admin.html?dukkan=berber" });
        assert.equal(customer.tagName, "A");
        assert.equal(customer.href, "https://preview.example.test/admin.html?dukkan=berber");
        assert.equal(customer.style.pointerEvents, "auto");
    });
});
