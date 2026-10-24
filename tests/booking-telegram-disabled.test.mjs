import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../api/_lib/create-appointment-core.js", import.meta.url), "utf8");
const start = source.indexOf("async function maybeSendTelegram(");
const end = source.indexOf("async function runBestEffortSideEffects(", start);
assert.ok(start >= 0 && end > start);
const sender = source.slice(start, end);

for (const flag of [undefined, "false", "0", "1", "TRUE"]) {
    it(`Telegram flag ${String(flag)} skips HTTP, private reads and credential access`, async () => {
        // Isolated environment: never inspect the real process environment or credentials.
        const env = { TELEGRAM_NOTIFICATIONS_ENABLED: flag };
        Object.defineProperty(env, "TELEGRAM_BOT_TOKEN", {
            get() { assert.fail("Disabled Telegram must not read bot credentials"); }
        });
        const send = runInNewContext(`${sender}; maybeSendTelegram`, {
            process: { env }, fetch: () => assert.fail("Unexpected HTTP request")
        });
        await send({ collection: () => assert.fail("Unexpected private business read") }, {});
    });
}

it("explicit Telegram opt-in still awaits delivery", async () => {
    let finishDelivery;
    let calls = 0;
    const delivery = new Promise(resolve => { finishDelivery = resolve; });
    const send = runInNewContext(`${sender}; maybeSendTelegram`, {
        process: { env: { TELEGRAM_NOTIFICATIONS_ENABLED: "true", TELEGRAM_BOT_TOKEN: "fake-token" } },
        fetch: async () => { calls++; await delivery; }
    });
    const db = { collection: () => ({ doc: () => ({
        get: async () => ({ exists: true, data: () => ({ telegramChatId: "fake-chat" }) })
    }) }) };
    let settled = false;
    const pending = send(db, {}).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(settled, false);
    finishDelivery();
    await pending;
    assert.equal(settled, true);
});
