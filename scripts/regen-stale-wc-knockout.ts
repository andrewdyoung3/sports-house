#!/usr/bin/env tsx
/**
 * scripts/regen-stale-wc-knockout.ts — sweep WC knockout previews poisoned by
 * the pre-fix stage-classification bug (espnRoundToStage returned 'group' for
 * knockout fixtures when ESPN returned an empty round string; bug was live from
 * ~June 28 until feat/competition-stage-stakes was deployed).
 *
 * WHAT IT DOES:
 *   1. Queries game_previews for all wc-* rows.
 *   2. Fetches live WC fixtures (with generous 30-day lookback) so each
 *      game_id's stage is re-evaluated via the fixed espnRoundToStageWithDateFallback.
 *   3. For each row whose stage is now a knockout round (not 'group'):
 *      a. Deletes the stale game_previews row (so the poller won't short-circuit
 *         at step 5e "preview already exists" and skip regeneration).
 *      b. Inserts a preview_jobs row for fixture.teamId.
 *         The partial unique index on (team_id) WHERE status='pending' makes the
 *         insert idempotent — a second run silently ignores already-pending teams.
 *
 * SCOPE:
 *   - Only wc-* game_ids. Does not touch group-stage WC previews or any other
 *     league.
 *   - Does NOT call generateAndStorePreview directly — all regeneration is routed
 *     through the existing poll-jobs poller, preserving its rate-limiting and
 *     concurrency controls.
 *
 * IDEMPOTENCY:
 *   Run 1: deletes N stale game_previews rows, enqueues N preview_jobs rows.
 *   Run 2 (before poller): nothing to delete (rows gone); preview_jobs insert
 *     hits the partial-unique-index constraint (23505) → silently skipped → no-op.
 *   Run 2 (after poller regenerated): new correct game_previews rows exist;
 *     the script would delete + re-enqueue them. Avoid re-running the sweep
 *     once the poller has processed all queued jobs.
 *
 * HUMAN-GATED DEPLOY STEP — do NOT auto-run:
 *   1. Deploy feat/competition-stage-stakes to production.
 *   2. Confirm Ollama is running and the poller is live.
 *   3. Dry-run first to review scope:
 *        npx tsx scripts/regen-stale-wc-knockout.ts --dry-run
 *   4. Execute:
 *        npx tsx scripts/regen-stale-wc-knockout.ts
 *   5. Monitor the poller log (/tmp/sporthouse-previewjobs.log) until all jobs
 *      are processed (generated= count matches enqueued= count).
 */

