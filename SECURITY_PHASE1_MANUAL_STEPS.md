# SECURITY_PHASE1_MANUAL_STEPS.md

Phase 1 manuel adımlar — **bu görevde uygulanmaz**.

## Firebase Console kontrolü

1. [Firebase Console](https://console.firebase.google.com/) → proje seçimi
2. **Beklenen project ID:** `berberrandevu-20a3e`
3. Yanlış projede işlem yapmayın — `.firebaserc` ile doğrulayın

## Authentication

| Adım | Ne zaman | Durum |
|------|----------|--------|
| Authentication bölümünü aç | Phase 2 öncesi | Kontrol |
| Email/Password provider etkinleştir | Phase 2 başlangıcı | Henüz değil |
| Test kullanıcı oluştur | Emulator veya staging | Henüz değil |
| Production berber hesabı oluştur | Controlled onboarding (Phase 2) | Henüz değil |
| Custom claim `super_admin` | Phase 3 | Henüz değil |

## Yapılmaması gerekenler (Phase 1)

- Plaintext şifre migration
- `berberler.password` silme
- Production membership/users belgesi toplu oluşturma
- Firestore rules deploy
- Functions deploy
- Firebase Console'da provider'ı production'da zorunlu kılma (kod hazır, provider opsiyonel)

## Yerel geliştirme (opsiyonel)

```bash
firebase emulators:start --only auth,firestore,functions
```

Tarayıcı: `http://localhost:...?authEmulator=1` (localhost + flag zorunlu)

## Phase 2 öncesi checklist

- [ ] Email/Password provider etkin
- [ ] Emulator'da test Auth user
- [ ] Username → Auth identity CF tasarımı onaylı
- [ ] Production Firestore backup alındı (`SECURITY_BACKUP_RUNBOOK.md`)
