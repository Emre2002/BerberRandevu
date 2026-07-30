# SECURITY_BASELINE.md

Phase 0 — Backup ve Baseline raporu.  
Baseline commit: `d743e02` (firestore CLI config) · Security docs: `0ee9aa4`

---

## 1. Git durumu

| Alan | Değer |
|------|--------|
| Branch | `security/firebase-auth-migration` |
| HEAD | `d743e02068c501bc5d1ee17c45ffba3770a889d3` |
| Working tree (Phase 0 başlangıcı) | clean |
| Remote | `origin` → `https://github.com/Emre2002/BerberRandevu` |
| Son commitler | `d743e02` firestore config · `0ee9aa4` security docs · `14738e1` UI |

Phase 0 çıktı dosyaları bu görevde oluşturuldu; commit/push yapılmadı.

---

## 2. Firebase proje doğrulaması

| Kontrol | Sonuç |
|---------|--------|
| `.firebaserc` default | `berberrandevu-20a3e` ✓ |
| `firebase.json` functions | `source: functions` ✓ |
| `firebase.json` firestore | `rules: firestore.rules`, `indexes: firestore.indexes.json` ✓ |
| `firebase.json` emulators | functions 5001, firestore 8080, UI enabled ✓ |
| Hosting | Yok (Vercel — `FIREBASE_HOSTING_DECISION.md`) |

Project ID uyuşmazlığı: **yok**.

---

## 3. Runtime ve yerel araçlar

| Araç | Sürüm |
|------|--------|
| Node | 20.20.1 |
| npm | 10.8.2 |
| Firebase CLI | 15.23.0 |
| Java | Temurin 21.0.11 LTS |
| Functions runtime | node 20 (`functions/package.json`) |
| `functions/node_modules` | mevcut (npm ci) |

---

## 4. Kritik dosya manifesti

Tam SHA-256: `SECURITY_BASELINE_MANIFEST.json`

Özet:
- Rules/index/config: `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- Auth client: `sessionAuth.js`, `admin-auth.js`, `giris.js`, `barber-login.js`, `super-admin.js`, `firestoreService.js`
- Super admin hash: `superAdminAuth.js`
- Public booking: `appointmentService.js`, `functions/index.js` (`createAppointment`)
- Frontend URL: `linkService.js` → Vercel

---

## 5. Secret tarama sonucu

| Kontrol | Sonuç |
|---------|--------|
| Service account JSON | Bulunamadı (tracked/untracked) |
| `.env*` | Bulunamadı |
| `GOOGLE_APPLICATION_CREDENTIALS` | Kodda referans yok |
| `private_key` / `client_email` (Admin SDK dosyası) | Bulunamadı |
| Debug log dosyaları | Bulunamadı |
| Hardcoded super-admin hash | `superAdminAuth.js` (tracked — bilinen legacy risk) |
| Plaintext password akışı | `firestoreService.js`, `giris.js`, `barber-login.js` |
| `firebase-config.js` | Tracked — Firebase **web** config (server secret değil) |

`.gitignore` güncellendi: `.env*`, debug logs, service account patterns, `secrets/`, `.gcloud/`.

**Sonuç:** Repo'da service account / private key sızıntısı tespit edilmedi. Legacy auth kodu bilinen risk olarak kayıtlı.

---

## 6. Mevcut Firestore Rules durumu

- Dosya: `firestore.rules` (SHA manifest'te)
- Production model: **tam açık** — tüm eşleşen koleksiyonlarda `allow read, write: if true`
- Staging hedef taslak: `firestore.staging.rules` (deploy edilmemiş)

---

## 7. Authentication baseline

- Firebase Authentication: **kullanılmıyor**
- Berber: Firestore `username` sorgusu + düz metin `password` karşılaştırma (client)
- Oturum: `sessionStorage` (berber), `localStorage` (super admin)
- Kesinleşen hedef: Firebase Auth tek kaynak; username UX korunur; parola taşınmaz, kontrollü reset

---

## 8. Super-admin baseline

- Doğrulama: client SHA-256 hash (`superAdminAuth.js`)
- State: `localStorage` bayrak/token/role
- Kesinleşen hedef: Firebase Auth + custom claim `super_admin: true` (Admin SDK ataması)

---

## 9. createAppointment baseline

- Tek CF: `functions/index.js` → `createAppointment`
- `request.auth`: yok
- Validation + rate limit: var
- Transaction: yok (slot race riski)
- Client fallback: `appointmentService.js` (`forceClient`, query bypass)
- Kesinleşen hedef: public yalnız CF; transaction hardening Phase 6

---

## 10. Emulator/test altyapısı

- `firebase.json` emulators tanımlı (functions + firestore)
- Emulator bu görevde **başlatılmadı**
- Rules test planı: `SECURITY_RULES_TEST_PLAN.md`

---

## 11. Vercel deployment baseline

- Production URL: `https://berberv1.vercel.app` (`linkService.js`)
- Firebase Hosting: kullanılmıyor
- Detay: `FIREBASE_HOSTING_DECISION.md`

---

## 12. Production backup hazır olma durumu

| Durum | Açıklama |
|-------|----------|
| Export çalıştırıldı mı? | **Hayır** |
| Runbook | `SECURITY_BACKUP_RUNBOOK.md` hazır |
| Phase 2 / Phase 4 öncesi | Export **zorunlu** (manuel) |

---

## 13. Phase 1 engelleri

| Engel | Durum |
|-------|--------|
| Uncommitted app source changes | Yok |
| Service account in repo | Yok |
| Project ID mismatch | Yok |
| Baseline manifest | Oluşturuldu |
| Production backup | Henüz alınmadı — Phase 1 koduna engel değil; Phase 2+ öncesi zorunlu |
| npm audit moderate | 9 adet — Phase 1'i engellemez |

---

## 14. Phase 1 readiness kararı

**READY_FOR_PHASE_1**

Koşullar: Yerel baseline tamamlandı. Phase 0 çıktılarının commit edilmesi önerilir. Production Firestore export Phase 2 öncesi manuel tamamlanmalı.

---

## npm audit baseline (functions)

| Alan | Değer |
|------|--------|
| Toplam | 9 |
| Severity | moderate (0 high/critical) |
| Direct/transitive | Transitive (`uuid` ← `firebase-admin`, `firebase-functions`, `gaxios`, `google-gax`) |
| Production/runtime | Functions deploy ortamı; `npm audit fix --force` breaking change gerektirir |
| Phase 1 engeli | **Hayır** — izleme; Phase 6/8'de kontrollü güncelleme |

`npm audit fix` / `--force` bu görevde **çalıştırılmadı**.
