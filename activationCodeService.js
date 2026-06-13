import {
    doc, getDoc, setDoc, getDocs, deleteDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { PACKAGE_TYPES } from "./subscriptionService.js";

const CODES = "activationCodes";

function randomSegment(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/** BRB-AYLIK-8F3K2L / BRB-3AY-JD92KS / BRB-YIL-72HD9A */
export function generateActivationCode(packageType) {
    const pkg = PACKAGE_TYPES[packageType];
    if (!pkg) throw new Error("Geçersiz paket türü.");
    return `BRB-${pkg.prefix}-${randomSegment(6)}`;
}

/** Super Admin: toplu benzersiz kod üretir ve Firestore'a yazar. */
export async function createActivationCodes({ packageType, count = 1, createdBy = "superAdmin" }) {
    const pkg = PACKAGE_TYPES[packageType];
    if (!pkg) throw new Error("Geçersiz paket türü.");
    const n = Math.min(Math.max(Number(count) || 1, 1), 100);

    const created = [];
    for (let i = 0; i < n; i++) {
        let code = generateActivationCode(packageType);
        let attempts = 0;
        while (attempts < 8) {
            const ref = doc(db, CODES, code);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                await setDoc(ref, {
                    code,
                    packageType,
                    durationDays: pkg.durationDays,
                    isUsed: false,
                    usedByBarberSlug: null,
                    usedAt: null,
                    createdAt: serverTimestamp(),
                    createdBy
                });
                created.push(code);
                break;
            }
            code = generateActivationCode(packageType);
            attempts++;
        }
    }
    return created;
}

/** Super Admin: tüm kodları tek seferde okur (panel açılışında cache'lenir). */
export async function fetchAllActivationCodes() {
    const snap = await getDocs(collection(db, CODES));
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
    });
}

export async function deleteActivationCode(code) {
    const normalized = String(code || "").trim().toUpperCase();
    await deleteDoc(doc(db, CODES, normalized));
}

export function formatCodeDate(value) {
    if (!value) return "—";
    if (typeof value.toDate === "function") {
        return value.toDate().toLocaleString("tr-TR");
    }
    return "—";
}

export function packageLabel(packageType) {
    return PACKAGE_TYPES[packageType]?.label || packageType || "—";
}
