const ALLOWED_ORIGINS = new Set([
    "https://berberv1.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]);

export function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && (ALLOWED_ORIGINS.has(origin) || /^https:\/\/berber-randevu.*\.vercel\.app$/i.test(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function sendJson(res, status, body, extraHeaders = {}) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    for (const [key, value] of Object.entries(extraHeaders)) {
        res.setHeader(key, value);
    }
    res.end(JSON.stringify(body));
}

export function sendError(res, status, code, message) {
    sendJson(res, status, { error: code, message });
}

export function readJsonBody(req) {
    return new Promise((resolvePromise, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) {
                reject(new Error("payload_too_large"));
            }
        });
        req.on("end", () => {
            if (!data) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(data));
            } catch {
                reject(new Error("invalid_json"));
            }
        });
        req.on("error", reject);
    });
}

export function getBearerToken(req) {
    const header = req.headers.authorization || req.headers.Authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(String(header));
    return match ? match[1].trim() : "";
}
