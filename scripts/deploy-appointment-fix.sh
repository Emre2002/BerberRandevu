#!/usr/bin/env bash
# Deploy Firestore rules + Vercel preview/production for appointment calendar fix.
# Requires authenticated firebase and vercel CLI (Windows session or FIREBASE_TOKEN / VERCEL_TOKEN).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${FIREBASE_PROJECT:-berberrandevu-20a3e}"
PRODUCTION_URL="${PRODUCTION_URL:-https://berberv1.vercel.app}"

echo "==> 1/5 Firestore rules → production ($PROJECT)"
npx firebase deploy --only firestore:rules --project "$PROJECT" --non-interactive

echo "==> 2/5 Vercel preview deploy"
PREVIEW_URL="$(npx vercel deploy --yes 2>&1 | tee /tmp/vercel-preview-deploy.log | tail -1)"
if [[ ! "$PREVIEW_URL" =~ ^https:// ]]; then
  echo "Preview deploy failed. Log:" >&2
  tail -20 /tmp/vercel-preview-deploy.log >&2
  exit 1
fi
echo "Preview URL: $PREVIEW_URL"

echo "==> 3/5 Preview calendar smoke tests"
SMOKE_BASE_URL="$PREVIEW_URL" node scripts/production-calendar-smoke.mjs

echo "==> 4/5 Vercel production deploy"
npx vercel deploy --prod --yes

echo "==> 5/5 Production calendar smoke tests"
SMOKE_BASE_URL="$PRODUCTION_URL" node scripts/production-calendar-smoke.mjs

echo "Deploy pipeline completed."
