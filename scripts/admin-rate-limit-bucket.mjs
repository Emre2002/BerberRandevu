#!/usr/bin/env node
/**
 * Controlled rate-limit bucket inspection/reset for test diagnostics.
 *
 * Usage:
 *   node scripts/admin-rate-limit-bucket.mjs --environment preview --scope phone_business_success --business abc --phone 5551234567 --requestDay 20260730
 *   node scripts/admin-rate-limit-bucket.mjs --environment preview --scope phone_business_success --business abc --phone 5551234567 --requestDay 20260730 --confirm --reset
 *
 * Production reset requires --environment production --confirm --confirm-production
 */
import { getAdminDb } from "../api/_lib/firebase-admin.js";
import {
    RATE_LIMIT_SCOPES,
    buildRateLimitDocIdsForTests,
    deleteRateLimitBucket,
    getNamespace,
    getRequestDayBucket,
    readRateLimitBucket,
    requireProductionRateLimitSecrets
} from "../api/_lib/booking-rate-limit.js";

const ALLOWED_SCOPES = new Set(Object.values(RATE_LIMIT_SCOPES));

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            i += 1;
        }
    }
    return args;
}

function requireArg(args, name) {
    const value = String(args[name] || "").trim();
    if (!value) {
        throw new Error(`Missing required argument: --${name}`);
    }
    return value;
}

function normalizePhone(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

function resolveDocId(scope, { business, phone, ip, requestDay, route }) {
    const ids = buildRateLimitDocIdsForTests({
        routeName: route || "public-create-appointment",
        businessId: business,
        phoneNorm: normalizePhone(phone),
        clientIp: ip || "203.0.113.1",
        requestDay
    });

    switch (scope) {
        case RATE_LIMIT_SCOPES.IP_ROUTE_BURST:
            return ids.routeBurst;
        case RATE_LIMIT_SCOPES.IP_BUSINESS_CREATE_BURST:
            return ids.burstCreate;
        case RATE_LIMIT_SCOPES.IP_BUSINESS_AVAILABILITY:
            return ids.burstAvailability;
        case RATE_LIMIT_SCOPES.PHONE_BUSINESS_ATTEMPT:
            return ids.attempt;
        case RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS:
            return ids.phoneSuccess;
        case RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS:
            return ids.ipSuccess;
        default:
            throw new Error(`Unsupported scope: ${scope}`);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const environment = requireArg(args, "environment");
    const scope = requireArg(args, "scope");
    const business = requireArg(args, "business");

    if (!ALLOWED_SCOPES.has(scope)) {
        throw new Error(`Invalid scope. Allowed: ${[...ALLOWED_SCOPES].join(", ")}`);
    }

    if (environment === "production" && args.reset && !args["confirm-production"]) {
        throw new Error("Production reset requires --confirm-production in addition to --confirm");
    }

    if (args["confirm-production"] && environment !== "production") {
        throw new Error("--confirm-production is only valid with --environment production");
    }

    if (String(args.scope || "").includes("*")) {
        throw new Error("Wildcard scopes are not allowed");
    }

    process.env.RATE_LIMIT_NAMESPACE = environment;

    requireProductionRateLimitSecrets();

    const phone = args.phone || "";
    const ip = args.ip || "203.0.113.1";
    const requestDay = args.requestDay || getRequestDayBucket();

    const needsPhone = [
        RATE_LIMIT_SCOPES.PHONE_BUSINESS_ATTEMPT,
        RATE_LIMIT_SCOPES.PHONE_BUSINESS_SUCCESS
    ].includes(scope);
    const needsIp = [
        RATE_LIMIT_SCOPES.IP_ROUTE_BURST,
        RATE_LIMIT_SCOPES.IP_BUSINESS_CREATE_BURST,
        RATE_LIMIT_SCOPES.IP_BUSINESS_AVAILABILITY,
        RATE_LIMIT_SCOPES.IP_BUSINESS_SUCCESS
    ].includes(scope);

    if (needsPhone && !phone) {
        throw new Error(`Scope ${scope} requires --phone`);
    }
    if (needsIp && !args.ip && scope === RATE_LIMIT_SCOPES.IP_ROUTE_BURST) {
        throw new Error(`Scope ${scope} requires --ip`);
    }

    const docId = resolveDocId(scope, { business, phone, ip: args.ip, requestDay, route: args.route });
    const db = getAdminDb();
    const bucket = await readRateLimitBucket(db, docId);

    const report = {
        environment,
        namespace: getNamespace(),
        scope,
        business,
        requestDay,
        docIdSuffix: docId.slice(-16),
        bucket
    };

    console.log(JSON.stringify(report, null, 2));

    if (args.reset) {
        if (!args.confirm) {
            throw new Error("Reset requires --confirm");
        }
        await deleteRateLimitBucket(db, docId);
        console.log(JSON.stringify({ reset: true, scope, docIdSuffix: docId.slice(-16) }));
    }
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
});
