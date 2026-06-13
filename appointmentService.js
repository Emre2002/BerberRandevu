import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { upsertCustomerOnAppointment } from "./customerService.js";
import { notifyNewAppointment } from "./notificationService.js";

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
