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
import { F1_DRIVERS, F1_CONSTRUCTOR_TEAMS, ERGAST_ID_TO_TEAM_ID } from '@/lib/f1-data';
import { fetchTimeout } from '@/lib/espn';

export type StandingRow = TeamStanding & { teamId?: string };

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' };

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
  return entries.map((e, i): StandingRow => {
    const cur  = i + 1;
    const prev = typeof e.previousRank === 'number' ? e.previousRank : undefined;
    return {
      name:       e.team?.displayName ?? '',
      teamId:     NRL_ESPN_TO_ID[e.team?.displayName ?? ''],
      position:   cur,
      played:     stat(e, 'gamesPlayed'),
      wins:       stat(e, 'gamesWon'),
      draws:      stat(e, 'gamesDrawn'),
      losses:     stat(e, 'gamesLost'),
      points:     stat(e, 'points'),
      rankChange: prev !== undefined ? prev - cur : undefined,
    };
  });
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
  return entries.map((e, i): StandingRow => {
    const cur  = i + 1;
    const prev = typeof e.previousRank === 'number' ? e.previousRank : undefined;
    return {
      name:         e.team?.displayName ?? '',
      teamId:       EPL_ESPN_TO_ID[e.team?.displayName ?? ''],
      position:     cur,
      played:       stat(e, 'gamesPlayed'),
      wins:         stat(e, 'wins'),
      draws:        stat(e, 'ties'),
      losses:       stat(e, 'losses'),
      points:       stat(e, 'points'),
      goalsFor:     stat(e, 'pointsFor'),
      goalsAgainst: stat(e, 'pointsAgainst'),
      rankChange:   prev !== undefined ? prev - cur : undefined,
    };
  });
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
    const cur  = i + 1;
    const prev = typeof e.previousRank === 'number' ? e.previousRank : undefined;
    return {
      name,
      teamId:     SRU_ESPN_TO_ID[name],
      position:   cur,
      played:     stat(e, 'gamesPlayed'),
      wins:       stat(e, 'wins', 'gamesWon'),
      draws:      stat(e, 'ties', 'gamesDrawn'),
      losses:     stat(e, 'losses', 'gamesLost'),
      points:     stat(e, 'points'),
      rankChange: prev !== undefined ? prev - cur : undefined,
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
    const cur  = i + 1;
    const prev = typeof e.previousRank === 'number' ? e.previousRank : undefined;
    return {
      name,
      teamId:     RINT_RC_DISP_TO_ID[name],
      position:   cur,
      played:     stat(e, 'gamesPlayed'),
      wins:       stat(e, 'wins', 'gamesWon'),
      draws:      stat(e, 'ties', 'gamesDrawn'),
      losses:     stat(e, 'losses', 'gamesLost'),
      points:     stat(e, 'points'),
      rankChange: prev !== undefined ? prev - cur : undefined,
    };
  });
}

// ─── Formula 1 — Jolpi Ergast API ────────────────────────────────────────────

async function fetchF1Standings(): Promise<StandingRow[]> {
  const tryUrls = [
    'https://api.jolpi.ca/ergast/f1/current/driverstandings.json',
    'https://api.jolpi.ca/ergast/f1/2025/driverstandings.json',
  ];

  // Fire the race calendar fetch in parallel with driver standings
  const racesPromise = fetchTimeout(
    'https://api.jolpi.ca/ergast/f1/current.json',
    { next: { revalidate: 3600 } },
  ).then(async r => {
    if (!r.ok) return 0;
    const racesData = await r.json();
    const races: any[] = racesData?.MRData?.RaceTable?.Races ?? [];
    const now = Date.now();
    return races.filter((r: any) => new Date(r.date).getTime() < now).length;
  }).catch(() => 0);

  let standingsList: any[] = [];
  for (const url of tryUrls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      standingsList = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
      if (standingsList.length > 0) break;
    } catch {
      // try next URL
    }
  }

  if (standingsList.length === 0) return [];

  const completedRaces = await racesPromise;

  return standingsList.map((s: any): StandingRow => {
    const driverId = s.Driver?.driverId ?? '';
    const teamId   = ERGAST_ID_TO_TEAM_ID[driverId];
    const driver   = teamId ? F1_DRIVERS.find(d => d.id === teamId) : undefined;

    const wins    = parseInt(s.wins ?? '0', 10);
    const played  = completedRaces;
    const losses  = Math.max(0, played - wins);

    return {
      name:         `${s.Driver?.givenName ?? ''} ${s.Driver?.familyName ?? ''}`.trim(),
      teamId,
      position:     parseInt(s.position, 10),
      played,
      wins,
      draws:        0,
      losses,
      points:       parseFloat(s.points ?? '0'),
      constructorName: s.Constructors?.[0]?.name ?? '',
      primaryColor:   driver?.primaryColor,
      secondaryColor: driver?.secondaryColor,
    } as StandingRow & { primaryColor?: string; secondaryColor?: string };
  });
}

