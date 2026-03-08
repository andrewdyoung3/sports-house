/**
 * GET /api/standings?league=afl
 *
 * Returns the current ladder/table for a supported league.
 * AFL         → Squiggle API (free, no key)
 * NRL         → ESPN v2/sports/rugby-league/3/standings
 * EPL         → ESPN v2/sports/soccer/eng.1/standings
 * Super Rugby → ESPN v2/sports/rugby/242041/standings
 *
 * Each entry includes `teamId` (our internal slug) when resolvable,
 * so the client can highlight followed teams.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { TeamStanding } from '@/types';

export type StandingRow = TeamStanding & { teamId?: string };

async function fetchTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── AFL — Squiggle API ───────────────────────────────────────────────────────

const AFL_SQUIGGLE_TO_ID: Record<string, string> = {
  'Adelaide':         'afl-crows',
  'Brisbane Lions':   'afl-lions',
  'Carlton':          'afl-blues',
  'Collingwood':      'afl-pies',
  'Essendon':         'afl-bombers',
  'Fremantle':        'afl-dockers',
  'Geelong':          'afl-cats',
  'Gold Coast':       'afl-suns',
  'GWS Giants':       'afl-giants',
  'Hawthorn':         'afl-hawks',
  'Melbourne':        'afl-demons',
  'North Melbourne':  'afl-kangaroos',
  'Port Adelaide':    'afl-power',
  'Richmond':         'afl-tigers',
  'St Kilda':         'afl-saints',
  'Sydney':           'afl-swans',
  'West Coast':       'afl-eagles',
  'Western Bulldogs': 'afl-dogs',
};

async function fetchAFLStandings(): Promise<StandingRow[]> {
  const year = new Date().getFullYear();
  const res  = await fetchTimeout(
    `https://api.squiggle.com.au/?q=standings;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const { standings = [] } = await res.json();
  return (standings as any[]).map((s, i): StandingRow => ({
    name:       s.name,
    teamId:     AFL_SQUIGGLE_TO_ID[s.name],
    position:   s.rank ?? i + 1,
    played:     s.played  ?? 0,
    wins:       s.wins    ?? 0,
    draws:      s.draws   ?? 0,
    losses:     s.losses  ?? 0,
    percentage: s.percentage != null ? Math.round(s.percentage * 10) / 10 : undefined,
    points:     s.points,
  }));
}

// ─── NRL — ESPN public API ────────────────────────────────────────────────────

const NRL_ESPN_TO_ID: Record<string, string> = {
  'Broncos':      'nrl-broncos',
  'Raiders':      'nrl-raiders',
  'Bulldogs':     'nrl-bulldogs',
  'Sharks':       'nrl-sharks',
  'Dolphins':     'nrl-dolphins',
  'Titans':       'nrl-titans',
  'Eels':         'nrl-eels',
  'Panthers':     'nrl-panthers',
  'Sea Eagles':   'nrl-seahawks',
  'Storm':        'nrl-storm',
  'Knights':      'nrl-knights',
  'Warriors':     'nrl-warriors',
  'Cowboys':      'nrl-cowboys',
  'Rabbitohs':    'nrl-rabbitohs',
  'Dragons':      'nrl-dragons',
  'Roosters':     'nrl-roosters',
  'Wests Tigers': 'nrl-tigers',
};

async function fetchNRLStandings(): Promise<StandingRow[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/rugby-league/3/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data    = await res.json();
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) =>
    (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e, i): StandingRow => ({
    name:     e.team?.displayName ?? '',
    teamId:   NRL_ESPN_TO_ID[e.team?.displayName ?? ''],
    position: i + 1,
    played:   stat(e, 'gamesPlayed'),
    wins:     stat(e, 'gamesWon'),
    draws:    stat(e, 'gamesDrawn'),
    losses:   stat(e, 'gamesLost'),
    points:   stat(e, 'points'),
  }));
}

// ─── EPL — ESPN public API ────────────────────────────────────────────────────

const EPL_ESPN_TO_ID: Record<string, string> = {
  'Arsenal':                 'epl-arsenal',
  'Aston Villa':             'epl-astonvilla',
  'AFC Bournemouth':         'epl-bournemouth',
  'Brentford':               'epl-brentford',
  'Brighton & Hove Albion':  'epl-brighton',
  'Burnley':                 'epl-burnley',
  'Chelsea':                 'epl-chelsea',
  'Crystal Palace':          'epl-crystalpalace',
  'Everton':                 'epl-everton',
  'Fulham':                  'epl-fulham',
  'Leeds United':            'epl-leeds',
  'Liverpool':               'epl-liverpool',
  'Manchester City':         'epl-mancity',
  'Manchester United':       'epl-manutd',
  'Newcastle United':        'epl-newcastle',
  'Nottingham Forest':       'epl-forest',
  'Sunderland':              'epl-sunderland',
  'Tottenham Hotspur':       'epl-spurs',
  'West Ham United':         'epl-westham',
  'Wolverhampton Wanderers': 'epl-wolves',
};

async function fetchEPLStandings(): Promise<StandingRow[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data    = await res.json();
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) =>
    (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e, i): StandingRow => ({
    name:         e.team?.displayName ?? '',
    teamId:       EPL_ESPN_TO_ID[e.team?.displayName ?? ''],
    position:     i + 1,
    played:       stat(e, 'gamesPlayed'),
    wins:         stat(e, 'wins'),
    draws:        stat(e, 'ties'),
    losses:       stat(e, 'losses'),
    points:       stat(e, 'points'),
    goalsFor:     stat(e, 'pointsFor'),
    goalsAgainst: stat(e, 'pointsAgainst'),
  }));
}

// ─── Super Rugby Pacific — ESPN public API ────────────────────────────────────

const SRU_ESPN_TO_ID: Record<string, string> = {
  'Brumbies':                  'sru-brumbies',
  'ACT Brumbies':              'sru-brumbies',
  'Queensland Reds':           'sru-reds',
  'Reds':                      'sru-reds',
  'New South Wales Waratahs':  'sru-waratahs',
  'Waratahs':                  'sru-waratahs',
  'NSW Waratahs':              'sru-waratahs',
  'Western Force':             'sru-force',
  'Force':                     'sru-force',
  'Blues':                     'sru-blues',
  'Chiefs':                    'sru-chiefs',
  'Crusaders':                 'sru-crusaders',
  'Highlanders':               'sru-highlanders',
  'Hurricanes':                'sru-hurricanes',
  'Fijian Drua':               'sru-drua',
  'Drua':                      'sru-drua',
  'Moana Pasifika':            'sru-moana',
};

async function fetchSuperRugbyStandings(): Promise<StandingRow[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/rugby/242041/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  // Super Rugby may use a conference structure; try children[0] then root
  const entries: any[] =
    data.children?.[0]?.standings?.entries ??
    data.standings?.entries ??
    [];
  const stat = (e: any, ...names: string[]) =>
    names.reduce((v, n) => v || ((e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0), 0 as number);
  return entries.map((e, i): StandingRow => {
    const name = e.team?.displayName ?? e.team?.name ?? '';
    return {
      name,
      teamId:   SRU_ESPN_TO_ID[name],
      position: i + 1,
      played:   stat(e, 'gamesPlayed'),
      wins:     stat(e, 'wins', 'gamesWon'),
      draws:    stat(e, 'ties', 'gamesDrawn'),
      losses:   stat(e, 'losses', 'gamesLost'),
      points:   stat(e, 'points'),
    };
  });
}

// ─── International Rugby — ESPN (Rugby Championship standings) ────────────────
//
// For rugby_int we return The Rugby Championship table (AU/NZ/SA/ARG) as the
// primary standings — most relevant for the Australian audience following the
// Wallabies. Six Nations teams appear in the table when present in that comp.

const RINT_RC_DISP_TO_ID: Record<string, string> = {
  'Australia':    'rint-wallabies',
  'New Zealand':  'rint-allblacks',
  'South Africa': 'rint-boks',
  'Argentina':    'rint-argentina',
};

async function fetchRINTStandings(): Promise<StandingRow[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/rugby/244293/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const entries: any[] =
    data.children?.[0]?.standings?.entries ??
    data.standings?.entries ??
    [];
  const stat = (e: any, ...names: string[]) =>
    names.reduce((v, n) => v || ((e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0), 0 as number);

  return entries.map((e, i): StandingRow => {
    const name = e.team?.displayName ?? e.team?.name ?? '';
    return {
      name,
      teamId:   RINT_RC_DISP_TO_ID[name],
      position: i + 1,
      played:   stat(e, 'gamesPlayed'),
      wins:     stat(e, 'wins', 'gamesWon'),
      draws:    stat(e, 'ties', 'gamesDrawn'),
      losses:   stat(e, 'losses', 'gamesLost'),
      points:   stat(e, 'points'),
    };
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  if (!ALLOWED.has(league)) {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
  }

  try {
    let rows: StandingRow[] = [];
    if      (league === 'afl')         rows = await fetchAFLStandings();
    else if (league === 'nrl')         rows = await fetchNRLStandings();
    else if (league === 'epl')         rows = await fetchEPLStandings();
    else if (league === 'super_rugby') rows = await fetchSuperRugbyStandings();
    else if (league === 'rugby_int')   rows = await fetchRINTStandings();

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[/api/standings]', err);
    return NextResponse.json([]);
  }
}
