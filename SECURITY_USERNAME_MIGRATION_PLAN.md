# SECURITY_USERNAME_MIGRATION_PLAN.md

Berber `username` değerlerinin canonical normalizasyona güvenli geçişi.
**Bu görevde çalıştırılmaz** — yalnız plan + dry-run aracı (`usernameMigration.js`).

## Bağlam

- Canonical algoritma: `usernameNormalization.js` (NFKC + trim + `toLocaleLowerCase('tr-TR')` + charset `[a-z0-9._-]` + 3–32).
- Eski `firestoreService.normalizeUsername` (`raw.trim().toLowerCase()`) artık canonical'a **delege** ediyor.
- Risk: giriş anında kullanıcı `"IŞIK"` yazınca eski yol `"işik"`, canonical `"ışık"` üretir. Depolanan `berberler.username` eski yolla yazıldığından Türkçe karakterli hesaplar eşleşmeyebilir.

## Dry-run (yazma yok)

`usernameMigration.js` → `planUsernameMigration(records)`:
- `records`: `berberler` koleksiyonundan `{slug, username}` (Admin SDK okuma)
- Çıktı: `changes` (from→to), `collisions` (aynı canonical'a düşen slug'lar), `invalid` (boş/normalize edilemez), `unchanged`
- `isMigrationSafeToApply(plan)`: `collisions.length === 0 && invalid.length === 0`

## Adımlar

1. **Backup zorunlu** — `SECURITY_BACKUP_RUNBOOK.md` (production export) tamamlanmadan yazma yapılmaz.
2. Admin SDK ortamında `berberler` oku (client script YASAK; service account frontend'e konmaz).
3. `planUsernameMigration` ile rapor üret; sonucu operasyon günlüğüne yaz (secret yok).
4. **Collision veya invalid varsa otomatik migration DURDURULUR** → manuel çözüm.
5. Collision yoksa: her `changes` kaydı için `berberler/{slug}.username = to` (ayrı `usernameLower`/lookup alanı da düşünülebilir — Phase 2 CF kararı).
6. Değişiklikleri küçük batch'lerde uygula; her batch sonrası doğrula.
7. Phase 2 username→Auth identity CF **aynı canonical** JS algoritmasını kullanır.

## Collision politikası

- İki farklı berber aynı canonical username'e düşerse **hiçbir hesap otomatik birleştirilmez/bağlanmaz**.
- Manuel: işletme sahipleriyle iletişim, benzersiz username ataması, ardından migrate.

## Rollback

- Backup export'tan `berberler.username` geri yükleme (yalnız etkilenen slug'lar).
- Migration script idempotent + değiştirilen (slug, from, to) kaydını tutmalı → tersine yazım mümkün.
- Kod tarafı rollback: `firestoreService.normalizeUsername` delegasyonu geri alınabilir (eski `trim().toLowerCase()`), ancak bu H1'i geri açar → yalnız acil.

## Golden vektörler

`tests/phase1-auth.test.mjs` → "canonical username golden vectors" + "username migration dry-run":
`I→ı`, `İ→i`, `ı→ı`, `i→i`, `IŞIK→ışık`, full-width `ＡＢＣ→abc`, görünmez karakter red, uzunluk sınırları, collision tespiti.
