#!/usr/bin/env tsx
/**
 * Preview-job poller — processes on-follow preview jobs from preview_jobs.
 *
 * Run via: npm run poll  (every 60 s via launchd com.sporthouse.previewjobs)
 *
 * Flow per tick:
 *   1. Ollama reachability check — exit if unreachable (jobs stay pending).
 *   2. Acquire shared generation lock — exit if heartbeat or prior poll is mid-run.
 *   3. Reclaim stale 'processing' jobs (> STALE_MINUTES old) back to 'pending'.
 *   4. Fetch up to BATCH pending jobs (oldest first).
 *   5. For each: atomic claim → find next fixture → check existing preview
 *      → generate or mark done → release on failure with attempt tracking.
 *   6. Release lock.
 *   7. Log summary: claimed=N generated=N already-fresh=N no-fixture=N failed=N
 *
 * The on-follow ping only ensures *existence* of a preview; regeneration at 48h/24h
 * marks stays the heartbeat's job. If a preview_jobs row is already covered (a
 * game_previews row exists for the fixture) the job is marked done without generating.
 */

import { readFileSync, appendFileSync } from 'fs';
import { acquireLock, releaseLock } from '@/lib/generation-lock';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { generateAndStorePreview } from '@/lib/preview-generator';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
import { LOOKAHEAD_DAYS } from '@/lib/preview-lifecycle';

// ─── Env loading ──────────────────────────────────────────────────────────────

try {
  const content = readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch { /* .env.local not present — env must be set externally */ }

// ─── Config ───────────────────────────────────────────────────────────────────

const BATCH        = 5;
const STALE_MINUTES = 10;
const MAX_ATTEMPTS  = 3;
const LOG_FILE      = '/tmp/sporthouse-previewjobs.log';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [poll-jobs] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* non-fatal */ }
  console.log(msg);
}

async function isOllamaReachable(): Promise<boolean> {
  const base = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Polyfill WebSocket for Node.js < 22 before Supabase creates its Realtime client.
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as any).WebSocket = ws;
  }

  // 1. Ollama reachability — leave jobs pending during an outage.
  if (!await isOllamaReachable()) {
    log('Ollama not reachable — skipping tick, jobs stay pending');
    process.exit(0);
  }

  // 2. Shared generation lock — poller and heartbeat must never overlap.
  if (!acquireLock()) {
    log('lock held by another process — skipping tick');
    process.exit(0);
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    log('Supabase admin client not configured — skipping tick');
    releaseLock();
    process.exit(0);
  }

  let claimedCount = 0, generatedCount = 0, alreadyFreshCount = 0,
      noFixtureCount = 0, failedCount = 0;

  try {
    // 3. Reclaim stale 'processing' jobs (crashed/timed-out poller tick).
    const staleTs = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    const { data: stale } = await admin
      .from('preview_jobs')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .lt('updated_at', staleTs)
      .select('id');
    if (stale && stale.length > 0) {
      log(`reclaimed ${stale.length} stale processing job(s)`);
    }

    // 4. Fetch pending jobs oldest-first.
    const { data: pending } = await admin
      .from('preview_jobs')
      .select('id, team_id, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH);

    if (!pending || pending.length === 0) {
      log('no pending jobs — done: claimed=0 generated=0 already-fresh=0 no-fixture=0 failed=0');
      return;
    }

    const now = Date.now();
    const lookaheadMs = LOOKAHEAD_DAYS * 86400_000;

    // 5. Process each job.
    for (const job of pending) {
      const jobId   = job.id as number;
      const teamId  = job.team_id as string;
      const attempts = job.attempts as number;

      // 5a. Atomic claim: only proceed if we win the status='pending' race.
      const { data: claimed } = await admin
        .from('preview_jobs')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'pending')
        .select('id');

      if (!claimed || claimed.length === 0) {
        log(`  job=${jobId} claim lost — another worker claimed it`);
        continue;
      }
      claimedCount++;
      log(`  claimed job=${jobId} team=${teamId}`);

      // 5b. Resolve the team's league from the canonical TEAMS list.
      const teamEntry = TEAMS.find(t => t.id === teamId);
      if (!teamEntry) {
        log(`  job=${jobId} unknown team=${teamId} — marking done`);
        await admin.from('preview_jobs').update({
          status: 'done', updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        noFixtureCount++;
        continue;
      }

      const league = teamEntry.league as string;

      // 5c. Fetch fixtures for the team's league (upcoming only, no lookback needed).
      let fixtures;
      try {
        fixtures = await fetchLeagueFixtures(league);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  job=${jobId} fixture-fetch failed: ${msg}`);
        await markFailed(admin, jobId, attempts, `fixture-fetch: ${msg}`);
        failedCount++;
        continue;
      }

      // 5d. Find the next upcoming fixture for this team within the lookahead window.
      const next = fixtures
        .filter(f =>
          (f.teamId === teamId || f.opponentId === teamId) &&
          !f.completed &&
          new Date(f.date).getTime() > now &&
          new Date(f.date).getTime() <= now + lookaheadMs,
        )
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

      if (!next) {
        log(`  job=${jobId} no upcoming fixture within ${LOOKAHEAD_DAYS}d — marking done`);
        await admin.from('preview_jobs').update({
          status: 'done', updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        noFixtureCount++;
        continue;
      }

      // 5e. Check if a preview already exists for this fixture.
      const { data: existing } = await admin
        .from('game_previews')
        .select('game_id')
        .eq('game_id', next.id)
        .maybeSingle();

      if (existing) {
        log(`  job=${jobId} preview already exists for gameId=${next.id} — marking done`);
        await admin.from('preview_jobs').update({
          status: 'done', updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        alreadyFreshCount++;
        continue;
      }

      // 5f. Generate.
      log(`  job=${jobId} generating gameId=${next.id} team=${teamEntry.name} vs ${next.opponent}`);
      const result = await generateAndStorePreview(league, next, teamEntry.name);

      if (result.ok) {
        await admin.from('preview_jobs').update({
          status: 'done', updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        generatedCount++;
      } else {
        const msg = result.error ?? 'unknown';
        log(`  job=${jobId} generation failed: ${msg}`);
        await markFailed(admin, jobId, attempts, msg);
        failedCount++;
      }
    }

    log(`done: claimed=${claimedCount} generated=${generatedCount} already-fresh=${alreadyFreshCount} no-fixture=${noFixtureCount} failed=${failedCount}`);

  } finally {
    releaseLock();
  }
}

async function markFailed(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  jobId: number,
  currentAttempts: number,
  error: string,
): Promise<void> {
  const newAttempts = currentAttempts + 1;
  const newStatus   = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  await admin.from('preview_jobs').update({
    status:    newStatus,
    attempts:  newAttempts,
    error:     error.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
}

main().catch(err => {
  log(`fatal: ${err instanceof Error ? err.message : err}`);
  releaseLock();
  process.exit(1);
});
