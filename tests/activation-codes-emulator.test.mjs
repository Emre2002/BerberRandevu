// firebase emulators:exec --only auth,firestore --config firebase.rules-test.json --project berberrandevu-dev-emre2002 "node --test tests/activation-codes-emulator.test.mjs"
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { deleteApp } from "firebase-admin/app";
import { Timestamp } from "firebase-admin/firestore";
import adminHandler from "../api/update-business.js";
import ownerHandler from "../api/owner/update-settings.js";
import { getAdminApp, getAdminAuth, getAdminDb } from "../api/_lib/firebase-admin.js";
import { extendSubscriptionEndDate } from "../subscriptionTerms.js";

const ADMIN_ROUTE = "/api/update-business?activationCodes=1";
const OWNER_ROUTE = "/api/owner/update-settings?activateSubscription=1";
const PROJECT = "berberrandevu-dev-emre2002";
const ACTIVE_END = "2090-01-20";
const EXPIRED_END = "2020-01-01";
const PASSWORD = "activation-test-fixture-password";
const LEGACY_CODE = "BRB-AYLIK-LEGACY";
const USED_CODE = "BRB-AYLIK-USEDU5";
const RACE_CODE = "BRB-3AY-RACEX5";
const INVALID_PACKAGE_CODE = "BRB-YIL-BADPKG";
const ATOMIC_CODE = "BRB-YIL-ATOMIC";
const FALLBACK_CODE = "BRB-AYLIK-NODAYS";

let server;
let origin;
let db;
const tokens = {};

async function createUser(uid, superAdmin = false) {
    const auth = getAdminAuth();
    const email = `${uid}@example.test`;
    await auth.createUser({ uid, email, password: PASSWORD });
    if (superAdmin) await auth.setCustomUserClaims(uid, { superAdmin: true });
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true })
    });
    assert.equal(res.status, 200);
    tokens[uid] = (await res.json()).idToken;
}

function seedCode(code, fields = {}) {
    return db.collection("activationCodes").doc(code).set({
        code, packageType: "monthly", durationDays: 30, isUsed: false,
        createdAt: Timestamp.fromDate(new Date("2024-01-01T00:00:00Z")),
        ...fields
    });
}

function seedBusiness(businessId, fields = {}) {
    return db.collection("berberler").doc(businessId).set({
        name: "Test işletmesi", status: "active", subscriptionEndDate: ACTIVE_END,
        subscriptionStatus: "active", password: "private-fixture", ...fields
    });
}

function seedMembership(uid, status = "active") {
    return db.collection("businessMemberships").doc(uid).set({ uid, role: "owner", status, businessId: uid });
}

async function post(route, payload, user, invalidToken = false) {
    const response = await fetch(origin + route, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(user ? { Authorization: `Bearer ${invalidToken ? user : tokens[user]}` } : {})
        },
        body: JSON.stringify(payload)
    });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, body: await response.json(), headers: response.headers };
}

async function data(path) {
    return (await db.doc(path).get()).data();
}

before(async () => {
    for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
        assert.match(process.env[name] || "", /^127\.0\.0\.1:\d+$/, `${name} must point to a local emulator`);
    }
    for (const name of ["FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS"]) {
        delete process.env[name];
    }
    process.env.VERCEL_ENV = "development";
    process.env.FIREBASE_PROJECT_ID = PROJECT;
    db = getAdminDb();

    await Promise.all(["admin", "owner-a", "owner-b", "inactive", "atomic", "expired", "limited"].map(
        (uid) => createUser(uid, uid === "admin")
    ));
    await Promise.all([
        seedMembership("owner-a"), seedMembership("owner-b"), seedMembership("inactive", "disabled"),
        seedMembership("atomic"), seedMembership("expired"), seedMembership("limited"),
        seedBusiness("owner-a"),
        seedBusiness("owner-b", { subscriptionEndDate: "2091-01-20" }),
        seedBusiness("atomic", { name: "x".repeat(300_000) }),
        seedBusiness("expired", { subscriptionEndDate: EXPIRED_END, subscriptionStatus: "expired", status: "passive" }),
        db.doc("publicBarbers/atomic").set({ preserved: "x".repeat(800_000), bookingOpen: false }),
        db.doc("publicBarbers/owner-a").set({ bookingOpen: false, preserved: true }),
        seedCode(LEGACY_CODE, { durationDays: 31 }),
        seedCode(USED_CODE, { isUsed: true, usedByBarberSlug: "historical-shop" }),
        seedCode(RACE_CODE, { packageType: "quarterly", durationDays: 90 }),
        seedCode(INVALID_PACKAGE_CODE, { packageType: "yearly", durationDays: -1 }),
        seedCode(ATOMIC_CODE, { packageType: "yearly", durationDays: 365 }),
        seedCode(FALLBACK_CODE, { durationDays: null })
    ]);
    server = createServer((req, res) => (req.url.startsWith("/api/update-business") ? adminHandler : ownerHandler)(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) {
        await db.terminate();
        await deleteApp(getAdminApp());
    }
});

