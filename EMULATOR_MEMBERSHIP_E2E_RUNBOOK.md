# Emulator Membership E2E Runbook

Phase 3 — geliştirme ortamında owner membership akışını doğrulama. **Production bağlantısı yok.**

## Ön koşullar

- Node.js 20+
- `functions/` altında `npm install` (bir kez)
- Yerel şifre: `EMULATOR_OWNER_PASSWORD` ortam değişkeni (repo'ya yazılmaz)

## 1. Emulator'ları başlat

```bash
cd functions
npm run serve -- --project berberrandevu-20a3e
```

Bu komut `firebase.emulator.json` kullanır (production `firebase.json` değil).
Rules: top-level `firestore.rules` → `firestore.emulator.rules`

Beklenen portlar (`firebase.emulator.json`):

| Servis | Host | Port |
|--------|------|------|
| Auth | 127.0.0.1 | 9099 |
| Functions | 127.0.0.1 | 5001 |
| Firestore | 127.0.0.1 | 8080 |

## 2. Frontend static server

Yeni terminal:

```bash
node scripts/dev-static-server.mjs
```

→ `http://127.0.0.1:5500` (yalnız localhost, development-only)

## 3. Seed aracı (Auth kullanıcı + membership)

Emulator host env'leri **zorunlu**. Şifre yalnız ortam değişkeninden:

**PowerShell:**

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:EMULATOR_OWNER_PASSWORD = "<yerel-test-şifresi>"
cd functions
npm run seed:emulator -- --emulator-only --confirm-project=berberrandevu-20a3e
```

**bash:**

```bash
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export EMULATOR_OWNER_PASSWORD='<yerel-test-şifresi>'
cd functions && npm run seed:emulator -- --emulator-only --confirm-project=berberrandevu-20a3e
```

Seed idempotent: aynı kullanıcı/membership tekrar çalıştırıldığında duplicate oluşturmaz.

## 4. Giriş URL'si

```
http://127.0.0.1:5500/giris.html?authEmulator=1
```

Alternatif flag: `?useEmulators=1`

**Origin kuralı (kritik):** Giriş, redirect ve gözlem sayfasında **aynı hostname** kullanın.
`127.0.0.1` ile `localhost` farklı origin sayılır; Auth persistence paylaşılmaz.
Tüm adımlarda yalnız `http://127.0.0.1:5500` kullanın.

## 5. Sentetik kullanıcı adı

Fixture: `fixtures/auth-emulator-users.json`

| Alan | Değer |
|------|-------|
| Username | `emulator_owner` |
| businessId | `shop-emulator-a` |
| Auth e-posta (sunucu tarafı) | `emulator_owner@users.berberrandevu.internal` |

## 6. Şifre

- Repo'da **yok**; seed sırasında `EMULATOR_OWNER_PASSWORD` ile Auth Emulator hesabı oluşturulur.
- Girişte aynı yerel şifreyi kullanın.
- Log/console'a yazılmaz.

## 7. Auth state gözlemi

Giriş sonrası (veya paralel sekmede):

```
http://127.0.0.1:5500/dev-auth-state.html?authEmulator=1
```

Beklenen:

- `guard.state: authenticated_owner`
- `businessId: shop-emulator-a` (yalnız membership belgesinden)

UID, token, e-posta veya ham membership JSON gösterilmez.

## 8. Emulator'ları kapat

Emulator terminalinde `Ctrl+C`.

## 9. Emulator verisini temizle

Firebase Emulator verisi varsayılan olarak bellek içi; süreç kapanınca silinir.

Kalıcı export/import kullandıysanız ilgili emulator export klasörünü silin.

## 10. Yaygın hatalar

| Belirti | Olası neden | Çözüm |
|---------|-------------|-------|
| `functions/unavailable` | Functions emulator kapalı | `npm run serve` |
| `Emulator giriş servisi kullanılamıyor` | Flag eksik | URL'ye `?authEmulator=1` ekleyin |
| `authenticated_without_membership` | Membership seed yapılmadı | Seed aracını çalıştırın |
| `unauthenticated` (giriş sonrası) | Farklı origin (`localhost` vs `127.0.0.1`) veya persistence öncesi sign-in | Yalnız `127.0.0.1` kullanın; çıkış yapıp tekrar giriş yapın |
| `guard.state: error` + membership | Firestore emulator yanlış rules yüklüyor | Emulator'ı `npm run serve` ile yeniden başlatın (`firebase.emulator.json`) |
| `legacy_only` observer'da | Firebase Auth yok ama sessionStorage legacy oturum var | `authEmulator=1` ile giriş yapın; observer legacy'i owner saymaz |
| Seed `blocked: auth_emulator_missing_host` | Env eksik | `FIREBASE_AUTH_EMULATOR_HOST` ayarlayın |
| Seed `blocked: missing EMULATOR_OWNER_PASSWORD` | Şifre env yok | Yerel env değişkeni set edin |
| Firestore okuma production'a gider | Emulator flag kapalı | `?authEmulator=1` + localhost kullanın |

## Güvenlik notları

- Production deploy, ADC veya service account **kullanılmaz**.
- Seed aracı localhost dışı emulator host'u reddeder.
- `dev-auth-state.html` production hostname'de çalışmaz.
