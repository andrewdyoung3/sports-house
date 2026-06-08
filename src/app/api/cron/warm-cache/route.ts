/**
 * GET /api/cron/warm-cache[?dryRun=true]
 *
 * Pre-generates AI previews for upcoming fixtures so users never wait on first
 * load. Only generates for fixtures where at least one user follows the home OR
 * away team — skipping all fixtures no user cares about.
 *
 * Special cases:
 *   F1  — any user following any F1 entity (id starts with "f1-") triggers
 *          generation for all upcoming F1 fixtures. F1 has no two-team structure.
 *   NBA / NHL / MLB — not in the LEAGUES list so they are never reached here.
 *
 * Protected by CRON_SECRET header.
 *
 * Query params:
 *   dryRun=true  Log what would be generated without making any AI calls.
 *                Useful for auditing the before/after fixture counts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import type { UpcomingGame } from '@/types';
import { getDistinctFollowedTeamIds } from '@/lib/followed-teams-server';
import { TEAMS } from '@/lib/teams';
import { acquireLock, releaseLock } from '@/lib/generation-lock';

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [warm-cache] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

const LEAGUES = ['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1'] as const;
type League = typeof LEAGUES[number];

// Approximate generation time per preview (seconds) — used to estimate time saved.
const AVG_SECONDS_PER_PREVIEW = 45;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true';
  const base   = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';

  if (!acquireLock()) {
    log('generation already in progress — skipping this run');
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock held' });
  }

  log(`start dryRun=${dryRun}`);

  try {
  // ── Followed teams set ────────────────────────────────────────────────────────
  const followedIds = await getDistinctFollowedTeamIds();
  const hasF1Followers = followedIds.size > 0
    ? Array.from(followedIds).some(id => id.startsWith('f1-'))
    : false;

  if (followedIds.size === 0) {
    log('no followed teams found (admin client not configured or no users) — generating all fixtures');
  } else {
    log(`followed teams: ${followedIds.size} distinct ids, hasF1Followers=${hasF1Followers}`);
  }

  // ── Per-league results ────────────────────────────────────────────────────────

  interface LeagueResult {
    league: string;
    totalFixtures: number;
    filteredFixtures: number;
    warmed: number;
    errors: number;
  }
  const results: LeagueResult[] = [];
  let grandTotalFixtures  = 0;
  let grandFiltered       = 0;

  for (const league of LEAGUES) {
    let warmed  = 0;
    let errors  = 0;
    let total   = 0;
    let filtered = 0;

    try {
      const fixtureRes = await fetch(`${base}/api/league-fixtures?league=${league}`, {
        cache: 'no-store',
      });
      if (!fixtureRes.ok) continue;

      const allFixtures = await fixtureRes.json() as UpcomingGame[];
      if (!Array.isArray(allFixtures)) continue;

      const now    = new Date();
      const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000); // next 24 h

      const upcoming = allFixtures.filter(f => {
        const d = new Date(f.date);
        return d >= now && d <= cutoff;
      });

      total = upcoming.length;
      grandTotalFixtures += total;

      // ── Filter to followed teams only ───────────────────────────────────────
      // Fail-open: if followedIds is empty (admin not configured), generate all.
      const toGenerate = followedIds.size === 0
        ? upcoming
        : upcoming.filter(f => {
            if (league === 'f1') return hasF1Followers;
            return followedIds.has(f.teamId) ||
                   (f.opponentId != null && followedIds.has(f.opponentId));
          });

      filtered = toGenerate.length;
      grandFiltered += filtered;

      if (total > 0) {
        log(`${league}: ${total} upcoming, ${filtered} after filter${dryRun ? ' (dry-run)' : ''}`);
      }

      if (dryRun) {
        for (const f of toGenerate) {
          const teamEntry = TEAMS.find(t => t.id === f.teamId);
          log(`  would-generate gameId=${f.id} team=${f.teamId}(${teamEntry?.name ?? '?'}) vs ${f.opponent}`);
        }
        results.push({ league, totalFixtures: total, filteredFixtures: filtered, warmed: 0, errors: 0 });
        continue;
      }

      // ── Generate ────────────────────────────────────────────────────────────
      for (const fixture of toGenerate) {
        try {
          const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
          await fetch(`${base}/api/ai-preview`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-cron-secret': secret,
            },
            body: JSON.stringify({
              league,
              teamId:       fixture.teamId,
              teamName:     teamEntry?.name ?? fixture.teamId,
              opponentName: fixture.opponent,
              gameId:       fixture.id,
              context:      {},
              teamResults:  [],
              oppResults:   [],
              competition:  fixture.competition,
              isHome:       fixture.isHome,
              opponentId:   fixture.opponentId,
            }),
          });
          warmed++;
        } catch {
          errors++;
        }
      }
    } catch {
      // league fetch failed — skip
    }

    results.push({ league, totalFixtures: total, filteredFixtures: filtered, warmed, errors });
  }

  const skipped         = grandTotalFixtures - grandFiltered;
  const timeSavedMinutes = Math.round((skipped * AVG_SECONDS_PER_PREVIEW) / 60);

  log(
    `done: total=${grandTotalFixtures} filtered=${grandFiltered} skipped=${skipped}` +
    ` estimatedTimeSaved=${timeSavedMinutes}min dryRun=${dryRun}`,
  );

  return NextResponse.json({
    ok:                 true,
    dryRun,
    timestamp:          new Date().toISOString(),
    followedTeamCount:  followedIds.size,
    results,
    totalFixtures:      grandTotalFixtures,
    filteredFixtures:   grandFiltered,
    skippedFixtures:    skipped,
    estimatedTimeSavedMinutes: timeSavedMinutes,
    total:              dryRun ? 0 : results.reduce((s, r) => s + r.warmed, 0),
  });
  } finally {
    releaseLock();
  }
}
