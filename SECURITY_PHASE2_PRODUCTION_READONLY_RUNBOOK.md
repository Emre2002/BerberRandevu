# SECURITY PHASE 2 — Production Read-Only Collector Runbook

> Bu runbook `scripts/username-production-readonly.mjs` collector'ının **güvenli** çalıştırılması içindir.
> Collector **yalnız salt okunur**dur ve **yalnız `berberler` collection'ındaki `username` alanını** okur.
> **Bu görevde collector çalıştırılmamıştır.** Aşağıdaki adımlar yetkili operatör içindir.

Beklenen Firebase project ID: **`berberrandevu-20a3e`**

---

## 1. Ön koşul: Production backup zorunludur

Herhangi bir **write** migration'dan önce production Firestore export'u alınmış olmalıdır
(`SECURITY_BACKUP_RUNBOOK.md`). Collector write yapmaz; ancak backup, sonraki write
fazının ön koşuludur ve collector çalıştırmadan önce doğrulanmalıdır.

## 2. Collector ne okur / ne okumaz

- Okur: `berberler` collection, **yalnız** `username` alanı (Firestore projection: `.select("username")`).
- Belge ID'si (slug) yalnız **bellekte** kullanılır; diske yazılmaz.
- **Okumaz:** `password`, `passwordHash`, `phone`, `email`, müşteri verisi, randevular, abonelik verisi ve diğer belge alanları.
- Tam belge getiren `get()`/`list()` **kullanılmaz** (yalnız projeksiyonlu query).

## 3. Kimlik bilgileri: ADC + read-only IAM

- **Application Default Credentials (ADC)** kullanılır. Repository'ye service-account JSON eklenmez.
- Üretim çalıştırması için tercihen **ayrı bir operatör hesabı** ve **yalnız salt okunur** rol:
  - Önerilen: `roles/datastore.viewer` (yalnız Firestore read).
- **Riskli:** Geniş `roles/owner` veya `roles/editor` yetkili hesap kullanmayın. Bu hesaplar
  yanlışlıkla write/silme yapabilir ve collector'ın salt okunur garantisini operatör tarafında zayıflatır.
- Bu runbook kapsamında **yapılmaz**: `gcloud auth login`, IAM rol atama, service account oluşturma,
  credential dosyası üretme. Bunlar operatörün ayrı, denetlenmiş sürecidir.

## 4. Beklenen project ID doğrulaması

Collector üç kaynağı karşılaştırır ve üçü de eşit değilse **hiçbir sorgu yapmaz**:

1. Sabit beklenen ID: `berberrandevu-20a3e`
2. CLI `--project=` değeri
3. Runtime credential/config project ID (`GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` / `GCP_PROJECT`)

## 5. Çalıştırmadan önce Git kontrolü

```bash
git status          # working tree temiz olmalı
git branch --show-current
git diff --check
```

Collector çıktısı repo'ya yazılmadığından, çalıştırma sonrası working tree değişmemelidir.

## 6. Çalıştırma komutu şablonu (bu görevde ÇALIŞTIRILMAZ)

```bash
# ADC operatör tarafında ayrıca hazırlanır (bu görevde yapılmaz).
node scripts/username-production-readonly.mjs \
  --production-readonly \
  --project=berberrandevu-20a3e \
  --confirm-project=berberrandevu-20a3e
```

Üç guard'dan biri eksik/yanlışsa collector **bağlanmadan** non-zero exit verir.

## 7. Bu görevde gerçek çalıştırma yapılmaz

Collector kodu ve testleri hazırlanmıştır; **production'a bağlanılmamıştır**. Gerçek çalıştırma
yalnız yetkili operatör tarafından, ayrı ve denetlenen bir ortamda yapılır.

## 8. Terminal çıktısı kişisel veri içermez

Çıktı yalnız şunları içerir: toplam kayıt, geçerli/geçersiz sayı, normalizasyonu değişen kayıt sayısı,
collision grup sayısı, otomatik migration güvenli mi, ve **maskeli** kayıt referansları
(slug SHA-256 ilk 12 karakter, username maskesi, collision group ID, canonical değişti mi, manual review gerekli mi).
**Raw slug / raw username / password basılmaz.**

## 9. Çıktı repository'ye yönlendirilmez

Çıktıyı dosyaya (`> out.json` vb.) yönlendirmeyin, fixture olarak kaydetmeyin, repo'ya commit etmeyin.

## 10. Collision / invalid varsa migration durur

Collector `collisionGroupCount > 0`, `invalidCount > 0` veya `migrationSafeToApply=false` durumunda
non-zero exit verir ve otomatik migration'ı **güvenli olarak işaretlemez**. Bu durumda write migration
başlatılmaz; manuel inceleme gerekir.

## 11. Credential temizleme / logout

Çalıştırma sonrası operatör ADC oturumunu sonlandırmalıdır (ör. `gcloud auth application-default revoke`),
geçici credential dosyaları silinmelidir. Bu adımlar operatör ortamında yapılır.

## 12. Operatör sonuç şablonu

```
COLLECTOR RUN
- Date/Operator:
- Project ID (runtime match): yes/no
- Total records:
- Valid / Invalid:
- Canonical changed count:
- Collision groups:
- migrationSafeToApply: yes/no
- Exit code:
```

## 13. Gerçek sonuç kopyalanmaz

Gerçek production sonucu (maskeli olsa dahi) sohbete, Git'e veya public issue'ya kopyalanmaz.
Sonuçlar denetlenen, erişimi kısıtlı bir kanalda saklanır.

## 14. Collector sonrası write yapılmaz

Collector yalnız envanter/analiz amaçlıdır. Sonrasında username verisi üzerinde **hiçbir write** yapılmaz.

## 15. Sonraki write migration için ayrı inceleme

Gerçek write migration (username normalizasyonu, Auth onboarding) ayrı bir fazdır ve
**ayrı, güçlü bir model incelemesi** ile güvenlik onayı gerektirir.
