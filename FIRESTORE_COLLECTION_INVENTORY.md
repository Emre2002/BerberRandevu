# FIRESTORE_COLLECTION_INVENTORY.md

Phase 4A — kod taraması ile doğrulanmış Firestore veri yüzeyi.

**Not:** `PROJECT_CONTEXT.md` Auth kullanılmıyor der; Phase 3 ile `businessMemberships` + Auth emulator yolu eklendi.

## Özet

| Koleksiyon | İşlemler | İstemci dosyaları | Tenant kaynağı | Hassasiyet |
|------------|----------|-------------------|----------------|------------|
| `berberler/{slug}` | R/W/L | `firestoreService.js`, `app.js`, `servicesAdmin.js` | URL `dukkan` / session | CRITICAL |
| `berberler/{slug}/blockedSlots` | R/W/L | `app.js` | URL `aktifDukkan` | MEDIUM |
| `berberler/{slug}/appointments/{date}` | R/W | `app.js`, `deletedAppointmentsService.js`, CF | slug arg | HIGH |
| `publicBarbers/{slug}` | R/W | `firestoreService.js` | slug | LOW |
| `appointments/{id}` | R/W/L | `appointmentService.js`, `app.js`, `customerService.js`, CF | `barberId` | HIGH |
| `customers/{id}` | R/W/L | `customerService.js`, CF | `barberSlug` | HIGH |
| `businessMemberships/{uid}` | R | `membershipService.js` | Auth uid | HIGH |
| `activationCodes/{code}` | R/W/L | `activationCodeService.js`, `subscriptionService.js` | caller | HIGH |
| `pendingBarbers/{id}` | R/W/L | `pendingBarberService.js` | — | MEDIUM |
| `demo_talepleri/{id}` | R/W/L | `demoRequestService.js` | — | LOW |
| `notifications/{id}` | R/W/L | `notificationService.js`, CF | `barberSlug` | MEDIUM |
| `deletedAppointments/{id}` | R/W/L | `deletedAppointmentsService.js` | `barberSlug` | MEDIUM |
| `campaigns/{id}` | R/W/L | `campaignService.js` | doc içi slug | MEDIUM |
| `payments/{id}` | rules only | — | — | HIGH |
| `rateLimits`, `appointmentAttempts` | Admin W | `functions/lib/rateLimit.js` | — | INTERNAL |

## Kod referansları

- `berberler` read: `firestoreService.js` (`fetchBarberBySlug`, `resolveBarberLogin`), `app.js:206`
- `berberler` write: `firestoreService.js` (`createBarber`, `updateBarber`), `servicesAdmin.js:334`
- `publicBarbers`: `firestoreService.js` (`syncPublicBarber`, `fetchPublicBarberBySlug`)
- `appointments` create client: `appointmentService.js:190`; CF: `functions/index.js:457`
- `businessMemberships` read: `membershipService.js:26-27`
- `customers`: `customerService.js` (`getDoc`, `where barberSlug`)
- `activationCodes`: `activationCodeService.js`, `subscriptionService.js` transaction
- `pendingBarbers`: `pendingBarberService.js:87`
- `demo_talepleri`: `demoRequestService.js:30`

## Belge ↔ kod farkları

| Konu | Eski belge | Kod |
|------|------------|-----|
| Auth | Kullanılmıyor | Phase 3 Auth + membership aktif |
| Public yüzey | `publicBarbers` hedef | `app.js` hâlâ `berberler` okur |
| Membership koleksiyonu | `memberships` | `businessMemberships` (`authGuard.js`) |
