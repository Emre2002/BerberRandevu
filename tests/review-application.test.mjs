import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { reviewApplication } from "../api/_lib/review-application-core.js";
import { CreateBusinessError } from "../api/_lib/create-business-core.js";
import { createBusiness } from "../api/_lib/create-business-core.js";

const application = { status: "pending", ownerName: "Fixture Owner", shopName: "Test Shop", phone: "05551234567",
    email: "fixture@example.test", city: "İzmir", district: "Konak", address: "Fixture address", openingHour: "09:00", closingHour: "19:00" };
function fixture({ failFinal = false, failAuth = false, loseResponse = false } = {}) {
    const docs = new Map([["pendingBarbers/a", { ...application }], ["pendingBarbers/b", { ...application, email: "other@example.test" }]]);
    let authCalls = 0, queue = Promise.resolve();
    const ref = path => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) });
    const db = {
        collection: name => ({ doc: id => ref(`${name}/${id}`), where: (_key, _op, value) => ({ limit: () => ({ get: async () => ({
            empty: ![...docs].some(([path, data]) => path.startsWith("berberler/") && data.username === value)
        }) }) }) }),
        runTransaction(fn) {
            const result = queue.then(async () => {
                const writes = [];
                const value = await fn({ get: r => r.get(), create: (r, data) => writes.push(["create", r.path, data]), update: (r, data) => writes.push(["update", r.path, data]) });
                const isFinal = writes.some(([op]) => op === "create");
                if (isFinal && failFinal) throw new Error("fixture commit failure");
                for (const [op, path] of writes) if (op === "create" && docs.has(path)) throw new Error("already exists");
                for (const [op, path, data] of writes) docs.set(path, op === "update" ? { ...docs.get(path), ...data } : data);
                if (isFinal && loseResponse) throw new Error("committed response lost");
                return value;
            });
            queue = result.catch(() => {});
            return result;
        }
    };
    const auth = { createUser: async () => { authCalls++; if (failAuth) throw new Error("ambiguous Auth response"); return { uid: "fixture-owner" }; } };
    const review = (action = "approve", applicationId = "a") => reviewApplication({ db, auth, timestamp: () => "now", action, applicationId, reviewerUid: "fixture-superadmin" });
    return { docs, review, authCalls: () => authCalls };
}
it("approves from stored data, preserves application history and creates matching records", async () => {
    const f = fixture(); const result = await f.review();
    assert.equal(result.status, "approved"); assert.equal(f.authCalls(), 1);
    assert.equal(f.docs.get("pendingBarbers/a").ownerName, application.ownerName);
    assert.equal(f.docs.get("pendingBarbers/a").reviewedByUid, "fixture-superadmin");
    assert.equal(f.docs.get(`berberler/${result.slug}`).email, application.email);
    assert.equal(f.docs.get(`publicBarbers/${result.slug}`).password, undefined);
    assert.equal(f.docs.get("businessMemberships/fixture-owner").businessId, result.slug);
    assert.equal(f.docs.get("pendingBarbers/b").status, "pending");
    const replay = await f.review(); assert.equal(replay.slug, result.slug); assert.equal(replay.idempotentReplay, true); assert.equal(f.authCalls(), 1);
});
it("parallel approval requests create only one Auth account", async () => {
    const f = fixture(); const results = await Promise.allSettled([f.review(), f.review()]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.authCalls(), 1);
});
it("rejects pending application and replays rejection without modifying its history or other applications", async () => {
    const f = fixture(); await f.review("reject"); const before = { ...f.docs.get("pendingBarbers/a") };
    assert.equal((await f.review("reject")).idempotentReplay, true);
    assert.deepEqual(f.docs.get("pendingBarbers/a"), before); assert.equal(f.authCalls(), 0);
    assert.equal(f.docs.get("pendingBarbers/b").status, "pending");
    await assert.rejects(f.review(), { code: "application_conflict" });
});
it("approve and reject race has one consistent outcome", async () => {
    const f = fixture(); const results = await Promise.allSettled([f.review(), f.review("reject")]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.docs.get("pendingBarbers/a").status, "approved");
});
for (const status of ["approved", "processing"]) it(`cannot reject ${status} application`, async () => {
    const f = fixture(); f.docs.get("pendingBarbers/a").status = status;
    await assert.rejects(f.review("reject"), { code: "application_conflict" }); assert.equal(f.authCalls(), 0);
});
for (const [path, data] of [["berberler/test-shop", {}], ["publicBarbers/test-shop", {}], ["authLoginIndex/testshop", {}], ["berberler/legacy", { username: "testshop" }]]) {
    it(`handles collision at ${path} without overwriting it`, async () => {
        const f = fixture(); f.docs.set(path, data); const result = await f.review();
        assert.equal(result.slug, "test-shop-2"); assert.equal(result.username, "testshop2"); assert.deepEqual(f.docs.get(path), data);
    });
}
for (const patch of [{ email: "bad" }, { shopName: "" }, { phone: 123 }, { openingHour: "29:00" }, { closingHour: "08:00" }, { city: "" }]) {
    it(`invalid stored application cannot start provisioning ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); Object.assign(f.docs.get("pendingBarbers/a"), patch);
        await assert.rejects(f.review(), { code: "invalid_application" }); assert.equal(f.authCalls(), 0);
        assert.equal(f.docs.get("pendingBarbers/a").status, "pending");
    });
}
for (const options of [{ failAuth: true }, { failFinal: true }]) it(`partial failure requires review and blocks a second Auth call ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.review(), { code: "application_review_required" });
    assert.equal(f.docs.get("pendingBarbers/a").status, "processing");
    await assert.rejects(f.review(), { code: "application_conflict" }); assert.equal(f.authCalls(), 1);
    assert.equal([...f.docs.keys()].filter(path => path.startsWith("berberler/")).length, 0);
});
it("lost Firestore commit response is safely recovered as approved on retry", async () => {
    const f = fixture({ loseResponse: true }); await assert.rejects(f.review(), { code: "application_review_required" });
    assert.equal((await f.review()).status, "approved"); assert.equal(f.authCalls(), 1);
});
it("missing application does not provision Auth", async () => {
    const f = fixture(); await assert.rejects(f.review("approve", "missing"), { code: "application_not_found" }); assert.equal(f.authCalls(), 0);
});
it("direct provisioning cannot reuse a processing application without its server claim", async () => {
    const f = fixture();
    f.docs.set("pendingBarbers/a", { ...application, status: "processing", approvalToken: "real-claim" });
    for (const approvalToken of [undefined, "forged-claim"]) {
        await assert.rejects(createBusiness({ db: { collection: name => ({
            doc: id => ({ get: async () => ({ exists: name === "pendingBarbers", data: () => f.docs.get(`pendingBarbers/${id}`) }) }),
            where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) })
        }) }, auth: { createUser: () => { throw new Error("must not provision"); } }, timestamp: () => "now", approvalToken,
        input: { pendingId: "a", slug: "test-shop", username: "testshop", name: application.shopName, email: application.email, phone: application.phone } }),
        error => ["invalid_request", "pending_mismatch"].includes(error.code));
    }
});

