const { HttpsError } = require("firebase-functions/v2/https");
const {
    resolveEmulatorAuthIdentifier,
    GENERIC_AUTH_ERROR
} = require("./emulatorAuthResolver");

/**
 * Emulator-only callable handler — export yalnız FUNCTIONS_EMULATOR=true iken index.js'de.
 * @param {import("firebase-functions/v2/https").CallableRequest} request
 */
async function handleResolveAuthIdentifierForEmulator(request) {
    const data = request.data || {};
    if (Object.prototype.hasOwnProperty.call(data, "password")) {
        throw new HttpsError("invalid-argument", "Invalid request", { code: GENERIC_AUTH_ERROR });
    }

    const username = data.username;
    const result = resolveEmulatorAuthIdentifier(username);

    if (!result.ok) {
        if (result.code === "emulator_unavailable") {
            throw new HttpsError("permission-denied", "Unavailable", { code: "emulator_unavailable" });
        }
        throw new HttpsError("not-found", "Invalid credentials", { code: GENERIC_AUTH_ERROR });
    }

    return {
        authEmail: result.authEmail,
        businessId: result.businessId
    };
}

module.exports = {
    handleResolveAuthIdentifierForEmulator,
    GENERIC_AUTH_ERROR
};
