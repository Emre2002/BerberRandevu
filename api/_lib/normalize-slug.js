const TR_MAP = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", I: "i", Ö: "o", Ş: "s", Ü: "u"
};

export function normalizeSlug(raw) {
    let s = String(raw || "").trim();
    for (const [from, to] of Object.entries(TR_MAP)) {
        s = s.split(from).join(to);
    }
    return s
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
