# SECURITY_BACKUP_RUNBOOK.md

Production Firestore yedekleme runbook'u. Bu belge Phase 0 kapsamında **çalıştırılmaz**; operatör tarafından manuel uygulanır.

## 1. Project ID doğrulaması

```bash
firebase projects:list
firebase use
cat .firebaserc
```

Beklenen: `berberrandevu-20a3e`. Uyuşmazlık varsa export **durdurulur**.

## 2. Gerekli IAM yetkileri

Export yapan hesabın en az:
- `roles/datastore.importExportAdmin` (veya eşdeğer Firestore export)
- Hedef Cloud Storage bucket üzerinde `storage.objects.create`, `storage.objects.get`

## 3. Firestore managed export yaklaşımı

Google Cloud Firestore **managed export** (Admin API). Client SDK veya Firebase CLI `firebase firestore:delete` değil.

## 4. Cloud Storage bucket gereksinimi

- Aynı bölgede (Firestore bölgesi ile uyumlu) bucket
- Örnek isim şablonu: `gs://berberrandevu-20a3e-firestore-backups`
- Bucket yoksa operatör oluşturur (bu runbook otomatik oluşturmaz)

## 5. Tarihli export klasörü

Şablon: `gs://<BUCKET>/backups/YYYY-MM-DD-HHMMSS/`

Örnek: `gs://berberrandevu-20a3e-firestore-backups/backups/2026-07-15-phase0/`

## 6. Örnek komut şablonu

```bash
# Project doğrulama
gcloud config get-value project
# Beklenen: berberrandevu-20a3e

# Export (placeholder — operatör bucket adını doldurur)
gcloud firestore export gs://<BACKUP_BUCKET>/backups/<TIMESTAMP> \
  --project=berberrandevu-20a3e
```

Alternatif: GCP Console → Firestore → Import/Export.

## 7. Export başarı doğrulaması

- GCS prefix altında `overall_export_metadata` ve koleksiyon çıktıları mevcut
- Export job durumu `SUCCESSFUL`
- Boyut sıfır değil; beklenen koleksiyonlar (ör. `berberler`, `appointments`, `customers`) listelenir

## 8. Export lokasyonunun kaydı

`SECURITY_BASELINE_MANIFEST.json` veya operasyon günlüğüne **yalnızca**:
- timestamp
- GCS URI
- operatör
- export job ID

Secret veya veri içeriği yazılmaz.

## 9. Restore production üzerinde denenmez

Canlı restore yalnız felaket senaryosunda, ayrı onay ve bakım penceresi ile.

## 10. Ayrı test projesinde restore doğrulaması

1. Staging/test Firebase projesi oluştur (production değil)
2. Test bucket'a import
3. Koleksiyon sayıları / örnek belge varlığı kontrol
4. Production'a dokunulmaz

## 11. Yedek erişim yetkileri

- Bucket IAM: minimum privilege (backup operatör + break-glass admin)
- Service account key repo'ya **konmaz**
- Yerel indirme varsa şifreli depolama; repo dışı

## 12. Saklama ve silme politikası

- Phase 0 baseline: en az 1 export saklanır
- Migration tamamlanana kadar haftalık veya majör faz öncesi export
- Eski export'lar 90 gün sonra silinebilir (operasyon politikası)

---

**Phase 0 durumu:** Export bu görevde çalıştırılmadı. Phase 2 (Auth migration) ve Phase 4 (rules deploy) öncesi tamamlanması zorunludur.
