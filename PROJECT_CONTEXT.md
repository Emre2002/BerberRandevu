# PROJECT_CONTEXT.md — BerberRandevu

Çok kiracılı (multi-tenant) berber randevu SaaS. Vanilla JS + Firebase.
Bu dosya güvenlik çalışmaları için yoğun proje haritasıdır. Doğrulanmış bilgiler içerir.

## 1. Teknoloji Yığını
- **Frontend:** Framework yok. Vanilla JS (ES Modules), statik HTML/CSS. Firebase SDK CDN'den (v10.7.1) import ediliyor.
- **Backend:** Firebase Cloud Functions v2 (`functions/index.js`, Node 20). Sadece `createAppointment` callable mevcut.
- **Veritabanı:** Cloud Firestore (client SDK doğrudan erişiyor).
- **Authentication:** Firebase Auth KULLANILMIYOR. Özel/custom giriş — username+password Firestore'da düz metin; oturum localStorage/sessionStorage'da.
- **Hosting/Deployment:** Firebase (`firebase.json`, `.firebaserc`, proje `berberrandevu-20a3e`). Functions deploy scripti mevcut. Hosting bloğu `firebase.json`'da tespit edilemedi.
- **Önemli paketler:** `firebase-admin` ^12.7.0, `firebase-functions` ^5.1.1 (functions). Client tarafı build/paket yok.

