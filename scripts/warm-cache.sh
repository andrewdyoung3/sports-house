#!/bin/bash
# Warm the AI preview cache for upcoming fixtures.
# Ollama is only reachable on the local Mac — this MUST run locally, never on Vercel.
# After each generation, previews are upserted to Supabase so the deployed app can serve them.
#
# Add to crontab with: crontab -e
# Recommended interval — every 10 minutes (new follows are covered within one window):
#   */10 * * * * /Users/andreasjenkins/Documents/SportHouse/scripts/warm-cache.sh >> /tmp/sporthouse-cron.log 2>&1

# Always target the local dev server — NEVER substitute a Vercel/production URL here.
SITE_URL="http://localhost:3001"
CRON_SECRET="${CRON_SECRET:-5b0a25f861799befc0643643236debd3}"
LOCKFILE="/tmp/sporthouse-ai.lock"
LOG="/tmp/sporthouse-ai.log"

# Acquire lock — exit immediately if another AI job is running.
# poll-reviews.sh uses the same lock so they never overlap.
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [warm-cache] skipped — another AI job holds the lock" | tee -a "$LOG"
  exit 0
fi

echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [warm-cache] start" | tee -a "$LOG"

response=$(curl -s -w "\n%{http_code}" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "${SITE_URL}/api/cron/warm-cache")

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -1)

if [ "$http_code" = "200" ]; then
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [warm-cache] done: $body" | tee -a "$LOG"
else
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [warm-cache] error (HTTP $http_code): $body" | tee -a "$LOG"
  exit 1
fi
