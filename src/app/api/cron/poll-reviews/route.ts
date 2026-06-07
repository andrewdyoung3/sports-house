/**
 * GET /api/cron/poll-reviews
 *
 * Finds games that finished within the last 2 hours and generates an AI review
 * for each one that doesn't already have one cached. Called every 5 minutes by
 * scripts/poll-reviews.sh.
 *
 * Protected by x-cron-secret header — no Supabase session required.
 * Logs each job start/end to /tmp/sporthouse-ai.log for latency verification.
 *
 * "Recently finished" heuristic per sport:
 *   AFL  — Squiggle complete=100, kickoff within last 5 hours (AFL games ~2h)
 *   NRL  — ESPN completed event, kickoff within last 4 hours (NRL game ~80 min)
 *   EPL  — ESPN completed event, kickoff within last 4 hours (EPL game ~100 min)
 *   SRU  — ESPN completed event, kickoff within last 4 hours (rugby game ~90 min)
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { getDistinctFollowedTeamIds } from '@/lib/followed-teams-server';

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [poll-reviews] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';

// ── How long after kickoff a game might still be "just finished" ──────────────
const LOOKBACK_MS: Record<string, number> = {
  afl:         5 * 3600 * 1000,  // AFL ~2h game + 3h buffer
  nrl:         4 * 3600 * 1000,
  epl:         4 * 3600 * 1000,
  super_rugby: 4 * 3600 * 1000,
};

// ── AFL — Squiggle ─────────────────────────────────────────────────────────────

const SQUIGGLE_TEAM_ID: Record<string, string> = {
  'Brisbane Lions': 'afl-lions', 'Richmond': 'afl-tigers', 'Sydney': 'afl-swans',
  'Geelong': 'afl-cats', 'Collingwood': 'afl-pies', 'Carlton': 'afl-blues',
  'Melbourne': 'afl-demons', 'Western Bulldogs': 'afl-dogs', 'Hawthorn': 'afl-hawks',
  'Essendon': 'afl-bombers', 'Adelaide': 'afl-crows', 'Port Adelaide': 'afl-power',
  'Fremantle': 'afl-dockers', 'GWS Giants': 'afl-giants', 'Greater Western Sydney': 'afl-giants',
  'Gold Coast': 'afl-suns', 'North Melbourne': 'afl-kangaroos', 'St Kilda': 'afl-saints',
  'West Coast': 'afl-eagles',
};

interface ReviewJob {
  league: string;
  teamName: string;
  opponent: string;
  teamScore: number;
  opponentScore: number;
  isHome: boolean;
  date: string;
  gameId: string;
  competition?: string;
  /** Internal app team slug — used to filter by followed teams. */
  teamId?: string;
  opponentId?: string;
}

// ── Team display-name → internal ID maps (mirrored from league-fixtures) ──────
// Used to populate teamId/opponentId on review jobs so we can filter by
// followed teams without hitting the league-fixtures route.

const NRL_NAME_TO_ID: Record<string, string> = {
  'Brisbane Broncos': 'nrl-broncos', 'Canberra Raiders': 'nrl-raiders',
  'Canterbury-Bankstown Bulldogs': 'nrl-bulldogs', 'Cronulla-Sutherland Sharks': 'nrl-sharks',
  'Dolphins': 'nrl-dolphins', 'Gold Coast Titans': 'nrl-titans',
  'Parramatta Eels': 'nrl-eels', 'Penrith Panthers': 'nrl-panthers',
  'Manly-Warringah Sea Eagles': 'nrl-seahawks', 'Melbourne Storm': 'nrl-storm',
  'Newcastle Knights': 'nrl-knights', 'New Zealand Warriors': 'nrl-warriors',
  'North Queensland Cowboys': 'nrl-cowboys', 'South Sydney Rabbitohs': 'nrl-rabbitohs',
  'St. George Illawarra Dragons': 'nrl-dragons', 'Sydney Roosters': 'nrl-roosters',
  'Wests Tigers': 'nrl-tigers',
  // ESPN short names (displayName varies)
  'Broncos': 'nrl-broncos', 'Raiders': 'nrl-raiders', 'Bulldogs': 'nrl-bulldogs',
  'Sharks': 'nrl-sharks', 'Titans': 'nrl-titans', 'Eels': 'nrl-eels',
  'Panthers': 'nrl-panthers', 'Sea Eagles': 'nrl-seahawks', 'Storm': 'nrl-storm',
  'Knights': 'nrl-knights', 'Warriors': 'nrl-warriors', 'Cowboys': 'nrl-cowboys',
  'Rabbitohs': 'nrl-rabbitohs', 'Dragons': 'nrl-dragons', 'Roosters': 'nrl-roosters',
};

