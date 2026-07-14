# SECURITY_PHASE1_REVIEW.md

Bağımsız Phase 1 güvenlik incelemesi. Önceki modelin SUCCESS sonucuna güvenilmeden gerçek diff + kod üzerinden doğrulandı.

Doğrulama komutları: `git diff --numstat HEAD`, `git diff --check` (temiz), `node --test tests/phase1-auth.test.mjs` (19/19 pass), `functions build` (skip script).

---

## Scope verification

| Kontrol | Sonuç |
|---------|--------|
| Tracked değişen | `firebase-config.js` (+49), `firebase.json` (+3) |
| Yeni kaynak | `authService.js`, `authGuard.js`, `membershipService.js`, `legacyAuthCompat.js`, `usernameNormalization.js`, `tests/phase1-auth.test.mjs` |
| `firestore.rules` değişti mi | **Hayır** (diff boş) |
| `functions/index.js` / createAppointment | **Hayır** |
| Firebase web config / project ID | **Değişmedi** (`berberrandevu-20a3e`) |
| Yeni dependency | **Yok** (package.json/lock değişmedi) |
| 10 dosya limiti | 6 kaynak + 1 test + 2 config = 9 ✓ |

Kapsam temiz. Kapsam dışı değişiklik yok.

---

## Bulgu durumları (SECURITY_PHASE1_FIXES.md sonrası)

| ID | Severity | Durum |
|----|----------|-------|
| H1 | High | **FIXED** — `firestoreService.normalizeUsername` canonical'a delege; tek algoritma; data migration planı hazır |
| M1 | Medium | **FIXED** — `authStateMachine` generation guard + user değişiminde state temizliği |
| M2 | Medium | **FIXED** — DI `authAdapter.signOut`; success/failure/stale testleri |
| M3 | Low/Medium | **FIXED** — kullanılmayan `authInstance` kaldırıldı |
| L1 | Low | **FIXED** — IPv6 `::1`/`[::1]`; fail-closed korundu |
| M2 (kapsam testi) | Medium | **PARTIALLY_FIXED** — çekirdek mantık `authStateMachine` ile test edildi; `authService` CDN entegrasyonu Phase 5 tarayıcı dumanına kaldı |
| L2 (dead code) | Low | **OPEN** — modüller Phase 5'te entry point'e bağlanacak (kasıtlı) |
| L3 (signOut legacy storage) | Low | **OPEN (by design)** — dokümante; guard owner üretmez |

---

## Bulgular

### H1 — İki username normalizasyonu Türkçe I/İ'de farklı sonuç üretiyor
- **Severity:** High
- **Dosya:** `usernameNormalization.js:18-23` vs `firestoreService.js:113-115`
- **Gerçek davranış:**
  - Legacy: `raw.trim().toLowerCase()` (locale-siz, NFKC yok, validation yok)
  - Yeni: `trim().normalize("NFKC").toLocaleLowerCase("tr-TR")`
  - Girdi `"IŞIK"` → legacy `"işik"`, yeni `"ışık"` (farklı). `"İ"` → legacy `"i̇"` (combining), yeni `"i"`.
- **Senaryo:** Phase 2'de kullanıcı adı, `berberler.username` (legacy normalize ile yazılmış) ile eşleştirileceğinde uyuşmazlık → berber giriş yapamaz veya iki farklı kayıt collision. Türkçe kullanıcı adları için hesap kilidi riski.
- **Phase 2 etkisi:** Doğrudan bloklayıcı — username→Auth identity çözümü buna dayanır.
- **Önerilen minimum düzeltme:** Tek canonical algoritma belirle; `firestoreService` ve CF aynı fonksiyonu kullansın. Karar bölümüne bakınız. (Bu incelemede kod değiştirilmedi.)
- **Test:** Aynı girdi kümesi için iki implementasyonun eşitliğini doğrulayan test; tr-TR I/İ/ı/i vektörleri.

