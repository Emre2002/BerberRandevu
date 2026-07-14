# SECURITY_PHASE1_FIXES.md

Phase 1 incelemesinde (SECURITY_PHASE1_REVIEW.md) doğrulanan bulguların düzeltmeleri.

## 1. Düzeltilen bulgular

| ID | Sev | Durum |
|----|-----|-------|
| H1 | High | FIXED — tek canonical normalizasyon; `firestoreService` delege |
| M1 | Medium | FIXED — generation guard + user değişiminde state temizliği |
| M2 | Medium | FIXED — DI adapter ile test edilebilir signOut |
| M3 | Medium | FIXED — kullanılmayan `authInstance` kaldırıldı |
| L1 | Low | FIXED — IPv6 `::1`/`[::1]` desteği; fail-closed korundu |

## 2. Değiştirilen dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `firestoreService.js` | `normalizeUsername` → canonical'a delege (import eklendi) |
| `authService.js` | State machine wiring; DI signOut; init sırası; teardown |
| `authStateMachine.js` | **Yeni** — saf, generation guard'lı state machine |
| `usernameMigration.js` | **Yeni** — saf dry-run planlayıcı + collision tespiti |
| `legacyAuthCompat.js` | `isLocalDevHost` IPv6 seti |
| `firebase-config.js` | Kullanılmayan `authInstance` kaldırıldı |
| `tests/phase1-auth.test.mjs` | 19 → 46 test |

Kaynak/test dosyası: 7 (≤ 8 limiti).

## 3. Canonical username algoritması

- Kaynak: `usernameNormalization.js`
- `String(raw).trim().normalize("NFKC").toLocaleLowerCase("tr-TR")`
- Doğrulama: `[a-z0-9._-]`, uzunluk 3–32, görünmez/kontrol karakter charset ile reddedilir
- `firestoreService.normalizeUsername` artık yalnız delege eder — **tek algoritma**
- Mevcut veri: **değiştirilmedi**; `SECURITY_USERNAME_MIGRATION_PLAN.md` + dry-run aracı

## 4. Membership race guard

- `authStateMachine.js`: her `handleAuthUser` `generation` artırır
- Kullanıcı değişiminde önceki `membership`/`businessId` derhal temizlenir
- Membership fetch yalnız `gen === generation` ise state'e yazar (stale ignore)
- Sign-out sonrası geç dönen istek owner üretmez
- Fetch hatası fail-closed (`error` → guard `ERROR`)
- Malformed / uid-uyuşmazlığı / geçersiz businessId → owner değil
- Tek `onAuthStateChanged` (unsubscribe guard); `teardownAuthFoundation` ile cleanup

## 5. Sign-out testability

- `authStateMachine` `authAdapter.signOut` DI alır
- `authService` gerçek adapter'ı (CDN `signOut`) enjekte eder
- Testler: success (adapter çağrısı + null user owner temizler), failure (fail-closed), stale request ignore
- Monkey-patch yok

## 6. Auth initialization sırası

`firebase-config.getAuthInstance`: app → auth instance → (emulator) → persistence (`authService`) → listener.
`setPersistence` listener'dan önce; hata gizlenmez → `initPromise` reject + `handleAuthUser(null)` (owner verilmez).

## 7. Emulator localhost davranışı

- `localhost`, `127.0.0.1`, `::1`, `[::1]` + zorunlu `?authEmulator=1`/`?useEmulators=1`
- Vercel/production host yalnız query ile bağlanamaz (test doğruladı)
- Fail-closed korundu (flag yoksa bağlanmaz)

## 8. Test sonuçları

```
node --test tests/phase1-auth.test.mjs
# tests 46, pass 46, fail 0
git diff --check  # temiz
firebase.json JSON parse  # OK
functions build  # skip script OK
```

## 9. Kalan riskler

- Canonical delegasyon sonrası Türkçe karakterli mevcut `username` değerleri migration'a kadar giriş anında eşleşmeyebilir (ASCII etkilenmez) — plan hazır, çalıştırılmadı
- `authService` CDN import içerdiğinden Node'da import edilemiyor; çekirdek mantık `authStateMachine` üzerinden test edildi (entegrasyon Phase 5 tarayıcı dumanı ile)
- Firestore rules hâlâ açık; legacy login aktif (Phase 4/7)

## 10. Phase 2 readiness

REVIEW_REQUIRED → düzeltmeler sonrası READY. H1/M1/M2/M3/L1 kapandı; Phase 2 için username migration (data) ve Console Email/Password ön koşulları duruyor.

## 11. Rollback adımları

- `authStateMachine.js` / `usernameMigration.js` sil; `authService.js` önceki sürüme al
- `firestoreService.normalizeUsername` delegasyonunu geri al (H1 yeniden açılır — yalnız acil)
- `legacyAuthCompat` IPv6 seti geri alınabilir
- `firebase-config` `authInstance` gerekli değil (regresyon yok)
- Legacy login / rules / functions etkilenmedi