const EPL_NAME_TO_ID: Record<string, string> = {
  'Arsenal': 'epl-arsenal', 'Aston Villa': 'epl-astonvilla',
  'AFC Bournemouth': 'epl-bournemouth', 'Brentford': 'epl-brentford',
  'Brighton & Hove Albion': 'epl-brighton', 'Chelsea': 'epl-chelsea',
  'Crystal Palace': 'epl-crystalpalace', 'Everton': 'epl-everton',
  'Fulham': 'epl-fulham', 'Liverpool': 'epl-liverpool',
  'Manchester City': 'epl-mancity', 'Manchester United': 'epl-manutd',
  'Newcastle United': 'epl-newcastle', 'Nottingham Forest': 'epl-forest',
  'Sunderland': 'epl-sunderland', 'Tottenham Hotspur': 'epl-spurs',
  'West Ham United': 'epl-westham', 'Wolverhampton Wanderers': 'epl-wolves',
};

const SRU_NAME_TO_ID: Record<string, string> = {
  'Brumbies': 'sru-brumbies', 'ACT Brumbies': 'sru-brumbies',
  'Queensland Reds': 'sru-reds', 'Reds': 'sru-reds',
  'New South Wales Waratahs': 'sru-waratahs', 'Waratahs': 'sru-waratahs',
  'NSW Waratahs': 'sru-waratahs', 'Western Force': 'sru-force', 'Force': 'sru-force',
  'Blues': 'sru-blues', 'Chiefs': 'sru-chiefs', 'Crusaders': 'sru-crusaders',
  'Highlanders': 'sru-highlanders', 'Hurricanes': 'sru-hurricanes',
  'Fijian Drua': 'sru-drua', 'Drua': 'sru-drua',
  'Moana Pasifika': 'sru-moana',
};

function resolveTeamId(league: string, name: string): string | undefined {
  if (league === 'afl')         return SQUIGGLE_TEAM_ID[name];
  if (league === 'nrl')         return NRL_NAME_TO_ID[name];
  if (league === 'epl')         return EPL_NAME_TO_ID[name];
  if (league === 'super_rugby') return SRU_NAME_TO_ID[name];
  return undefined;
}

