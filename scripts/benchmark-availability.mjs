#!/usr/bin/env node
/**
 * Benchmark public availability API — sanitized timings only.
 */
import { performance } from "node:perf_hooks";
import { getAdminDb } from "../api/_lib/firebase-admin.js";
import { computePublicAvailability } from "../api/_lib/availability.js";
import { resolvePublicBusinessSlug } from "../api/_lib/resolve-public-business-slug.js";

const BASE = (process.env.SMOKE_BASE_URL || "https://berberv1.vercel.app").replace(/\/$/, "");
const SLUG = process.env.SMOKE_PUBLIC_SLUG || "abc";
const RUNS = Number(process.env.AVAILABILITY_BENCHMARK_RUNS || 5);

function tomorrowYmd() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

async function measureHttp(label, date) {
    const url = `${BASE}/api/public/availability?dukkan=${encodeURIComponent(SLUG)}&date=${date}`;
    const started = performance.now();
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const body = await response.json();
    const elapsedMs = Math.round(performance.now() - started);
    const sizeBytes = JSON.stringify(body).length;
    return {
        label,
        status: response.status,
        elapsedMs,
        sizeBytes,
        requestId: body?.requestId || response.headers.get("x-request-id") || null,
        slotCount: (body.availableSlots?.length || 0) + (body.busySlots?.length || 0)
    };
}

async function measureLocal(date) {
    const db = getAdminDb();
    const businessSlug = await resolvePublicBusinessSlug(db, SLUG);
    const started = performance.now();
    const result = await computePublicAvailability(db, { businessSlug, date, requestId: "local-benchmark" });
    const elapsedMs = Math.round(performance.now() - started);
    return {
        label: "local_compute",
        ok: result.ok,
        elapsedMs,
        timings: result.timings || null,
        sizeBytes: result.ok ? JSON.stringify(result.payload).length : 0
    };
}

function summarize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 0;
    return {
        min: sorted[0] || 0,
        max: sorted[sorted.length - 1] || 0,
        p50,
        p95,
        avg: Math.round(sorted.reduce((sum, v) => sum + v, 0) / (sorted.length || 1))
    };
}

const date = tomorrowYmd();
const httpCold = await measureHttp("http_cold", date);
const httpWarmRuns = [];
for (let i = 0; i < RUNS; i += 1) {
    httpWarmRuns.push(await measureHttp(`http_warm_${i + 1}`, date));
}

const local = await measureLocal(date);

console.log(JSON.stringify({
    ok: httpCold.status === 200,
    slug: SLUG,
    date,
    httpCold,
    httpWarm: summarize(httpWarmRuns.map((r) => r.elapsedMs)),
    httpWarmSamples: httpWarmRuns,
    local,
    responseSizeBytes: httpCold.sizeBytes
}, null, 2));

process.exit(httpCold.status === 200 ? 0 : 1);