test("Super Admin creates unique batches with the existing formats and package durations", async () => {
    const jobs = [["monthly", 30, "AYLIK"], ["quarterly", 90, "3AY"], ["yearly", 365, "YIL"], ["monthly", 30, "AYLIK"]];
    const responses = await Promise.all(jobs.map(([packageType]) => post(ADMIN_ROUTE, { action: "create", packageType, count: 3 }, "admin")));
    assert.equal(new Set(responses.flatMap(({ body }) => body.codes)).size, 12);
    for (const [index, { status, body }] of responses.entries()) {
        const [packageType, durationDays, prefix] = jobs[index];
        assert.equal(status, 200);
        assert.equal(body.codes.length, 3);
        for (const code of body.codes) {
            assert.match(code, new RegExp(`^BRB-${prefix}-[A-HJ-NP-Z2-9]{6}$`));
            const stored = await data(`activationCodes/${code}`);
            assert.equal(stored.packageType, packageType);
            assert.equal(stored.durationDays, durationDays);
            assert.equal(stored.isUsed, false);
        }
    }
});

test("a code collision retries the entire batch without overwriting or partially creating codes", async (t) => {
    const originalBatch = db.batch.bind(db);
    const collidedRefs = [];
    const batchMock = t.mock.method(db, "batch", () => {
        const batch = originalBatch();
        const create = batch.create.bind(batch);
        const commit = batch.commit.bind(batch);
        batch.create = (ref, fields) => {
            collidedRefs.push(ref);
            return create(ref, fields);
        };
        batch.commit = async () => {
            batchMock.mock.restore();
            await originalBatch().create(collidedRefs[0], { code: collidedRefs[0].id, marker: "existing" }).commit();
            return commit();
        };
        return batch;
    });

    const result = await post(ADMIN_ROUTE, { action: "create", packageType: "yearly", count: 2 }, "admin");
    assert.equal(result.status, 200);
    assert.equal(result.body.codes.length, 2);
    assert.equal((await collidedRefs[0].get()).data().marker, "existing");
    const untouched = await collidedRefs[1].get();
    // A freshly generated code in the retry can legitimately match an unused first-batch candidate.
    assert.equal(untouched.exists, result.body.codes.includes(untouched.id));
    assert.equal(result.body.codes.includes(collidedRefs[0].id), false);
});

test("Super Admin lists existing codes with status and serialized timestamps", async () => {
    const result = await post(ADMIN_ROUTE, { action: "list" }, "admin");
    assert.equal(result.status, 200);
    const legacy = result.body.codes.find((entry) => entry.code === LEGACY_CODE);
    assert.equal(legacy.durationDays, 31);
    assert.equal(legacy.createdAt, Date.parse("2024-01-01T00:00:00Z"));
    assert.equal(result.body.codes.find((entry) => entry.code === USED_CODE).isUsed, true);
    assert.ok(result.body.codes[0].createdAt > legacy.createdAt);
});

