#!/usr/bin/env tsx
/**
 * Standalone preview generator — runs Ollama and upserts results to Supabase
 * directly. No Next.js dev server required.
 *
 * Run via: npm run warm
 *   (the npm script loads .env.local before tsx starts)
 *
 * Designed for a scheduled LaunchAgent on the Mac mini that hosts Ollama:
 *   scripts/launchd/com.sporthouse.previews.plist
 *
 * Overlap protection: uses the same file-based lock as generation-lock.ts so
 * concurrent cron firings skip cleanly.
 *
 * Freshness skip: previews are regenerated only when stale. Staleness threshold
 * tightens as kickoff nears so late team news / lineups are captured:
 *   > 48 h to kickoff  → skip if row is < 24 h old  (once per day)
 *   ≤ 48 h to kickoff  → skip if row is < 6 h old   (4× per day in final run-up)
 */

import { readFileSync } from 'fs';
import { appendFileSync } from 'fs';
import { acquireLock, releaseLock } from '@/lib/generation-lock';
import { getDistinctFollowedTeamIds } from '@/lib/followed-teams-server';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { generateAndStorePreview } from '@/lib/preview-generator';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
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

// Leagues to warm — same set the old warm-cache cron used, plus world_cup.
const LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'world_cup'] as const;

// How far ahead to look for upcoming fixtures.
const LOOKAHEAD_MS = 48 * 60 * 60 * 1000;

// Freshness thresholds — tighten as kickoff approaches.
const FAR_THRESHOLD_MS  = 24 * 60 * 60 * 1000; // > 48 h to kickoff: daily refresh
const NEAR_THRESHOLD_MS =  6 * 60 * 60 * 1000; // ≤ 48 h to kickoff: 6-hourly refresh
const NEAR_WINDOW_MS    = 48 * 60 * 60 * 1000; // boundary between the two regimes

const LOG_FILE = '/tmp/sporthouse-ai.log';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [generate-previews] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* non-fatal */ }
  console.log(msg);
}

async function isOllamaReachable(): Promise<boolean> {
  const base = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isFreshPreview(gameId: string, kickoffMs: number): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data } = await admin
      .from('game_previews')
      .select('updated_at')
      .eq('game_id', gameId)
      .maybeSingle();
    if (!data?.updated_at) return false; // no row → generate
    const rowAgeMs      = Date.now() - new Date(data.updated_at).getTime();
    const msTillKickoff = kickoffMs - Date.now();
    const threshold     = msTillKickoff <= NEAR_WINDOW_MS ? NEAR_THRESHOLD_MS : FAR_THRESHOLD_MS;
    return rowAgeMs < threshold;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!acquireLock()) {
    log('skipped — another generate-previews job holds the lock');
    process.exit(0);
  }

  try {
    if (!await isOllamaReachable()) {
      log('Ollama not reachable — aborting run');
      process.exit(0);
    }

    const followedIds  = await getDistinctFollowedTeamIds();
    const hasF1Fans    = Array.from(followedIds).some(id => id.startsWith('f1-'));
    const failOpen     = followedIds.size === 0;

    if (failOpen) {
      log('no followed teams found (admin not configured or no users) — generating all fixtures');
    } else {
      log(`followed teams: ${followedIds.size} ids, hasF1Fans=${hasF1Fans}`);
    }

    let attempted = 0, generated = 0, skipped = 0, failed = 0;

    for (const league of LEAGUES) {
      let fixtures: UpcomingGame[];
      try {
        fixtures = await fetchLeagueFixtures(league);
      } catch (err) {
        log(`fetch-fail league=${league} err=${err instanceof Error ? err.message : err}`);
        continue;
      }

      const now    = Date.now();
      const cutoff = now + LOOKAHEAD_MS;

      const upcoming = fixtures.filter(f => {
        const t = new Date(f.date).getTime();
        return t >= now && t <= cutoff;
      });

      const toGenerate = failOpen
        ? upcoming
        : upcoming.filter(f => {
            if (league === 'f1') return hasF1Fans;
            return followedIds.has(f.teamId) ||
                   (f.opponentId != null && followedIds.has(f.opponentId));
          });

      if (toGenerate.length === 0) continue;
      log(`${league}: ${upcoming.length} upcoming, ${toGenerate.length} after filter`);

      for (const fixture of toGenerate) {
        attempted++;

        if (await isFreshPreview(fixture.id, new Date(fixture.date).getTime())) {
          log(`  skip-fresh gameId=${fixture.id}`);
          skipped++;
          continue;
        }

        const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
        const teamName  = teamEntry?.name ?? fixture.teamId;

        log(`  generating gameId=${fixture.id} team=${teamName} vs ${fixture.opponent}`);
        const result = await generateAndStorePreview(league, fixture, teamName);

        if (result.ok) {
          generated++;
        } else {
          log(`  failed gameId=${fixture.id} err=${result.error ?? 'unknown'}`);
          failed++;
        }
      }
    }

    log(`done: attempted=${attempted} generated=${generated} skipped=${skipped} failed=${failed}`);
  } finally {
    releaseLock();
  }
}

main().catch(err => {
  log(`fatal: ${err instanceof Error ? err.message : err}`);
  releaseLock();
  process.exit(1);
});
