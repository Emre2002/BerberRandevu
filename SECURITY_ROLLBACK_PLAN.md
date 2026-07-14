# SECURITY_ROLLBACK_PLAN.md

Migration fazları (Phase 1–8) için geri alma planı. **Production veri restore son çaredir.**

## Genel ilkeler

- `allow read, write: if true` durumuna dönmek **kabul edilebilir rollback değildir**.
- Rules sorununda: son bilinen **minimum gerekli erişimli güvenli** rules sürümüne dönülür (baseline SHA: `firestore.rules` → manifest).
- Auth migration rollback: kullanıcıları silmek yerine disable/claim geri alma tercih edilir.
- Vercel frontend rollback: önceki deployment'a promote.

---

## Phase 1 — Firebase Auth temeli

| Alan | Değer |
|------|--------|
| Tetikleyici | Auth SDK kırılması, çift login, oturum çakışması |
| Geri alınacak dosyalar | Yeni `authService.js`, `firebase-config.js` Auth importları, `giris.js`/`admin-auth.js` Auth dalları |
| Auth kullanıcı etkisi | Test Auth kullanıcıları disable; production berberler henüz migrate edilmediyse etki düşük |
| Rules | Değişmez (Phase 1) |
| Functions | Değişmez |
| Vercel | Önceki deploy |
| Veri | Membership belgeleri silinebilir (henüz authoritative değilse) |
| Doğrulama | Eski sessionStorage login + admin panel |

---

## Phase 2 — Berber migration (controlled password reset)

| Alan | Değer |
|------|--------|
| Tetikleyici | Toplu hesap kilitlenmesi, onboarding hatası |
| Geri alınacak | Auth sign-in zorunluluğu; geçici dual-login (Firestore password read **sadece acil**, rules hâlâ açıksa riskli) |
| Auth etkisi | Migrate edilen kullanıcılar kalır; reset e-postası tekrar gönderilir |
| Rules/Functions | Değişmez |
| Veri | `berberler.password` Phase 7'ye kadar silinmemiş olmalı — acil rollback için |
| Doğrulama | Örnek berber giriş + randevu listesi |

---

## Phase 3 — Super admin claims

| Alan | Değer |
|------|--------|
| Tetikleyici | Yanlış claim, panel erişim kaybı |
| Geri alınacak | Client claim okuma; geçici staging-only eski hash login **production'da uzatılmaz** |
| Auth etkisi | `super_admin` claim kaldırılır / düzeltilir (Admin SDK) |
| Doğrulama | Claim'li kullanıcı panel; claim'siz reddedilir |

---

## Phase 4 — Firestore Security Rules

| Alan | Değer |
|------|--------|
| Tetikleyici | Berber paneli 403, müşteri randevu kırılması, CRM boş |
| Geri alınacak | `firestore.rules` → **baseline değil**, bir önceki **staging-tested güvenli** sürüm |
| Yöntem | `firebase deploy --only firestore:rules` (yedek dosyadan) |
| Auth/Functions | Auth ve CF önce deploy edilmiş olmalı; aksi halde rules rollback yetmez |
| **Yasak rollback** | Tam açık `if true` rules |
| Doğrulama | Rules unit tests + smoke (berber read own, cross-tenant deny) |

---

## Phase 5 — Client migration

| Alan | Değer |
|------|--------|
| Tetikleyici | UI gate loop, tenant filtre hatası |
| Geri alınacak | Client bundle (Vercel önceki deployment) |
| Rules | Phase 4 sürümü korunur |
| Doğrulama | Auth login, admin, public booking |

---

## Phase 6 — Cloud Functions hardening

| Alan | Değer |
|------|--------|
| Tetikleyici | Booking 500, çift slot, rate limit aşırı |
| Geri alınacak | `functions/index.js` önceki revision (`firebase functions:log`, GCP Console revision) |
| Auth etkisi | Yok |
| Veri | Transaction eklenmişse eski CF race riski geri gelir — bilinçli trade-off |
| Doğrulama | Callable success; concurrent slot test |

---

## Phase 7 — Legacy kaldırma

| Alan | Değer |
|------|--------|
| Tetikleyici | Auth-only kullanıcı giriş yapamıyor |
| Geri alınacak | Kod geri alınabilir; **`password` alanı silindiyse geri alınamaz** — export'tan restore gerekir |
| **Veri restore** | Son çare: Phase 0 export'tan test projesinde doğrulanmış prosedür |
| Doğrulama | Tüm berberler Auth ile giriş |

---

## Phase 8 — Test ve production deploy

| Alan | Değer |
|------|--------|
| Tetikleyici | Production incident post-deploy |
| Sıra (ters) | Rules → Functions → Client (Auth claim son) |
| Vercel | Önceki production deployment promote |
| Doğrulama | `SECURITY_RULES_TEST_PLAN.md` kritik senaryolar |

---

## Hızlı referans — dosya SHA baseline

Manifest: `SECURITY_BASELINE_MANIFEST.json` (`d743e02` commit).

| Dosya | Rollback kaynağı |
|-------|------------------|
| `firestore.rules` | Git tag / manifest SHA |
| `firebase.json` | Git |
| `functions/index.js` | Git + GCP function revision |
| Client | Vercel deployment history |