test("Super Admin deletes an unused code and cannot delete a used code", async () => {
    const unused = "BRB-AYLIK-DELETE";
    await seedCode(unused);
    const deleted = await post(ADMIN_ROUTE, { action: "delete", code: unused.toLowerCase() }, "admin");
    assert.equal(deleted.status, 200);
    assert.equal(await data(`activationCodes/${unused}`), undefined);
    const used = await post(ADMIN_ROUTE, { action: "delete", code: USED_CODE }, "admin");
    assert.equal(used.status, 409);
    assert.equal(used.body.error, "code_used");
    assert.equal((await data(`activationCodes/${USED_CODE}`)).usedByBarberSlug, "historical-shop");
});

test("missing or invalid ID tokens cannot access either API", async () => {
    for (const [route, payload] of [[ADMIN_ROUTE, { action: "list" }], [OWNER_ROUTE, { code: LEGACY_CODE }]]) {
        assert.equal((await post(route, payload)).status, 401);
        assert.equal((await post(route, payload, "invalid-id-token", true)).status, 401);
    }
    assert.equal((await post(OWNER_ROUTE, { code: LEGACY_CODE }, "inactive")).status, 403);
    assert.equal((await post(OWNER_ROUTE, { code: LEGACY_CODE }, "admin")).status, 403);
});

test("an authenticated owner cannot create, list or delete codes or read the pool through Firestore", async () => {
    for (const action of ["create", "list", "delete"]) {
        const result = await post(ADMIN_ROUTE, { action, packageType: "monthly", code: LEGACY_CODE }, "owner-a");
        assert.equal(result.status, 403);
    }
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    const documents = `http://${firestoreHost}/v1/projects/${PROJECT}/databases/(default)/documents`;
    const directRead = await fetch(`${documents}/activationCodes/${LEGACY_CODE}`, {
        headers: { Authorization: `Bearer ${tokens["owner-a"]}` }
    });
    assert.equal(directRead.status, 403);
});

test("an owner cannot pass another business ID and neither business is changed", async () => {
    const result = await post(OWNER_ROUTE, { code: LEGACY_CODE, businessId: "owner-b" }, "owner-a");
    assert.equal(result.status, 403);
    assert.equal((await data("berberler/owner-a")).subscriptionEndDate, ACTIVE_END);
    assert.equal((await data("berberler/owner-b")).subscriptionEndDate, "2091-01-20");
    assert.equal((await data(`activationCodes/${LEGACY_CODE}`)).isUsed, false);
});

test("an owner redeems a legacy code using its stored duration and atomically updates the public profile", async () => {
    const result = await post(OWNER_ROUTE, { code: ` ${LEGACY_CODE.toLowerCase()} ` }, "owner-a");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { newEndDate: "2090-02-20", durationDays: 31, packageType: "monthly" });
    const barber = await data("berberler/owner-a");
    const profile = await data("publicBarbers/owner-a");
    const code = await data(`activationCodes/${LEGACY_CODE}`);
    assert.equal(barber.subscriptionEndDate, result.body.newEndDate);
    assert.equal(barber.subscriptionStatus, "active");
    assert.equal(profile.bookingOpen, true);
    assert.equal(profile.slug, "owner-a");
    assert.equal(profile.preserved, true);
    assert.equal(profile.password, undefined);
    assert.equal(profile.lastActivationCode, undefined);
    assert.equal(profile.subscriptionEndDate, undefined);
    assert.equal(code.isUsed, true);
    assert.equal(code.usedByBarberSlug, "owner-a");
    assert.equal(code.durationDays, 31);
    assert.ok(code.usedAt.isEqual(barber.lastSubscriptionUpdate));
    assert.ok(code.usedAt.isEqual(profile.updatedAt));
});

test("a used code cannot extend any subscription a second time", async () => {
    const result = await post(OWNER_ROUTE, { code: LEGACY_CODE }, "owner-b");
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "code_used");
    assert.equal((await data("berberler/owner-b")).subscriptionEndDate, "2091-01-20");
});

