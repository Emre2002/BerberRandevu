import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV_FILE = path.join(__dirname, "..", "..", ".env.local");

/**
 * Loads key=value pairs from .env.local without overwriting variables
 * already present in the target environment (shell / process.env wins).
 *
 * Precedence: current process.env → .env.local → no fallback.
 */
export function loadLocalEnvFile({ envFilePath, targetEnv = process.env } = {}) {
    const file = envFilePath || DEFAULT_ENV_FILE;
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key in targetEnv) continue;
        targetEnv[key] = value;
    }
}
