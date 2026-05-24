/**
 * GET /api/results?league=afl&teamId=afl-lions
 *
 * Returns the last 5 completed results for a team across ALL competitions.
 * AFL  → Squiggle API (free, no key) — filters completed games server-side.
 * EPL  → ESPN public API — fans out across PL, FA Cup, EFL Cup, UCL, UEL.
 *
 * Returns GameResult[] — same shape as mock-data.ts getRecentResults().
 */

import { NextRequest, NextResponse } from 'next/server';
import type { GameResult } from '@/types';
import { COUNTRY_TO_ABBR } from '@/lib/f1-data';
import { TEAM_LOGOS } from '@/lib/team-logos';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' };

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function unknownTeam(name: string): { color: string; abbr: string } {
  const words = name.trim().split(/\s+/);
  const abbr  = words.length >= 2
    ? words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
    : name.slice(0, 3).toUpperCase();
  return { color: '#6B7280', abbr };
}

function parseCricketFormat(eventType: string): 'test' | 'odi' | 't20' {
  const t = (eventType ?? '').toLowerCase();
  if (t.includes('twenty') || t === 't20' || t.includes('t20')) return 't20';
  if (t.includes('one day') || t.includes('odi') || t.includes('list a')) return 'odi';
  if (t.includes('test') || t.includes('first class') || t.includes('first-class')) return 'test';
  return 't20';
}

function espnDateRange(daysBack: number, daysForward: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 86400000);
  const end   = new Date(now.getTime() + daysForward * 86400000);
  return `${fmt(start)}-${fmt(end)}`;
}

// ─── AFL — Squiggle API ───────────────────────────────────────────────────────

const SQUIGGLE_NAME: Record<string, string> = {
  'afl-crows':     'Adelaide',
  'afl-lions':     'Brisbane Lions',
  'afl-blues':     'Carlton',
  'afl-pies':      'Collingwood',
  'afl-bombers':   'Essendon',
  'afl-dockers':   'Fremantle',
  'afl-cats':      'Geelong',
  'afl-suns':      'Gold Coast',
  'afl-giants':    'GWS Giants',
  'afl-hawks':     'Hawthorn',
  'afl-demons':    'Melbourne',
  'afl-kangaroos': 'North Melbourne',
  'afl-power':     'Port Adelaide',
  'afl-tigers':    'Richmond',
  'afl-saints':    'St Kilda',
  'afl-swans':     'Sydney',
  'afl-eagles':    'West Coast',
  'afl-dogs':      'Western Bulldogs',
};

const AFL_CDN = 'https://a.espncdn.com/i/teamlogos/afl/500';

const AFL_TEAM: Record<string, { color: string; abbr: string; logo: string }> = {
  'Adelaide':         { color: '#013A6E', abbr: 'ADL', logo: `${AFL_CDN}/adel.png` },
  'Brisbane Lions':   { color: '#A30046', abbr: 'BRI', logo: `${AFL_CDN}/bl.png`   },
  'Carlton':          { color: '#0E1E2E', abbr: 'CAR', logo: `${AFL_CDN}/carl.png` },
  'Collingwood':      { color: '#000000', abbr: 'COL', logo: `${AFL_CDN}/coll.png` },
  'Essendon':         { color: '#CC2031', abbr: 'ESS', logo: `${AFL_CDN}/ess.png`  },
  'Fremantle':        { color: '#2A1A5E', abbr: 'FRE', logo: `${AFL_CDN}/fre.png`  },
  'Geelong':          { color: '#001F5B', abbr: 'GEE', logo: `${AFL_CDN}/geel.png` },
  'Gold Coast':       { color: '#E8312D', abbr: 'GCS', logo: `${AFL_CDN}/suns.png` },
  'GWS Giants':       { color: '#F47B20', abbr: 'GWS', logo: `${AFL_CDN}/gws.png`  },
  'Hawthorn':         { color: '#4D2004', abbr: 'HAW', logo: `${AFL_CDN}/haw.png`  },
  'Melbourne':        { color: '#CC2031', abbr: 'MEL', logo: `${AFL_CDN}/melb.png` },
  'North Melbourne':  { color: '#003088', abbr: 'NME', logo: `${AFL_CDN}/nmfc.png` },
  'Port Adelaide':    { color: '#000000', abbr: 'PAD', logo: `${AFL_CDN}/port.png` },
  'Richmond':         { color: '#FFD200', abbr: 'RIC', logo: `${AFL_CDN}/rich.png` },
  'St Kilda':         { color: '#ED0F05', abbr: 'STK', logo: `${AFL_CDN}/stk.png`  },
  'Sydney':           { color: '#ED171F', abbr: 'SYD', logo: `${AFL_CDN}/syd.png`  },
  'West Coast':       { color: '#003087', abbr: 'WCE', logo: `${AFL_CDN}/wce.png`  },
  'Western Bulldogs': { color: '#014896', abbr: 'WBD', logo: `${AFL_CDN}/wb.png`   },
};

