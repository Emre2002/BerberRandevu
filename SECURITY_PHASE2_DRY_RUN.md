# SECURITY_PHASE2_DRY_RUN.md

Phase 2 — username normalizasyonu **dry-run** (envanter; production migration değil).

## Amaç

Mevcut `berberler` hesaplarını değiştirmeden canonical username envanteri ve collision/legacy fark analizi.

## Araçlar

| Bileşen | Rol |
|---------|-----|
| `usernameMigration.js` | `runUsernameDryRun`, `legacyNormalizeUsername`, `parseSanitizedFixture` |
| `usernameNormalization.js` | Canonical algoritma (tek kaynak) |
| `scripts/username-dry-run.mjs` | CLI — varsayılan sanitised fixture |
| `fixtures/berberler-sanitized.sample.json` | Örnek veri (production değil) |

## Varsayılan veri kaynağı

- **Sanitised JSON fixture** (`fixtures/berberler-sanitized.sample.json`)
- Yalnız `slug` + `username` okunur; `password` ve diğer hassas alanlar **işlenmez**

## Çalıştırma (manuel)

```bash
node scripts/username-dry-run.mjs
node scripts/username-dry-run.mjs --fixture path/to/sanitized.json
```

## Production modu (bu görevde çalıştırılmadı)

`--production-readonly`:
- Project ID doğrulaması: `berberrandevu-20a3e`
- Yalnız read; yazma API yok
- Service account repo dışı; manuel onay gerekir
- Bu görevde flag tanımlı ancak **exit 2** ile reddedilir

## Dry-run çıktı özeti (`summary`)

- `totalAccounts`
- `validCanonicalCount`
- `legacyDiffersCount` (eski `trim().toLowerCase()` vs canonical)
- `collisionGroupCount`
- `invalidCount` / `missingUsernameCount`
- `asciiOnlyCount` / `withTurkishCharsCount`
- `safeForAutoMigrationCount` / `requiresManualReviewCount`
- `migrationSafeToApply` (collision+invalid+missing yok)

## Gizlilik

- Password okunmaz, loglanmaz, rapora girmez
- Raporlarda username maskeli (`usernameMasked`) kullanılabilir
- Gerçek production listesi **repository'ye yazılmaz** — çıktı operatör makinesinde veya güvenli depoda

## Testler

`node --test tests/dry-run.test.mjs`

## Sonraki adım

Operatör sanitised veya production-readonly (onaylı) fixture ile CLI çalıştırır → `SECURITY_PHASE2_ACCOUNT_INVENTORY_TEMPLATE.md` doldurulur.
