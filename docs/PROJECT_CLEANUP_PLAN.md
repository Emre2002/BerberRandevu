# Project Cleanup Plan

See `docs/CLEANUP_BASELINE.md` for baseline.

## Implemented (HIGH confidence)

| Item | Action |
|------|--------|
| `barber-login.js` | Deleted — no runtime imports |
| CF callable booking in `firebase-config.js` | Removed |
| `functions/index.js` createAppointment | Removed — Vercel API is canonical |
| Admin `forceClient` Firestore path | Replaced with owner server API |
| `appointmentService.js` CF fallback | Removed |
| `.git-files-temp.txt` | Deleted |

## Kept

| Item | Reason |
|------|--------|
| `api/create-appointment.js` | Thin alias, no duplicate logic |
| `legacyAuthCompat.js` | Emulator + localhost API routing |
| `sessionAuth.js` | UX flags; APIs use Firebase tokens |
| `superAdminAuth.js` | Emulator-only login |

## Manual review (MEDIUM)

- Archive migration markdown to `docs/archive/`
- Refresh `README-functions.md`
- Consider removing `sessionAuth` localStorage checks when UX allows
