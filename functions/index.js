/**
 * Firebase Cloud Functions — emulator-only exports.
 * Public appointment creation is handled by Vercel /api/public/create-appointment.
 */
const { onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

if (process.env.FUNCTIONS_EMULATOR === "true") {
    const {
        handleResolveAuthIdentifierForEmulator
    } = require("./lib/resolveAuthIdentifierCallable");

    exports.resolveAuthIdentifierForEmulator = onCall(
        { cors: true },
        handleResolveAuthIdentifierForEmulator
    );
}
