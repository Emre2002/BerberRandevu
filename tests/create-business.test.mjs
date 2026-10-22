import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBusiness } from "../api/_lib/create-business-core.js";

const input = {
    slug: "ornek-berber", name: "Örnek Berber", username: "ornekowner",
    password: "SafePassword123", openHour: "09:00", closeHour: "19:00"
};

function fixture({ failTransaction = false, existingAuth = false } = {}) {
    const documents = new Map();
    const authInputs = [];
    let authCreates = 0;
    const ref = (path) => ({ path, get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }) });
    const db = {
        collection(name) {
            return {
                doc: (id) => ref(`${name}/${id}`),
                where: (_field, _op, value) => ({
                    limit: () => ({ get: async () => ({
                        empty: ![...documents.entries()].some(([path, data]) => path.startsWith("berberler/") && data.username === value)
                    }) })
                })
            };
        },
        async runTransaction(callback) {
            if (failTransaction) throw new Error("simulated_firestore_failure");
            const writes = [];
            const result = await callback({
                get: (document) => document.get(),
                create: (document, data) => writes.push(["create", document.path, data]),
                update: (document, data) => writes.push(["update", document.path, { ...documents.get(document.path), ...data }])
            });
            for (const [operation, path, data] of writes) {
                if (operation === "create" && documents.has(path)) throw new Error("already_exists");
                documents.set(path, data);
            }
            return result;
        }
    };
    const auth = {
        async createUser({ email, password }) {
            authCreates++;
            authInputs.push({ email, password });
            if (existingAuth || authCreates > 1) {
                throw Object.assign(new Error("exists"), { code: "auth/email-already-exists" });
            }
            return { uid: "owner-uid-1" };
        }
    };
    return { db, auth, documents, authInputs, getAuthCreates: () => authCreates };
}

