import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    archiveOwnerAppointment,
    buildDeterministicArchiveId
} from "../api/_lib/archive-appointment-core.js";

function docKey(collection, id) {
    return `${collection}/${id}`;
}

function createConcurrentMockDb(initial = {}) {
    const docs = new Map(Object.entries(initial));
    let transactionQueue = Promise.resolve();

    const makeRef = (collection, id) => {
        const key = docKey(collection, id);
        return {
            id,
            path: `${collection}/${id}`,
            async get() {
                if (!docs.has(key)) {
                    return { exists: false, data: () => undefined, id };
                }
                const value = docs.get(key);
                return {
                    exists: true,
                    id,
                    data: () => (typeof value === "object" ? { ...value } : value)
                };
            }
        };
    };

    const db = {
        collection(name) {
            return {
                doc(id) {
                    return makeRef(name, id);
                },
                where(field, _op, value) {
                    const filters = [{ field, value }];
                    return {
                        where(nextField, _nextOp, nextValue) {
                            filters.push({ field: nextField, value: nextValue });
                            return this;
                        },
                        limit() {
                            return this;
                        },
                        async get() {
                            const matches = [];
                            for (const [key, data] of docs.entries()) {
                                if (!key.startsWith(`${name}/`)) continue;
                                let ok = true;
                                for (const filter of filters) {
                                    if (data?.[filter.field] !== filter.value) {
                                        ok = false;
                                        break;
                                    }
                                }
                                if (!ok) continue;
                                matches.push({
                                    id: key.slice(name.length + 1),
                                    data: () => ({ ...data }),
                                    ref: makeRef(name, key.slice(name.length + 1))
                                });
                            }
                            return {
                                docs: matches,
                                empty: matches.length === 0
                            };
                        }
                    };
                }
            };
        },
        runTransaction(fn) {
            const run = async () => {
                const working = new Map(docs);
                const tx = {
                    async get(ref) {
                        const key = docKey(ref.path.split("/")[0], ref.id);
                        if (!working.has(key)) {
                            return { exists: false, data: () => undefined, id: ref.id };
                        }
                        const value = working.get(key);
                        return {
                            exists: true,
                            id: ref.id,
                            data: () => (typeof value === "object" ? { ...value } : value)
                        };
                    },
                    set(ref, value) {
                        working.set(docKey(ref.path.split("/")[0], ref.id), { ...value });
                    },
                    delete(ref) {
                        working.delete(docKey(ref.path.split("/")[0], ref.id));
                    }
                };

                const result = await fn(tx);
                docs.clear();
                for (const [key, value] of working.entries()) {
                    docs.set(key, value);
                }
                return result;
            };

            const next = transactionQueue.then(run, run);
            transactionQueue = next.catch(() => {});
            return next;
        }
    };

    return { db, docs };
}

