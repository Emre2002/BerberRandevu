# FIREBASE_HOSTING_DECISION.md

## Mevcut deployment yöntemi
- Frontend production base URL kodda sabit: `https://berberv1.vercel.app` (`linkService.js` → `PRODUCTION_BASE_URL`).
- App Check dokümantasyonu aynı domaini Vercel olarak anıyor (`APP_CHECK_SETUP.md`: `berberv1.vercel.app`, “Production | Vercel domain”).
- Functions deploy yolu: `firebase deploy --only functions` (`functions/package.json`, `README-functions.md`).
- Repo kökünde `.github/`, `vercel.json`, `netlify.toml` yok.

## Firebase Hosting kullanılıyor mu?
Hayır — en azından bu repository üzerinden yapılandırılmamış.
- `firebase.json` geçmişinde (ilk commit `581831f` dahil) `hosting` anahtarı yok.
- Git history’de `firebase.json` içinde `hosting` araması boş.

## Doğrulanan public/source klasörü
- Ayrı `public/`, `dist/` veya `build/` klasörü yok.
- Statik frontend dosyaları repo kökünde: `index.html`, `randevu.html`, `admin.html`, `giris.html`, `super-admin.html`, ilgili `.js` / `.css`.
- Firebase Hosting `public` klasörü için kesin bir deploy klasörü seçilmedi / doğrulanmadı.

## Gerekli hosting config önerisi
Bu görevde `firebase.json`’a hosting eklenmedi.

Eğer ileride Firebase Hosting’e geçilecekse (kullanıcı kararı):
- `public: "."` (kök) veya bilinçli bir static export klasörü
- SPA rewrite muhtemelen gerekmez (çoklu gerçek HTML sayfaları; tek `index.html` router yok)
- Functions deploy’dan ayrı tutulmalı

Şu an öneri: Vercel’de kalın; Firebase yalnızca Functions + (yakında) Firestore rules/indexes için kullanılsın.

## SPA rewrite gerekip gerekmediği
Gerekmez (mevcut yapı çok sayfalı statik HTML). Firebase Hosting kullanılsa bile genelde `** → /index.html` rewrite uygun olmaz.

## Karar güven seviyesi
Yüksek — production URL ve dokümantasyon Vercel’i gösteriyor; Firebase Hosting config hiç var olmamış.

**Özet:** TESPİT EDİLEMEDİ (Firebase Hosting public klasörü için kullanıcı kararı gerekli) — mevcut yöntem Vercel olarak doğrulanmış; bu görevde hosting bloğu eklenmedi.
