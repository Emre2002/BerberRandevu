# SECURITY_MIGRATION_PLAN.md

Hedef: mevcut production verisi ve belge ID’leri korunarak Firebase Auth + deny-by-default rules + tenant izolasyonu + güvenli super admin + public booking yalnız CF.
Bu belge uygulama kodu değiştirmez; fazlı geçiş planıdır.

Doğrulanmış mevcut gerçekler: `PROJECT_CONTEXT.md` + kod doğrulaması (`firestore.rules` açık; Auth yok; şifre düz metin `berberler.password`; oturum storage; `createAppointment` Auth/transaction yok; admin create `forceClient: true`).

---

## Phase 0 — Backup ve baseline

**Amaç:** Geri alınabilir başlangıç noktası; veri kaybı riskini düşürmek.

**Değiştirilecek dosyalar:** Yok (süreç).

**Oluşturulacak:**
- Git tag / commit baseline (repo henüz git değilse init + ilk commit kullanıcı onayıyla)
- `firestore.rules` yedeği (ör. `firestore.rules.pre-migration.bak` — kullanıcı onayı sonrası)
- Collection/alan envanteri snapshot (bu plan + `SECURITY_ACCESS_MATRIX.md`)
- Emulator config checklist (`firebase.json` emulators zaten var)

**Veri etkisi:** Yok (yalnız yedek).

**Risk:** Yedeksiz ilerlenirse rules/Auth hatasında veri kurtarma zorlaşır.

**Rollback:** Tag’e dönüş; rules yedeğini geri yükle; export’tan restore.

**Başarı kriteri:**
- Production Firestore export veya eşdeğer yedek alındı
- `firestore.rules` içeriği arşivlendi
- Emulator’da proje ayağa kalkıyor

**Bağımlılık:** Yok → Phase 1’in önkoşulu.

---

## Phase 1 — Firebase Authentication temeli

**Amaç:** Auth SDK’yı ekleyip `onAuthStateChanged` omurgasını kurmak; mevcut sessionStorage login’i henüz kaldırmamak (dual-run).

**Değiştirilecek (planlanan) dosyalar:**
- `firebase-config.js` — `getAuth` export
- Yeni: `authService.js` (veya eşdeğer) — state dinleme, signIn/signOut sarmalayıcıları
- `giris.js` / `admin-auth.js` — kademeli Auth state okuma (eski gate paralel)

**Oluşturulacak koleksiyon/model (öneri; karar `SECURITY_DECISIONS.md`):**
- `users/{uid}` — profil (displayName, email/username map)
- `memberships/{uid}_{slug}` veya `berberler/{slug}/members/{uid}` — `{ uid, barberSlug, role: "owner" }`
  - Mevcut kodda membership yok; employee rolü yok → başlangıçta yalnız `owner`

**Veri etkisi:** Yeni belgeler; mevcut `berberler`/`appointments` ID’leri değişmez.

**Risk:** UI kırılması düşük tutulmalı (eski session hâlâ çalışır).

**Rollback:** Auth import’ları ve yeni dosyaları geri al; eski login aynen kalır.

**Başarı kriteri:** Emulator’da test kullanıcı ile Auth session; mevcut berber session ile admin paneli hâlâ açılır.

**Bağımlılık:** Phase 0 → Phase 2.

---

## Phase 2 — Berber hesaplarının migration’ı

**Amaç:** Her `berberler/{slug}` için Firebase Auth kullanıcısı; username deneyimi korunabilir (karar gerekli); düz metin şifre client’tan kalkmadan önce güvenli taşıma veya reset.

**Değiştirilecek (planlanan):**
- `firestoreService.js` — `resolveBarberLogin` / `validateBarberLogin` kademeli Auth’a yönlendirme
- `giris.js`, `barber-login.js` — Auth sign-in
- **Yeni güvenilir ortam:** Admin SDK migration script (CI/Cloud Function/one-off Node, **frontend değil**, service account frontend’e konmaz)

**Migration seçenekleri (karar bekler):**
- A) Admin SDK ile mevcut düz metin şifreyi bir kez `createUser` + sonra password alanını silme planı (Phase 7)
- B) Zorunlu parola sıfırlama / ilk girişte yeni parola

**Username eşlemesi (karar):** sentetik email (`username@…`) veya custom auth / `signInWithEmailAndPassword` + username→email lookup belgesi (`usernames/{username}` → uid). Lookup belgesi rules ile korunmalı.

**Veri etkisi:** Auth users oluşur; `memberships` yazılır; `berberler` ID/slug aynı kalır. `password` alanı Phase 7’ye kadar silinmez (kesinti önleme) veya kısa dual-read penceresi.

**Risk:** En yüksek operasyonel risk — yanlış eşleme hesabı kilitler; client-side migration yasak (şifre sızıntısı / incomplete migrate).

