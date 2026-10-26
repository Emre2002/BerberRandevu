export function renderCampaignHistory(container, history, emptyMessage = "Henüz mesaj gönderilmedi.") {
    container.replaceChildren();

    if (!history.length) {
        const empty = document.createElement("p");
        empty.className = "msg-empty";
        empty.textContent = emptyMessage;
        container.append(empty);
        return;
    }

    for (const campaign of history) {
        const item = document.createElement("div");
        item.className = "msg-history-item";

        const meta = document.createElement("div");
        meta.className = "msg-history-item__meta";
        const date = campaign.createdAt?.toDate?.();
        meta.textContent = `${date ? date.toLocaleString("tr-TR") : "—"} · ${campaign.recipientCount} alıcı`;

        const message = document.createElement("div");
        message.className = "msg-history-item__text";
        message.textContent = campaign.message ?? "";

        item.append(meta, message);
        container.append(item);
    }
}
