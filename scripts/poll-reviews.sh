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
LOCKFILE="/tmp/sporthouse-ai.lock"
LOG="/tmp/sporthouse-ai.log"

# Acquire lock — exit immediately if warm-cache or another poll-reviews is running.
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [poll-reviews] skipped — another AI job holds the lock" | tee -a "$LOG"
  exit 0
fi

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
