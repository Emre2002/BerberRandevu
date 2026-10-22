import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBaseUrl, PRODUCTION_BASE_URL } from "../linkService.js";

describe("environment-bound browser links", () => {
    it("keeps the established production address", () => {
        assert.equal(resolveBaseUrl("production", "https://preview.example.test"), PRODUCTION_BASE_URL);
    });

    it("uses only the current secure preview origin", () => {
        assert.equal(resolveBaseUrl("preview", "https://preview.example.test"), "https://preview.example.test");
        assert.throws(() => resolveBaseUrl("preview", "http://preview.example.test"));
        assert.throws(() => resolveBaseUrl("preview", "https://preview.example.test/redirect"));
    });

    it("fails closed without a configured environment or origin", () => {
        assert.throws(() => resolveBaseUrl("unconfigured", "https://preview.example.test"));
        assert.throws(() => resolveBaseUrl("preview", ""));
        assert.equal(resolveBaseUrl("development", "http://localhost:3000"), "http://localhost:3000");
    });

    it("routes public appointment and availability API requests through the environment-bound base", () => {
        for (const file of ["publicAppointmentClient.js", "publicAvailabilityClient.js"]) {
            const source = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
            assert.match(source, /import \{ getBaseUrl \} from "\.\/linkService\.js"/);
            assert.match(source, /return getBaseUrl\(\)/);
            assert.doesNotMatch(source, /PRODUCTION_BASE_URL/);
        }
    });
});
