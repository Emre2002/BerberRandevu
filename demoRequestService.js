import {
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    query,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, hasFirebaseConfig } from "./firebase-config.js";

const COLLECTION = "demo_talepleri";

function ensureDb() {
    if (!hasFirebaseConfig() || !db) {
        throw new Error("Firebase yapılandırması eksik. Süper admin panelinden yapılandırın.");
    }
    return db;
}

export async function submitDemoRequest({ adSoyad, telefon, email, dukkanAdi, mesaj = "" }) {
    const database = ensureDb();

    if (!adSoyad?.trim()) throw new Error("Ad Soyad zorunludur.");
    if (!telefon?.trim()) throw new Error("Telefon numarası zorunludur.");
    if (!email?.trim()) throw new Error("E-posta adresi zorunludur.");
    if (!dukkanAdi?.trim()) throw new Error("Dükkan adı zorunludur.");

    await addDoc(collection(database, COLLECTION), {
        adSoyad: adSoyad.trim(),
        telefon: telefon.trim(),
        email: email.trim(),
        dukkanAdi: dukkanAdi.trim(),
        mesaj: (mesaj || "").trim(),
        durum: "pasif",
        olusturmaTarihi: serverTimestamp()
    });
}

export async function fetchAllDemoRequests() {
    const database = ensureDb();
    const snap = await getDocs(
        query(collection(database, COLLECTION), orderBy("olusturmaTarihi", "desc"))
    );
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    return items;
}

export async function updateDemoRequestStatus(id, durum) {
    const database = ensureDb();
    await updateDoc(doc(database, COLLECTION, id), { durum });
}

export function formatDemoRequestDate(ts) {
    if (!ts) return "—";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}