## 2. Klasör ve Dosya Haritası (güvenlik açısından önemli)
- `firebase-config.js` — Firebase config (public apiKey), App Check monitor, callable köprüsü.
- `firebase-config.example.js` — örnek config şablonu.
- `firestore.rules` — Firestore güvenlik kuralları (AÇIK: `allow read, write: if true`).
- `firestore.staging.rules` — staging kuralları (ayrıca incelenmeli).
- `firebase.json` / `.firebaserc` — deployment/emülatör ayarları, proje kimliği.
- `functions/index.js` — tek backend endpoint: `createAppointment` (validation + rate limit).
- `functions/lib/rateLimit.js` — IP/telefon rate limit, IP hash, App Check monitor logu.
- `sessionAuth.js` — berber + süper admin oturum yönetimi (localStorage/sessionStorage, süre 8s).
- `superAdminAuth.js` — süper admin giriş doğrulaması (SHA-256 hash client'ta gömülü).
- `admin-auth.js` — berber admin paneli route guard (frontend gate).
- `giris.js` — berber girişi (username/şifre ile slug çözümleme).
- `barber-login.js` — slug bazlı berber girişi (deprecated akış).
- `super-admin.js` — süper admin panel giriş/mount akışı.
- `superAdminAuth.js` — süper admin kimlik doğrulama sabitleri.
- `firestoreService.js` — tüm Firestore CRUD; berber login, password saklama, publicBarbers sync.
- `appointmentService.js` — randevu oluşturma (client veya callable yolu).
- `customerService.js` — müşteri (CRM) işlemleri.
- `subscriptionService.js` — abonelik durumu/hesaplama, aktivasyon kodu.
- `subscriptionAdmin.js` — abonelik admin işlemleri.
- `activationCodeService.js` — aktivasyon kodu üretimi/doğrulama.
- `publicBookingAccess.js` — public randevu erişim/blok kuralları.
- `pendingBarberService.js` / `pendingBarbersPanel.js` — bekleyen berber başvuruları.
- `super-admin-panel.js` / `super-admin-dashboard.*` — süper admin paneli.
- `admin.html` / `super-admin.html` / `giris.html` / `barber-login.html` / `randevu.html` — sayfa giriş noktaları.
- `paymentService.js` — ödeme kayıtları (`payments` koleksiyonu).
- `notificationService.js` — bildirimler.
- `deletedAppointmentsService.js` — silinen randevu arşivi.

## 3. Kimlik ve Yetkilendirme Akışı
- **Berber girişi:** `giris.js` → `resolveBarberLogin(username,password)` (`firestoreService.js`); Firestore `berberler` koleksiyonunda `username` sorgusu, ardından `password !== barber.password` DÜZ METİN karşılaştırma.
- **Süper admin girişi:** `super-admin.js` → `validateSuperAdminLogin` (`superAdminAuth.js`); kullanıcı adı+şifre SHA-256 ile client kodunda gömülü hash'e karşı doğrulanır.
- **Giriş durumu saklama:** Berber → `sessionStorage` (`barberLoggedIn`, `barberSlug`, süre 8s). Süper admin → `localStorage` (`superAdminLoggedIn`, token, role). Backend doğrulaması yok.
- **Rol okuma:** Rol yok; süper admin rolü `localStorage.superAdminRole === "superAdmin"` ile client'ta belirlenir.
- **Admin yetkisi:** `admin-auth.js` içindeki `initGate()` ile SADECE frontend'de belirlenir (session/URL slug eşleşmesi).
- **businessId/tenantId:** `slug` = tenant kimliği. URL parametresi `?dukkan=`/`?shop=` (`getBarberSlugFromUrl`) veya session slug'ından okunur.
- **Backend doğrulaması:** Sadece `createAppointment` callable'da (girdi doğrulama + rate limit + publicBarbers kontrolü). Kullanıcı kimliği/rol doğrulaması backend'de tespit edilemedi.
- **Sadece frontend kontrolü olan noktalar:** Admin paneli erişimi, süper admin paneli, tüm randevu güncelleme/silme, müşteri/abonelik işlemleri (Firestore kuralları açık olduğundan client-only).

## 4. Veri Modeli (Firestore koleksiyonları)
- **berberler/{slug}** (tenant/işletme + kullanıcı): `name, slug, username, password (düz metin), phone, email, telegramChatId, openHour, closeHour, selectedServices, status, subscriptionStatus, subscriptionEndDate, lastActivationCode`. Alt koleksiyonlar: `blockedSlots`, `appointments` (legacy).
- **publicBarbers/{slug}** (public ayna): hassas alanlar HARİÇ (username/password/telegram/abonelik yok); `bookingOpen`, `status`, çalışma saatleri.
- **appointments/{id}** (randevular): `barberId(=slug), customerName, phone, service, date, time, status, musteriNotu`.
- **customers/{barberSlug_phone}** (müşteriler): `barberSlug, displayName, phone, nameVariants, firstVisit, lastVisit, totalAppointments/totalVisits`.
- **employees:** Ayrı koleksiyon tespit edilemedi (berber = tek kullanıcı görünüyor).
- **services:** `berberler.selectedServices` alanı içinde; ayrı koleksiyon değil.
- **subscriptions:** Ayrı koleksiyon yok; abonelik alanları `berberler` dokümanında. `activationCodes` ile aktivasyon.
- **payments, notifications, campaigns, deletedAppointments, demo_talepleri:** açık okuma/yazma erişimli koleksiyonlar.

## 5. Kritik İşlem Akışları
- **Giriş yapma:** `giris.js` + `firestoreService.js#resolveBarberLogin` + `sessionAuth.js#loginBarberSession`.
- **Admin paneline girme:** `admin-auth.js#initGate` (frontend gate) → `admin.html`.
- **Süper admin panele girme:** `super-admin.js` + `superAdminAuth.js` + `sessionAuth.js#isSuperAdminLoggedIn`.
- **Randevu oluşturma:** `appointmentService.js#createAppointmentWithEffects` → callable `functions/index.js#createAppointment` (varsayılan) veya client `createAppointmentViaClient`.
- **Randevu güncelleme:** `firestoreService.js` / `appointmentService.js` (client `updateDoc`, backend doğrulaması yok).
- **Randevu silme:** `deletedAppointmentsService.js` + client `deleteDoc` (backend doğrulaması yok).
- **Kullanıcı rolü kontrolü:** `sessionAuth.js` (client-only), backend yok.
- **Başka işletmenin verisini sorgulama:** Firestore kuralları `if true` — herhangi bir client tüm `berberler`, `appointments`, `customers` verisini okuyup yazabilir.
- **Abonelik kontrolü:** `subscriptionService.js#getSubscriptionState` (client-only, `berberler` alanlarından).

## 6. İlk Güvenlik Ön Değerlendirmesi (bariz riskler, en fazla 10)
1. **Firestore kuralları tamamen açık** (`allow read, write: if true`) — kimlik doğrulamasız herkes tüm verileri okuyup yazabilir/silebilir.
2. **Berber şifreleri Firestore'da DÜZ METİN** saklanıyor; kurallar açık olduğundan herkes okuyabilir.
3. **Yetkilendirme yalnızca frontend'de** — admin/süper admin gate'leri client kodu; API/DB seviyesinde zorlanmıyor.
4. **Süper admin kimlik bilgisi client'ta gömülü SHA-256 hash** — offline brute-force ve statik dosyadan çıkarım riski.
5. **Süper admin oturumu localStorage'da bayrak** (`superAdminLoggedIn=true`) — XSS veya elle set ile bypass.
6. **Tenant izolasyonu yok** — `slug` URL'den geliyor, DB seviyesinde tenant kısıtı yok; çapraz işletme veri erişimi.
7. **Backend randevu güncelleme/silme yok** — bu işlemler doğrudan client'tan yetki kontrolsüz yapılıyor.
8. **App Check yalnızca monitor/opt-in** ve enforce edilmemiş — callable ve DB kötüye kullanıma açık.
9. **publicBarbers'a client yazımı** — `berberler` yazımı serbest olduğundan public ayna manipüle edilebilir.
10. **Hassas alanlar (telegramChatId, abonelik, password) `berberler`'de** ve açık kurallar nedeniyle sızıntıya açık.

> Not: Bu yalnızca ön değerlendirmedir; ayrıntılı denetim ve çözüm bir sonraki aşamada yapılacaktır.
