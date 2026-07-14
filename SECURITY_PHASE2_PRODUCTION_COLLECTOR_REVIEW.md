# SECURITY PHASE 2 — Production Read-Only Collector Review

**Kapsam:** `scripts/username-production-readonly.mjs` ve `tests/production-readonly-collector.test.mjs`
**Amaç:** Production `berberler` hesaplarının salt okunur, hassas veri diske yazmayan envanteri.
**Durum:** Kod + testler yazıldı. Production'a **bağlanılmadı**, collector **çalıştırılmadı**.

---

## 1. Credential yaklaşımı

- **Application Default Credentials (ADC)** kullanılır (`applicationDefault()`).
- Repository'de service-account JSON, private key veya access token **yoktur**.
- `firebase-admin` import'u yalnız guard'lar geçtikten **sonra** dinamik olarak yapılır; testler bu yolu tetiklemez.

## 2. IAM varsayımları

- Üretim için önerilen: ayrı operatör hesabı + `roles/datastore.viewer` (salt okunur).
- Geniş `owner`/`editor` yetkili hesap **önerilmez** (runbook §3'te risk belirtildi).
- Bu görevde IAM değişikliği / login / service account oluşturma **yapılmadı**.

## 3. Project guard

- Üç kaynak eşitliği zorunlu: sabit `berberrandevu-20a3e`, CLI `--project`, runtime credential project.
- `validateProjectGuard()` saf fonksiyonu; eksik flag, mismatch veya runtime project yokluğunda `ok:false`.
- Guard başarısızsa `main()` bağlantıdan **önce** `exit(2)`.
- Generic `--collection` **kabul edilmez**; collection sabit `berberler`.

## 4. Projection doğrulaması

- `PROJECTION_FIELDS = ["username"]`, query `.collection("berberler").select("username")`.
- `mapDocsToRecords()` yalnız `doc.id` (slug) ve `doc.get("username")` okur; `data()` (tam belge) kullanmaz.
- Testler projection alanının yalnız `username` olduğunu ve tam-belge okumanın yapılmadığını doğrular.

## 5. Read-only API yüzeyi

- Yalnız `.collection(...).select(...).get()` (query/read) kullanılır.
- Hiçbir write metodu import edilmez/çağrılmaz; write-capable adapter fonksiyon parametresi olarak kabul edilmez.
- Statik kontrol testi collector kaynağında `.set( .add( .update( .delete( .create( .batch( .bulkWriter( .runTransaction(` aramasında **başarısız** olur (yalnız collector dosyası denetlenir → false positive yok).

## 6. Hassas veri sanitizasyonu

- Production username değerleri diske/fixture'a/repo'ya/düz metne **yazılmaz**.
- Çıktı yalnız summary + **maskeli** referanslar (slug SHA-256 ilk 12 char, username maskesi, collision group ID, canonicalChanged, manualReview).
- `assertOutputSanitized()` çıktıda raw slug/raw username sızıntısı bulursa `throw` eder → `exit(8)`.
- Hata mesajları belge içeriği/stack yerine sadece kod/kategori basar.

## 7. Exit davranışı

| Durum | Exit |
|---|---|
| Guard fail (flag/project/runtime mismatch, credential yok) | 2 |
| Collision bulundu | 3 |
| Invalid kayıt | 4 |
| Missing username | 5 |
| migrationSafeToApply=false | 6 |
| Query hatası | 7 |
| Sanitization hatası | 8 |
| Temiz | 0 |

Collision/invalid varsa `migrationSafeToApply` **true olmaz** (kaynak: `runUsernameDryRun`).

## 8. Test kapsamı

`tests/production-readonly-collector.test.mjs` doğrular:
- flag/yanlış project/eksik confirm → bağlantı çağrılmaz (guard fail)
- runtime credential mismatch ve credential yok → fail-closed
- yalnız `berberler` collection; projection yalnız `username`
- doc mapping yalnız id+username okur (data() çağırmaz)
- write metotları collector kaynağında yok (statik kontrol)
- raw username/slug/password stdout JSON'da yok
- collision ve invalid → non-zero
- temiz veri → success (exit 0), yalnız maskeli referanslar
- sanitization guard leak'te throw
- **production bağlantısı testlerde hiçbir zaman kurulmaz** (saf helper'lar + mock doc)

## 9. Kalan riskler

- Operatör tarafında geniş IAM rolü kullanılırsa salt okunur garanti zayıflar (süreçsel kontrol gerekir).
- ADC yanlış hesapla hazırlanırsa yanlış projeye bağlanma riski runtime guard ile azaltılır ancak operatör dikkati şarttır.
- Firestore `select()` sunucu tarafında yalnız istenen alanı döndürür; ağ üzerinde password taşınmaz — yine de IAM read yetkisi tüm alanlara erişebildiği için minimum-yetki hesap önerilir.
- Statik write kontrolü tek savunma değildir; ana güvence read-only API kullanımı ve project guard'dır.

## 10. Manuel güvenlik kontrolleri (operatör)

- Çalıştırmadan önce ADC hesabının yalnız `datastore.viewer` olduğunu doğrula.
- `git status` temiz; çıktı repo'ya yönlendirilmedi.
- Çalıştırma sonrası credential revoke / geçici dosya temizliği.
- Çıktının (maskeli dahi) sohbet/Git/issue'ya kopyalanmaması.

## 11. Production'da çalıştırmaya hazır mı?

**REVIEW_REQUIRED.** Kod salt okunur, guard'lı ve maskelidir; ancak:
- Yerel test çalıştırması bu oturumda **yapılamadı** (shell ortamı komut döndürmedi) — operatör önce
  `node --test tests/production-readonly-collector.test.mjs`, dry-run ve Phase 1 testlerini yeşil görmelidir.
- Operatör tarafında read-only ADC ve backup ön koşulu doğrulanmalıdır.
- Sonraki write migration ayrı, güçlü model incelemesi gerektirir.
