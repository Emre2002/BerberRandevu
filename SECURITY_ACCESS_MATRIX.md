# SECURITY_ACCESS_MATRIX.md

Kaynak: gerçek koleksiyon adları ve client/CF erişimleri (kod doğrulaması).
Mevcut üretim kuralları (`firestore.rules`): tüm listelenen kaynaklar için `allow read, write: if true` (deny-by-default yok).
`firestore.staging.rules` hedef taslaktır; production’da aktif değildir.

## Roller (gerçek)

| Rol | Kimlik kaynağı (bugün) | Güvenilir mi? |
|-----|------------------------|---------------|
| `public` (unauthenticated) | Yok | — |
| `barber` | `sessionStorage` (`barberLoggedIn`, `barberSlug`) + Firestore `berberler.username/password` düz metin | Hayır — client-only |
| `superAdmin` | Client SHA-256 (`superAdminAuth.js`) + `localStorage` bayrak/token/role | Hayır — client-only |

**Yok:** Firebase Auth kullanıcıları, customer hesabı, employee rolü, membership belgesi.

**Tenant anahtarı:** `slug` (`berberler` doc id). İlişkili alanlar: `appointments.barberId`, `customers.barberSlug`, `notifications.barberSlug`, `deletedAppointments.barberSlug`.

---

## Matris — mevcut davranış (production rules açık)

Açıklama: A = allow (rules + client yolu), D = deny (rules ile). Bugün neredeyse her şey A.
“Tenant izolasyonu gerekli?” = hedef modelde izolasyon şart mı.

### `publicBarbers/{slug}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get | A (müşteri UI) | A | A | Hayır (kasıtlı public read hedefi) |
| list | A | A | A | Evet (list kısıtlanmalı) |
| create/update/delete | A (rules açık; yazım `firestoreService.syncPublicBarber` client) | A | A | Evet — yalnız güvenilir sync |

### `berberler/{slug}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get | A (`app.js` müşteri sayfası da okuyor) | A | A | Evet — hassas alanlar (password, telegram, abonelik) |
| list | A (`fetchAllBarbers`) | A | A | Evet |
| create | A | A | A (panel `createBarber`) | Evet — yalnız superAdmin/CF |
| update | A | A (`servicesAdmin`, abonelik alanları dahil allowed list) | A | Evet + protected fields |
| delete | A | A | A | Evet |

### `berberler/{slug}/blockedSlots/{docId}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get/list | A (slot UI) | A | A | Kısmi — public list daraltılmalı |
| create/update/delete | A | A (`app.js` admin) | A | Evet |

### `berberler/{slug}/appointments/{date}` (legacy)
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get | A (slot birleştirme) | A | A | Kısmi |
| write/delete | A | A (`deletedAppointmentsService`) | A | Evet |

### `appointments/{id}` — tenant alanı: `barberId`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get | A | A | A | Evet |
| list | A (`where barberId+date` müşteri; berber CRM) | A | A (`fetchAll` yolları) | Evet |
| create | A (`createAppointmentViaClient` + CF Admin SDK) | A (`forceClient: true` admin) | A | Evet — public create yalnız CF |
| update | A | A | A | Evet |
| delete | A | A | A | Evet |

### `customers/{id}` — tenant: `barberSlug` (id: `{slug}_{phone}`)
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get/list | A | A (`fetchCustomersByBarber`) | A (`fetchAllCustomers`) | Evet |
| create/update | A (randevu yan etkisi client/CF) | A | A | Evet |
| delete | A | A | A | Evet |

### `notifications/{id}` — tenant: `barberSlug`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get/list/write | A | A | A | Evet — create tercih CF |

### `deletedAppointments/{id}` — tenant: `barberSlug`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get/list/create/update/delete | A | A | A | Evet |

### `campaigns/{id}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get/list/write | A | A | A | Evet (kodda `barberSlug` kullanımı var; staging aynı varsayar) |

### `activationCodes/{code}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| get | A | A (`activateSubscriptionCode` client transaction) | A | Evet — client read kapatılmalı |
| list | A | A | A (`fetchAllActivationCodes`) | Evet — yalnız superAdmin/CF |
| create/update/delete | A | A (activate update) | A (`createActivationCodes`) | Evet — CF |

### `pendingBarbers/{id}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| create | A (başvuru formu) | A | A | Public create OK; read/admin değil |
| read/update/delete | A | A | A (panel) | Evet — yalnız superAdmin |

### `demo_talepleri/{id}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| create | A (landing) | A | A | Public create OK |
| read/update/delete | A | A | A | Evet — yalnız superAdmin |

### `payments/{id}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| read/write | A (rules) | A | A | Evet — superAdmin/CF; `paymentService` mock kayıtları client |

### `rateLimits/{id}`, `appointmentAttempts/{id}`
| İşlem | public | barber | superAdmin | Tenant izolasyonu gerekli? |
|-------|--------|--------|------------|----------------------------|
| read/write | A (rules açık; yazım CF Admin SDK) | A | A | Evet — client tamamen deny |

---

## Tenant kimliği kaynakları (doğrulanmış)

| Akış | Tenant değeri | Kaynak |
|------|---------------|--------|
| Müşteri randevu UI | `aktifDukkan` | URL (`dukkan`/`shop`/`randevu`); yoksa customer sayfada varsayılan `"x-men"` |
| Berber login sonrası | `barberSlug` | Firestore sorgu sonucu → `sessionStorage` |
| Admin gate | slug | URL `?dukkan=` + `sessionStorage` eşleşmesi (`admin-auth.js`) |
| Super admin dükkan denetimi | slug | URL; yetki `localStorage` superAdmin state |
| Appointment create (client) | `barberId` | JS parametresi (`aktifDukkan` / caller) — client güvenilir değil |
| Appointment create (CF) | `data.barberSlug` | İstemci payload; CF `publicBarbers` ile doğrular, Auth yok |
| Customer/CRM sorguları | `barberSlug` argümanı | Caller (session/URL/JS) — rules zorlamaz |
| Abonelik aktivasyonu | `barberSlug` argümanı | Caller — client transaction |

---

## Cloud Function `createAppointment` (özet erişim)

| Kontrol | Durum |
|---------|--------|
| `request.auth` | Yok |
| Input validation | Var (telefon, tarih, saat, isim, honeypot `website`) |
| Rate limit | Var (`rateLimits`, IP/telefon) |
| İşletme doğrulama | `publicBarbers` status + `bookingOpen` |
| Servis / çalışma saatleri | `publicBarbers` üzerinden |
| Slot çakışma / aynı gün telefon | Query ile kontrol; **transaction yok** |
| Kritik alan güveni | `barberSlug`, service, date, time istemciden; sunucu whitelist ile doğrular |

---

## Hedef model özeti (matris yönü)

| Kaynak | public | barber (Auth+membership) | superAdmin (claim) |
|--------|--------|--------------------------|---------------------|
| `publicBarbers` | get (ve gerekirse dar list) | get | full via CF/Admin |
| `berberler` hassas | deny | kendi slug get/update (protected fields hariç) | full |
| `appointments` write | deny (CF) | kendi tenant update/delete veya CF | full/CF |
| `customers` | deny | kendi `barberSlug` | full |
| `activationCodes` | deny | activate yalnız CF | create/list CF |
| `rateLimits` / `appointmentAttempts` | deny | deny | deny (Admin SDK) |
