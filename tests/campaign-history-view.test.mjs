import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCampaignHistory } from "../campaignHistoryView.js";

class TestElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
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
        throw new Error("Campaign history must not parse HTML");
    }

    replaceChildren(...children) {
        this.children = children;
    }

    append(...children) {
        this.children.push(...children);
    }
}

function render(history, emptyMessage) {
    const originalDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => new TestElement(tagName) };
    try {
        const container = new TestElement("div");
        container.append(new TestElement("span"));
        renderCampaignHistory(container, history, emptyMessage);
        return container;
    } finally {
        globalThis.document = originalDocument;
    }
}

describe("campaign message history", () => {
    it("preserves message order, date, recipient count and classes", () => {
        const date = new Date("2026-10-22T11:30:00Z");
        const container = render([
            { createdAt: { toDate: () => date }, recipientCount: 2, message: "Merhaba" },
            { recipientCount: 1, message: "İkinci mesaj" }
        ]);
        assert.equal(container.children.length, 2);
        assert.equal(container.children[0].className, "msg-history-item");
        assert.equal(container.children[0].children[0].className, "msg-history-item__meta");
        assert.equal(container.children[0].children[0].textContent, `${date.toLocaleString("tr-TR")} · 2 alıcı`);
        assert.equal(container.children[0].children[1].textContent, "Merhaba");
        assert.equal(container.children[1].children[0].textContent, "— · 1 alıcı");
        assert.equal(container.children[1].children[1].textContent, "İkinci mesaj");
    });

    it("shows HTML, script and onerror payloads as inert text in all dynamic fields", () => {
        const payload = '<img src=x onerror="globalThis.historyXss=true">';
        const script = "<script>globalThis.historyXss=true</script>";
        const container = render([{
            createdAt: { toDate: () => ({ toLocaleString: () => script }) },
            recipientCount: payload,
            message: `${script}${payload}`
        }]);
        const [meta, message] = container.children[0].children;
        assert.equal(meta.textContent, `${script} · ${payload} alıcı`);
        assert.equal(message.textContent, `${script}${payload}`);
        assert.equal(container.children[0].children.length, 2);
        assert.equal(globalThis.historyXss, undefined);
    });

    it("preserves empty and loading-error messages", () => {
        assert.equal(render([]).children[0].textContent, "Henüz mesaj gönderilmedi.");
        const error = render([], "Mesaj geçmişi yüklenemedi.").children[0];
        assert.equal(error.className, "msg-empty");
        assert.equal(error.textContent, "Mesaj geçmişi yüklenemedi.");
    });
});