describe("archive appointment idempotency", () => {
    it("buildDeterministicArchiveId is stable and tenant-scoped", () => {
        const first = buildDeterministicArchiveId("shop-a", "appt-1");
        const second = buildDeterministicArchiveId("shop-a", "appt-1");
        assert.equal(first, second);
        assert.notEqual(first, buildDeterministicArchiveId("shop-b", "appt-1"));
        assert.notEqual(first, buildDeterministicArchiveId("shop-a", "appt-2"));
        assert.match(first, /^[a-f0-9]{40}$/);
    });

    it("two concurrent archive calls create exactly one archive document", async () => {
        const appointmentId = "appt-concurrent-1";
        const businessId = "shop-a";
        const { db, docs } = createConcurrentMockDb({
            [docKey("appointments", appointmentId)]: {
                barberId: businessId,
                date: "2099-03-01",
                time: "10:00",
                customerName: "Concurrent Test",
                phone: "5550000000",
                service: "Test"
            },
            [docKey("appointmentSlotLocks", `${businessId}__2099-03-01__10:00`)]: {
                businessId,
                date: "2099-03-01",
                time: "10:00",
                appointmentId
            }
        });

        const input = {
            businessId,
            appointmentId,
            archivedByUid: "uid-owner-a",
            deletedBy: "rules-test",
            deletedByMode: "unit-test"
        };

        const [first, second] = await Promise.all([
            archiveOwnerAppointment(db, input),
            archiveOwnerAppointment(db, input)
        ]);

        assert.equal(first.ok, true);
        assert.equal(second.ok, true);

        const archiveDocs = [...docs.keys()].filter((key) => key.startsWith("deletedAppointments/"));
        assert.equal(archiveDocs.length, 1);
        assert.equal(docs.has(docKey("appointments", appointmentId)), false);
        assert.equal(docs.has(docKey("appointmentSlotLocks", `${businessId}__2099-03-01__10:00`)), false);

        const deterministicId = buildDeterministicArchiveId(businessId, appointmentId);
        assert.equal(archiveDocs[0], docKey("deletedAppointments", deterministicId));
    });

    it("reconciles legacy auto-id archive with still-active appointment once", async () => {
        const appointmentId = "appt-legacy-auto-1";
        const businessId = "shop-a";
        const legacyArchiveId = "legacy-auto-archive-id";
        const { db, docs } = createConcurrentMockDb({
            [docKey("deletedAppointments", legacyArchiveId)]: {
                barberSlug: businessId,
                originalAppointmentId: appointmentId,
                customerName: "Legacy Archive",
                appointmentDate: "2099-03-02",
                appointmentTime: "11:00"
            },
            [docKey("appointments", appointmentId)]: {
                barberId: businessId,
                date: "2099-03-02",
                time: "11:00",
                customerName: "Still Active",
                phone: "5550000001",
                service: "Test"
            }
        });

        const result = await archiveOwnerAppointment(db, {
            businessId,
            appointmentId,
            archivedByUid: "uid-owner-a"
        });

        assert.equal(result.ok, true);
        assert.equal(result.reconciled, true);
        assert.equal(result.archiveId, legacyArchiveId);
        assert.equal(docs.has(docKey("appointments", appointmentId)), false);

        const archiveDocs = [...docs.keys()].filter((key) => key.startsWith("deletedAppointments/"));
        assert.equal(archiveDocs.length, 1);
    });

    it("returns idempotent success when archive exists and source is missing", async () => {
        const appointmentId = "appt-idempotent-1";
        const businessId = "shop-a";
        const archiveId = buildDeterministicArchiveId(businessId, appointmentId);
        const { db } = createConcurrentMockDb({
            [docKey("deletedAppointments", archiveId)]: {
                barberSlug: businessId,
                originalAppointmentId: appointmentId,
                customerName: "Archived",
                appointmentDate: "2099-03-03",
                appointmentTime: "12:00"
            }
        });

        const result = await archiveOwnerAppointment(db, {
            businessId,
            appointmentId,
            archivedByUid: "uid-owner-a"
        });

        assert.equal(result.ok, true);
        assert.equal(result.idempotent, true);
        assert.equal(result.archiveId, archiveId);
    });

    it("fails closed for cross-tenant appointment access", async () => {
        const { db } = createConcurrentMockDb({
            [docKey("appointments", "appt-cross-tenant")]: {
                barberId: "shop-b",
                date: "2099-03-04",
                time: "13:00",
                customerName: "Other Tenant",
                phone: "5550000002",
                service: "Test"
            }
        });

        await assert.rejects(
            () => archiveOwnerAppointment(db, {
                businessId: "shop-a",
                appointmentId: "appt-cross-tenant",
                archivedByUid: "uid-owner-a"
            }),
            (err) => err.code === "forbidden"
        );
    });

    it("fails closed when archive document tenant mismatches membership", async () => {
        const appointmentId = "appt-conflict-1";
        const businessId = "shop-a";
        const deterministicId = buildDeterministicArchiveId(businessId, appointmentId);
        const { db } = createConcurrentMockDb({
            [docKey("deletedAppointments", deterministicId)]: {
                barberSlug: "shop-b",
                originalAppointmentId: appointmentId
            }
        });

        await assert.rejects(
            () => archiveOwnerAppointment(db, {
                businessId,
                appointmentId,
                archivedByUid: "uid-owner-a"
            }),
            (err) => err.code === "archive_conflict"
        );
    });
});
