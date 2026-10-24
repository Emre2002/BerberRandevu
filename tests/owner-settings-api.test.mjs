import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { OwnerSettingsError } from "../api/_lib/owner-settings-core.js";

const source = readFileSync(new URL("../api/owner/update-settings.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "async function handler");
async function request({ auth, body = { businessId: "shop-a", updates: { openHour: "10:00" } }, failure, method = "POST" } = {}) {
    const writes = [];
    const context = {
        applyCors() {}, getClientIp: () => "fixture", checkRateLimit: () => true,
        requireOwnerMembership: async () => auth ?? { ok: true, decoded: { uid: "owner-a" }, membership: { businessId: "shop-a" } },
        readJsonBody: async () => body, getAdminDb: () => ({}), OwnerSettingsError,
        updateOwnerSettings: async (_db, input) => { if (failure) throw failure; writes.push(input); return { ok: true }; },
        sendError: (res, status, code) => Object.assign(res, { status, code }),
        sendJson: (res, status, data) => Object.assign(res, { status, data })
    };
    runInNewContext(`${source}; this.handler = handler;`, context);
    const res = {};
    await context.handler({ method }, res);
    return { res, writes };
}
it("owner route uses authenticated identity and returns success", async () => {
    const { res, writes } = await request();
    assert.equal(res.status, 200);
    assert.equal(writes[0].uid, "owner-a");
    assert.equal(writes[0].businessId, "shop-a");
});
for (const status of [401, 403]) it(`owner route refuses auth failure ${status} without writes`, async () => {
    const { res, writes } = await request({ auth: { ok: false, status, code: "forbidden" } });
    assert.equal(res.status, status); assert.equal(writes.length, 0);
});
for (const body of [{ businessId: "shop-b", updates: {} }, { businessId: "shop-a", uid: "forged", updates: {} }]) it("owner route rejects forged target or identity", async () => {
    const { res, writes } = await request({ body });
    assert.equal(res.status, 403); assert.equal(writes.length, 0);
});
it("owner route sanitizes unexpected errors", async () => {
    const { res } = await request({ failure: new Error("private internal detail") });
    assert.equal(res.status, 500); assert.equal(res.code, "internal_error");
});
it("client settings delegate both changes to one authenticated request", () => {
    const source = readFileSync(new URL("../firestoreService.js", import.meta.url), "utf8");
    const fn = source.slice(source.indexOf("export async function updateOwnerBarberSettings"), source.indexOf("export async function syncAllPublicBarbersForMigration"));
    assert.match(fn, /callPrivilegedApi\("updateOwnerSettings"/);
    assert.doesNotMatch(fn, /updateDoc|setDoc/);
});
