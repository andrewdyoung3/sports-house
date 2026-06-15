#!/usr/bin/env tsx
/**
 * Standalone preview generator — runs Ollama and upserts results to Supabase
 * directly. No Next.js dev server required.
 *
 * Normal run (scheduled):
 *   npm run warm
 *   → per-fixture lifecycle: initial gen after settle, regen at 48h/24h marks.
 *
 * Force run (manual, ad-hoc):
 *   npm run warm:force
 *   → regenerates every followed team's next fixture regardless of freshness.
 *   Never used by the launchd plist; manual only.
 *
 * Overlap protection: file-based lock so concurrent launchd firings skip cleanly.
 */

import { readFileSync, appendFileSync } from 'fs';
import { acquireLock, releaseLock } from '@/lib/generation-lock';
import { getDistinctFollowedTeamIds } from '@/lib/followed-teams-server';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { generateAndStorePreview } from '@/lib/preview-generator';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
import {
  decideForTeam,
  LOOKAHEAD_DAYS,
  LOOKBACK_DAYS,
  type TaggedFixture,
} from '@/lib/preview-lifecycle';
import type { UpcomingGame } from '@/types';

// ─── Env loading ──────────────────────────────────────────────────────────────
// Load .env.local before anything reads process.env. Already-set env vars win
// (the launchd plist can override individual keys via EnvironmentVariables).

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

const LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'world_cup', 'nba', 'cricket_int', 'bbl'] as const;

const LOG_FILE = '/tmp/sporthouse-ai.log';

/** When true, bypass decideForTeam and regenerate every team's next fixture. */
const FORCE = process.argv.includes('--force');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [generate-previews] ${msg}\n`;
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
  // The Realtime client checks for globalThis.WebSocket at init time and calls
  // process.exit(1) if absent. The script never uses Realtime subscriptions but
  // supabase-js always initialises the client during createClient().
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as any).WebSocket = ws;
  }

  if (!acquireLock()) {
    log('skipped — another generate-previews job holds the lock');
    process.exit(0);
  }

  try {
    if (!await isOllamaReachable()) {
      log('Ollama not reachable — aborting run');
      process.exit(0);
    }

    const followedIds = await getDistinctFollowedTeamIds();
    const hasF1Fans   = Array.from(followedIds).some(id => id.startsWith('f1-'));
    const failOpen    = followedIds.size === 0;

    if (failOpen) {
      log(`${FORCE ? '[force] ' : ''}no followed teams found — generating all fixtures`);
    } else {
      log(`${FORCE ? '[force] ' : ''}followed teams: ${followedIds.size} ids, hasF1Fans=${hasF1Fans}`);
    }

    // ── 1. Fetch all fixtures (with lookback) and tag by league ──────────────
    const allFixtures: TaggedFixture[] = [];
    for (const league of LEAGUES) {
      let fixtures: UpcomingGame[];
      try {
        fixtures = await fetchLeagueFixtures(league, LOOKBACK_DAYS);
      } catch (err) {
        log(`fetch-fail league=${league} err=${err instanceof Error ? err.message : err}`);
        continue;
      }
      for (const f of fixtures) allFixtures.push({ ...f, league });
    }

    const now         = Date.now();
    const lookaheadMs = LOOKAHEAD_DAYS * 86400_000;

    // In failOpen mode, iterate over all home-team IDs (every fixture has one).
    // In normal mode, iterate over followed team IDs (includes both sides).
    const allTeamIds: string[] = failOpen
      ? Array.from(new Set(allFixtures.map(f => f.teamId)))
      : Array.from(followedIds);

    const processedGameIds = new Set<string>();

    if (FORCE) {
      // ── Force mode: bypass lifecycle, regenerate every team's next fixture ──
      let forcedCount = 0, skippedCount = 0, failedCount = 0;

      for (const teamId of allTeamIds) {
        if (teamId.startsWith('f1-') && !hasF1Fans && !failOpen) continue;

        // Same candidate selection as normal: next upcoming within lookahead window.
        const next = allFixtures
          .filter(f =>
            (f.teamId === teamId || f.opponentId === teamId) &&
            !f.completed &&
            new Date(f.date).getTime() > now &&
            new Date(f.date).getTime() <= now + lookaheadMs,
          )
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

        if (!next) {
          skippedCount++;
          continue;
        }

        // Dedup: if both home and away are followed, first one wins.
        if (processedGameIds.has(next.id)) {
          skippedCount++;
          continue;
        }
        processedGameIds.add(next.id);

        const teamEntry = TEAMS.find(t => t.id === next.teamId);
        const teamName  = teamEntry?.name ?? next.teamId;

        log(`  force gameId=${next.id} league=${next.league} team=${teamName} vs ${next.opponent}`);

        const result = await generateAndStorePreview(next.league, next, teamName);
        if (result.ok) {
          forcedCount++;
        } else {
          log(`  failed gameId=${next.id} err=${result.error ?? 'unknown'}`);
          failedCount++;
        }
      }

      log(`done: forced=${forcedCount} skipped=${skippedCount} failed=${failedCount}`);

    } else {
      // ── Normal mode: batch Supabase query + decideForTeam lifecycle ──────────
      const upcomingIds = Array.from(
        new Set(
          allFixtures
            .filter(f => !f.completed && new Date(f.date).getTime() > now &&
                         new Date(f.date).getTime() <= now + lookaheadMs)
            .map(f => f.id),
        ),
      );

      const existingRows = new Map<string, string>();
      const admin = getSupabaseAdmin();
      if (admin && upcomingIds.length > 0) {
        const { data } = await admin
          .from('game_previews')
          .select('game_id, updated_at')
          .in('game_id', upcomingIds);
        for (const row of data ?? []) {
          if (row.game_id && row.updated_at) {
            existingRows.set(row.game_id as string, row.updated_at as string);
          }
        }
      }
      log(`supabase: ${existingRows.size} existing rows across ${upcomingIds.length} upcoming fixtures`);

      let initialCount = 0, regen48Count = 0, regen24Count = 0, skippedCount = 0, failedCount = 0;

      for (const teamId of allTeamIds) {
        if (teamId.startsWith('f1-') && !hasF1Fans && !failOpen) continue;

        const decision = decideForTeam(teamId, allFixtures, existingRows, now);
        if (!decision) {
          skippedCount++;
          continue;
        }

        const { fixture, action } = decision;

        // Dedup: both home and away teams may resolve to the same game.
        if (processedGameIds.has(fixture.id)) {
          skippedCount++;
          continue;
        }
        processedGameIds.add(fixture.id);

        const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
        const teamName  = teamEntry?.name ?? fixture.teamId;

        log(`  ${action} gameId=${fixture.id} league=${fixture.league} team=${teamName} vs ${fixture.opponent}`);

        const result = await generateAndStorePreview(fixture.league, fixture, teamName);
        if (result.ok) {
          if (action === 'initial')  initialCount++;
          if (action === 'regen-48') regen48Count++;
          if (action === 'regen-24') regen24Count++;
        } else {
          log(`  failed gameId=${fixture.id} err=${result.error ?? 'unknown'}`);
          failedCount++;
        }
      }

      log(`done: initial=${initialCount} regen-48=${regen48Count} regen-24=${regen24Count} skipped=${skippedCount} failed=${failedCount}`);
    }
  } finally {
    releaseLock();
  }
}

main().catch(err => {
  log(`fatal: ${err instanceof Error ? err.message : err}`);
  releaseLock();
  process.exit(1);
});