// ─── Formula 1 Constructor Standings — Jolpi Ergast API ──────────────────────

/** Mapping from Ergast constructorId → our internal f1-team-* id */
const F1_ERGAST_CONSTRUCTOR_TO_TEAM_ID: Record<string, string> = {
  'red_bull':    'f1-team-redbull',
  'ferrari':     'f1-team-ferrari',
  'mercedes':    'f1-team-mercedes',
  'mclaren':     'f1-team-mclaren',
  'aston_martin':'f1-team-astonmartin',
  'alpine':      'f1-team-alpine',
  'williams':    'f1-team-williams',
  'rb':          'f1-team-racingbulls',
  'haas':        'f1-team-haas',
  'sauber':      'f1-team-sauber',
};

async function fetchF1ConstructorStandings(): Promise<StandingRow[]> {
  const tryUrls = [
    'https://api.jolpi.ca/ergast/f1/current/constructorstandings.json',
    'https://api.jolpi.ca/ergast/f1/2025/constructorstandings.json',
  ];

  let standingsList: any[] = [];
  for (const url of tryUrls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      standingsList = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
      if (standingsList.length > 0) break;
    } catch {
      // try next URL
    }
  }

  if (standingsList.length === 0) return [];

  return standingsList.map((s: any): StandingRow => {
    const constructorId = s.Constructor?.constructorId ?? '';
    const teamId        = F1_ERGAST_CONSTRUCTOR_TO_TEAM_ID[constructorId];
    const constructorTeam = teamId ? F1_CONSTRUCTOR_TEAMS.find(t => t.id === teamId) : undefined;

    return {
      name:         s.Constructor?.name ?? '',
      teamId,
      position:     parseInt(s.position, 10),
      played:       0,
      wins:         parseInt(s.wins ?? '0', 10),
      draws:        0,
      losses:       0,
      points:       parseFloat(s.points ?? '0'),
      primaryColor: constructorTeam?.primaryColor,
      secondaryColor: constructorTeam?.secondaryColor,
    } as StandingRow & { primaryColor?: string; secondaryColor?: string };
  });
}

// ─── BBL — ESPN public API (league ID: 8044) ──────────────────────────────────

const BBL_ESPN_TO_ID: Record<string, string> = {
  'Perth Scorchers':    'bbl-scorchers',
  'Sydney Sixers':      'bbl-sixers',
  'Hobart Hurricanes':  'bbl-hurricanes',
  'Brisbane Heat':      'bbl-heat',
  'Adelaide Strikers':  'bbl-strikers',
  'Melbourne Stars':    'bbl-stars',
  'Melbourne Renegades':'bbl-renegades',
  'Sydney Thunder':     'bbl-thunder',
};

async function fetchBBLStandings(): Promise<StandingRow[]> {
  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/cricket/8044/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];
  const data    = await res.json();
  const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
  const stat = (e: any, n: string) =>
    (e.stats as any[])?.find((s: any) => s.name === n)?.value ?? 0;
  return entries.map((e, i): StandingRow => {
    const cur  = i + 1;
    const prev = typeof e.previousRank === 'number' ? e.previousRank : undefined;
    const nrr  = stat(e, 'netrr');
    return {
      name:       e.team?.displayName ?? '',
      teamId:     BBL_ESPN_TO_ID[e.team?.displayName ?? ''],
      position:   cur,
      played:     stat(e, 'matchesPlayed'),
      wins:       stat(e, 'matchesWon'),
      draws:      stat(e, 'matchesTied') + stat(e, 'noresult'),
      losses:     stat(e, 'matchesLost'),
      points:     stat(e, 'matchPoints'),
      percentage: nrr !== 0 ? Math.round(nrr * 1000) / 1000 : undefined,  // Net Run Rate
      rankChange: prev !== undefined ? prev - cur : undefined,
    };
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1', 'bbl']);

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  const type   = req.nextUrl.searchParams.get('type') ?? 'drivers';
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
    else if (league === 'f1' && type === 'constructors') rows = await fetchF1ConstructorStandings();
    else if (league === 'f1')          rows = await fetchF1Standings();
    else if (league === 'bbl')         rows = await fetchBBLStandings();

    return NextResponse.json(rows, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/standings]', err);
    return NextResponse.json([]);
  }
}