**Rollback:** Auth kullanıcılarını disable; login’i tekrar Firestore password path’e al (password alanı silinmediyse); membership’leri işaretle.

**Başarı kriteri:**
- Örnek berber Auth ile girer, `sessionStorage` yerine/yanında Auth token vardır
- Eski slug URL’leri (`admin.html?dukkan=`) aynı dükkana gider
- Migration log: slug → uid eşlemesi

**Bağımlılık:** Phase 1 → Phase 3/4 (rules Auth olmadan sıkılaştırılmaz).

---

## Phase 3 — Super admin migration’ı

**Amaç:** `superAdminAuth.js` gömülü hash + `localStorage` authorization’ı kaldırmadan önce güvenilir claim.

**Değiştirilecek (planlanan):**
- `super-admin.js`, `sessionAuth.js` (super admin kısımları), `superAdminAuth.js` (legacy)
- Yeni CF: `setSuperAdminClaim` yalnız bootstrap/trusted operator (veya manuel Admin SDK CLI)
- Claim örneği: `superAdmin: true` (`firestore.staging.rules` ile uyumlu isim)

**Kurallar:**
- Claim yalnız Admin SDK
- Client `localStorage.superAdminLoggedIn` yetki kanıtı olamaz
- Panel mount `request.auth.token.superAdmin` + isteğe bağlı `users`/`admins` belgesi

**Veri etkisi:** Auth user + custom claim; Firestore veri silinmez.

**Risk:** Claim yanlışlıkla geniş dağılırsa tam erişim; bootstrap prosedürü sıkı tutulmalı.

**Rollback:** Claim kaldır (`admin.auth().setCustomUserClaims(uid, {})`); geçici olarak eski hash login’i yalnız staging’de tut (production’da uzatma).

**Başarı kriteri:** Claim’li kullanıcı panel açar; claim’siz + localStorage forge açamaz (rules/CF enforce sonrası kesin).

**Bağımlılık:** Phase 1 → Phase 4 ile birlikte enforce.

---

## Phase 4 — Firestore Security Rules

**Amaç:** Deny-by-default; Auth uid + membership/claim; tenant izolasyonu; protected fields; public appointment write kapalı.

**Değiştirilecek:**
- `firestore.rules` (production’a **yalnız** Auth+CF hazırken)
- Referans taslak: `firestore.staging.rules` (zaten claim `superAdmin` + `barberSlug` varsayar — membership belgesine çevrilebilir)

**Oluşturulacak:** Rules unit testleri (Phase 8 / `SECURITY_RULES_TEST_PLAN.md`).

**Korunacak alanlar (berber update engeli):**  
`password`, `subscriptionStatus`, `subscriptionEndDate`, `lastActivationCode`, `username` (policy’ye göre), `status` (superAdmin), telegram vb.

**Public:**
- `publicBarbers` get (ve gerekirse kısıtlı list)
- `appointments` create/update/delete: false (CF Admin SDK)
- Slot listesi: dar query veya availability CF (staging’deki geçici list uyarısı geçerli)

**Veri etkisi:** Yok (rules). Yanlış deploy = uygulama kırılır.

**Risk:** **En riskli faz** — Auth/membership eksikken deploy edilirse tüm berber panelleri kilitlenir; açık bırakılırsa güvenlik kazanımı olmaz.

**Rollback:** Yedek `firestore.rules` anında deploy.

**Başarı kriteri:** Emulator + staging’de test planı yeşil; smoke: berber kendi verisi OK, çapraz tenant DENY, public direct write DENY.

**Bağımlılık:** Phase 2+3 + Phase 6’nın public booking CF yolu zorunlu; admin `forceClient` kapatılmış olmalı.

---

## Phase 5 — Client migration

**Amaç:** UI gate’leri UX-only; yetki Auth + rules; sorgular tenant filtreli ve rules-uyumlu.

**Değiştirilecek (planlanan):**
- `sessionAuth.js` — Auth sarmalayıcı; storage auth kaldırılır
- `admin-auth.js`, `giris.js`, `barber-login.js`, `super-admin.js`
- `app.js` — `aktifDukkan` yalnız membership/claim ile bağlanır; URL tek başına yetki vermez
- `firestoreService.js`, `customerService.js`, `appointmentService.js` — client write yolları daraltılır
- `subscriptionService.js` / `activationCodeService.js` — activate/create CF’e taşınır
- `servicesAdmin.js`, `deletedAppointmentsService.js`, CRM panelleri

**Veri etkisi:** Yok (istemci davranışı).

**Risk:** Eski bookmark/login akışı kırılabilir; dual-run penceresi kısa tutulmalı.

**Rollback:** Önceki client bundle / git revert; rules hâlâ sıkıysa Auth login zorunlu kalır.

