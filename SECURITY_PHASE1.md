# SECURITY_PHASE1.md

Phase 1 — Firebase Authentication Temeli tamamlandı.

## 1. Değiştirilen mimari

- Tek Firebase app init (`firebase-config.js`) korundu; Auth lazy eklendi
- Paralel auth katmanı: legacy sessionStorage login + yeni Firebase Auth state
- Yetki kararı yalnız `authGuard` + membership belgesi (henüz panellere zorunlu değil)

## 2. Eklenen dosyalar

| Dosya | Görev |
|-------|--------|
| `authService.js` | Auth state, subscribe, signOut |
| `authGuard.js` | Guard + membership model/parser |
| `membershipService.js` | Firestore membership read |
| `legacyAuthCompat.js` | Legacy telemetry + emulator gating |
| `usernameNormalization.js` | Merkezi username normalizasyonu |
| `tests/phase1-auth.test.mjs` | Unit testler |
| `SECURITY_PHASE1_MANUAL_STEPS.md` | Console checklist |

## 3. Güncellenen dosyalar

- `firebase-config.js` — `getAuthInstance`, emulator export
- `firebase.json` — `emulators.auth.port: 9099`

## 4. Auth initialization

- `initializeApp` + `getFirestore`: mevcut (`firebase-config.js`)
- `getAuthInstance()`: lazy CDN import `firebase-auth.js`
- Çift init yok; tek `app` instance

## 5. Auth state modeli

`authService.js`:
- `authLoading`, `membershipLoading`
- `firebaseUser`, `membership`, `error`
- `legacyAuthMode` (telemetry)
- `subscribeAuthState` / `ensureAuthFoundationInitialized`

## 6. Membership modeli

**Seçim: A — `businessMemberships/{uid}`**

| Neden | Açıklama |
|-------|----------|
| Owner-only 1:1 | Tek sorgu: `getDoc(businessMemberships/{uid})` |
| Mevcut tenant | `businessId` = `berberler` slug |
| B alternatifi | `berberler/{id}/members/{uid}` — çoklu üye için Phase 2+ |

**users/{uid}:** `username`, `normalizedUsername`, `displayName`, `authMigrationStatus`, timestamps (Phase 2 yazımı)

**businessMemberships/{uid}:** `uid`, `businessId`, `role: owner`, `status`, timestamps

## 7. Username normalization

- `usernameNormalization.js`: NFKC, trim, `toLocaleLowerCase('tr-TR')`, 3–32 char, `[a-z0-9._-]`
- `firestoreService.normalizeUsername` henüz değiştirilmedi (legacy uyum)
- Username → Auth identity: **Phase 2 güvenilir CF** (public Firestore sorgusu yok)
- Sentetik e-posta: **frontend'de üretilmez**; Admin SDK/CF (Phase 2)

## 8. Legacy compatibility

- `authMode`: `firebase` | `legacy` | `none` (telemetry)
- Legacy session **authenticated_owner üretmez**
- Mevcut `giris.js` / `admin-auth.js` / `sessionAuth.js` dokunulmadı

## 9. Auth guard durumları

`loading` | `unauthenticated` | `legacy_only` | `authenticated_without_membership` | `authenticated_owner` | `error`

`authenticated_owner` = Firebase `currentUser` + `businessMemberships` active owner.

## 10. Emulator yaklaşımı

- `firebase.json`: auth 9099
- Bağlantı: `localhost`/`127.0.0.1` **ve** `?authEmulator=1` veya `?useEmulators=1`
- Vercel production emulator'a bağlanamaz

## 11. Bilinen geçici riskler

- Firestore rules hâlâ açık
- Legacy login aktif; plaintext password
- Auth foundation henüz entry point'lere bağlanmadı (lazy init)
- ~~İki farklı username normalizasyonu~~ → FIXED (SECURITY_PHASE1_FIXES.md); canonical'a delege edildi, mevcut Türkçe karakterli `username` değerleri data migration'a kadar giriş anında eşleşmeyebilir (ASCII etkilenmez)

## 15. Review düzeltmeleri (Phase 1 Fixes)

SECURITY_PHASE1_REVIEW.md bulguları düzeltildi (H1/M1/M2/M3/L1 FIXED). Ayrıntı: `SECURITY_PHASE1_FIXES.md`.
- Yeni: `authStateMachine.js` (generation guard), `usernameMigration.js` (dry-run)
- `authService.js` DI signOut + race guard ile yeniden yazıldı
- Testler 46/46; `firestoreService.normalizeUsername` canonical'a delege

## 12. Phase 2 bağımlılıkları

- Email/Password provider (Console)
- Username → Auth CF
- Controlled password reset onboarding
- `users` + `businessMemberships` belge oluşturma (güvenilir ortam)
- `firestoreService.normalizeUsername` birleştirme

## 13. Rollback

- Yeni modülleri kaldır / import etme
- `firebase-config.js` Auth bloğunu geri al
- `firebase.json` auth emulator satırını kaldır
- Legacy login etkilenmez

## 14. Test sonuçları

```
node --test tests/phase1-auth.test.mjs
# 19 pass, 0 fail
```

Kapsam: normalization, guard states, membership parse, emulator gating.
