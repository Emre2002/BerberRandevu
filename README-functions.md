# BerberRandevu — Cloud Functions

Müşteri randevu oluşturma için `createAppointment` callable function.

**Varsayılan (Faz 5C-C4):** Müşteri randevu akışı Cloud Function kullanır.  
**Rollback:** `?cfBooking=0` veya `?forceClientBooking=1` ile eski client-side yol.

Örnek: `randevu.html?dukkan=x-men`

---

## Durum özeti (Faz 5C-C4)

| Özellik | Durum |
|---------|--------|
| Müşteri randevu (varsayılan) | **Cloud Function** |
| Client-side rollback | `?cfBooking=0` veya `?forceClientBooking=1` |
| Güvenli CF fallback | Teknik hatalarda client path (kısa süreli) |
| Admin panel randevu | Client (`forceClient: true`) |
| Server-side rate limit | CF içinde aktif |
| App Check | **Monitor mode** — enforce yok |
| Firestore Rules (production) | Değiştirilmedi — açık |
| Staging rules taslağı | `firestore.staging.rules` (deploy edilmedi) |

---

## Müşteri randevu yolu (C4)

### URL parametreleri

| URL | Davranış |
|-----|----------|
| `randevu.html?dukkan=x-men` | **CF varsayılan** |
| `randevu.html?dukkan=x-men&cfBooking=1` | CF (açık zorlama) |
| `randevu.html?dukkan=x-men&cfBooking=0` | Client rollback |
| `randevu.html?dukkan=x-men&forceClientBooking=1` | Client rollback |

Admin panel: her zaman client path — CF'ye gitmez.

### Güvenli fallback

CF çağrısı başarısız olursa **yalnızca teknik erişim hatalarında** eski client write denenir:

- `functions/unavailable`
- `functions/internal`
- `functions/deadline-exceeded`
- `functions/not-found`
- Ağ / timeout benzeri hatalar

Console log (kullanıcıya gösterilmez):

```
[Booking] CF unavailable, falling back to client path
```

Fallback **yapılmaz** (CF kararı geçerlidir):

- `duplicate_phone_day`, `slot_taken`, `booking_closed`, `spam_detected`
- Rate limit: `phone_rate_limited`, `ip_barber_rate_limited`, `ip_global_rate_limited`
- `invalid_phone`, `invalid_service`, `permission-denied`
- Diğer iş kuralı / güvenlik redleri

**Neden?** CF “bu randevu alınamaz” dediyse client path ile bypass edilmemeli. Fallback yalnızca CF'ye ulaşılamadığında geçici köprüdür (Rules sıkılaşana kadar).

Fallback de başarısız olursa: *"Şu anda randevu oluşturulamadı. Lütfen tekrar deneyin."*

---

## App Check

### Nedir?

Firebase App Check, isteklerin gerçek web uygulamanızdan geldiğini doğrular. Botların Firestore/Callable API'yi doğrudan spam etmesini zorlaştırır.

### Şu an: Monitor mode

- **Enforce kapalı** — token olmadan CF ve Firestore çalışmaya devam eder
- CF her `createAppointment` çağrısında log: `[App Check Monitor] present | missing`
- Client opt-in: `?appCheck=1` + `APP_CHECK_RECAPTCHA_SITE_KEY` (`firebase-config.js`)

Tam kurulum: **[APP_CHECK_SETUP.md](./APP_CHECK_SETUP.md)**

### Enforce nasıl açılır? (Sonraki faz)

1. reCAPTCHA v3 site key + Firebase Console App Check
2. Client'ta `initializeAppCheck` tüm sayfalarda
3. Monitor metrikleri: `% present` > 95% birkaç gün
4. `onCall({ enforceAppCheck: true })` + Console enforcement
5. Rollback planı hazır olsun

### Enforce öncesi test listesi

- [ ] `randevu.html?dukkan=x-men&appCheck=1` → CF log `present`
- [ ] Site key olmadan uygulama kırılmıyor
- [ ] Admin / SuperAdmin sayfaları App Check ile test edildi
- [ ] localhost + production domain reCAPTCHA'da tanımlı
- [ ] Emulator debug token (geliştirme) dokümante

**Önerilen sağlayıcı:** reCAPTCHA v3 (Enterprise büyüme aşamasında)

---

## Staging Firestore Rules

### Dosya: `firestore.staging.rules`

Production'a **deploy edilmemeli**. Staging Firebase projesinde veya emulator'da test içindir.

### Amaç