async function fetchRecentAFL(): Promise<ReviewJob[]> {
  const now  = Date.now();
  const cutoff = now - LOOKBACK_MS.afl;
  try {
    const year = new Date().getFullYear();
    const res  = await fetch(
      `https://api.squiggle.com.au/?q=games;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, cache: 'no-store' },
    );
    if (!res.ok) return [];
    const { games = [] } = await res.json();

    return (games as any[])
      .filter(g => Number(g.complete) === 100 && g.unixtime * 1000 > cutoff)
      .map((g): ReviewJob => ({
        league:    'afl',
        teamName:  g.hteam as string,
        opponent:  g.ateam as string,
        teamScore: Number(g.hscore),
        opponentScore: Number(g.ascore),
        isHome:    true,
        date:      g.date as string,
        gameId:    `afl-${g.id}`,
        teamId:    SQUIGGLE_TEAM_ID[g.hteam as string],
        opponentId: SQUIGGLE_TEAM_ID[g.ateam as string],
      }));
  } catch {
    return [];
  }
}

async function fetchRecentESPN(sportPath: string, league: string): Promise<ReviewJob[]> {
  const now    = Date.now();
  const cutoff = now - LOOKBACK_MS[league];
  const today  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${today}&limit=50`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const events: any[] = data.events ?? [];

    return events
      .filter(e => {
        if (!e.competitions?.[0]?.status?.type?.completed) return false;
        const kickoff = new Date(e.date).getTime();
        return kickoff > cutoff;
      })
      .map((e): ReviewJob => {
        const comp:  any   = e.competitions?.[0] ?? {};
        const competitors: any[] = comp.competitors ?? [];
        const home  = competitors.find((c: any) => c.homeAway === 'home');
        const away  = competitors.find((c: any) => c.homeAway === 'away');
        const teamName = home?.team?.displayName ?? 'Home';
        const oppName  = away?.team?.displayName ?? 'Away';
        return {
          league,
          teamName,
          opponent:      oppName,
          teamScore:     parseInt(home?.score ?? '0', 10),
          opponentScore: parseInt(away?.score  ?? '0', 10),
          isHome:        true,
          date:          e.date as string,
          gameId:        `${league}-${e.id as string}`,
          teamId:        resolveTeamId(league, teamName),
          opponentId:    resolveTeamId(league, oppName),
        };
      });
  } catch {
    return [];
  }
}

// ── POST one review job ────────────────────────────────────────────────────────

async function postReview(job: ReviewJob, secret: string): Promise<'ok' | 'cached' | 'error'> {
  const t0 = Date.now();
  log(`start gameId=${job.gameId} ${job.teamName} vs ${job.opponent}`);
  try {
    const res = await fetch(`${BASE}/api/ai-review`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body:    JSON.stringify(job),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      log(`error gameId=${job.gameId} status=${res.status} elapsed=${elapsed}ms`);
      return 'error';
    }
    // If elapsed < 2s the result was served from cache (generation takes >>2s)
    const outcome = elapsed < 2000 ? 'cached' : 'ok';
    log(`${outcome} gameId=${job.gameId} elapsed=${elapsed}ms`);
    return outcome;
  } catch (e) {
    log(`error gameId=${job.gameId} err=${e} elapsed=${Date.now() - t0}ms`);
    return 'error';
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log('poll start');
  const t0 = Date.now();

  // Gather all recently-finished games in parallel
  const [aflJobs, nrlJobs, eplJobs, sruJobs, followedIds] = await Promise.all([
    fetchRecentAFL(),
    fetchRecentESPN('rugby-league/3',     'nrl'),
    fetchRecentESPN('soccer/eng.1',       'epl'),
    fetchRecentESPN('rugby/242041',       'super_rugby'),
    getDistinctFollowedTeamIds(),
  ]);

  const allJobs = [...aflJobs, ...nrlJobs, ...eplJobs, ...sruJobs];
  log(`found ${allJobs.length} recently-finished games`);

  // ── Filter to followed teams only ──────────────────────────────────────────
  // Fail-open: if admin client is unconfigured (empty set), process all jobs.
  const filteredJobs = followedIds.size === 0
    ? allJobs
    : allJobs.filter(job =>
        (job.teamId     != null && followedIds.has(job.teamId))     ||
        (job.opponentId != null && followedIds.has(job.opponentId)) ||
        // Unknown team IDs → include to avoid missing a game (fail-open per job)
        (job.teamId == null && job.opponentId == null),
      );

  if (followedIds.size > 0 && filteredJobs.length < allJobs.length) {
    log(`filtered to ${filteredJobs.length} jobs (${allJobs.length - filteredJobs.length} skipped — no followers)`);
  }

  const counts = { generated: 0, cached: 0, errors: 0 };
  for (const job of filteredJobs) {
    const outcome = await postReview(job, secret);
    if (outcome === 'ok')     counts.generated++;
    if (outcome === 'cached') counts.cached++;
    if (outcome === 'error')  counts.errors++;
  }

  const elapsed = Date.now() - t0;
  log(`poll done elapsed=${elapsed}ms generated=${counts.generated} cached=${counts.cached} errors=${counts.errors}`);

  return NextResponse.json({
    ok: true,
    timestamp:      new Date().toISOString(),
    gamesFound:     allJobs.length,
    gamesProcessed: filteredJobs.length,
    gamesSkipped:   allJobs.length - filteredJobs.length,
    ...counts,
    elapsedMs:      elapsed,
  });
}
