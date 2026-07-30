# SECURITY_PHASE2_OPERATOR_RUNBOOK.md

Operatör dry-run iş akışı. **Production migration değil** — yalnız envanter.

## Ön koşullar

- Node 20+; repo kökünden çalıştır
- Production veri için: `SECURITY_BACKUP_RUNBOOK.md` backup tamamlanmış olmalı
- **Password, telefon, müşteri verisi fixture'a eklenmez**
- Gerçek username/işletme listesi **Git'e commit edilmez**

## 1. Sample fixture ile dry-run

```bash
node scripts/username-dry-run.mjs
```

Varsayılan: `fixtures/berberler-sanitized.sample.json` → stdout JSON (`summary` + `meta`).

## 2. Kullanıcı hazırladığı sanitized fixture

Operatör production'dan **yalnız** `slug` + `username` çıkarır (Admin SDK, repo dışı). Dosyayı güvenli dizinde tutar:

```bash
node scripts/username-dry-run.mjs --fixture /path/outside/repo/my-sanitized.json
```

Edge-case doğrulama (sahte veri):

```bash
node scripts/username-dry-run.mjs --fixture fixtures/berberler-sanitized.edge-cases.json
```

## 3. Çıktı yorumlama

| Alan | Anlam |
|------|--------|
| `migrationSafeToApply: false` | Otomatik devam **yasak** |
| `collisionGroupCount > 0` | Aynı canonical → manuel çözüm |
| `legacyDiffersCount > 0` | Eski `trim().toLowerCase()` ≠ canonical (Türkçe risk) |
| `missingUsernameCount` | Eksik alan → manuel |
| `safeForAutoMigrationCount` | Teorik auto-safe (collision/invalid/missing yok); yine de onay gerekir |

**Collision varsa otomatik devam edilmez** — iki farklı işletme aynı login kimliğine düşer; hesap birleştirme yapılmaz.

## 4. Gizlilik ve repo güvenliği

- CLI yalnız **stdout** yazar; repository'ye hesap listesi **yazmaz**
- Çıktıyı dosyaya kaydedecekseniz: Git dışı, erişim kısıtlı dizin
- `SECURITY_PHASE2_ACCOUNT_INVENTORY_TEMPLATE.md` → yalnız istatistik + maskeli kayıt
- Password alanları fixture'da **asla** bulunmamalı (`parseSanitizedFixture` yalnız slug/username alır)

## 5. Production-readonly

- `--production-readonly`: tanımlı; project ID `berberrandevu-20a3e` doğrulanır; **yalnız read**
- **Production collector henüz yok** — flag şu an exit 2 ile reddedilir
- Production erişimi için: ayrı güçlü model güvenlik review + manuel onay + service account (repo dışı) zorunlu
- Bu aşamada: migration write, Auth kullanıcı, membership, rules deploy **yasak**

## 6. Test doğrulama

```bash
node --test tests/dry-run.test.mjs
```

## 7. Envanter doldurma

Özet sayıları `SECURITY_PHASE2_ACCOUNT_INVENTORY_TEMPLATE.md` içine işle; detaylı slug listesi operasyon günlüğünde (Git dışı).
