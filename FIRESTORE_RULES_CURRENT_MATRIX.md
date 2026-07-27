# FIRESTORE_RULES_CURRENT_MATRIX.md

**Rules:** `firestore.rules` (production)  
**Doğrulama:** `tests/firestore-rules/current-characterization.test.mjs`

Production rules açıkça tanımlar: `berberler` (+ alt), `appointments`, `payments`, `customers`, `notifications`, `campaigns`, `deletedAppointments`, `demo_talepleri`. Diğerleri default **DENY**.

## Current Rules Matrix

### `berberler/{slug}` — tüm client actor'lar

| get | list | create | update | delete |
|-----|------|--------|--------|--------|
| ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |

Cross-tenant kontrol yok. `request.auth` yok.

### `appointments/{id}` — tüm client actor'lar

| get | list | create | update | delete |
|-----|------|--------|--------|--------|
| ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |

### `customers`, `notifications`, `campaigns`, `deletedAppointments`, `payments`, `demo_talepleri`

Tüm işlemler: **ALLOW** (`if true`).

### `publicBarbers`, `businessMemberships`, `activationCodes`, `pendingBarbers`, `rateLimits`

Tüm işlemler: **DENY** (rules'ta tanımsız).

### Legacy session / URL

| Vektör | Rules etkisi |
|--------|--------------|
| sessionStorage / localStorage | Yok |
| URL `?dukkan=` | Yok |

## Target Security Matrix (özet)

| Kaynak | public | owner A | owner B | superAdmin | Admin SDK |
|--------|--------|---------|---------|------------|-----------|
| `publicBarbers` | get ALLOW | get ALLOW | get ALLOW | CF | SERVER_ONLY |
| `berberler` hassas | DENY | own get/update | DENY | claim/CF | SERVER_ONLY |
| `businessMemberships` | DENY | own get | DENY | CF | SERVER_ONLY |
| `appointments` write | DENY (CF) | own tenant | DENY | CF | SERVER_ONLY |
| `customers` | DENY | own `barberSlug` | DENY | CF | SERVER_ONLY |
| `activationCodes` | DENY | activate CF | DENY | list/create CF | SERVER_ONLY |
| Tanımsız | DENY | DENY | DENY | DENY | SERVER_ONLY |

Detaylı hedef: `SECURITY_ACCESS_MATRIX.md`, `SECURITY_DECISIONS.md`.
