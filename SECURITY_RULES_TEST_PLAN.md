# SECURITY_RULES_TEST_PLAN.md

## Phase 4A — uygulanan altyapı (2026-07-27)

| Bileşen | Konum |
|---------|--------|
| Test kütüphanesi | `@firebase/rules-unit-testing` (root devDependency) |
| Production rules test config | `firebase.rules-test.json` (port 8081/9100) |
| Phase 3 emulator config | `firebase.emulator.json` (değişmedi) |
| Production deploy config | `firebase.json` (değişmedi) |
| Sentetik project ID | `berberrandevu-rules-test` |
| Fail-closed guard | `tests/firestore-rules/guards.mjs` |
| Fixture seed | `tests/firestore-rules/fixtures.mjs` (`withSecurityRulesDisabled`) |
| Runner | `tests/firestore-rules/run.mjs` |

### Komutlar

```bash
npm run test:regression          # 196 mevcut test
npm run test:rules:config        # config ayrımı (9 test)
npm run test:rules:current       # mevcut davranış karakterizasyonu (20 test)
npm run test:rules:target        # hedef model vs production (11 beklenen FAIL)
npm run test:rules:candidate     # Phase 4B aday rules (36 test)
npm run test:rules               # config + current + candidate (target dahil değil)
```

## Phase 4B1 — candidate shadow rules (2026-07-27)

| Bileşen | Konum |
|---------|--------|
| Candidate rules | `firestore.phase4b.rules` |
| Candidate test config | `firebase.rules-phase4b.json` (port 8082/9101) |
| Candidate tests | `tests/firestore-rules/candidate/candidate-security.test.mjs` |
| Compatibility | `FIRESTORE_PHASE4B_COMPATIBILITY_REPORT.md` |

### Test kategorileri (güncel)

1. **current-rules-characterization** — production `firestore.rules`
2. **target-security-requirements** — production vs hedef (gap raporu)
3. **candidate-security** — `firestore.phase4b.rules` (tam geçmeli)

---

## Önceki plan (hedef senaryolar)

Firebase Emulator Suite (`firebase.json`: functions 5001, firestore 8080) için.
Gerçek koleksiyon adları kullanılır. Customer Auth rolü yoktur.

## Test altyapısı

- `@firebase/rules-unit-testing` veya eşdeğer
- Seed:
  - `berberler/shop-a` `{ username, status, subscriptionEndDate, selectedServices, openHour, closeHour }` (**password seed’de olmamalı** — hedef model)
  - `berberler/shop-b` benzer
  - `publicBarbers/shop-a`, `publicBarbers/shop-b` public alanlar + `bookingOpen: true`
  - `memberships` veya claim: uidA → shop-a owner; uidB → shop-b owner
  - Auth users: `barberA`, `barberB`, `superAdmin` (`token.superAdmin: true`), `plainUser` (claim/membership yok)
  - `appointments/appt-a1` `{ barberId: "shop-a", date, time, phone, status: "confirmed" }`
  - `customers/shop-a_5xxxxxxxxx` `{ barberSlug: "shop-a", phone }`
  - `activationCodes/TESTCODE` `{ isUsed: false, durationDays: 30 }`
  - `notifications`, `deletedAppointments` örnekleri shop-a

Her senaryoda: **Aktör / Seed / İşlem / Beklenen / Kaynak / İlke**

---

## 1. Public — özel işletme verisi

| Alan | Değer |
|------|--------|
| Aktör | unauthenticated |
| Seed | `berberler/shop-a` hassas alanlarla |
| İşlem | `get(berberler/shop-a)` |
| Beklenen | **deny** |
| Kaynak | `berberler` |
| İlke | Hassas işletme belgesi public değil |

## 2. Public — appointment listesi

| Alan | Değer |
|------|--------|
| Aktör | unauthenticated |
| Seed | `appointments` shop-a kayıtları |
| İşlem | `list(appointments)` veya geniş query; PII içeren get |
| Beklenen | **deny** (hedef: full list/get kapalı; availability ayrı CF veya mirror) |
| Kaynak | `appointments` |
| İlke | Müşteri PII sızıntısı yok |

*Not: Staging taslakta barberId+date list geçici allow — production hedefi deny + availability CF ise test buna göre güncellenir.*

## 3. Public — doğrudan appointment create

| Alan | Değer |
|------|--------|
| Aktör | unauthenticated |
| İşlem | client `addDoc(appointments, { barberId: "shop-a", ... })` |
| Beklenen | **deny** |
| Kaynak | `appointments` |
| İlke | Public write yalnız Admin SDK / CF |

## 4. Public — createAppointment CF

| Alan | Değer |
|------|--------|
| Aktör | unauthenticated callable |
| Seed | `publicBarbers/shop-a` bookingOpen; boş slot |
| İşlem | `createAppointment({ barberSlug: "shop-a", geçerli payload })` |
| Beklenen | **allow** (function success) |
| Kaynak | CF → `appointments` (Admin SDK) |
| İlke | Public booking sunucu yoluyla çalışır |

## 5. Berber — kendi verisi

| Alan | Değer |
|------|--------|
| Aktör | Auth barberA (shop-a membership/claim) |
| İşlem | `get(berberler/shop-a)`, `list(appointments where barberId==shop-a)`, `list(customers where barberSlug==shop-a)` |
| Beklenen | **allow** |
| Kaynak | `berberler`, `appointments`, `customers` |
| İlke | Own-tenant read |