async function fetchAFLResults(teamId: string): Promise<GameResult[]> {
  const sqName = SQUIGGLE_NAME[teamId];
  if (!sqName) return [];

  const year = new Date().getFullYear();
  const res  = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const { games = [] } = await res.json();

  const completed = (games as any[])
    .filter(g =>
      (g.hteam === sqName || g.ateam === sqName) &&
      Number(g.complete) === 100,
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return completed.map((g): GameResult => {
    const isHome     = g.hteam === sqName;
    const teamScore  = isHome ? Number(g.hscore) : Number(g.ascore);
    const oppScore   = isHome ? Number(g.ascore) : Number(g.hscore);
    const oppName    = isHome ? g.ateam : g.hteam;
    const opp        = AFL_TEAM[oppName] ?? unknownTeam(oppName);
    const tz         = (g.tz as string) ?? '+10:00';
    const parsedDate = new Date(g.date.replace(' ', 'T') + tz);

    return {
      opponent:       oppName,
      opponentAbbr:   opp.abbr,
      opponentLogoUrl: opp.logo,
      isHome,
      isWin:          teamScore > oppScore,
      teamScore,
      opponentScore:  Math.max(0, oppScore),
      date:           parsedDate.toISOString(),
    };
  });
}

// ─── NRL — ESPN public API (league ID: 3) ────────────────────────────────────

/** Maps our team ID → ESPN displayName (short name used in scoreboard). */
const NRL_ESPN_NAME: Record<string, string> = {
  'nrl-broncos':   'Broncos',
  'nrl-raiders':   'Raiders',
  'nrl-bulldogs':  'Bulldogs',
  'nrl-sharks':    'Sharks',
  'nrl-dolphins':  'Dolphins',
  'nrl-titans':    'Titans',
  'nrl-eels':      'Eels',
  'nrl-panthers':  'Panthers',
  'nrl-seahawks':  'Sea Eagles',
  'nrl-storm':     'Storm',
  'nrl-knights':   'Knights',
  'nrl-warriors':  'Warriors',
  'nrl-cowboys':   'Cowboys',
  'nrl-rabbitohs': 'Rabbitohs',
  'nrl-dragons':   'Dragons',
  'nrl-roosters':  'Roosters',
  'nrl-tigers':    'Wests Tigers',
};

async function fetchNRLResults(teamId: string): Promise<GameResult[]> {
  const teamName = NRL_ESPN_NAME[teamId];
  if (!teamName) return [];

  // 120-day lookback — NRL only has one competition so no fanout needed
  const now   = new Date();
  const start = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(start)}-${fmt(now)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const events = ((data.events ?? []) as any[]).filter(e => {
    const completed    = e.status?.type?.completed === true;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return completed && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return events
    .map((e: any): GameResult => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');

      const homeTeamName = home?.team?.displayName ?? '';
      const isHome       = homeTeamName === teamName;
      const ourComp      = isHome ? home : away;
      const oppComp      = isHome ? away : home;

      const oppName   = oppComp?.team?.displayName ?? 'Unknown';
      const teamScore = Number(ourComp?.score ?? 0);
      const oppScore  = Number(oppComp?.score ?? 0);

      return {
        opponent:        oppName,
        opponentAbbr:    oppComp?.team?.abbreviation ?? oppName.slice(0, 3).toUpperCase(),
        opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined),
        isHome,
        isWin:           teamScore > oppScore,
        teamScore,
        opponentScore:   oppScore,
        date:            new Date(e.date).toISOString(),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── State of Origin results ──────────────────────────────────────────────────

const SOO_RESULT_META: Record<string, { self: string; opponent: string; oppAbbr: string; oppColor: string; oppLogoUrl: string }> = {
  'nrl-maroons': {
    self: 'Queensland', opponent: 'New South Wales',
    oppAbbr: 'NSW', oppColor: '#003DA5',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289317.png',
  },
  'nrl-blues': {
    self: 'New South Wales', opponent: 'Queensland',
    oppAbbr: 'QLD', oppColor: '#6B0000',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289318.png',
  },
};

async function fetchSOOResults(teamId: string): Promise<GameResult[]> {
  const meta = SOO_RESULT_META[teamId];
  if (!meta) return [];

  const year  = new Date().getFullYear();
  const start = `${year}0415`;
  const end   = `${year}0901`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${start}-${end}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();

  const allSOO = ((data.events ?? []) as any[])
    .filter((e: any) => {
      const comps: any[] = e.competitions?.[0]?.competitors ?? [];
      return (
        comps.some(c => c.team?.displayName === 'Queensland') &&
        comps.some(c => c.team?.displayName === 'New South Wales')
      );
    })
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const completed = allSOO.filter((e: any) => e.status?.type?.completed === true);

  return completed.map((e: any, idx: number): GameResult => {
    const gameNum  = idx + 1;
    const comp     = e.competitions?.[0] ?? {};
    const comps: any[] = comp.competitors ?? [];
    const selfC    = comps.find(c => c.team?.displayName === meta.self);
    const oppC     = comps.find(c => c.team?.displayName === meta.opponent);
    const isHome   = selfC?.homeAway === 'home';
    const selfPts  = Number(selfC?.score ?? 0);
    const oppPts   = Number(oppC?.score  ?? 0);

    return {
      opponent:        meta.opponent,
      opponentAbbr:    meta.oppAbbr,
      opponentLogoUrl: meta.oppLogoUrl,
      isHome,
      isWin:           selfPts > oppPts,
      teamScore:       selfPts,
      opponentScore:   oppPts,
      date:            new Date(e.date).toISOString(),
      competition:     `State of Origin — Game ${gameNum}`,
    };
  }).reverse(); // most recent first
}

// ─── EPL — ESPN public API ────────────────────────────────────────────────────

const ESPN_TEAM_NAME: Record<string, string> = {
  'epl-arsenal':       'Arsenal',
  'epl-astonvilla':    'Aston Villa',
  'epl-bournemouth':   'AFC Bournemouth',
  'epl-brentford':     'Brentford',
  'epl-brighton':      'Brighton & Hove Albion',
  'epl-burnley':       'Burnley',
  'epl-chelsea':       'Chelsea',
  'epl-crystalpalace': 'Crystal Palace',
  'epl-everton':       'Everton',
  'epl-fulham':        'Fulham',
  'epl-leeds':         'Leeds United',
  'epl-liverpool':     'Liverpool',
  'epl-mancity':       'Manchester City',
  'epl-manutd':        'Manchester United',
  'epl-newcastle':     'Newcastle United',
  'epl-forest':        'Nottingham Forest',
  'epl-spurs':         'Tottenham Hotspur',
  'epl-sunderland':    'Sunderland',
  'epl-westham':       'West Ham United',
  'epl-wolves':        'Wolverhampton Wanderers',
};

const EPL_TEAM: Record<string, { color: string; abbr: string }> = {
  'Arsenal':                    { color: '#EF0107', abbr: 'ARS' },
  'Aston Villa':                { color: '#670E36', abbr: 'AVL' },
  'AFC Bournemouth':            { color: '#DA291C', abbr: 'BOU' },
  'Brentford':                  { color: '#E30613', abbr: 'BRE' },
  'Brighton & Hove Albion':     { color: '#0057B8', abbr: 'BHA' },
  'Burnley':                    { color: '#6C1D45', abbr: 'BUR' },
  'Chelsea':                    { color: '#034694', abbr: 'CHE' },
  'Crystal Palace':             { color: '#1B458F', abbr: 'CRY' },
  'Everton':                    { color: '#003399', abbr: 'EVE' },
  'Fulham':                     { color: '#000000', abbr: 'FUL' },
  'Leeds United':               { color: '#FFCD00', abbr: 'LEE' },
  'Liverpool':                  { color: '#C8102E', abbr: 'LIV' },
  'Manchester City':            { color: '#6CABDD', abbr: 'MCI' },
  'Manchester United':          { color: '#DA291C', abbr: 'MUN' },
  'Newcastle United':           { color: '#241F20', abbr: 'NEW' },
  'Nottingham Forest':          { color: '#DD0000', abbr: 'NFO' },
  'Sunderland':                 { color: '#EB172B', abbr: 'SUN' },
  'Tottenham Hotspur':          { color: '#132257', abbr: 'TOT' },
  'West Ham United':            { color: '#7A263A', abbr: 'WHU' },
  'Wolverhampton Wanderers':    { color: '#FDB913', abbr: 'WOL' },
};

const ESPN_COMPETITIONS = [
  { slug: 'eng.1',           label: 'Premier League' },
  { slug: 'eng.fa',          label: 'FA Cup' },
  { slug: 'eng.league_cup',  label: 'EFL Cup' },
  { slug: 'uefa.champions',  label: 'Champions League' },
  { slug: 'uefa.europa',     label: 'Europa League' },
];

async function fetchESPNResultsForSlug(
  teamName: string,
  slug: string,
  label: string,
  range: string,
): Promise<GameResult[]> {
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data   = await res.json();
  const events = ((data.events ?? []) as any[]).filter(e => {
    const completed    = e.status?.type?.completed === true;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return completed && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return events.map((e: any): GameResult => {
    const comp:        any   = e.competitions?.[0] ?? {};
    const competitors: any[] = comp.competitors ?? [];
    const home = competitors.find((c: any) => c.homeAway === 'home');
    const away = competitors.find((c: any) => c.homeAway === 'away');

    const homeTeamName = home?.team?.displayName ?? '';
    const isHome       = homeTeamName === teamName;
    const ourComp      = isHome ? home : away;
    const oppComp      = isHome ? away : home;

    const oppName    = oppComp?.team?.displayName ?? 'Unknown';
    const opp        = EPL_TEAM[oppName] ?? unknownTeam(oppName);
    const teamScore  = Number(ourComp?.score ?? 0);
    const oppScore   = Number(oppComp?.score ?? 0);

    // Use ESPN's winner field — correctly handles penalty shootouts in cup knockout
    // ties (e.g. 3-3 AET → one team is marked winner=true, the other is not).
    // For regular-season draws, neither team has winner=true → isDraw = true.
    const ourWinner = ourComp?.winner === true || ourComp?.winner === 'true';
    const oppWinner = oppComp?.winner === true || oppComp?.winner === 'true';
    const isDraw    = !ourWinner && !oppWinner;
    // Penalty win: cup game where our team won but scores are level (e.g. 3-3 after ET)
    const isPenWin  = ourWinner && teamScore === oppScore;

    return {
      opponent:        oppName,
      opponentAbbr:    opp.abbr,
      opponentLogoUrl: (oppComp?.team?.logo as string | undefined) ?? undefined,
      isHome,
      isWin:           ourWinner,
      isDraw:          isDraw || undefined,
      teamScore,
      opponentScore:   oppScore,
      date:            new Date(e.date).toISOString(),
      competition:     label === 'Premier League'
        ? undefined
        : isPenWin
          ? `${label} (Pens)`
          : label,
    };
  });
}

async function fetchEPLResults(teamId: string): Promise<GameResult[]> {
  const teamName = ESPN_TEAM_NAME[teamId];
  if (!teamName) return [];

  // 120-day lookback — wide enough to cover a full recent run across all cups
  const now   = new Date();
  const start = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(start)}-${fmt(now)}`;

  const results = await Promise.allSettled(
    ESPN_COMPETITIONS.map(({ slug, label }) =>
      fetchESPNResultsForSlug(teamName, slug, label, range),
    ),
  );

  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Deduplicate by (date + opponent) in case the same game appears in two feeds
  const seen   = new Set<string>();
  const unique = all.filter(r => {
    const key = `${r.date}-${r.opponent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── Super Rugby — ESPN public API (league ID: 242041) ───────────────────────

const SRU_ESPN_NAME: Record<string, string> = {
  'sru-brumbies':    'Brumbies',
  'sru-reds':        'Queensland Reds',
  'sru-waratahs':    'New South Wales Waratahs',
  'sru-force':       'Western Force',
  'sru-blues':       'Blues',
  'sru-chiefs':      'Chiefs',
  'sru-crusaders':   'Crusaders',
  'sru-highlanders': 'Highlanders',
  'sru-hurricanes':  'Hurricanes',
  'sru-drua':        'Fijian Drua',
  'sru-moana':       'Moana Pasifika',
};

const SRU_CDN = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';
const SRU_OPP_LOGO: Record<string, string> = {
  'Brumbies':                 `${SRU_CDN}/25889.png`,
  'ACT Brumbies':             `${SRU_CDN}/25889.png`,
  'Queensland Reds':          `${SRU_CDN}/182.png`,
  'Reds':                     `${SRU_CDN}/182.png`,
  'New South Wales Waratahs': `${SRU_CDN}/227.png`,
  'Waratahs':                 `${SRU_CDN}/227.png`,
  'NSW Waratahs':             `${SRU_CDN}/227.png`,
  'Western Force':            `${SRU_CDN}/25893.png`,
  'Force':                    `${SRU_CDN}/25893.png`,
  'Blues':                    `${SRU_CDN}/25932.png`,
  'Chiefs':                   `${SRU_CDN}/25934.png`,
  'Crusaders':                `${SRU_CDN}/25936.png`,
  'Highlanders':              `${SRU_CDN}/25938.png`,
  'Hurricanes':               `${SRU_CDN}/25939.png`,
  'Fijian Drua':              `${SRU_CDN}/289338.png`,
  'Drua':                     `${SRU_CDN}/289338.png`,
  'Moana Pasifika':           `${SRU_CDN}/289319.png`,
};

async function fetchSuperRugbyResults(teamId: string): Promise<GameResult[]> {
  const teamName = SRU_ESPN_NAME[teamId];
  if (!teamName) return [];

  // 120-day lookback
  const now   = new Date();
  const start = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(start)}-${fmt(now)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/242041/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const matchesTeam = (c: any) =>
    c.team?.displayName === teamName || c.team?.name === teamName;

  const events = ((data.events ?? []) as any[]).filter(e => {
    const completed    = e.status?.type?.completed === true;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return completed && competitors.some(matchesTeam);
  });

  return events
    .map((e: any): GameResult => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find(matchesTeam);
      const oppComp = competitors.find((c: any) => !matchesTeam(c));
      const isHome  = ourComp?.homeAway === 'home';
      const oppName = oppComp?.team?.displayName ?? 'Unknown';
      const teamScore = Number(ourComp?.score ?? 0);
      const oppScore  = Number(oppComp?.score ?? 0);

      return {
        opponent:        oppName,
        opponentAbbr:    oppComp?.team?.abbreviation ?? oppName.slice(0, 3).toUpperCase(),
        opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined)
          ?? SRU_OPP_LOGO[oppName],
        isHome,
        isWin:           teamScore > oppScore,
        teamScore,
        opponentScore:   oppScore,
        date:            new Date(e.date).toISOString(),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── International Rugby Union — ESPN public API ──────────────────────────────

const RINT_ESPN_NAME_R: Record<string, string> = {
  'rint-wallabies': 'Australia',
  'rint-allblacks': 'New Zealand',
  'rint-boks':      'South Africa',
  'rint-england':   'England',
  'rint-ireland':   'Ireland',
  'rint-france':    'France',
  'rint-scotland':  'Scotland',
  'rint-wales':     'Wales',
  'rint-argentina': 'Argentina',
  'rint-fiji':      'Fiji',
  'rint-samoa':     'Samoa',
  'rint-tonga':     'Tonga',
};

const RINT_CDN_R = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';
const RINT_OPP_LOGO_R: Record<string, string> = {
  'Australia':    `${RINT_CDN_R}/6.png`,
  'New Zealand':  `${RINT_CDN_R}/8.png`,
  'South Africa': `${RINT_CDN_R}/5.png`,
  'England':      `${RINT_CDN_R}/1.png`,
  'Ireland':      `${RINT_CDN_R}/3.png`,
  'France':       `${RINT_CDN_R}/9.png`,
  'Scotland':     `${RINT_CDN_R}/2.png`,
  'Wales':        `${RINT_CDN_R}/4.png`,
  'Argentina':    `${RINT_CDN_R}/10.png`,
  'Fiji':         `${RINT_CDN_R}/14.png`,
  'Samoa':        `${RINT_CDN_R}/15.png`,
  'Tonga':        `${RINT_CDN_R}/16.png`,
  'Italy':        `${RINT_CDN_R}/20.png`,
  'Japan':        `${RINT_CDN_R}/23.png`,
  'United States':`${RINT_CDN_R}/11.png`,
  'Georgia':      `${RINT_CDN_R}/81.png`,
  'Namibia':      `${RINT_CDN_R}/82.png`,
};

const RINT_RC_TEAMS  = new Set(['rint-wallabies', 'rint-allblacks', 'rint-boks', 'rint-argentina']);
const RINT_SN_TEAMS  = new Set(['rint-england', 'rint-ireland', 'rint-france', 'rint-scotland', 'rint-wales']);

async function fetchRintResultsComp(
  teamName: string,
  compId: string,
  range: string,
): Promise<GameResult[]> {
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/${compId}/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const matchesTeam = (c: any) =>
    c.team?.displayName === teamName || c.team?.name === teamName;

  return ((data.events ?? []) as any[])
    .filter(e => e.status?.type?.completed === true &&
      (e.competitions?.[0]?.competitors ?? []).some(matchesTeam))
    .map((e: any): GameResult => {
      const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
      const ourComp = competitors.find(matchesTeam);
      const oppComp = competitors.find((c: any) => !matchesTeam(c));
      const isHome    = ourComp?.homeAway === 'home';
      const oppName   = oppComp?.team?.displayName ?? 'Unknown';
      const teamScore = Number(ourComp?.score ?? 0);
      const oppScore  = Number(oppComp?.score ?? 0);

      return {
        opponent:        oppName,
        opponentAbbr:    oppComp?.team?.abbreviation ?? oppName.slice(0, 3).toUpperCase(),
        opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined)
          ?? RINT_OPP_LOGO_R[oppName],
        isHome,
        isWin:           teamScore > oppScore,
        teamScore,
        opponentScore:   oppScore,
        date:            new Date(e.date).toISOString(),
      };
    });
}

async function fetchInternationalRugbyResults(teamId: string): Promise<GameResult[]> {
  const teamName = RINT_ESPN_NAME_R[teamId];
  if (!teamName) return [];

  const now   = new Date();
  const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 1-year lookback
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(start)}-${fmt(now)}`;

  const compIds = ['289234']; // always include int'l tests
  if (RINT_RC_TEAMS.has(teamId)) compIds.push('244293');
  if (RINT_SN_TEAMS.has(teamId)) compIds.push('180659');

  const results = await Promise.allSettled(
    compIds.map(id => fetchRintResultsComp(teamName, id, range)),
  );

  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Dedup by date + opponent (same game may appear in multiple competition feeds)
  const seen   = new Set<string>();
  const unique = all.filter(r => {
    const key = `${r.date.slice(0, 10)}-${r.opponent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── Cross-league soccer results (by team display name) ──────────────────────
//
// Used when an EPL/UCL/UEL opponent is from a foreign domestic league (e.g.
// Bayer Leverkusen in the UCL). Fans out across major European competitions
// by filtering ESPN scoreboards for the team's display name — the same name
// that appeared in the fixture, so no extra mapping is needed.

const CROSS_SOCCER_COMPS = [
  // English lower divisions — covers relegated EPL clubs and cup opponents
  { slug: 'eng.2',          label: 'Championship' },
  { slug: 'eng.3',          label: 'League One' },
  { slug: 'eng.fa',         label: 'FA Cup' },
  { slug: 'eng.league_cup', label: 'EFL Cup' },
  // Major European domestic leagues
  { slug: 'ger.1',          label: 'Bundesliga' },
  { slug: 'esp.1',          label: 'La Liga' },
  { slug: 'fra.1',          label: 'Ligue 1' },
  { slug: 'ita.1',          label: 'Serie A' },
  { slug: 'por.1',          label: 'Primeira Liga' },
  { slug: 'ned.1',          label: 'Eredivisie' },
  { slug: 'sco.1',          label: 'Scottish Prem' },
  { slug: 'uefa.champions', label: 'Champions League' },
  { slug: 'uefa.europa',    label: 'Europa League' },
];

async function fetchCrossLeagueSoccerResults(teamName: string): Promise<GameResult[]> {
  const now   = new Date();
  const start = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(start)}-${fmt(now)}`;

  const settled = await Promise.allSettled(
    CROSS_SOCCER_COMPS.map(({ slug, label }) =>
      fetchESPNResultsForSlug(teamName, slug, label, range),
    ),
  );

  const all = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  const seen   = new Set<string>();
  const unique = all.filter(r => {
    const key = `${r.date.slice(0, 10)}-${r.opponent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── Formula 1 — Jolpi Ergast API ────────────────────────────────────────────
//
// Returns last 5 completed race results with the followed driver's or
// constructor's actual finishing position (P1, P3, DNF, etc.).

import { F1_DRIVER_IDS, F1_CONSTRUCTOR_IDS, isF1ConstructorTeam } from '@/lib/f1-data';

/** Map Ergast positionText → display label. */
function ergastPosLabel(posText: string): string {
  const n = parseInt(posText, 10);
  if (!isNaN(n)) return `P${n}`;
  if (posText === 'R') return 'DNF';
  if (posText === 'D') return 'DSQ';
  if (posText === 'N') return 'NC';
  if (posText === 'W') return 'DNS';
  return posText || 'DNF';
}

async function fetchF1Results(teamId: string): Promise<GameResult[]> {
  const tryUrls = [
    'https://api.jolpi.ca/ergast/f1/current/results.json?limit=100',
    'https://api.jolpi.ca/ergast/f1/2025/results.json?limit=100',
  ];

  let races: any[] = [];
  for (const url of tryUrls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      races = data?.MRData?.RaceTable?.Races ?? [];
      if (races.length > 0) break;
    } catch {
      // try next URL
    }
  }

  if (races.length === 0) return [];

  // Determine whether we're following a specific driver or a constructor
  const ergastDriverId: string | undefined = F1_DRIVER_IDS[teamId];
  const isConstructor = isF1ConstructorTeam(teamId);
  // Constructor ID for Ergast (e.g. 'red_bull', 'ferrari') — derived from division name
  // stored in constructor team objects. Map via F1_CONSTRUCTOR_IDS keyed by display name.
  // teamId format: 'f1-team-redbull' → division 'Red Bull Racing' → ergast 'red_bull'
  const CONSTRUCTOR_ERGAST: Record<string, string> = Object.fromEntries(
    Object.entries(F1_CONSTRUCTOR_IDS).map(([name, id]) => [
      // Build the team-id equivalent key for lookup
      `f1-team-${id.replace(/_/g, '')}`,
      id,
    ]),
  );
  // Also handle common mismatches (e.g. 'rb' for racing bulls stored as 'racingbulls')
  const CONSTRUCTOR_ERGAST_OVERRIDES: Record<string, string> = {
    'f1-team-racingbulls': 'rb',
    'f1-team-redbull':     'red_bull',
    'f1-team-astonmartin': 'aston_martin',
    'f1-team-sauber':      'sauber',
  };
  const ergastConstructorId: string | undefined = isConstructor
    ? (CONSTRUCTOR_ERGAST_OVERRIDES[teamId] ?? CONSTRUCTOR_ERGAST[teamId])
    : undefined;

  // Filter to completed races only (race date in the past + results present)
  const now = Date.now();
  const completed = races.filter((race: any) =>
    new Date(race.date).getTime() < now && Array.isArray(race.Results) && race.Results.length > 0,
  );

  return completed
    .slice(-5)
    .reverse()
    .map((race: any): GameResult => {
      const country = race.Circuit?.Location?.country ?? '';
      const abbr    = COUNTRY_TO_ABBR[country] ?? country.slice(0, 3).toUpperCase();
      const results: any[] = race.Results ?? [];

      let f1Position: string;
      let isWin = false;

      if (ergastDriverId) {
        // Driver follow — find their specific result
        const driverResult = results.find(
          (r: any) => r.Driver?.driverId === ergastDriverId,
        );
        f1Position = driverResult
          ? ergastPosLabel(driverResult.positionText ?? '')
          : 'DNS';
        isWin = f1Position === 'P1';
      } else if (ergastConstructorId) {
        // Constructor follow — find best result from either team car
        const teamResults = results.filter(
          (r: any) => r.Constructor?.constructorId === ergastConstructorId,
        );
        if (teamResults.length === 0) {
          f1Position = 'DNS';
        } else {
          // Best position = lowest number (or any classified finisher)
          const classified = teamResults.filter((r: any) => !isNaN(parseInt(r.positionText, 10)));
          if (classified.length > 0) {
            const best = classified.reduce((a: any, b: any) =>
              parseInt(a.positionText, 10) < parseInt(b.positionText, 10) ? a : b,
            );
            f1Position = ergastPosLabel(best.positionText);
            isWin = f1Position === 'P1';
          } else {
            f1Position = 'DNF';
          }
        }
      } else {
        // Championship/unknown — show race winner for context
        const winner = results[0];
        const winnerName = winner
          ? `${winner.Driver?.givenName ?? ''} ${winner.Driver?.familyName ?? ''}`.trim()
          : '';
        f1Position = 'P1';
        isWin = true;
        return {
          opponent:      race.raceName,
          opponentAbbr:  abbr,
          isHome:        false,
          isWin:         true,
          teamScore:     1,
          opponentScore: 20,
          date:          new Date(race.date).toISOString(),
          competition:   winnerName ? `Winner: ${winnerName}` : 'Formula 1',
          f1Position:    'P1',
        };
      }

      return {
        opponent:      race.raceName,
        opponentAbbr:  abbr,
        isHome:        false,
        isWin,
        teamScore:     parseInt(f1Position.replace('P', '')) || 20,
        opponentScore: 20,
        date:          new Date(race.date).toISOString(),
        f1Position,
      };
    });
}

// ─── BBL — ESPN public API (league ID: 8044) ──────────────────────────────────

const BBL_RESULTS_ESPN_NAME: Record<string, string> = {
  'bbl-scorchers':  'Perth Scorchers',
  'bbl-sixers':     'Sydney Sixers',
  'bbl-hurricanes': 'Hobart Hurricanes',
  'bbl-heat':       'Brisbane Heat',
  'bbl-strikers':   'Adelaide Strikers',
  'bbl-stars':      'Melbourne Stars',
  'bbl-renegades':  'Melbourne Renegades',
  'bbl-thunder':    'Sydney Thunder',
};
const BBL_RESULTS_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(BBL_RESULTS_ESPN_NAME).map(([id, name]) => [name, id]),
);

async function fetchBBLResults(teamId: string): Promise<GameResult[]> {
  const teamName = BBL_RESULTS_ESPN_NAME[teamId];
  if (!teamName) return [];

  const range = espnDateRange(200, 0); // look 200 days back (full season)
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/cricket/8044/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const events = ((data.events ?? []) as any[]).filter((e: any) => {
    const state       = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return state === 'post' && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return events
    .map((e: any): GameResult => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find((c: any) => c.team?.displayName === teamName);
      const oppComp = competitors.find((c: any) => c.team?.displayName !== teamName);
      const isHome  = ourComp?.homeAway === 'home';
      const isWin   = ourComp?.winner === 'true' || ourComp?.winner === true;
      const oppName = oppComp?.team?.displayName ?? 'Unknown';

      const rawScore    = (ourComp?.score ?? '') as string;
      const rawOppScore = (oppComp?.score ?? '') as string;
      // Extract runs for the numeric field (used for sorting / form dots)
      const parseRuns = (s: string) => { const m = /^(\d+)/.exec(s); return m ? parseInt(m[1], 10) : 0; };

      const eventType = comp.class?.eventType ?? comp.class?.name ?? 'T20';
      const fmt = parseCricketFormat(eventType);
      const resultSummary = (comp.status?.summary ?? '') as string;

      // Build innings array from linescores if available
      const innings: Array<{ team: string; score: string; overs?: number }> = [];
      (ourComp?.linescores ?? []).forEach((ls: any) => {
        innings.push({ team: teamName, score: `${ls.runs ?? 0}/${ls.wickets ?? 0}`, overs: ls.overs });
      });
      (oppComp?.linescores ?? []).forEach((ls: any) => {
        innings.push({ team: oppName, score: `${ls.runs ?? 0}/${ls.wickets ?? 0}`, overs: ls.overs });
      });

      const oppId = BBL_RESULTS_DISP_TO_ID[oppName];
      return {
        opponent:        oppName,
        opponentAbbr:    oppComp?.team?.abbreviation ?? unknownTeam(oppName).abbr,
        opponentLogoUrl: TEAM_LOGOS[oppId ?? ''] ?? (oppComp?.team?.logo as string | undefined),
        opponentId:      oppId,
        isHome,
        isWin,
        isDraw:          !ourComp?.winner && !oppComp?.winner && comp.status?.type?.state === 'post',
        teamScore:       parseRuns(rawScore),
        opponentScore:   parseRuns(rawOppScore),
        date:            new Date(e.date).toISOString(),
        cricketScore:    rawScore || undefined,
        cricketOppScore: rawOppScore || undefined,
        cricketResult:   resultSummary || undefined,
        cricketFormat:   fmt,
        cricketInnings:  innings.length > 0 ? innings : undefined,
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── International Cricket — ESPN per-team series results ────────────────────
//
// Uses the same series/event ID map as the fixtures route.
// For completed matches the scoreboard returns the most recently finished event,
// so we also try individual event IDs (same CRICKET_INT_EVENT_IDS map) to
// surface full series history.

const CRICKET_INT_RESULTS_ESPN_NAME: Record<string, string> = {
  'int-aus': 'Australia',
  'int-eng': 'England',
  'int-ind': 'India',
  'int-pak': 'Pakistan',
  'int-nz':  'New Zealand',
  'int-sa':  'South Africa',
  'int-sl':  'Sri Lanka',
  'int-wi':  'West Indies',
  'int-ban': 'Bangladesh',
  'int-zim': 'Zimbabwe',
  'int-ire': 'Ireland',
  'int-afg': 'Afghanistan',
};
const CRICKET_INT_RESULTS_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CRICKET_INT_RESULTS_ESPN_NAME).map(([id, name]) => [name, id]),
);

// Per-team series IDs for results (same as fixtures, including recently completed ICC events)
const CRICKET_INT_RESULTS_TEAM_SERIES: Partial<Record<string, number[]>> = {
  'int-aus': [
    8604,     // ICC Men's T20 World Cup 2025/26 (completed Mar 2026)
    24231,    // Bangladesh tour of Australia 2026
    1530201,  // Australia tour of Zimbabwe 2026
    24203,    // Australia tour of South Africa 2026/27
  ],
};
const CRICKET_INT_RESULTS_GENERIC_SERIES = [8037, 8604];

async function fetchCricketIntResults(teamId: string): Promise<GameResult[]> {
  const teamName = CRICKET_INT_RESULTS_ESPN_NAME[teamId];
  if (!teamName) return [];

  const seriesIds = CRICKET_INT_RESULTS_TEAM_SERIES[teamId] ?? CRICKET_INT_RESULTS_GENERIC_SERIES;

  // Fetch the scoreboard (last/current event) for each series
  const allEvents: any[] = [];
  await Promise.allSettled(
    seriesIds.map(async (seriesId) => {
      try {
        const res = await fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard`,
          { next: { revalidate: 3600 } },
        );
        if (!res.ok) return;
        const data = await res.json();
        allEvents.push(...(data.events ?? []));
      } catch { /* skip */ }
    }),
  );

  const completed = allEvents.filter((e: any) => {
    const state       = e.competitions?.[0]?.status?.type?.state ?? '';
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return state === 'post' && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return completed
    .map((e: any): GameResult => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find((c: any) => c.team?.displayName === teamName);
      const oppComp = competitors.find((c: any) => c.team?.displayName !== teamName);
      const isHome  = ourComp?.homeAway === 'home';
      const isWin   = ourComp?.winner === 'true' || ourComp?.winner === true;
      const oppName = oppComp?.team?.displayName ?? 'Unknown';

      const rawScore    = (ourComp?.score ?? '') as string;
      const rawOppScore = (oppComp?.score ?? '') as string;
      const parseRuns = (s: string) => { const m = /^(\d+)/.exec(s); return m ? parseInt(m[1], 10) : 0; };

      const eventType = comp.class?.eventType ?? comp.class?.name ?? '';
      const fmt = parseCricketFormat(eventType);
      const resultSummary = (comp.status?.summary ?? '') as string;
      const seriesName = e.name ?? comp.description ?? '';

      const innings: Array<{ team: string; score: string; overs?: number }> = [];
      (ourComp?.linescores ?? []).forEach((ls: any) => {
        innings.push({ team: teamName, score: `${ls.runs ?? 0}/${ls.wickets ?? 0}`, overs: ls.overs });
      });
      (oppComp?.linescores ?? []).forEach((ls: any) => {
        innings.push({ team: oppName, score: `${ls.runs ?? 0}/${ls.wickets ?? 0}`, overs: ls.overs });
      });

      const oppId = CRICKET_INT_RESULTS_DISP_TO_ID[oppName];
      return {
        opponent:        oppName,
        opponentAbbr:    oppComp?.team?.abbreviation ?? unknownTeam(oppName).abbr,
        // Prefer our internal ICC logo over ESPN's (which returns country flags for int'l cricket)
        opponentLogoUrl: TEAM_LOGOS[oppId ?? ''] ?? (oppComp?.team?.logo as string | undefined),
        opponentId:      oppId,
        isHome,
        isWin,
        isDraw:          !ourComp?.winner && !oppComp?.winner && comp.status?.type?.state === 'post',
        teamScore:       parseRuns(rawScore),
        opponentScore:   parseRuns(rawOppScore),
        date:            new Date(e.date).toISOString(),
        cricketScore:    rawScore || undefined,
        cricketOppScore: rawOppScore || undefined,
        cricketResult:   resultSummary || undefined,
        cricketFormat:   fmt,
        cricketInnings:  innings.length > 0 ? innings : undefined,
        competition:     seriesName || undefined,
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'f1', 'bbl', 'cricket_int']);
const TEAMID_RE = /^[a-z0-9]+-?[a-z0-9_-]*$/;

export async function GET(req: NextRequest) {
  const league   = req.nextUrl.searchParams.get('league') ?? '';
  const teamId   = req.nextUrl.searchParams.get('teamId') ?? '';
  const teamName = req.nextUrl.searchParams.get('teamName') ?? '';

  // Cross-league soccer: look up any European club by display name.
  // Triggered when opponentId is unknown (opponent is from a foreign domestic league).
  if (teamName && !teamId) {
    if (teamName.length > 80 || /[\n\r\0<>{}|\\^`]/.test(teamName)) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }
    try {
      const results = await fetchCrossLeagueSoccerResults(teamName);
      return NextResponse.json(results);
    } catch (err) {
      console.error('[/api/results cross-league]', err);
      return NextResponse.json([]);
    }
  }

  if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    let results: GameResult[] = [];
    if      (league === 'afl')         results = await fetchAFLResults(teamId);
    else if (league === 'nrl' && (teamId === 'nrl-maroons' || teamId === 'nrl-blues')) results = await fetchSOOResults(teamId);
    else if (league === 'nrl')         results = await fetchNRLResults(teamId);
    else if (league === 'epl')         results = await fetchEPLResults(teamId);
    else if (league === 'super_rugby') results = await fetchSuperRugbyResults(teamId);
    else if (league === 'rugby_int')   results = await fetchInternationalRugbyResults(teamId);
    else if (league === 'f1')          results = await fetchF1Results(teamId);
    else if (league === 'bbl')         results = await fetchBBLResults(teamId);
    else if (league === 'cricket_int') results = await fetchCricketIntResults(teamId);

    return NextResponse.json(results, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/results]', err);
    return NextResponse.json([]);
  }
}
