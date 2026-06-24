# Firebase App Check — BerberRandevu Kurulum Rehberi

Bu doküman **Faz 5C-C3** kapsamında hazırlanmıştır. App Check şu an **monitor mode**'dadır; production enforce yoktur.

---

## App Check nedir?

Firebase App Check, isteklerin gerçek uygulamanızdan geldiğini doğrular. Bot/script ile doğrudan Firebase API (Firestore, Callable Functions) kullanımını zorlaştırır.

- **Client:** reCAPTCHA v3 veya Enterprise token üretir
- **Firebase:** Token'ı doğrular
- **Cloud Functions:** `request.app` ile App Check durumu görülür; `enforceAppCheck: true` ile zorunlu kılınır

---

## Sağlayıcı karşılaştırması

| | reCAPTCHA v3 | reCAPTCHA Enterprise |
|---|--------------|----------------------|
| Kurulum | Hızlı, Firebase Console entegrasyonu | Google Cloud Console + faturalandırma |
| Maliyet | Ücretsiz kotası genelde yeterli | Düşük-orta trafik SaaS için uygun |
| Bot koruması | İyi (skor tabanlı) | Daha gelişmiş sinyaller |
| BerberRandevu için | **Önerilen (v1)** | Büyüme / saldırı artınca geçiş |

### Öneri: **reCAPTCHA v3**

BerberRandevu statik web uygulaması, düşük-orta trafik ve hızlı kurulum için **reCAPTCHA v3** yeterlidir. Enterprise, yoğun bot saldırısı veya kurumsal SLA gerektiğinde değerlendirilir.

---

## Kurulum adımları (Firebase Console)

### 1. reCAPTCHA v3 site key oluştur

1. [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin) → v3 key
2. Domain: `berberv1.vercel.app`, `localhost`, staging domain
3. Site key ve secret key'i not alın

### 2. Firebase App Check'i etkinleştir

1. Firebase Console → **App Check**
2. Web app seç → **reCAPTCHA v3** provider
3. Site key'i gir
4. **Enforcement:** Başlangıçta **Unenforced** (monitor) bırak

### 3. Cloud Functions monitor

`createAppointment` her çağrıda log üretir:

```
[App Check Monitor] present | missing { appId, enforce: false }
```

Firebase Console → App Check → Metrics ile birlikte izleyin.

### 4. Client monitor (opsiyonel test)

Kod hazırlığı `firebase-config.js` içinde:

- URL: `?appCheck=1` → App Check token üretmeyi dener
- Site key: `APP_CHECK_RECAPTCHA_SITE_KEY` sabiti (henüz boş olabilir)
- **Enforce yok** — token olmadan da uygulama çalışır

Test URL örneği:

```
randevu.html?dukkan=x-men&cfBooking=1&appCheck=1
```

Site key tanımlandıktan sonra CF loglarında `present` görülmeli.

---

## Enforce nasıl açılır? (Sonraki faz — dikkatli)

### Ön koşul checklist

- [ ] Client'ta `initializeAppCheck` tüm sayfalarda aktif (randevu, admin, super-admin)
- [ ] reCAPTCHA domain listesi production + staging + localhost
- [ ] `?cfBooking=1` test yolu App Check ile başarılı
- [ ] Callable CF: 1 hafta monitor — `% present` > %95
- [ ] Firestore / Functions Console'da unverified istek sayısı düşük
- [ ] Rollback planı: enforce kapat + redeploy

### Adımlar

1. **Functions enforce:**

```javascript
exports.createAppointment = onCall(
  { cors: true, enforceAppCheck: true },
  async (request) => { ... }
);
```

2. **Firebase Console → App Check → Enforcement:**
   - Cloud Functions → Enforced
   - Firestore → Enforced (rules sıkılaştırma ile birlikte)

3. **Client:** `initializeAppCheck` production'da zorunlu (site key env/config)

### Rollback

- Console'dan enforcement → Unenforced
- `enforceAppCheck: false` deploy
- Client App Check init geçici devre dışı (acil durum)

---

## Site key yönetimi

| Ortam | Öneri |
|-------|--------|
| Development | localhost domain'li v3 key |
| Staging | Ayrı Firebase projesi + ayrı key |
| Production | Vercel domain + secret (build env veya firebase-config sabiti) |

**Not:** Site key client'ta görünür — bu normaldir. Güvenlik App Check + Rules + CF ile sağlanır.

`APP_CHECK_RECAPTCHA_SITE_KEY` değerini `firebase-config.js` içinde doldurun veya ileride build-time inject edin.

---

## İlgili dosyalar

| Dosya | Rol |
|-------|-----|
| `firebase-config.js` | `initAppCheckMonitor()` — opt-in `?appCheck=1` |
| `functions/lib/rateLimit.js` | `logAppCheckMonitor()` |
| `firestore.staging.rules` | Rules staging taslağı (App Check ile birlikte Stage 6) |
| `README-functions.md` | CF + rate limit + App Check özeti |

---

## Bilinen sınırlamalar (C3)

- App Check, API key ile doğrudan REST Firestore erişimini engellemez — **Rules sıkılaştırma şart**
- Admin panel sessionStorage auth — App Check tek başına admin korumaz
- Emulator'da App Check debug token gerekebilir (`FIREBASE_APPCHECK_DEBUG_TOKEN`)

---

## Sonraki faz özeti

1. Production müşteri default CF
2. `createAppointmentAdmin` + Firebase Auth custom claims
3. Staging'de `firestore.staging.rules` test
4. App Check enforce + production rules kademeli deploy
