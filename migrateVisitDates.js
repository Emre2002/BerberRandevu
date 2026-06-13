import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { normalizePhone } from "./customerService.js";

const CUSTOMERS = "customers";
const APPOINTMENTS = "appointments";

/**
 * TEK SEFERLİK MIGRATION — firstVisit / lastVisit alanlarını gerçek randevu
 * tarihlerinden yeniden hesaplar.
 *
 * Eski kayıtlarda firstVisit/lastVisit yanlışlıkla kaydın OLUŞTURMA anına
 * (serverTimestamp) göre yazılmıştı. Bu script:
 *   1) Tüm randevuları TEK SEFERDE okur (tam tarama yalnızca migration anında).
 *   2) barberId + telefon kombinasyonuna göre en eski/en yeni randevu tarihini bulur.
 *   3) Her müşteri kaydına firstVisit = en eski, lastVisit = en yeni yazar.
 *
 * createdAt ve updatedAt'e DOKUNMAZ.
 *
 * Kullanım (Süper Admin sayfası açıkken, tarayıcı konsolunda):
 *   await migrateVisitDates({ dryRun: true })   // önce önizleme
 *   await migrateVisitDates()                    // gerçek yazma
 *
 * @param {{ dryRun?: boolean }} opts
 */
export async function migrateVisitDates({ dryRun = false } = {}) {
    console.log(`[migrateVisitDates] Başlıyor${dryRun ? " (DRY RUN — yazma yok)" : ""}...`);

    // 1) Tüm randevuları oku, barberId + telefon için min/max tarih çıkar.
    const apptSnap = await getDocs(collection(db, APPOINTMENTS));
    const range = {}; // `${barberId}_${phone}` -> { min, max }

    apptSnap.forEach((d) => {
        const a = d.data();
        if (!a || !a.date || !a.barberId) return;
        const phone = normalizePhone(a.phone);
        if (!phone) return;
        const date = String(a.date).slice(0, 10);
        const key = `${a.barberId}_${phone}`;
        if (!range[key]) {
            range[key] = { min: date, max: date };
        } else {
            if (date < range[key].min) range[key].min = date;
            if (date > range[key].max) range[key].max = date;
        }
    });

    // 2) Müşterileri tara, eşleşen randevu tarihleriyle güncelleme listesi oluştur.
    const custSnap = await getDocs(collection(db, CUSTOMERS));
    const ops = [];
    let skipped = 0;
    let noAppointments = 0;

    custSnap.forEach((c) => {
        const data = c.data();
        const phone = normalizePhone(data.phone);
        const key = `${data.barberSlug}_${phone}`;
        const r = range[key];

        if (r) {
            ops.push({ id: c.id, firstVisit: r.min, lastVisit: r.max });
            return;
        }

        // Randevu bulunamadı (silinmiş olabilir): varsa lastAppointmentDate'e düş, yoksa atla.
        const fallback = typeof data.lastAppointmentDate === "string"
            ? data.lastAppointmentDate.slice(0, 10) : null;
        if (fallback) {
            ops.push({ id: c.id, firstVisit: fallback, lastVisit: fallback });
        } else {
            noAppointments++;
            skipped++;
        }
    });

    if (dryRun) {
        console.table(ops.slice(0, 100));
        const summary = { totalCustomers: custSnap.size, willUpdate: ops.length, skipped, noAppointments, dryRun: true };
        console.log("[migrateVisitDates] Önizleme:", summary);
        return summary;
    }

    // 3) Güncellemeleri yaz (createdAt / updatedAt'e dokunmadan).
    let updated = 0;
    for (const op of ops) {
        await updateDoc(doc(db, CUSTOMERS, op.id), {
            firstVisit: op.firstVisit,
            lastVisit: op.lastVisit
        });
        updated++;
    }

    const summary = { totalCustomers: custSnap.size, updated, skipped, noAppointments };
    console.log("[migrateVisitDates] Tamamlandı:", summary);
    return summary;
}
