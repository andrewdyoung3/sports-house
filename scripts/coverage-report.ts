#!/usr/bin/env tsx
/**
 * Read-only diagnostic: classifies every followed team by preview coverage.
 *
 * For each distinct followed team_id:
 *   covered    — next upcoming fixture within LOOKAHEAD_DAYS AND game_previews row exists
 *   missing    — next upcoming fixture within LOOKAHEAD_DAYS but NO preview row
 *   no-upcoming — no fixture in the lookahead window (+ soonest beyond it, if any)
 *
 * No writes, no Ollama. Run via: npm run coverage
 */

import { readFileSync } from 'fs';
import { getDistinctFollowedTeamIds } from '@/lib/followed-teams-server';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';
import { LOOKAHEAD_DAYS } from '@/lib/preview-lifecycle';
import type { UpcomingGame } from '@/types';

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
} catch { /* .env.local not present */ }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysFromNow(ms: number, now: number): string {
  const d = Math.round((ms - now) / 86400_000);
  return d === 0 ? 'today' : d === 1 ? '1d' : `${d}d`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // WS polyfill for Node.js < 22 (Supabase Realtime client init).
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    const { default: ws } = await import('ws');
    (globalThis as any).WebSocket = ws;
  }

  const followedIds = await getDistinctFollowedTeamIds();
  if (followedIds.size === 0) {
    console.log('No followed teams found (admin client not configured or no users).');
    return;
  }
  console.log(`\nFollowed teams: ${followedIds.size}  Lookahead: ${LOOKAHEAD_DAYS}d\n`);

  const now         = Date.now();
  const lookaheadMs = LOOKAHEAD_DAYS * 86400_000;

  // ── 1. Group teams by league and fetch once per league ──────────────────────
  const leagueToTeams = new Map<string, string[]>();
  const unknownTeams: string[] = [];

  for (const teamId of followedIds) {
    const entry = TEAMS.find(t => t.id === teamId);
    if (!entry) { unknownTeams.push(teamId); continue; }
    const league = entry.league as string;
    const bucket = leagueToTeams.get(league) ?? [];
    bucket.push(teamId);
    leagueToTeams.set(league, bucket);
  }

  // Fetch fixtures for each distinct league (no lookback — upcoming only).
  const leagueFixtures = new Map<string, UpcomingGame[]>();
  for (const league of leagueToTeams.keys()) {
    try {
      const fixtures = await fetchLeagueFixtures(league);
      leagueFixtures.set(league, fixtures);
    } catch (err) {
      console.error(`  fetch-fail league=${league}: ${err instanceof Error ? err.message : err}`);
      leagueFixtures.set(league, []);
    }
  }

  // ── 2. Classify each team ───────────────────────────────────────────────────
  interface TeamRow {
    teamId:   string;
    league:   string;
    status:   'covered' | 'missing' | 'no-upcoming';
    fixture?: UpcomingGame;
    soonestMs?: number; // soonest fixture beyond LOOKAHEAD_DAYS (for no-upcoming)
  }

  const rows: TeamRow[] = [];
  const fixtureIdsInWindow: string[] = [];

  for (const [league, teamIds] of leagueToTeams) {
    const allFixtures = leagueFixtures.get(league) ?? [];

    for (const teamId of teamIds) {
      const teamFixtures = allFixtures.filter(
        f => (f.teamId === teamId || f.opponentId === teamId) && !f.completed,
      );

      // Next fixture within lookahead
      const inWindow = teamFixtures.filter(f => {
        const t = new Date(f.date).getTime();
        return t > now && t <= now + lookaheadMs;
      });
      const next = inWindow.sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      )[0];

      if (next) {
        fixtureIdsInWindow.push(next.id);
        // Status determined after game_previews query below
        rows.push({ teamId, league, status: 'missing', fixture: next });
      } else {
        // Find soonest fixture beyond the lookahead window
        const beyond = teamFixtures
          .filter(f => new Date(f.date).getTime() > now + lookaheadMs)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
        rows.push({
          teamId,
          league,
          status: 'no-upcoming',
          soonestMs: beyond ? new Date(beyond.date).getTime() : undefined,
        });
      }
    }
  }

  for (const teamId of unknownTeams) {
    rows.push({ teamId, league: '?', status: 'no-upcoming' });
  }

  // ── 3. Batch-query game_previews ────────────────────────────────────────────
  const coveredGameIds = new Set<string>();
  const admin = getSupabaseAdmin();
  if (admin && fixtureIdsInWindow.length > 0) {
    const { data } = await admin
      .from('game_previews')
      .select('game_id')
      .in('game_id', fixtureIdsInWindow);
    for (const row of data ?? []) {
      if (row.game_id) coveredGameIds.add(row.game_id as string);
    }
  }

  // Resolve final status for rows that had a fixture in window
  for (const row of rows) {
    if (row.status === 'missing' && row.fixture && coveredGameIds.has(row.fixture.id)) {
      row.status = 'covered';
    }
  }

  // Sort: missing first (actionable), then covered, then no-upcoming
  const ORDER: Record<TeamRow['status'], number> = { missing: 0, covered: 1, 'no-upcoming': 2 };
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.teamId.localeCompare(b.teamId));

  // ── 4. Print table ──────────────────────────────────────────────────────────
  const W_TEAM    = 28;
  const W_LEAGUE  = 14;
  const W_FIXTURE = 52;

  const header =
    pad('team_id', W_TEAM) + '| ' +
    pad('league', W_LEAGUE) + '| ' +
    pad('next fixture', W_FIXTURE) + '| preview';
  console.log(header);
  console.log('-'.repeat(header.length + 2));

  for (const row of rows) {
    let fixtureCol: string;
    if (row.fixture) {
      const kickoff    = new Date(row.fixture.date);
      const kickoffStr = `${kickoff.toISOString().slice(0, 10)} (${daysFromNow(kickoff.getTime(), now)})`;
      fixtureCol = `${row.fixture.id} | ${kickoffStr} vs ${row.fixture.opponent}`.slice(0, W_FIXTURE - 1);
    } else if (row.status === 'no-upcoming') {
      const soonest = row.soonestMs
        ? ` [soonest: ${daysFromNow(row.soonestMs, now)}]`
        : ' [none found]';
      fixtureCol = `none in ${LOOKAHEAD_DAYS}d${soonest}`;
    } else {
      fixtureCol = '—';
    }

    const previewCol =
      row.status === 'covered'    ? 'yes' :
      row.status === 'missing'    ? '*** MISSING ***' :
      'n/a';

    console.log(
      pad(row.teamId, W_TEAM) + '| ' +
      pad(row.league, W_LEAGUE) + '| ' +
      pad(fixtureCol, W_FIXTURE) + '| ' +
      previewCol,
    );
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  const covered    = rows.filter(r => r.status === 'covered').length;
  const noUpcoming = rows.filter(r => r.status === 'no-upcoming').length;
  const missing    = rows.filter(r => r.status === 'missing');

  console.log('');
  console.log(`covered=${covered}  no-upcoming=${noUpcoming}  missing=${missing.length}`);

  if (missing.length > 0) {
    console.log('\nMissing previews (fixture exists but no row in game_previews):');
    for (const row of missing) {
      const f = row.fixture!;
      const kickoff = new Date(f.date);
      console.log(
        `  ${row.teamId}  ${f.id}  vs ${f.opponent}  ` +
        `${kickoff.toISOString().slice(0, 16)}  (${daysFromNow(kickoff.getTime(), now)})`,
      );
    }
  } else {
    console.log('\nNo missing previews — all teams with upcoming fixtures are covered.');
  }

  // ── 6. No-upcoming detail ───────────────────────────────────────────────────
  const noUpcomingRows = rows.filter(r => r.status === 'no-upcoming');
  if (noUpcomingRows.length > 0) {
    console.log('\nNo-upcoming detail (off-season or beyond lookahead):');
    for (const row of noUpcomingRows) {
      const soonest = row.soonestMs
        ? `soonest in ${daysFromNow(row.soonestMs, now)}`
        : 'no fixture found';
      console.log(`  ${row.teamId}  (${row.league})  — ${soonest}`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
