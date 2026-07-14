# SECURITY_CHANGELOG.md

Güvenlik migration değişiklik günlüğü.

## Phase 1 — Firebase Authentication Temeli (2026-07-15)

- `firebase-config.js`: `getAuthInstance`, Auth emulator gating (localhost + query flag)
- `authService.js`: merkezi Auth state (`onAuthStateChanged`, membership yükleme, `authSignOut`)
- `authGuard.js`: guard durumları + `businessMemberships` model sabitleri + `parseOwnerMembership`
- `membershipService.js`: `fetchMembershipForUid` (read-only)
- `legacyAuthCompat.js`: legacy/telemetry + emulator host helpers
- `usernameNormalization.js`: tr-TR normalizasyon (Phase 2 CF uyumu için)
- `firebase.json`: Auth emulator port 9099
- `tests/phase1-auth.test.mjs`: 19 unit test
- Legacy login/sessionStorage **değiştirilmedi**
- `firestore.rules` **değiştirilmedi**

## Phase 1 Fixes — Review düzeltmeleri (2026-07-15)

- H1 FIXED: `firestoreService.normalizeUsername` → `usernameNormalization` canonical'a delege (tek algoritma)
- M1 FIXED: `authStateMachine.js` (yeni) — generation guard, stale membership ignore, user değişiminde temizlik
- M2 FIXED: DI `authAdapter.signOut`; `authService.js` state machine ile yeniden yazıldı; `teardownAuthFoundation`
- M3 FIXED: `firebase-config.js` kullanılmayan `authInstance` kaldırıldı
- L1 FIXED: `legacyAuthCompat.isLocalDevHost` IPv6 `::1`/`[::1]` (fail-closed korundu)
- `usernameMigration.js` (yeni): saf dry-run + collision tespiti
- Testler: 19 → 46 (hepsi pass)
- Data/rules/functions/legacy login **değiştirilmedi**; `SECURITY_USERNAME_MIGRATION_PLAN.md` eklendi