**Başarı kriteri:**
- `sessionStorage.barberSlug` değiştirmek başka dükkan verisi getirmez
- `localStorage` admin forge işe yaramaz
- Admin randevu CF veya authenticated write policy ile çalışır

**Bağımlılık:** Phase 4 ile eşzamanlı veya hemen sonra.

---

## Phase 6 — Cloud Functions hardening

**Amaç:** Public booking ve kritik yazımları sunucuda kilitlemek.

**Değiştirilecek:**
- `functions/index.js` — `createAppointment`: transaction ile slot rezervasyonu; App Check enforce (opsiyonel ek); Auth gerekmez (public) ama tüm kritik alanlar server doğrulamalı
- Yeni CF adayları:
  - `createAppointmentAdmin` (Auth + membership)
  - `activateSubscriptionCode` (Auth + kendi slug)
  - `createActivationCodes` / berber CRUD hassas alanlar (superAdmin claim)
  - `syncPublicBarber` (Admin SDK)
- `functions/lib/rateLimit.js` — korunur
- Client: `appointmentService.js` — public default CF; `forceClient` kaldırılır/kırılır; `?cfBooking=0` production’da etkisiz

**createAppointment hedef kontrolleri:**
- Mevcut validation + rate limit korunur
- `runTransaction` ile aynı `barberId+date+time` aktif çakışma atomik
- status/service/hours yalnız `publicBarbers` / güvenilir belgeden
- İstemci `status` vb. override edemesin

**Veri etkisi:** Yeni yazım yolları; mevcut appointment belgeleri kalır.

**Risk:** Transaction yokken çift slot kalır; CF downtime = booking kesilir (client fallback production’da kapalı olmalı).

**Rollback:** Önceki functions deploy; geçici client path yalnız acil + kısa süreli (bilinçli risk).

**Başarı kriteri:** Eşzamanlı çift create’de tek başarı; public `addDoc(appointments)` rules ile deny; admin authenticated yol yeşil.

**Bağımlılık:** Phase 4 öncesi public CF zorunlu; admin CF Phase 4/5 ile.

---

## Phase 7 — Legacy güvenliğin kaldırılması

**Amaç:** Düz metin password, frontend karşılaştırma, gömülü hash, sahte storage auth, kullanılmayan login kodunu silmek.

**Değiştirilecek / kaldırılacak (planlanan):**
- `berberler.password` alanları (batch Admin SDK — client script yok)
- `firestoreService.resolveBarberLogin` / `validateBarberLogin` password dalları
- `superAdminAuth.js` hash sabitleri
- `sessionAuth` storage role bayrakları
- `barber-login.js` deprecated akış (veya Auth’a redirect)
- `createAppointmentViaClient` production yolu
- `updateBarber` allowed list’ten password/subscription alanları

**Veri etkisi:** Password alan silme **geri alınamaz** (Auth tarafı sağlam değilse hesap kilidi). Yalnız Phase 2 başarı + izleme sonrası.

**Risk:** Erken silme = giriş kaybı.

**Rollback:** Password geri yüklenemez (yedek export’tan teorik); Auth reset akışı hazır olmalı.

**Başarı kriteri:** Kodda düz metin password okuma yok; grep temiz; storage auth yok.

**Bağımlılık:** Phase 2–6 tamam + izleme süresi.

---

## Phase 8 — Test ve deployment

**Amaç:** Emulator → staging → production sırası; rollback hazır.

**Değiştirilecek:** Test dosyaları / CI (yeni); deploy sırası dokümantasyonu.

**Deploy sırası (öneri):**
1. Functions (public booking + admin CF) staging
2. Auth migration staging
3. Rules staging + `SECURITY_RULES_TEST_PLAN.md`
4. Client staging smoke
5. Production: Functions → Auth claim/membership doğrula → Client → Rules (son)
6. Phase 7 password silme ayrı bakımlı pencere

**Rollback planı:**
- Rules: önceki rules deploy (&lt; 1 dk)
- Functions: previous revision
- Client: previous static host / git
- Auth: kullanıcı disable değil; claim geri al

**Başarı kriteri:** Test planı senaryoları geçti; staging smoke (giriş, randevu, CRM, super admin, çapraz tenant fail).

**Bağımlılık:** Phase 0–7.

---

## Faz özeti

| Faz | İsim | Risk |
|-----|------|------|
| 0 | Backup/baseline | Düşük |
| 1 | Auth temeli | Düşük |
| 2 | Berber migration | Yüksek |
| 3 | Super admin claims | Yüksek |
| 4 | Firestore Rules | **En yüksek** |
| 5 | Client migration | Orta-yüksek |
| 6 | Functions hardening | Yüksek |
| 7 | Legacy kaldırma | Yüksek (geri alınamaz veri) |
| 8 | Test/deploy | Orta |

**Not:** Phase 4 ve 6 birbirine kenetli; rules sıkılaştırmadan önce public/admin CF yolları production-ready olmalı.
