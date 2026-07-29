# AGENTS.md

## Cursor Cloud specific instructions

### What this project is
Multi-tenant barber-appointment SaaS. Static frontend (vanilla JS ES modules, HTML/CSS at repo root) that loads the Firebase SDK from CDN and talks to Cloud Firestore directly. Backend is Firebase Cloud Functions (`functions/`, Node 20) exposing a single `createAppointment` callable. There is no bundler/build step for the frontend.

### Running the frontend locally
ES modules require serving over HTTP (not `file://`). Serve the repo root as static files and open the pages, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/super-admin.html`, `/index.html`, `/giris.html`, etc. No install/build needed for the frontend.

### Super admin login (client-side only)
Super admin auth is entirely client-side in `superAdminAuth.js`: it SHA-256-hashes the entered username (lowercased+trimmed) and password and compares against `EXPECTED_USER_HASH` / `EXPECTED_PASS_HASH`. There is no backend check. Current credentials are `superadmin` / `BerberSuper2024!`. To change the password, replace `EXPECTED_PASS_HASH` with `sha256(newPassword)`:

```
node -e 'console.log(require("crypto").createHash("sha256").update("NEW_PASSWORD").digest("hex"))'
```

### Cloud Functions
`cd functions && npm install`, then use the Firebase emulators (`firebase.json` defines firestore/functions/auth emulator ports 8080/5001/9099). Frontend auto-connects to the functions emulator on `localhost`/`127.0.0.1` (see `firebase-config.js`).

### Deploying to Vercel (static hosting)
`vercel.json` + `.vercelignore` configure the repo root as a static deploy (no build/install; `functions/`, docs, tests, firebase configs are excluded). Two ways to ship:
- CLI: install once with `npm install -g vercel` (user prefix works: `npm config set prefix ~/.npm-global`), then `vercel deploy --prod --yes --token "$VERCEL_TOKEN"`. Requires a `VERCEL_TOKEN` secret; there is no interactive login in the cloud VM.
- Or import the GitHub repo in the Vercel dashboard (Framework Preset: Other, no build command) for auto-deploys.

Note: Vercel only serves the static frontend. The `createAppointment` Cloud Function is not deployed to Vercel; the app also has a client-side booking fallback (`?forceClientBooking=1`) that writes to Firestore directly.
