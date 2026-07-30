# SECURITY_PHASE2_ACCOUNT_INVENTORY_TEMPLATE.md

Operatör şablonu. **Gerçek production verisi veya tam username listesi bu dosyaya yapıştırılmaz.**

## Run metadata

| Alan | Değer |
|------|--------|
| Tarih | |
| Operatör | |
| Veri kaynağı | fixture / sanitized-export (Git dışı) |
| Fixture yolu (Git dışı önerilir) | |
| Backup alındı mı? | Evet/Hayır |

## Summary (CLI `summary` — yalnız sayılar)

| Metrik | Sayı |
|--------|------|
| totalAccounts | |
| validCanonicalCount | |
| legacyDiffersCount | |
| collisionGroupCount | |
| invalidCount | |
| missingUsernameCount | |
| asciiOnlyCount | |
| withTurkishCharsCount | |
| safeForAutoMigrationCount | |
| requiresManualReviewCount | |
| migrationSafeToApply | true/false |

## Maskeli kayıt formatı (detay listesi — opsiyonel, Git dışı tercih)

Gerçek username veya işletme adı **zorunlu değil**. Örnek sütunlar:

| slugPrefix/hash | canonicalChanged | collisionGroupId | manualReview | not |
|-----------------|------------------|------------------|--------------|-----|
| `fx-col-*` / `a1b2…` | evet/hayır | CG-001 veya — | evet/hayır | collision / invalid / missing |

- `slugPrefix/hash`: tam slug yerine prefix (`fx-`) veya tek yönlü hash
- `canonicalChanged`: legacy ≠ canonical
- `collisionGroupId`: aynı gruptaki kayıtlar aynı ID (`CG-001`)
- `manualReview`: `requiresManualReview` özeti

## Collision grupları (istatistik)

| collisionGroupId | kayıt sayısı | karar |
|------------------|--------------|--------|
| CG-001 | | Manuel / Bekle |

## Karar

- [ ] `migrationSafeToApply === false` → otomatik migration **başlatılmaz**
- [ ] Collision manuel çözüldü
- [ ] Phase 2 onboarding (Auth + controlled reset) ayrı onaylı faz

## Notlar

- Password, telefon, e-posta, müşteri verisi **yer almaz**
- Tam envanter çıktısı güvenli operasyon günlüğünde (Git dışı)
