/**
 * Poll for recently-finished games and generate AI reviews (prewarm).
 * TypeScript port of the former poll-reviews.sh — launchd's TCC denies
 * bash exec/read of .sh files under ~/Documents for this agent, while
 * node/tsx runs fine, so the poller now chains off the previewjobs agent:
 *   npm run poll; npm run poll:reviews    (every 60s; lock keeps it polite)
 *
 * Lock protocol (shared with warm-cache): mkdir /tmp/sporthouse-ai.lock.d is
 * the atomic acquire; a ts file inside carries the timestamp; anything older
 * than 60 min is treated as a crashed run and cleared.
 *
 * CRON_SECRET comes from the environment or .env.local — never hardcoded
 * (the old shell script carried a fallback secret; rotate CRON_SECRET).
 */
import { readFileSync, mkdirSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'fs';

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* env set externally */ }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';
const SECRET   = process.env.CRON_SECRET;
const LOCKDIR  = '/tmp/sporthouse-ai.lock.d';
const LOG      = '/tmp/sporthouse-ai.log';
const LOCK_MAX_AGE_MS = 3600_000;

const log = (msg: string) => {
  const line = `[${new Date().toISOString().slice(0, 19)}] [poll-reviews] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* log best-effort */ }
};

async function main() {
  if (!SECRET) { log('no CRON_SECRET in env/.env.local — abort'); process.exit(1); }

  // Stale-lock safety, then atomic acquire via mkdir.
  if (existsSync(LOCKDIR)) {
    let stale = true;
    try {
      const ts = Number(readFileSync(`${LOCKDIR}/ts`, 'utf8').trim());
      stale = !Number.isFinite(ts) || Date.now() - ts * 1000 > LOCK_MAX_AGE_MS;
    } catch { /* no ts file → stale */ }
    if (stale) { log('stale lock — removing'); rmSync(LOCKDIR, { recursive: true, force: true }); }
  }
  try {
    mkdirSync(LOCKDIR);
  } catch {
    log('skipped — another AI job holds the lock');
    return;
  }
  writeFileSync(`${LOCKDIR}/ts`, String(Math.floor(Date.now() / 1000)));
  const release = () => { try { rmSync(LOCKDIR, { recursive: true, force: true }); } catch { /* already gone */ } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });

  log('start');
  try {
    const res  = await fetch(`${SITE_URL}/api/cron/poll-reviews`, {
      headers: { 'x-cron-secret': SECRET },
      signal: AbortSignal.timeout(300_000),
    });
    const body = (await res.text()).slice(0, 500);
    if (res.ok) log(`done: ${body}`);
    else { log(`error (HTTP ${res.status}): ${body}`); process.exitCode = 1; }
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

main();