describe("Superadmin business provisioning", () => {
    it("creates private, public, membership and login records with the same owner identity", async () => {
        const f = fixture();
        const result = await createBusiness({ ...f, timestamp: () => "now", input });
        assert.equal(result.ownerUid, "owner-uid-1");
        assert.equal(f.authInputs[0].email, "ornekowner@users.berberrandevu.internal");
        assert.equal(f.authInputs[0].password, input.password);
        assert.equal(f.documents.size, 4);
        assert.equal(f.documents.get("berberler/ornek-berber").ownerUid, result.ownerUid);
        assert.deepEqual(f.documents.get("businessMemberships/owner-uid-1"), {
            uid: result.ownerUid, businessId: result.slug, role: "owner", status: "active",
            createdAt: "now", updatedAt: "now"
        });
        assert.equal(f.documents.get("authLoginIndex/ornekowner").businessId, result.slug);
        const publicBarber = f.documents.get("publicBarbers/ornek-berber");
        assert.equal(publicBarber.slug, result.slug);
        assert.deepEqual(publicBarber.selectedServices, f.documents.get("berberler/ornek-berber").selectedServices);
        assert.equal(publicBarber.openHour, input.openHour);
        assert.equal(publicBarber.password, undefined);

        await assert.rejects(
            createBusiness({ ...f, timestamp: () => "now", input }),
            (error) => error.code === "business_exists" && error.status === 409
        );
        assert.equal(f.getAuthCreates(), 1);
    });

    it("rejects an existing Authentication account without Firestore writes", async () => {
        const f = fixture({ existingAuth: true });
        await assert.rejects(createBusiness({ ...f, timestamp: () => "now", input }),
            (error) => error.code === "owner_exists" && error.status === 409);
        assert.equal(f.documents.size, 0);
    });

    it("approves a claimed application atomically without storing or returning the password", async () => {
        const f = fixture();
        const { password: _unused, ...pendingInput } = input;
        f.documents.set("pendingBarbers/application-1", {
            status: "processing", shopName: input.name, email: "applicant@example.test", phone: "5551234567"
        });
        const result = await createBusiness({
            ...f, timestamp: () => "now",
            input: { ...pendingInput, email: "applicant@example.test", phone: "5551234567", pendingId: "application-1" }
        });
        assert.equal(f.authInputs[0].email, "applicant@example.test");
        assert.ok(f.authInputs[0].password.length >= 32);
        assert.notEqual(f.authInputs[0].password, input.password);
        assert.equal(f.documents.get("authLoginIndex/ornekowner").loginMode, "email");
        assert.equal(f.documents.get("pendingBarbers/application-1").status, "approved");
        assert.equal(f.documents.get("pendingBarbers/application-1").createdSlug, result.slug);
        assert.equal(JSON.stringify(result).includes(input.password), false);
        assert.equal(Object.hasOwn(result, "password"), false);
        for (const data of f.documents.values()) {
            assert.equal(Object.hasOwn(data, "password"), false);
            assert.equal(Object.hasOwn(data, "createdPassword"), false);
            assert.equal(JSON.stringify(data).includes(input.password), false);
            assert.equal(JSON.stringify(data).includes(f.authInputs[0].password), false);
        }
    });

    it("does not save a temporary password when application provisioning fails", async () => {
        const f = fixture({ failTransaction: true });
        const { password: _unused, ...pendingInput } = input;
        f.documents.set("pendingBarbers/application-1", {
            status: "processing", shopName: input.name, email: "applicant@example.test", phone: "5551234567"
        });
        await assert.rejects(createBusiness({
            ...f, timestamp: () => "now",
            input: { ...pendingInput, email: "applicant@example.test", phone: "5551234567", pendingId: "application-1" }
        }), (error) => error.code === "provisioning_incomplete" && !error.message.includes(input.password));
        assert.equal(f.documents.get("pendingBarbers/application-1").status, "processing");
        assert.equal(Object.hasOwn(f.documents.get("pendingBarbers/application-1"), "createdPassword"), false);
    });

    it("reports incomplete provisioning and does not delete Auth on transaction failure", async () => {
        const f = fixture({ failTransaction: true });
        await assert.rejects(createBusiness({ ...f, timestamp: () => "now", input }),
            (error) => error.code === "provisioning_incomplete" && error.status === 503);
        assert.equal(f.getAuthCreates(), 1);
        assert.equal(f.documents.size, 0);
    });

    it("validates before creating any account", async () => {
        const f = fixture();
        await assert.rejects(createBusiness({ ...f, timestamp: () => "now", input: { ...input, password: "bad" } }),
            (error) => error.status === 400);
        assert.equal(f.getAuthCreates(), 0);
        await assert.rejects(createBusiness({
            ...f, timestamp: () => "now",
            input: { ...input, pendingId: "application-1" }
        }), (error) => error.status === 400);
    });

    it("routes creation through a server-side Superadmin check and same-origin API", () => {
        const route = readFileSync(resolve("api/create-business.js"), "utf8");
        const client = readFileSync(resolve("privilegedApiClient.js"), "utf8");
        const resolver = readFileSync(resolve("api/_lib/resolve-auth.js"), "utf8");
        const service = readFileSync(resolve("firestoreService.js"), "utf8");
        assert.ok(route.indexOf("requireSuperAdmin(req)") < route.indexOf("createBusiness({"));
        assert.match(route, /sendJson\(res, 201, \{ ok: true, \.\.\.result \}\)/);
        assert.doesNotMatch(route, /console\.error\([^\n]*input|sendJson\([^\n]*input/);
        assert.match(client, /return window\.location\.origin;/);
        assert.match(service, /callPrivilegedApi\("createBusinessForSuperAdmin"/);
        assert.match(resolver, /loginMode === "email"/);
    });

    it("claims a pending application before creating a business, preventing duplicate approval", () => {
        const source = readFileSync(resolve("pendingBarberService.js"), "utf8");
        const approval = source.slice(source.indexOf("export async function approvePendingBarber"));
        assert.ok(approval.indexOf("runTransaction(database") < approval.indexOf("await createBarber({"));
        assert.match(approval, /data\.status !== "pending"/);
        assert.match(approval, /status: "processing"/);
        assert.doesNotMatch(approval, /createdPassword:\s*password/);
        assert.doesNotMatch(source, /crypto\.getRandomValues|Math\.random|buildWhatsAppApprovalLink|generatePassword/);
        const core = readFileSync(resolve("api/_lib/create-business-core.js"), "utf8");
        assert.match(core, /randomBytes\(32\)/);
        const panel = readFileSync(resolve("pendingBarbersPanel.js"), "utf8");
        assert.doesNotMatch(panel, /showOneTimeCredential|buildWhatsAppApprovalLink|createdPassword:\s*result\.password|https:\/\/wa\.me/);
    });
});
