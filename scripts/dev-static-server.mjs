#!/usr/bin/env node
/**
 * Development-only static file server.
 * Yalnız localhost — production kullanımı için değildir.
 *
 *   node scripts/dev-static-server.mjs
 */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const DEV_STATIC_SERVER_HOST = "127.0.0.1";
export const DEV_STATIC_SERVER_PORT = 5500;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
};

/**
 * @param {string} requestPath
 * @param {string} [rootDir]
 */
export function resolveSafeStaticPath(requestPath, rootDir = ROOT) {
    if (!requestPath || typeof requestPath !== "string") {
        return { ok: false, reason: "invalid_path" };
    }

    const decoded = decodeURIComponent(requestPath.split("?")[0].split("#")[0]);
    if (decoded.includes("\0")) {
        return { ok: false, reason: "null_byte" };
    }

    const segments = decoded.split("/").filter(Boolean);
    for (const segment of segments) {
        if (segment === "..") return { ok: false, reason: "path_traversal" };
        if (segment.startsWith(".")) return { ok: false, reason: "dotfile" };
    }

    const relative = segments.join("/") || "index.html";
    const absolute = path.resolve(rootDir, relative);

    if (!absolute.startsWith(path.resolve(rootDir) + path.sep) && absolute !== path.resolve(rootDir)) {
        return { ok: false, reason: "outside_root" };
    }

    return { ok: true, absolute, relative };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} [rootDir]
 */
export async function handleStaticRequest(req, res, rootDir = ROOT) {
    const urlPath = req.url === "/" ? "/index.html" : req.url || "/index.html";
    const resolved = resolveSafeStaticPath(urlPath, rootDir);

    if (!resolved.ok) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
    }

    try {
        const fileStat = await stat(resolved.absolute);
        if (!fileStat.isFile()) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Forbidden");
            return;
        }

        const ext = path.extname(resolved.absolute).toLowerCase();
        const body = await readFile(resolved.absolute);
        res.writeHead(200, {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        res.end(body);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
    }
}

/**
 * @param {{ host?: string, port?: number, rootDir?: string }} [opts]
 */
export function createDevStaticServer(opts = {}) {
    const host = opts.host ?? DEV_STATIC_SERVER_HOST;
    const port = opts.port ?? DEV_STATIC_SERVER_PORT;
    const rootDir = opts.rootDir ?? ROOT;

    const server = http.createServer((req, res) => {
        handleStaticRequest(req, res, rootDir).catch(() => {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Internal Server Error");
        });
    });

    return { server, host, port, rootDir };
}

const isMain =
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
    const { server, host, port } = createDevStaticServer();
    server.listen(port, host, () => {
        console.log(`[dev-static-server] http://${host}:${port} (development only)`);
    });
}
