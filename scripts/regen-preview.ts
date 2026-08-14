#!/usr/bin/env tsx
/**
 * scripts/regen-preview.ts — on-demand single-game preview regeneration.
 *
 * Wipes and regenerates one match preview immediately, overwriting the
 * Supabase row regardless of freshness.
 *
 * Uses buildPreviewContext (the same canonical rich-context builder as the
 * heartbeat and poller) so the generated prompt is byte-identical to what the
 * scheduled run would produce.
 *
 * Usage:
 *   npm run regen -- <gameId>            e.g. npm run regen -- afl-38612
 *   npx tsx scripts/regen-preview.ts <gameId>
 *
 * Reuses the shared generation lock so it cannot run concurrently with the
 * heartbeat or poller.
 */

import { readFileSync } from 'fs';
import { acquireLock, releaseLock } from '@/lib/generation-lock';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { generateAndStorePreview } from '@/lib/preview-generator';
import { buildPreviewContext } from '@/lib/preview-context';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
import { resolveCompetitionContext } from '@/lib/competition-structure';

// ─── Env loading (mirrors generate-previews.ts) ───────────────────────────────

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

// ─── Game-ID prefix → league mapping ─────────────────────────────────────────

const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl:  'afl',
  nrl:  'nrl',
  soo:  'nrl',   // State of Origin rep fixtures live in the NRL fixture list
  epl:  'epl',
  sru:  'super_rugby',
  nba:  'nba',
  f1:   'f1',
  rint: 'rugby_int',
  bbl:  'bbl',
  cint: 'cricket_int',
};

function deriveLeague(gameId: string): string | null {
  const prefix = gameId.split('-')[0];
  return PREFIX_TO_LEAGUE[prefix] ?? null;
}

// ─── Ollama reachability ──────────────────────────────────────────────────────

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
  // Polyfill WebSocket for Node < 22 (Supabase Realtime needs it at createClient time)
  if (typeof (globalThis as unknown as Record<string, unknown>).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as unknown as Record<string, unknown>).WebSocket = ws;
  }

  const gameId = process.argv[2]?.trim();
  if (!gameId) {
    console.error('Usage: npm run regen -- <gameId>   e.g. npm run regen -- afl-38612');
    process.exit(1);
  }

  const league = deriveLeague(gameId);
  if (!league) {
    console.error(`Unknown gameId prefix: "${gameId}". Expected e.g. afl-38612, nrl-603376, f1-12345`);
    process.exit(1);
  }

  console.log(`regen  gameId=${gameId}  league=${league}`);

  // Lock — prevent concurrent heartbeat/poller runs
  if (!acquireLock()) {
    console.error('skipped — another generate-previews job holds the lock. Wait for it to finish and retry.');
    process.exit(1);
  }

  let exitCode = 0;
  try {
    if (!await isOllamaReachable()) {
      throw new Error('Ollama not reachable — is it running?');
    }

    // Fetch fixtures with generous window (30 days back, 60 days forward)
    const GENEROUS_LOOKBACK    = 30;
    const GENEROUS_LOOKAHEAD_MS = 60 * 86400_000;

    let fixtures;
    try {
      fixtures = await fetchLeagueFixtures(league, GENEROUS_LOOKBACK);
    } catch (err) {
      throw new Error(`Failed to fetch ${league} fixtures: ${err instanceof Error ? err.message : err}`);
    }

    const now     = Date.now();
    const fixture = fixtures.find(
      f => f.id === gameId && new Date(f.date).getTime() <= now + GENEROUS_LOOKAHEAD_MS,
    );

    if (!fixture) {
      const sample = fixtures.slice(0, 10).map(f => `    ${f.id}  (${f.date})`).join('\n');
      throw new Error(
        `Fixture not found: ${gameId}\n  Fetched ${fixtures.length} ${league} fixtures. IDs available:\n${sample}`,
      );
    }

    const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
    const teamName  = teamEntry?.name ?? fixture.teamId;
    console.log(`  fixture  ${teamName} vs ${fixture.opponent}  (${fixture.date})`);

    // Build the canonical rich context (same path as heartbeat/poller — results
    // are cached so generateAndStorePreview below re-uses this fetch for free).
    const ctx = await buildPreviewContext(league, fixture, teamName);

    if (ctx.teamManager || ctx.opponentManager) {
      console.log(`  coaches  ${ctx.teamManager ?? '?'} vs ${ctx.opponentManager ?? '(unknown)'}`);
    }

    // Print the FIXTURE CONTEXT label as a diagnostic (stakes + phase).
    const played    = ctx.teamStanding?.played ?? ctx.opponentStanding?.played;
    const fixtureCtx = resolveCompetitionContext(
      league,
      ctx.leagueTable ?? [],
      teamName,
      fixture.opponent,
      played,
      fixture.date,
    );
    console.log(`  FIXTURE CONTEXT:`);
    console.log(`    Phase:  ${fixtureCtx.phase}`);
    console.log(`    Stakes: ${fixtureCtx.stakes}${fixtureCtx.explanation ? ` — ${fixtureCtx.explanation}` : ''}`);
    if (fixtureCtx.stakes === 'STANDARD') {
      console.log(`    (STANDARD → block suppressed in prompt)`);
    }
    if (ctx.leagueTable && ctx.leagueTable.length > 0) {
      console.log(`  standings  ${ctx.leagueTable.length} rows  team=${ctx.teamStanding?.position ?? '?'}  opp=${ctx.opponentStanding?.position ?? '?'}`);
    }

    console.log(`  generating…`);
    const t0     = Date.now();
    // generateAndStorePreview calls buildPreviewContext internally — the cache
    // makes this a no-op fetch, so the prompt is built from the same ctx above.
    const result = await generateAndStorePreview(league, fixture, teamName);
    const elapsed = Date.now() - t0;

    if (!result.ok) {
      throw new Error(`generate failed: ${result.error ?? 'unknown'}`);
    }

    const admin = getSupabaseAdmin();
    if (admin) {
      const { data } = await admin
        .from('game_previews')
        .select('updated_at, model')
        .eq('game_id', gameId)
        .maybeSingle();
      if (data) {
        console.log(`  done    elapsed=${elapsed}ms  model=${data.model}  updated_at=${data.updated_at}`);
      }
    } else {
      console.log(`  done    elapsed=${elapsed}ms`);
    }

  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    releaseLock();
  }
  if (exitCode) process.exit(exitCode);
}

main().catch(err => { console.error(err); releaseLock(); process.exit(1); });
