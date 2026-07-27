# FIRESTORE_PHASE4B_COMPATIBILITY_REPORT.md

Phase 4B1 — `firestore.phase4b.rules` uygulandığında mevcut frontend kırılmaları.

**Kural:** Candidate rules güvenli kalır; frontend bu görevde migrate edilmedi.

## BLOCKER

### B1 — Plaintext `password` alanı okunabilir kalır

| Alan | Değer |
|------|-------|
| Dosya | `firestoreService.js`, `membershipService.js` (dolaylı) |
| Path | `berberler/{slug}.password` |
| İşlem | get |
| Actor | Owner (candidate allow) |
| Neden | Firestore Rules field-level masking yapamaz |
| Migrasyon | Phase 7: password alanını sil; Auth-only credential |
| Öncelik | **BLOCKER** |

### B2 — Legacy username login (`berberler` where query)

| Alan | Değer |
|------|-------|
| Dosya | `firestoreService.js` → `resolveBarberLogin` |
| Fonksiyon | `resolveBarberLogin` (satır 167-174) |
| Path | `berberler` collection query `where username ==` |
| İşlem | list/query |
| Actor | unauthenticated / legacy |
| Tenant | username → slug |
| Candidate | **DENY** (list kapalı) |
| Migrasyon | Production Auth + membership tamamlanmalı; legacy path kaldırılmalı |
| Öncelik | **BLOCKER** |

### B3 — Production `businessMemberships` kayıtları yok

| Alan | Değer |
|------|-------|
| Dosya | `membershipService.js` |
| Path | `businessMemberships/{uid}` |
| İşlem | get |
| Actor | Auth owner |
| Candidate | ALLOW (own doc) |
| Migrasyon | Her owner için membership seed (Admin SDK) |
| Öncelik | **BLOCKER** |

### B4 — Müşteri sayfası `berberler` doğrudan okuma

| Alan | Değer |
|------|-------|
| Dosya | `app.js` (satır 206), `firestoreService.js` `fetchPublicBarber` fallback |
| Path | `berberler/{aktifDukkan}` |
| İşlem | get |
| Actor | unauthenticated public |
| Tenant | URL `dukkan`/`shop` |
| Candidate | **DENY** |
| Migrasyon | `publicBarbers` backfill + `fetchPublicBarber` fallback kaldır |
| Öncelik | **BLOCKER** |

## REQUIRED BEFORE DEPLOY

### R1 — Appointment client create

| Dosya | `appointmentService.js:190` |
| İşlem | create `appointments` |
| Candidate | DENY |
| Migrasyon | Public booking yalnız `createAppointment` CF |

### R2 — Appointment status update / cancel (client)

| Dosya | `deletedAppointmentsService.js:47` |
| İşlem | delete `appointments`, archive write |
| Candidate | DENY client write |
| Migrasyon | CF veya owner-scoped server endpoint |

### R3 — Admin `forceClient` appointment create

| Dosya | `appointmentService.js` (admin path) |
| Candidate | DENY |
| Migrasyon | Admin appointment CF |

### R4 — `activationCodes` client transaction

| Dosya | `subscriptionService.js`, `activationCodeService.js` |
| Candidate | DENY all client |
| Migrasyon | `activateSubscriptionCode` CF |

### R5 — Super admin `berberler` list / create

| Dosya | `firestoreService.js` `fetchAllBarbers`, `createBarber` |
| Candidate | DENY |
| Migrasyon | super_admin claim + CF/Admin SDK |

### R6 — `syncPublicBarber` client write

| Dosya | `firestoreService.js:82` |
| Candidate | DENY `publicBarbers` write |
| Migrasyon | CF mirror sync |

### R7 — `notificationService` client create

| Dosya | `notificationService.js:13` |
| Candidate | DENY create |
| Migrasyon | CF notification write |

### R8 — `campaignService` unscoped history list

| Dosya | `campaignService.js:100-105` `fetchCampaignHistory` |
| İşlem | list all `campaigns` |
| Candidate | DENY unscoped list |
| Migrasyon | Tenant-scoped query veya super-admin CF |

### R9 — `customerService` super-admin `fetchAllCustomers`

| Dosya | `customerService.js:202` |
| Candidate | DENY unscoped list |
| Migrasyon | Super-admin CF |

### R10 — `pendingBarbers` / `demo_talepleri` admin read-update

| Dosya | `pendingBarberService.js`, `demoRequestService.js` |
| Candidate | create public OK; read/update DENY |
| Migrasyon | Super-admin CF panel |

## POST-ROLLOUT HARDENING

- `blockedSlots` public list — path-scoped; candidate ALLOW (müşteri slot UI çalışır)
- `selectedServices` update via `servicesAdmin.js` — candidate owner update ALLOW (name gibi güvenli alanlar)
- `telegramChatId` — candidate protected; `updateBarber` allowed list'ten çıkarılmalı (uygulama)
- Legacy `berberler/{slug}/appointments/{date}` — candidate owner read only; yazım zaten CF/legacy

## Özet

| Kategori | Adet |
|----------|------|
| BLOCKER | 4 |
| REQUIRED BEFORE DEPLOY | 10 |
| POST-ROLLOUT HARDENING | 4 |