## 6. Berber — başka işletme okuma

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | `get(berberler/shop-b)`, `list(appointments where barberId==shop-b)` |
| Beklenen | **deny** |
| Kaynak | `berberler`, `appointments` |
| İlke | Tenant izolasyonu |

## 7. Berber — başka işletme appointment update/delete

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| Seed | `appointments/appt-b1` barberId shop-b |
| İşlem | `updateDoc` / `deleteDoc` |
| Beklenen | **deny** |
| Kaynak | `appointments` |
| İlke | Cross-tenant write yok |

## 8. Berber — kendi role bilgisini değiştiremez

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | membership belgesinde `role` update veya self claim yazımı |
| Beklenen | **deny** |
| Kaynak | `memberships` / claims (claim client’tan yazılamaz) |
| İlke | Privilege escalation yok |

## 9. Berber — tenant/business ilişkisini değiştiremez

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | membership `barberSlug` → shop-b; veya `berberler/shop-a.slug` değişimi |
| Beklenen | **deny** |
| Kaynak | membership / `berberler` |
| İlke | Tenant binding immutable (owner self-service değil) |

## 10. Berber — abonelik alanları

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | `updateDoc(berberler/shop-a, { subscriptionEndDate, subscriptionStatus })` |
| Beklenen | **deny** |
| Kaynak | `berberler` protected fields |
| İlke | Mass assignment / abonelik bypass yok |

## 11. Normal berber — super admin işlemi

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | `createBarber`, `fetchAllBarbers` list all, `createActivationCodes`, `pendingBarbers` admin update |
| Beklenen | **deny** |
| Kaynak | `berberler` list/create, `activationCodes`, `pendingBarbers` |
| İlke | Least privilege |

## 12. localStorage isAdmin / superAdminLoggedIn

| Alan | Değer |
|------|--------|
| Aktör | unauthenticated veya plainUser; client’ta localStorage forge |
| İşlem | Emulator rules context Auth’suz `get(berberler/shop-a)` / activationCodes list |
| Beklenen | **deny** |
| Kaynak | rules (`request.auth` / claim) |
| İlke | Client storage yetki kanıtı değil |

## 13. sessionStorage barberSlug değiştirme

| Alan | Değer |
|------|--------|
| Aktör | barberA token (shop-a); client sessionStorage slug=shop-b |
| İşlem | `get(berberler/shop-b)` / shop-b appointments |
| Beklenen | **deny** (token/membership shop-a) |
| Kaynak | rules |
| İlke | Client tenant id yetki kanıtı değil |

## 14. URL / DOM / JS değişkeni

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | `?dukkan=shop-b` veya `aktifDukkan="shop-b"` ile shop-b yazma |
| Beklenen | **deny** |
| Kaynak | rules |
| İlke | UI/URL yetki kanıtı değil |

## 15. Protected fields mass assignment

| Alan | Değer |
|------|--------|
| Aktör | barberA |
| İşlem | `updateDoc(berberler/shop-a, { password, telegramChatId, status, lastActivationCode })` |
| Beklenen | **deny** (veya diff’te bu alanlar yok sayılır / reject) |
| Kaynak | `berberler` |
| İlke | Field-level ACL |

## 16. Super admin claim yok

| Alan | Değer |
|------|--------|
| Aktör | plainUser veya barberA |
| İşlem | tüm berber listesi, kod üretimi, demo_talepleri admin |
| Beklenen | **deny** |
| Kaynak | superAdmin-only |
| İlke | Claim zorunlu |

## 17. Super admin claim var

| Alan | Değer |
|------|--------|
| Aktör | superAdmin (`token.superAdmin == true`) |
| İşlem | `get/list berberler`, aktivasyon kodu create, pending onay |
| Beklenen | **allow** (policy’ye göre) |
| Kaynak | admin kaynakları |
| İlke | Trusted claim |

## 18. Geçersiz / süresi dolmuş token

| Alan | Değer |
|------|--------|
| Aktör | expired / invalid auth |
| İşlem | herhangi protected read |
| Beklenen | **deny** |
| Kaynak | Auth |
| İlke | Session bütünlüğü |

## 19. Eşzamanlı aynı slot

| Alan | Değer |
|------|--------|
| Aktör | iki paralel `createAppointment` CF (aynı shop-a, date, time) |
| Seed | boş slot |
| İşlem | concurrent callable |
| Beklenen | **yalnız biri success**; diğeri `slot_taken` (transaction ile) |
| Kaynak | CF + `appointments` |
| İlke | Race-safe rezervasyon |

## 20. Ek (önerilen)

| # | Senaryo | Beklenen |
|---|---------|----------|
| 20a | Public `activationCodes` get | deny |
| 20b | Public `rateLimits` / `appointmentAttempts` | deny |
| 20c | Public `demo_talepleri` create | allow |
| 20d | Public `demo_talepleri` list | deny |
| 20e | Public `pendingBarbers` create | allow (form); list deny |
| 20f | barberA `customers` shop-b | deny |
| 20g | barberA kendi `blockedSlots` write | allow |
| 20h | unauthenticated `publicBarbers/shop-a` get | allow |

---

## Çalıştırma notları

1. Önce rules unit tests (Auth mock + assertSucceeds/Fails).
2. Sonra Functions emulator ile senaryo 4 ve 19.
3. Staging smoke: gerçek client’ta storage/URL manipülasyonu (12–14) — rules enforce olmadan “UI redirect” başarı sayılmaz.
4. Production deploy öncesi bu dosyanın tamamı yeşil olmadan Phase 4 production’a çıkılmaz.
