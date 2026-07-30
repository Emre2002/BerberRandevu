const buckets = new Map();

export function checkRateLimit(key, { limit = 60, windowMs = 60_000 } = {}) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return true;
    }
    entry.count += 1;
    return entry.count <= limit;
}

export function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
        return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || "unknown";
}
