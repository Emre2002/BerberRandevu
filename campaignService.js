import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { fetchAllCustomers, fetchCustomersByBarber } from "./customerService.js";

const CAMPAIGNS = "campaigns";

/** Süper Admin bayram şablonları */
export const SUPER_ADMIN_TEMPLATES = {
    kurban: {
        id: "kurban",
        label: "Kurban Bayramı",
        body: "Kurban Bayramınız mübarek olsun! 🕌 Saç ve sakal bakımı için online randevu oluşturabilirsiniz."
    },
    ramazan: {
        id: "ramazan",
        label: "Ramazan Bayramı",
        body: "Ramazan Bayramınız kutlu olsun! ✨ Bayram tıraşı için hemen randevu alın."
    },
    newyear: {
        id: "newyear",
        label: "Yeni Yıl",
        body: "Mutlu yıllar! 🎉 Yeni yıla fresh bir görünümle girin — online randevunuzu oluşturun."
    },
    fathersday: {
        id: "fathersday",
        label: "Babalar Günü",
        body: "Babalar Gününüz kutlu olsun! 👔 Özel gün tıraşı için randevu linkimizden kolayca rezervasyon yapabilirsiniz."
    }
};

/** Berber paneli şablonları */
export const BARBER_TEMPLATES = {
    bayram: {
        id: "bayram",
        label: "Bayram Mesajı",
        body: "Bayramınız mübarek olsun! 🌙 Randevunuzu online oluşturmak için linke tıklayın."
    },
    kampanya: {
        id: "kampanya",
        label: "Kampanya Mesajı",
        body: "Bu hafta özel kampanyamız var! ✂️ Detaylar ve randevu için bize ulaşın."
    },
    indirim: {
        id: "indirim",
        label: "İndirim Mesajı",
        body: "Sadece sizin için %20 indirim! 🎁 Randevunuzu hemen oluşturun."
    },
    hatirlatma: {
        id: "hatirlatma",
        label: "Hatırlatma Mesajı",
        body: "Sizi özledik! 💈 Bakım zamanınız geldi — online randevu ile kolayca yer ayırtın."
    }
};

export function buildTemplateMessage(template, barberName = "") {
    const prefix = barberName ? `${barberName}: ` : "";
    return prefix + (template?.body || "");
}

export async function sendCampaign({
    target = "all",
    barberSlug = null,
    templateId,
    customMessage = "",
    sentBy = "superAdmin",
    templates = SUPER_ADMIN_TEMPLATES
}) {
    const template = templates[templateId];
    const message = customMessage.trim() || buildTemplateMessage(template);

    if (!message) throw new Error("Mesaj içeriği boş olamaz.");

    const customers = target === "all"
        ? await fetchAllCustomers()
        : await fetchCustomersByBarber(barberSlug);

    if (!customers.length) throw new Error("Gönderilecek müşteri bulunamadı.");

    const ref = await addDoc(collection(db, CAMPAIGNS), {
        target,
        barberSlug: barberSlug || null,
        templateId: templateId || "custom",
        templateLabel: template?.label || "Özel Mesaj",
        message,
        recipientCount: customers.length,
        sentBy,
        status: "sent",
        createdAt: serverTimestamp()
    });

    console.info("[Campaign Mock] Mesaj gönderildi:", {
        campaignId: ref.id,
        recipients: customers.length,
        preview: message.slice(0, 80)
    });

    return { id: ref.id, recipientCount: customers.length, message, customers };
}

export async function fetchCampaignHistory(limit = 30) {
    const q = query(collection(db, CAMPAIGNS), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list.slice(0, limit);
}

export async function fetchCampaignsByBarber(barberSlug, limit = 20) {
    const all = await fetchCampaignHistory(100);
    return all
        .filter((c) => c.sentBy === barberSlug || c.barberSlug === barberSlug)
        .slice(0, limit);
}