| Koleksiyon | Staging hedef |
|------------|---------------|
| `publicBarbers` | read: true, write: false |
| `appointments` | client create: false, geçici list read (slot) |
| `customers`, `notifications` | anon: false, auth claims sonra |
| `rateLimits`, `appointmentAttempts` | false (yalnız CF Admin SDK) |
| `activationCodes` | false |
| `berberler` | auth gerekli (hemen production'da uygulanmaz) |

### Production rules neden hemen deploy edilmemeli?

1. **Admin panel** hâlâ client-side Firestore read/write kullanıyor (sessionStorage auth, Firebase Auth yok)
2. **Müşteri varsayılan yolu** hâlâ client `addDoc(appointments)`
3. **Abonelik aktivasyonu** client transaction (`activationCodes`)
4. **SuperAdmin** tüm koleksiyonlara doğrudan erişiyor
5. Rules sıkılaştırma **Auth + admin CF** olmadan canlı sistemi kırar

---

## Geçiş planı (özet)

| Stage | İçerik |
|-------|--------|
| **1** | CF müşteri yolu test — `?cfBooking=1` stabil |
| **2** | Production default CF + client write fallback birkaç gün |
| **3** | `createAppointmentAdmin` CF planı |
| **4** | Firebase Auth + custom claims (barber, superAdmin) |
| **5** | Staging projede `firestore.staging.rules` test |
| **6** | Production rules kademeli sıkılaştırma + App Check enforce |

---

## Gereksinimler

- Node.js 20+
- Firebase CLI: `npm install -g firebase-tools`
- Firebase projesine giriş: `firebase login`

---

## Kurulum

```bash
cd functions
npm install
cd ..
```

---

## Rate limit sistemi

Cloud Function her çağrıda Firestore `rateLimits` koleksiyonunu kullanır.  
**Yalnızca Cloud Function yazar** — production Rules bu fazda değiştirilmedi.

### Limitler

| Doc ID | Limit |
|--------|-------|
| `pa_{slug}_{phone}_{bucket}` | 3 deneme / saat |
| `ip_{slug}_{ipHash}_{bucket}` | 5 başarılı / saat |
| `ipg_{ipHash}_{bucket}` | 20 istek / saat |

Detay: Faz 5C-C2 notları aşağıda.

### Saatlik bucket

- Format: `yyyyMMddHH` — **Europe/Istanbul**

---

## Emulator ile yerel test

```bash
firebase emulators:start --only functions,firestore
```

```
http://localhost:5500/randevu.html?dukkan=x-men
http://localhost:5500/randevu.html?dukkan=x-men&forceClientBooking=1
http://localhost:5500/randevu.html?dukkan=x-men&appCheck=1
```

---

## Production deploy (Functions only)

```bash
firebase deploy --only functions
```

**Bu fazda deploy edilmeyecek:** `firestore.rules` (production), App Check enforce.

---

## Feature flag (C4)

| Parametre | Davranış |
|-----------|----------|
| (yok) | **Cloud Function (varsayılan)** |
| `cfBooking=1` | Cloud Function |
| `cfBooking=0` | Client rollback |
| `forceClientBooking=1` | Client rollback |
| `appCheck=1` | App Check monitor (site key gerekli) |

---

## Callable hata kodları

`booking_closed`, `slot_taken`, `duplicate_phone_day`, `phone_rate_limited`, `ip_barber_rate_limited`, `ip_global_rate_limited`, `spam_detected`, `rate_limit_error`

---

## Admin kırılma riski (rules sıkılaştırılırsa)

Staging rules production'a alınmadan önce çözülmeli:

| Özellik | Kırılma nedeni |
|---------|----------------|
| Admin takvim | `appointments` read/write, `blockedSlots` write |
| Admin randevu ekleme | `createAppointmentWithEffects` client write |
| CRM | `customers` read/write |
| Hizmet yönetimi | `berberler` update |
| Çalışma saatleri | `berberler` update |
| Abonelik kodu | `activationCodes` + `berberler` transaction |
| Public Mirror Sync | `publicBarbers` write |
| SuperAdmin | `berberler`, `activationCodes`, tüm koleksiyonlar |
| Canlı bildirimler | `notifications` read/listener |

---

## Sorun giderme

| Sorun | Çözüm |
|-------|--------|
| `functions/not-found` | Deploy veya emulator |
| App Check `missing` | Normal (monitor); `?appCheck=1` + site key ile test |
| Staging rules test | Ayrı Firebase projesi + `firestore.staging.rules` |
| `shop_not_found` | Public Mirror Sync |

---

## İlgili dokümanlar

- [APP_CHECK_SETUP.md](./APP_CHECK_SETUP.md) — App Check kurulum ve enforce
- [firestore.staging.rules](./firestore.staging.rules) — staging rules taslağı
- [firestore.rules](./firestore.rules) — production (henüz açık, değiştirilmedi)