import { readFileSync } from 'fs';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

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
} catch { /* .env.local absent — env must be set externally */ }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Polyfill WebSocket for Node < 22 (Supabase Realtime needs it at createClient time).
  if (typeof (globalThis as unknown as Record<string, unknown>).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as unknown as Record<string, unknown>).WebSocket = ws;
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('[dry-run] no writes will be performed\n');

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error('Supabase admin client not configured — set SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // 1. Query all wc-* rows from game_previews.
  console.log('Fetching wc-* rows from game_previews…');
  const { data: wcRows, error: fetchErr } = await admin
    .from('game_previews')
    .select('game_id, updated_at')
    .like('game_id', 'wc-%');

  if (fetchErr) {
    console.error(`Failed to query game_previews: ${fetchErr.message}`);
    process.exit(1);
  }

  if (!wcRows || wcRows.length === 0) {
    console.log('No wc-* rows in game_previews — nothing to sweep.');
    return;
  }
  console.log(`Found ${wcRows.length} wc-* row(s) in game_previews.\n`);

  // 2. Fetch live WC fixtures (30-day lookback ensures recently-completed group
  //    games AND upcoming knockout fixtures are both present).
  console.log('Fetching live WC fixtures (lookback=30)…');
  let fixtures;
  try {
    fixtures = await fetchLeagueFixtures('world_cup', 30);
  } catch (err) {
    console.error(`Failed to fetch WC fixtures: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Build game_id → fixture map (only fixtures with a worldCupStage set).
  const fixtureByGameId = new Map(fixtures.map(f => [f.id, f]));
  console.log(`Fetched ${fixtures.length} WC fixture(s); ${fixtureByGameId.size} unique game_ids.\n`);

  // 3. Classify each wc-* game_previews row.
  const stale: Array<{ gameId: string; teamId: string; stage: string; updatedAt: string }> = [];
  let skippedGroup    = 0;
  let skippedNoFixture = 0;

  for (const row of wcRows) {
    const gameId = row.game_id as string;
    const fixture = fixtureByGameId.get(gameId);

    if (!fixture) {
      // Fixture not found in live feed (completed long ago or unknown id).
      console.log(`  ${gameId}  — no matching fixture (expired or unknown); skip`);
      skippedNoFixture++;
      continue;
    }

    const stage = fixture.worldCupStage ?? 'group';

    if (stage === 'group') {
      console.log(`  ${gameId}  stage=group  ${fixture.teamId} vs ${fixture.opponent}  — not stale; skip`);
      skippedGroup++;
      continue;
    }

    // Knockout stage — this preview was generated with the old classification bug.
    console.log(
      `  ${gameId}  stage=${stage}  ${fixture.teamId} vs ${fixture.opponent}  updated_at=${row.updated_at}  → STALE`,
    );
    stale.push({
      gameId,
      teamId:    fixture.teamId,
      stage,
      updatedAt: row.updated_at as string,
    });
  }

  console.log(`\nSummary: stale=${stale.length}  skipped-group=${skippedGroup}  skipped-no-fixture=${skippedNoFixture}`);

  if (stale.length === 0) {
    console.log('Nothing to sweep.');
    return;
  }

  if (dryRun) {
    console.log('\n[dry-run] Would delete + enqueue:');
    for (const s of stale) {
      console.log(`  delete game_previews.game_id=${s.gameId}  enqueue preview_jobs.team_id=${s.teamId} (stage=${s.stage})`);
    }
    console.log('\nRe-run without --dry-run to apply.');
    return;
  }

  // 4. Delete stale game_previews rows and enqueue preview_jobs.
  console.log('\nApplying sweep…');
  let deleted   = 0;
  let enqueued  = 0;
  let alreadyPending = 0;

  for (const s of stale) {
    // 4a. Delete the stale preview so the poller doesn't skip regen (step 5e).
    const { error: delErr } = await admin
      .from('game_previews')
      .delete()
      .eq('game_id', s.gameId);

    if (delErr) {
      console.error(`  WARN: failed to delete game_previews game_id=${s.gameId}: ${delErr.message}`);
    } else {
      console.log(`  deleted  game_previews.game_id=${s.gameId}`);
      deleted++;
    }

    // 4b. Enqueue a preview_jobs row for the team. The partial unique index on
    //     (team_id) WHERE status='pending' makes duplicate inserts a 23505 no-op.
    try {
      await admin
        .from('preview_jobs')
        .insert({ team_id: s.teamId, status: 'pending' })
        .throwOnError();

      console.log(`  enqueued preview_jobs.team_id=${s.teamId}  (stage=${s.stage})`);
      enqueued++;
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.details?.code;
      if (code === '23505') {
        // Partial unique constraint — already a pending job for this team. Good.
        console.log(`  skip     preview_jobs.team_id=${s.teamId}  (already pending)`);
        alreadyPending++;
      } else {
        console.error(
          `  WARN: failed to insert preview_jobs team_id=${s.teamId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `\nDone.  deleted=${deleted}  enqueued=${enqueued}  already-pending=${alreadyPending}`,
  );
  console.log('The poller (poll-jobs) will process enqueued jobs within its next tick.');
  console.log('Monitor: tail -f /tmp/sporthouse-previewjobs.log');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
