import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { upsertCustomerOnAppointment, normalizePhone } from "./customerService.js";
import { notifyNewAppointment } from "./notificationService.js";

const INACTIVE_APPOINTMENT_STATUSES = new Set([
    "cancelled",
    "canceled",
    "iptal",
    "deleted",
    "pasif",
    "inactive"
]);

/** Silinmiş / iptal edilmiş randevular hariç aktif kabul edilir. */
export function isActiveAppointmentStatus(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    return !INACTIVE_APPOINTMENT_STATUSES.has(normalized);
}

/**
 * Aynı gün için önceden yüklenmiş randevu haritasında telefon eşleşmesi arar.
 * Ek Firestore read gerektirmez; barberId + date filtresi getDayData tarafından sağlanır.
 */
export function findActiveAppointmentByPhoneOnDay({ appointments, phone }) {
    const targetPhone = normalizePhone(phone);
    if (!targetPhone || !appointments) return null;

    for (const appt of Object.values(appointments)) {
        if (!appt || !isActiveAppointmentStatus(appt.status)) continue;
        if (normalizePhone(appt.phone) !== targetPhone) continue;
        return appt;
    }
    return null;
}

/**
 * Randevu oluşturur; müşteri DB, bildirim ve Telegram yan etkilerini tetikler.
 */
export async function createAppointmentWithEffects({
    barberId,
    customerName,
    phone,
    service,
    date,
    time,
    status = "confirmed",
    musteriNotu = ""
}) {
    const ref = await addDoc(collection(db, "appointments"), {
        barberId,
        customerName,
        phone,
        service,
        date,
        time,
        status,
        musteriNotu: musteriNotu || ""
    });

    const cleanPhone = phone && phone !== "—" ? phone : null;

    if (cleanPhone) {
        await upsertCustomerOnAppointment({
            barberSlug: barberId,
            customerName,
            phone: cleanPhone,
            appointmentDate: date
        });
    }

    await notifyNewAppointment({
        barberSlug: barberId,
        customerName,
        phone: cleanPhone || "—",
        date,
        time
    });

    return ref.id;
}
