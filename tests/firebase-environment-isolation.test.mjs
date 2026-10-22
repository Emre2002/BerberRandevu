import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    DEVELOPMENT_PROJECT_ID,
    PRODUCTION_PROJECT_ID,
    selectFirebaseConfig
} from "../firebase-environment.js";
import { resolveClientBuildEnvironment } from "../build-firebase-runtime-config.mjs";
import {
    resolveExpectedProjectId,
    validateServiceAccountProjectId
} from "../api/_lib/firebase-project-policy.js";

describe("Firebase client environment isolation", () => {
    it("keeps the production app on the production project", () => {
        assert.equal(selectFirebaseConfig("production", "berberv1.vercel.app").projectId, PRODUCTION_PROJECT_ID);
    });

    it("selects only the development app for Preview and local development", () => {
        assert.equal(selectFirebaseConfig("preview", "preview.vercel.app").projectId, DEVELOPMENT_PROJECT_ID);
        assert.equal(selectFirebaseConfig("development", "localhost").projectId, DEVELOPMENT_PROJECT_ID);
    });

    it("fails closed when the environment is missing or production is used on localhost", () => {
        assert.throws(() => selectFirebaseConfig("", "localhost"));
        assert.throws(() => selectFirebaseConfig("production", "localhost"));
        assert.throws(() => resolveClientBuildEnvironment({}));
        assert.equal(resolveClientBuildEnvironment({ VERCEL_ENV: "preview" }), "preview");
        assert.throws(() => resolveClientBuildEnvironment({
            VERCEL_ENV: "preview",
            FIREBASE_CLIENT_ENV: "production"
        }));
    });
});

describe("Firebase Admin project isolation", () => {
    it("keeps production behavior and rejects a mismatched production project", () => {
        assert.equal(resolveExpectedProjectId({ VERCEL_ENV: "production" }), PRODUCTION_PROJECT_ID);
        assert.throws(() => resolveExpectedProjectId({ VERCEL_ENV: "production", FIREBASE_PROJECT_ID: DEVELOPMENT_PROJECT_ID }));
    });

    it("requires the development project for Preview and local use", () => {
        assert.equal(resolveExpectedProjectId({ VERCEL_ENV: "preview", FIREBASE_PROJECT_ID: DEVELOPMENT_PROJECT_ID }), DEVELOPMENT_PROJECT_ID);
        assert.throws(() => resolveExpectedProjectId({ VERCEL_ENV: "preview" }));
        assert.throws(() => resolveExpectedProjectId({ VERCEL_ENV: "preview", FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID }));
        assert.throws(() => resolveExpectedProjectId({ FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID }));
    });

    it("rejects service accounts for the wrong project", () => {
        assert.doesNotThrow(() => validateServiceAccountProjectId({ project_id: DEVELOPMENT_PROJECT_ID }, DEVELOPMENT_PROJECT_ID));
        assert.throws(() => validateServiceAccountProjectId({ project_id: PRODUCTION_PROJECT_ID }, DEVELOPMENT_PROJECT_ID));
        assert.throws(() => validateServiceAccountProjectId({}, DEVELOPMENT_PROJECT_ID));
    });
});