const route = readFileSync(new URL("../api/review-application.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "async function handler");
for (const action of ["approve", "reject"]) for (const permitted of [false, true]) it(`route ${action} enforces server authorization (allowed=${permitted})`, async () => {
    let calls = 0; const res = {};
    const ctx = { applyCors() {}, requireSuperAdmin: async () => permitted ? { ok: true, decoded: { uid: "verified" } } : { ok: false, status: 403, code: "forbidden" },
        readJsonBody: async () => ({ applicationId: "a", action }), getAdminDb: () => ({}), getAdminAuth: () => ({}), FieldValue: { serverTimestamp: () => "now" }, CreateBusinessError,
        reviewApplication: async input => { calls++; assert.equal(input.reviewerUid, "verified"); assert.equal(input.applicationId, "a"); return { status: "fixture" }; },
        sendError: (res, status) => { res.status = status; }, sendJson: (res, status) => { res.status = status; } };
    runInNewContext(`${route}; this.handler = handler;`, ctx); await ctx.handler({ method: "POST" }, res);
    assert.equal(calls, permitted ? 1 : 0); assert.equal(res.status, permitted ? 200 : 403);
});
it("client sends only ID and action and performs no private queries or writes", () => {
    const src = readFileSync(new URL("../pendingBarberService.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /updateDoc|runTransaction|slugExists|usernameExists|createBarber/);
    assert.match(src, /applicationId: id, action: "approve"/); assert.match(src, /applicationId: id, action: "reject"/);
});

function panelFixture({ failed = false } = {}) {
    let handler, release, approvals = 0, rejections = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const toasts = [];
    const cards = { addEventListener: (_event, fn) => { handler = fn; }, innerHTML: "" };
    const source = readFileSync(new URL("../pendingBarbersPanel.js", import.meta.url), "utf8")
        .replace(/import\s*\{[\s\S]*?from "\.\/pendingBarberService.js";/, "")
        .replace(/export /g, "");
    const context = { document: { getElementById: id => id === "pbCards" ? cards : null }, confirm: () => true, PACKAGE_OPTIONS: {},
        approvePendingBarber: async () => { approvals++; await gate; if (failed) throw new Error("Kontrol gerekli"); return { slug: "fixture", username: "fixture" }; },
        rejectPendingBarber: async () => { rejections++; }, fetchAllPendingBarbers: async () => [], formatPendingDate: () => "", packageLabel: () => "" };
    runInNewContext(`${source}; bindPendingBarbersEvents((...args) => toasts.push(args));`, { ...context, toasts });
    const approve = { dataset: { pbApprove: "a" } }, reject = { dataset: { pbReject: "a" } };
    const event = action => ({ target: { closest: selector => selector === `[data-pb-${action}]` ? action === "approve" ? approve : reject : null } });
    return { click: action => handler(event(action)), release, toasts, counts: () => ({ approvals, rejections }) };
}
it("panel blocks duplicate and opposite actions while approval is pending and reports success", async () => {
    const p = panelFixture(); const first = p.click("approve");
    await p.click("approve"); await p.click("reject");
    assert.deepEqual(p.counts(), { approvals: 1, rejections: 0 });
    p.release(); await first;
    assert.match(p.toasts[0][0], /İşletme hesabı oluşturuldu/);
});
it("panel reports approval failure without a success message", async () => {
    const p = panelFixture({ failed: true }); const first = p.click("approve"); p.release(); await first;
    assert.equal(p.toasts.length, 1);
    assert.equal(p.toasts[0][0], "Kontrol gerekli");
    assert.equal(p.toasts[0][1], "error");
});
it("panel keeps the rejection button connected to the API service", async () => {
    const p = panelFixture(); await p.click("reject");
    assert.equal(p.counts().rejections, 1); assert.equal(p.toasts[0][0], "Başvuru reddedildi.");
});
