# Architecture

Production: Vercel static frontend + serverless APIs on Firebase Admin SDK.

## Booking

`publicAppointmentClient.js` → `POST /api/public/create-appointment` → `create-appointment-core.js`

## Auth

Owners: Firebase Auth + `businessMemberships`. Superadmin: Firebase Auth + `superAdmin` claim + Bearer APIs.

## Functions

Cloud Functions export only `resolveAuthIdentifierForEmulator` when `FUNCTIONS_EMULATOR=true`.