test("simultaneous redemptions by two businesses use the code exactly once", async () => {
    const owners = ["owner-a", "owner-b"];
    const before = await Promise.all(owners.map((owner) => data(`berberler/${owner}`)));
    const results = await Promise.all(owners.map((owner) => post(OWNER_ROUTE, { code: RACE_CODE }, owner)));
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    const winner = results.findIndex(({ status }) => status === 200);
    const loser = 1 - winner;
    const code = await data(`activationCodes/${RACE_CODE}`);
    assert.equal(code.usedByBarberSlug, owners[winner]);
    assert.equal((await data(`berberler/${owners[winner]}`)).subscriptionEndDate,
        extendSubscriptionEndDate(before[winner].subscriptionEndDate, 90));
    assert.equal((await data(`berberler/${owners[loser]}`)).subscriptionEndDate, before[loser].subscriptionEndDate);
});

test("invalid packages, counts, malformed codes and unknown codes are rejected", async () => {
    const badPackage = await post(ADMIN_ROUTE, { action: "create", packageType: "constructor" }, "admin");
    assert.equal(badPackage.status, 400);
    assert.equal(badPackage.body.error, "invalid_package");
    const badCount = await post(ADMIN_ROUTE, { action: "create", packageType: "yearly", count: 101 }, "admin");
    assert.equal(badCount.body.error, "invalid_count");
    const malformed = await post(OWNER_ROUTE, { code: "bad/code" }, "owner-a");
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, "invalid_code");
    const missing = await post(OWNER_ROUTE, { code: "BRB-YIL-NOCODE" }, "owner-a");
    assert.equal(missing.status, 404);
    const badStoredPackage = await post(OWNER_ROUTE, { code: INVALID_PACKAGE_CODE }, "owner-a");
    assert.equal(badStoredPackage.status, 400);
    assert.equal(badStoredPackage.body.error, "invalid_package");
    assert.equal((await data(`activationCodes/${INVALID_PACKAGE_CODE}`)).isUsed, false);
});

test("expiry math covers active, expired, missing and legacy Timestamp dates at Istanbul midnight", () => {
    const midnight = new Date("2026-11-11T21:00:00Z");
    assert.equal(extendSubscriptionEndDate("2026-11-12", 30, midnight), "2026-12-12");
    assert.equal(extendSubscriptionEndDate("2026-11-11", 30, midnight), "2026-12-11");
    assert.equal(extendSubscriptionEndDate(null, 30, midnight), "2026-12-11");
    assert.equal(extendSubscriptionEndDate(Timestamp.fromDate(midnight), 30, midnight), "2026-12-12");
});

test("expired subscription uses the legacy default duration and a passive business remains closed", async () => {
    const earliest = extendSubscriptionEndDate(EXPIRED_END, 30);
    const result = await post(OWNER_ROUTE, { code: FALLBACK_CODE }, "expired");
    assert.equal(result.status, 200);
    assert.equal(result.body.durationDays, 30);
    assert.ok([earliest, extendSubscriptionEndDate(EXPIRED_END, 30)].includes(result.body.newEndDate));
    assert.equal((await data("publicBarbers/expired")).bookingOpen, false);
});

test("a failed public-profile write rolls back the code and private subscription", async () => {
    const before = await Promise.all([
        data("berberler/atomic"), data("publicBarbers/atomic"), data(`activationCodes/${ATOMIC_CODE}`)
    ]);
    // Both seeded documents fit individually, but the merged public document exceeds Firestore's size limit.
    const result = await post(OWNER_ROUTE, { code: ATOMIC_CODE }, "atomic");
    assert.equal(result.status, 500);
    const after = await Promise.all([
        data("berberler/atomic"), data("publicBarbers/atomic"), data(`activationCodes/${ATOMIC_CODE}`)
    ]);
    assert.deepEqual(after.map(({ name, preserved, ...fields }) => fields),
        before.map(({ name, preserved, ...fields }) => fields));
    assert.equal(after[1].preserved.length, 800_000);
});

test("failed code attempts consume the persistent business quota", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
        const result = await post(OWNER_ROUTE, { code: "BRB-YIL-NOCODE" }, "limited");
        assert.equal(result.status, 404);
    }
    const result = await post(OWNER_ROUTE, { code: "BRB-YIL-NOCODE" }, "limited");
    assert.equal(result.status, 429);
    assert.equal(result.body.error, "rate_limited");
    assert.ok(Number(result.headers.get("Retry-After")) > 0);
});