### M1 — Membership yükleme yarışı (stale overwrite)
- **Severity:** Medium
- **Dosya:** `authService.js:54-72, 92-97`
- **Gerçek davranış:** `onAuthStateChanged` callback'i async; `loadMembershipForUser` await'i sıralanmıyor. Hızlı kullanıcı değişiminde (A→B) eski fetch geç dönerse `state.membership` A ile yazılabilir.
- **Azaltıcı:** `parseOwnerMembership` `docUid === uid` çapraz kontrolü nedeniyle yanlış kullanıcıya **owner sızmaz** (guard `authenticated_without_membership` döner). Yani güvenlik değil, doğruluk sorunu.
- **Senaryo:** Hesap değişiminde geçerli owner geçici olarak "membership yok" görünebilir.
- **Phase 2 etkisi:** Düşük; yine de sequencing eklenmeli.
- **Önerilen düzeltme:** Her callback'e request token / `if (state.firebaseUser?.uid !== user.uid) return` guard'ı fetch sonrası.
- **Test:** İki ardışık user event; eski fetch geç çözülür → owner state yeni kullanıcıya bağlı kalmalı.

### M2 — Gerçek auth modülleri test kapsamı dışında
- **Severity:** Medium
- **Dosya:** `tests/phase1-auth.test.mjs`, `authService.js`, `membershipService.js`, `firebase-config.js`
- **Gerçek davranış:** Testler saf modülleri (`authGuard`, `legacyAuthCompat`, `usernameNormalization`) gerçek import ile doğruluyor — mantık kopyası değil (iyi). Ancak `authService`/`membershipService`/`firebase-config` CDN `https://` import içerdiğinden Node'da import edilemiyor; bu modüllerdeki init/race/signOut yolları test edilmiyor.
- **Not:** Emulator gating testi `legacyAuthCompat.shouldConnectAuthEmulator` üzerinden — bu, `firebase-config`'in çağırdığı **aynı** fonksiyon (re-export), dolayısıyla mantık doğru fonksiyonda test ediliyor; fakat `getAuthInstance` entegrasyonu değil.
- **Önerilen düzeltme:** Saf mantığı (guard/normalize/emulator) modüllerden ayrı tutmak zaten yapılmış; `authService` için dependency injection (auth+fetch mock) ile signOut/race testi eklenebilir.

### M3 — Kullanılmayan `authInstance` değişkeni
- **Severity:** Low/Medium (kod hijyeni)
- **Dosya:** `firebase-config.js:142,168`
- **Gerçek davranış:** `authInstance` atanıyor ama hiçbir yerde okunmuyor; tek kaynak `authInitPromise`. Kafa karışıklığı riski.
- **Düzeltme:** Değişkeni kaldır veya senkron erişim için kullan.

