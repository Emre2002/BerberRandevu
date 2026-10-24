import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveClientBuildEnvironment(env = process.env) {
    const vercelEnvironment = String(env.VERCEL_ENV || "").trim();
    const localEnvironment = String(env.FIREBASE_CLIENT_ENV || "").trim();
    const environment = vercelEnvironment || localEnvironment;

    if (!["production", "preview", "development"].includes(environment)) {
        throw new Error("Firebase client environment must be production, preview, or development");
    }
    if (vercelEnvironment && localEnvironment && localEnvironment !== vercelEnvironment) {
        throw new Error("Conflicting Firebase client and Vercel environments");
    }
    return environment;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const environment = resolveClientBuildEnvironment();
    writeFileSync(
        new URL("./firebase-runtime-config.js", import.meta.url),
        `// Generated at build time. Do not edit.\nexport const firebaseRuntimeEnvironment = ${JSON.stringify(environment)};\n`
    );
}
