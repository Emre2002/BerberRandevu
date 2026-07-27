# FIRESTORE_RULES_GAP_REPORT.md

Phase 4A — mevcut rules vs hedef model.

## Test özeti

| Paket | Komut | Sonuç |
|-------|-------|-------|
| Karakterizasyon | `npm run test:rules:current` | 20/20 |
| Hedef | `npm run test:rules:target` | 4/15 (11 beklenen GAP) |
| Skip/todo | — | 0 |

## CRITICAL

**GAP-01** — `allow read, write: if true` on `berberler`, `appointments`, `customers`, vb.  
Saldırı: kimlik doğrulamasız tam veri okuma/yazma. Target test: FAIL.

**GAP-02** — Cross-tenant izolasyon yok (owner A → shop B). Target test: FAIL.

**GAP-03** — `berberler.password` client update ALLOW. Target test: FAIL.

## HIGH

**GAP-04** — Unauthenticated appointment client create ALLOW. Target: FAIL.

**GAP-05** — `businessMemberships` production rules'ta yok (default DENY). Phase 3 owner akışı production'da kırık. Target: FAIL.

**GAP-06** — `publicBarbers` default DENY; client mirror ve müşteri UI uyumsuz. Target: FAIL.

**GAP-07** — Broad `appointments` list ALLOW. Target: FAIL.

## MEDIUM

**GAP-08** — `pendingBarbers` / `demo_talepleri` public create hedefi vs default deny.

## Target test PASS (zaten uyumlu)

- Cross-uid `businessMemberships` get DENY
- Client membership create/escalation DENY
- `activationCodes` unauthenticated get DENY

## Phase 4B — tek önerilen paket

`4B-core-deny-and-membership`:

1. Root deny-by-default wildcard
2. `businessMemberships/{uid}` owner get; client write deny
3. `berberler/{slug}` owner tenant match; protected fields deny
4. `publicBarbers` public get; client write deny
5. `appointments` client write deny; owner tenant read
6. Legacy açık koleksiyonları explicit deny
