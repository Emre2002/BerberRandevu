# Cleanup Baseline

Branch: `cleanup/professional-project-optimization`  
Pre-cleanup HEAD: `4634e22e`

## Entry points

- Public booking: `randevu.html` → `app.js` → `/api/public/create-appointment`
- Owner admin: `admin.html` → `admin-auth.js` → `/api/owner/create-appointment`
- Superadmin: `super-admin.html` → Firebase Auth + privileged APIs

## Pre-cleanup validation

- npm test: 363/363 pass
- Production auth: 4/4 accounts
- Production final validation: all green
- Booking E2E: HTTP 201, cleaned up

## Environmental notes

- `firebase-debug.log` EPERM blocks `node --test` root scan — fixed via explicit test scripts
- Stale emulator ports 8081/8082 may block rules tests