### L1 — IPv6 localhost (`::1`) emulator host kapsamı dışında
- **Severity:** Low
- **Dosya:** `legacyAuthCompat.js:15-18`
- **Gerçek davranış:** `isLocalDevHost` yalnız `localhost`/`127.0.0.1`. `[::1]` fail-closed (emulator'a bağlanmaz) → güvenlik değil, dev kolaylığı kaybı.
- **Düzeltme:** İsteğe bağlı `::1` ekle.

### L2 — Yeni modüller hiçbir entry point'e bağlı değil (dead code)
- **Severity:** Low (Phase 1 kapsamına uygun)
- **Dosya:** `authService.js` vb.; HTML sayfaları import etmiyor.
- **Gerçek davranış:** Lazy foundation; Phase 5'e kadar çağrılmıyor. Kasıtlı ve dokümante. Risk: entegrasyona kadar gerçek tarayıcı davranışı doğrulanmaz.

### L3 — `authSignOut` legacy storage'ı temizlemiyor
- **Severity:** Low (dokümante davranış)
- **Dosya:** `authService.js:135-141`
- **Gerçek davranış:** Yalnız Firebase `signOut`. Legacy `sessionStorage`/super-admin `localStorage` dokunulmaz → sonraki yüklemede `legacy_only`. Guard bunu owner saymaz, dolayısıyla güvenli; ancak migration UX'i netleştirilmeli. `onAuthStateChanged(null)` ile `state.membership` temizleniyor (listener aktifken).

---

## Architecture assessment

- Tek `app` instance; Firestore + Auth aynı app. `initializeApp` modül-seviye tek çağrı — ancak `getApps()` guard'ı yok (ES module singleton olduğu için pratikte tek; robustluk için eklenebilir, Low).
- `getAuthInstance` `authInitPromise` ile idempotent; `connectAuthEmulator` tek kez.
- `ensureAuthFoundationInitialized` `initialized`+`initPromise` ile duplicate listener'ı önlüyor; tek `onAuthStateChanged`.
- `unsubscribeAuth` saklanıyor ama dışa açılmıyor (SPA/multi-page reload için kabul edilebilir).
- Guard saf fonksiyon; storage/URL/DOM'dan owner üretmiyor — **doğru**.

## Membership model decision

- Mevcut: `businessMemberships/{uid}`, `businessId = berberler slug`.
- **Öneri: A (businessId = slug) korunmalı**, ancak:
  - Slug **policy-level immutable** kabul edilmeli (rename edilmemeli); çünkü `appointments.barberId`, `customers.barberSlug`, alt koleksiyonlar hep slug'a bağlı. Ayrı immutable tenantId eklemek şu an büyük migration ve gerçekçi değil.
  - Doc id = uid tek-owner/tek-işletme'yi zorlar; gelecekte çoklu işletme gerekirse `businessMemberships/{uid}_{businessId}` veya alt koleksiyon gerekir. Phase 1 için (owner-only) uygun.
- Bu incelemede model değiştirilmedi.

## Username normalization decision

- **Canonical öneri:** `usernameNormalization.js` (NFKC + `toLocaleLowerCase('tr-TR')` + charset/uzunluk) tek kaynak olmalı; `firestoreService.normalizeUsername` Phase 2'de buna delege edilmeli ve mevcut `berberler.username` değerleri yeni algoritma ile yeniden normalize/eşlenmeli (migration adımı).
- Locale-dependent lowering bilinçli tercih; CF tarafında da **aynı** JS algoritması kullanılmalı (Node `toLocaleLowerCase('tr-TR')` ICU ile uyumlu — doğrulanmalı).
- `firestoreService` bu aşamada değiştirilmedi (talimat gereği).

## Emulator safety

- Production Vercel host + `?authEmulator=1` → **bağlanmaz** (test doğruladı).
- localhost + flag zorunlu; yalnız-localhost yeterli değil (iyi).
- `connectAuthEmulator` tek kez, Auth kullanılmadan önce.
- **Sonuç: güvenli.** (Critical yok.)

## Test quality

- Gerçek modül mantığı test ediliyor (kopya değil). 19 test 4 alanda anlamlı ayrı davranış.
- Eksik: signOut testi, membership race testi, `authService` entegrasyonu, `detectLegacyAuthMode` (window gerektirir).
- Global sızıntı yok (guard saf; legacy testleri parametre ile).

## Phase 2 readiness

- Foundation sağlam ve kapsam içi; **ancak H1 (normalizasyon) Phase 2 için bloklayıcı**.
- Emulator güvenli, guard tasarımı doğru, rules/functions/legacy dokunulmadı.

## Required fixes before Phase 2

1. **H1:** Tek canonical username normalizasyonu; `firestoreService` + CF delege; mevcut `berberler.username` migration/eşleme planı.
2. **M1:** Membership yükleme sequencing guard'ı.
3. **M2:** `authService` için DI tabanlı signOut + race testleri.
4. **M3/L1:** `authInstance` temizliği; opsiyonel `::1`.
5. Entegrasyon (Phase 5) öncesi yeni modüllerin bir entry point'te gerçek tarayıcı dumanı.
