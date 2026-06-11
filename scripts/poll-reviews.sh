#!/bin/bash
# Poll for recently-finished games and generate AI reviews.
# Runs every 5 minutes via crontab — exits immediately if warm-cache is running.
#
# Add to crontab with: crontab -e
#   */5 * * * * /Users/andreasjenkins/Documents/SportHouse/scripts/poll-reviews.sh >> /tmp/sporthouse-cron.log 2>&1
#
# Reviews are generated within 5-10 min of a game finishing:
#   - poll runs every 5 min
#   - route finds games with kickoff within the last 2-5 hours + complete=true
#   - generation itself takes ~20-60s on instruct-2507
#
# Check /tmp/sporthouse-ai.log to verify end-to-end latency.

SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3001}"
CRON_SECRET="${CRON_SECRET:-5b0a25f861799befc0643643236debd3}"
LOCKDIR="/tmp/sporthouse-ai.lock.d"
LOG="/tmp/sporthouse-ai.log"
LOCK_MAX_AGE_SECS=3600   # 60 min — treat as stale if a previous run crashed

# Stale-lock safety: if the dir exists but its timestamp is too old, remove it.
if [ -d "$LOCKDIR" ]; then
  if [ -f "$LOCKDIR/ts" ]; then
    lock_age=$(( $(date +%s) - $(cat "$LOCKDIR/ts") ))
    if [ "$lock_age" -gt "$LOCK_MAX_AGE_SECS" ]; then
      echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] stale lock (${lock_age}s old) — removing" | tee -a "$LOG"
      rm -rf "$LOCKDIR"
    fi
  else
    rm -rf "$LOCKDIR"   # no timestamp — treat as stale
  fi
fi

# Acquire lock atomically via mkdir (macOS + Linux, no external dependencies).
# warm-cache.sh uses the same LOCKDIR so the two scripts never overlap.
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] skipped — another AI job holds the lock" | tee -a "$LOG"
  exit 0
fi
echo "$(date +%s)" > "$LOCKDIR/ts"
# Release the lock on any exit (success, error, or interrupt).
trap 'rm -rf "$LOCKDIR"' EXIT

echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] start" | tee -a "$LOG"

response=$(curl -s -w "\n%{http_code}" \
  --max-time 300 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "${SITE_URL}/api/cron/poll-reviews")

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -1)

if [ "$http_code" = "200" ]; then
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] done: $body" | tee -a "$LOG"
else
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] error (HTTP $http_code): $body" | tee -a "$LOG"
  exit 1
fi
