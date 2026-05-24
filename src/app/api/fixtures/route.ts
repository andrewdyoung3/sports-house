/**
 * GET /api/fixtures?league=afl&teamId=afl-lions
 *
 * Fetches real upcoming fixtures for a supported league/team.
 * AFL → Squiggle API (free, no key) — fetch all games for year, filter server-side
 *        (the Squiggle ?team= filter is unreliable for the current season)
 * EPL → ESPN public API (no key) — scoreboard endpoint with 90-day lookahead
 *
 * Returns UpcomingGame[] — same shape as mock-data.ts so the client
 * can drop real data in without changing the display layer.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { UpcomingGame } from '@/types';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { COUNTRY_TO_ABBR } from '@/lib/f1-data';

// 5-minute browser/CDN cache; server-side fetch cache handles upstream revalidation.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' };

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Fetch with a hard timeout (default 8 s). Throws on timeout or network error. */
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

/** Parse ESPN cricket eventType string → 'test' | 'odi' | 't20' */
function parseCricketFormat(eventType: string): 'test' | 'odi' | 't20' {
  const t = (eventType ?? '').toLowerCase();
  if (t.includes('twenty') || t === 't20' || t.includes('t20')) return 't20';
  if (t.includes('one day') || t.includes('odi') || t.includes('list a')) return 'odi';
  if (t.includes('test') || t.includes('first class') || t.includes('first-class')) return 'test';
  return 't20';
}

/** Format date range string YYYYMMDD-YYYYMMDD for ESPN API */
function espnDateRange(daysBack: number, daysForward: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 86400000);
  const end   = new Date(now.getTime() + daysForward * 86400000);
  return `${fmt(start)}-${fmt(end)}`;
}

/** Format a UTC Date shifted to AEST (UTC+10) as a display string. */
function aestDisplay(d: Date): string {
  const h   = d.getUTCHours();
  const m   = d.getUTCMinutes().toString().padStart(2, '0');
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ap} AEST`;
}

/** Fallback for unknown opponents: grey + initials. */
function unknownTeam(name: string): { color: string; abbr: string } {
  const words = name.trim().split(/\s+/);
  const abbr  = words.length >= 2
    ? words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
    : name.slice(0, 3).toUpperCase();
  return { color: '#6B7280', abbr };
}

// ─── AFL — Squiggle API ───────────────────────────────────────────────────────

/** Maps our teamId slug to Squiggle's display name. */
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

const SQUIGGLE_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(SQUIGGLE_NAME).map(([id, name]) => [name, id]),
);

const AFL_CDN = 'https://a.espncdn.com/i/teamlogos/afl/500';

/** AFL team colour, abbreviation + ESPN logo (keyed by Squiggle display name). */
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

// AFL broadcast approximation — real rights vary per game.
const AFL_BROADCAST_ROTATION = [
  ['Seven Network', 'Fox Footy'],
  ['Seven Network'],
  ['Fox Footy'],
];

async function fetchAFL(teamId: string): Promise<UpcomingGame[]> {
  const sqName = SQUIGGLE_NAME[teamId];
  if (!sqName) return [];

  // Fetch all games for the year — the ?team= filter is unreliable for the
  // current season so we filter server-side. Next.js dedupes this URL across
  // all AFL team requests within the same revalidation window.
  const year = new Date().getFullYear();
  const res = await fetchTimeout(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const { games = [] } = await res.json();
  const now = Date.now();
  // Keep games that kicked off within the last 2 hours (so the hero stays
  // visible during the game) and are not yet complete.
  const twoHoursAgo = now - 2 * 3600 * 1000;

  return (games as any[])
    .filter(g =>
      (g.hteam === sqName || g.ateam === sqName) &&
      g.complete < 100 &&
      g.unixtime * 1000 > twoHoursAgo,
    )
    .slice(0, 10)
    .map((g, i): UpcomingGame => {
      const isHome  = g.hteam === sqName;
      const oppName = isHome ? g.ateam : g.hteam;
      const opp     = AFL_TEAM[oppName] ?? unknownTeam(oppName);

      // Squiggle returns g.tz (e.g. "+11:00" AEDT or "+10:00" AEST) and
      // g.timestr already in local time (e.g. "1:10 PM"). Use both.
      const tz   = (g.tz as string) ?? '+10:00';
      const d    = new Date(g.date.replace(' ', 'T') + tz);
      const time = g.timestr ? `${g.timestr} AEST` : aestDisplay(d);

      return {
        id:             `afl-${g.id}`,
        teamId,
        opponent:       oppName,
        opponentAbbr:   opp.abbr,
        opponentColor:  opp.color,
        opponentLogoUrl: opp.logo,
        isHome,
        date:           d.toISOString(),
        time,
        venue:          g.venue ?? '',
        broadcast:      AFL_BROADCAST_ROTATION[i % AFL_BROADCAST_ROTATION.length],
        streaming:      ['Kayo Sports', '7plus'],
        opponentId:     SQUIGGLE_TO_ID[oppName],
      };
    });
}

// ─── EPL — ESPN public API (no key required) ──────────────────────────────────

/**
 * Maps our teamId slug to ESPN's team displayName.
 * 2025-26 season: Ipswich/Leicester/Southampton relegated; Leeds/Sunderland/Burnley promoted.
 * Names verified against ESPN scoreboard API.
 */
const ESPN_TEAM_NAME: Record<string, string> = {
  'epl-arsenal':      'Arsenal',
  'epl-astonvilla':   'Aston Villa',
  'epl-bournemouth':  'AFC Bournemouth',
  'epl-brentford':    'Brentford',
  'epl-brighton':     'Brighton & Hove Albion',
  'epl-burnley':      'Burnley',
  'epl-chelsea':      'Chelsea',
  'epl-crystalpalace':'Crystal Palace',
  'epl-everton':      'Everton',
  'epl-fulham':       'Fulham',
  'epl-leeds':        'Leeds United',
  'epl-liverpool':    'Liverpool',
  'epl-mancity':      'Manchester City',
  'epl-manutd':       'Manchester United',
  'epl-newcastle':    'Newcastle United',
  'epl-forest':       'Nottingham Forest',
  'epl-spurs':        'Tottenham Hotspur',
  'epl-sunderland':   'Sunderland',
  'epl-westham':      'West Ham United',
  'epl-wolves':       'Wolverhampton Wanderers',
};

const EPL_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(ESPN_TEAM_NAME).map(([id, name]) => [name, id]),
);

/** EPL team colour + abbreviation lookup (keyed by ESPN displayName). */
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

/**
 * Australian broadcast rights per ESPN competition slug.
 * Last verified: March 2026.
 *
 * EPL (eng.1):        Stan Sport (streaming) + Channel 9 (select FTA games)
 * FA Cup (eng.fa):    Stan Sport only
 * EFL Cup/Carabao (eng.league_cup): beIN Sports Connect (exclusive rights)
 * Champions League:   Stan Sport only
 * Europa League:      Stan Sport only
 *
 * UPDATE THIS TABLE when rights deals change — nowhere else needs touching.
 *
 * broadcast  = traditional TV channels (may include free-to-air)
 * streaming  = subscription streaming services
 */
const BROADCAST_RIGHTS: Record<string, { broadcast: string[]; streaming: string[] }> = {
  'eng.1':          { broadcast: ['Channel 9', 'Stan Sport'], streaming: ['Stan Sport'] },
  'eng.fa':         { broadcast: ['Stan Sport'],              streaming: ['Stan Sport'] },
  'eng.league_cup': { broadcast: ['beIN Sports'],             streaming: ['beIN Sports Connect'] },
  'uefa.champions': { broadcast: ['Stan Sport'],              streaming: ['Stan Sport'] },
  'uefa.europa':    { broadcast: ['Stan Sport'],              streaming: ['Stan Sport'] },
};
const BROADCAST_FALLBACK = { broadcast: ['Stan Sport'], streaming: ['Stan Sport'] };

/**
 * ESPN competition slugs + display names.
 * Fetched in parallel; any that return no data (team not in that competition) are silently dropped.
 */
const ESPN_COMPETITIONS: { slug: string; label: string; isPrimary?: boolean }[] = [
  { slug: 'eng.1',           label: 'Premier League', isPrimary: true },
  { slug: 'eng.fa',          label: 'FA Cup' },
  { slug: 'eng.league_cup',  label: 'EFL Cup' },
  { slug: 'uefa.champions',  label: 'Champions League' },
  { slug: 'uefa.europa',     label: 'Europa League' },
];

/** Fetch one ESPN competition's scoreboard and return any events involving teamName. */
async function fetchESPNCompetition(
  teamName: string,
  slug: string,
  label: string,
  teamId: string,
  range: string,
): Promise<UpcomingGame[]> {
  // For UEFA knockout competitions the dated scoreboard often returns an empty
  // events array because the API only surfaces the "current" round, not the full
  // calendar. We always try the dated query first (captures confirmed future
  // fixtures when the API supports it) and, for UEFA slugs, also try an undated
  // request which reliably returns the current/next scheduled round.
  const isUEFA = slug.startsWith('uefa.');
  const urls: string[] = [
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=200`,
  ];
  if (isUEFA) {
    urls.push(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?limit=50`);
  }

  const allEventMap = new Map<string, any>();
  for (const url of urls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const e of (data.events ?? []) as any[]) {
        if (!allEventMap.has(e.id)) allEventMap.set(e.id, e);
      }
    } catch { /* try next url */ }
  }

  if (allEventMap.size === 0) return [];

  const now = Date.now();
  const twoHoursAgo = now - 2 * 3600 * 1000;

  const teamEvents = Array.from(allEventMap.values()).filter((e: any) => {
    if (e.status?.type?.completed === true) return false;
    // Exclude events that finished more than 2 hours ago (safety net for undated query)
    if (new Date(e.date).getTime() < twoHoursAgo) return false;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return teamEvents.map((e: any): UpcomingGame => {
    const comp:        any   = e.competitions?.[0] ?? {};
    const competitors: any[] = comp.competitors ?? [];
    const home = competitors.find((c: any) => c.homeAway === 'home');
    const away = competitors.find((c: any) => c.homeAway === 'away');

    const homeTeamName = home?.team?.displayName ?? '';
    const awayTeamName = away?.team?.displayName ?? '';
    const isHome       = homeTeamName === teamName;
    const oppName      = isHome ? awayTeamName : homeTeamName;
    const opp          = EPL_TEAM[oppName] ?? unknownTeam(oppName);
    const oppComp      = isHome ? away : home;
    const oppLogoUrl   = (oppComp?.team?.logo as string | undefined) ?? undefined;

    const utcDate  = new Date(e.date);
    const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
    const time     = aestDisplay(aestDate);

    const rights = BROADCAST_RIGHTS[slug] ?? BROADCAST_FALLBACK;

    return {
      id:            `soccer-${slug}-${e.id}`,
      teamId,
      opponent:      oppName,
      opponentAbbr:  opp.abbr,
      opponentColor: opp.color,
      isHome,
      date:          utcDate.toISOString(),
      time,
      venue:         comp.venue?.fullName ?? '',
      broadcast:        rights.broadcast,
      streaming:        rights.streaming,
      competition:      label === 'Premier League' ? undefined : label,
      opponentLogoUrl:  oppLogoUrl,
      opponentId:       EPL_DISP_TO_ID[oppName],
    };
  });
}

async function fetchEPL(teamId: string): Promise<UpcomingGame[]> {
  const teamName = ESPN_TEAM_NAME[teamId];
  if (!teamName) return [];

  // 150-day window — covers the full second half of a season
  const now   = new Date();
  const end   = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  // Fan out to all competitions concurrently; tolerate individual failures
  const results = await Promise.allSettled(
    ESPN_COMPETITIONS.map(({ slug, label }) =>
      fetchESPNCompetition(teamName, slug, label, teamId, range),
    ),
  );

  const allGames = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Deduplicate by ESPN event id (in case the same event appears in two feeds)
  const seen = new Set<string>();
  const unique = allGames.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });

  // Sort chronologically
  unique.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return unique.slice(0, 20);
}

// ─── NRL — ESPN public API (league ID: 3) ────────────────────────────────────

/** Maps our teamId slug to ESPN's team displayName. */
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

/** Fallback logo URLs keyed by ESPN displayName — derived from our TEAM_LOGOS map. */
const NRL_OPP_LOGO: Record<string, string> = Object.fromEntries(
  Object.entries(NRL_ESPN_NAME).map(([id, name]) => [name, TEAM_LOGOS[id]]),
);

const NRL_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(NRL_ESPN_NAME).map(([id, name]) => [name, id]),
);

/** NRL team colour + abbreviation lookup (keyed by ESPN displayName). */
const NRL_OPP_TEAM: Record<string, { color: string; abbr: string }> = {
  'Broncos':      { color: '#6F1C2B', abbr: 'BRI' },
  'Raiders':      { color: '#69BE28', abbr: 'CAN' },
  'Bulldogs':     { color: '#003C94', abbr: 'CBY' },
  'Sharks':       { color: '#009EDB', abbr: 'CRO' },
  'Dolphins':     { color: '#DF2626', abbr: 'DOL' },
  'Titans':       { color: '#009FDF', abbr: 'GCT' },
  'Eels':         { color: '#003B8E', abbr: 'PAR' },
  'Panthers':     { color: '#001F5C', abbr: 'PEN' },
  'Sea Eagles':   { color: '#B82837', abbr: 'MAN' },
  'Storm':        { color: '#4F2D7F', abbr: 'MEL' },
  'Knights':      { color: '#00204E', abbr: 'NEW' },
  'Warriors':     { color: '#808080', abbr: 'WAR' },
  'Cowboys':      { color: '#003087', abbr: 'COW' },
  'Rabbitohs':    { color: '#007B3F', abbr: 'SOU' },
  'Dragons':      { color: '#CD0000', abbr: 'DRA' },
  'Roosters':     { color: '#003087', abbr: 'SYD' },
  'Wests Tigers': { color: '#FF6400', abbr: 'WTI' },
};

async function fetchNRLFixtures(teamId: string): Promise<UpcomingGame[]> {
  const teamName = NRL_ESPN_NAME[teamId];
  if (!teamName) return [];

  // 90-day forward window
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const events = ((data.events ?? []) as any[]).filter(e => {
    const completed    = e.status?.type?.completed === true;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return !completed && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return events
    .map((e: any): UpcomingGame => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find((c: any) => c.team?.displayName === teamName);
      const oppComp = competitors.find((c: any) => c.team?.displayName !== teamName);
      const isHome  = ourComp?.homeAway === 'home';
      const oppName = oppComp?.team?.displayName ?? 'Unknown';
      const opp     = NRL_OPP_TEAM[oppName] ?? unknownTeam(oppName);

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const time     = aestDisplay(aestDate);

      return {
        id:              `nrl-${e.id}`,
        teamId,
        opponent:        oppName,
        opponentAbbr:    opp.abbr,
        opponentColor:   opp.color,
        isHome,
        date:            utcDate.toISOString(),
        time,
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Nine Network', 'Fox Sports'],
        streaming:       ['Kayo Sports', '9Now'],
        opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined)
          ?? NRL_OPP_LOGO[oppName],
        opponentId:      NRL_DISP_TO_ID[oppName],
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 10);
}

// ─── State of Origin — ESPN NRL scoreboard (league ID: 3) ────────────────────

interface SOOMeta {
  self: string;     // ESPN displayName of followed team
  opponent: string; // ESPN displayName of the opposition
  selfAbbr: string;
  oppAbbr:  string;
  oppColor: string;
  oppLogoUrl: string;
}

const SOO_META: Record<string, SOOMeta> = {
  'nrl-maroons': {
    self: 'Queensland',      opponent: 'New South Wales',
    selfAbbr: 'QLD',         oppAbbr: 'NSW',
    oppColor: '#003DA5',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289317.png',
  },
  'nrl-blues': {
    self: 'New South Wales', opponent: 'Queensland',
    selfAbbr: 'NSW',         oppAbbr: 'QLD',
    oppColor: '#6B0000',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289318.png',
  },
};

async function fetchSOOFixtures(teamId: string): Promise<UpcomingGame[]> {
  const meta = SOO_META[teamId];
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

  // Filter for SOO events: both teams must be the two states
  const allSOO = ((data.events ?? []) as any[])
    .filter((e: any) => {
      const comps: any[] = e.competitions?.[0]?.competitors ?? [];
      return (
        comps.some(c => c.team?.displayName === 'Queensland') &&
        comps.some(c => c.team?.displayName === 'New South Wales')
      );
    })
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Tally series score from completed games
  let selfWins = 0;
  let oppWins  = 0;
  for (const e of allSOO) {
    if (!e.status?.type?.completed) break;
    const comps: any[] = e.competitions?.[0]?.competitors ?? [];
    const selfC  = comps.find(c => c.team?.displayName === meta.self);
    const oppC   = comps.find(c => c.team?.displayName === meta.opponent);
    const selfPts = Number(selfC?.score ?? 0);
    const oppPts  = Number(oppC?.score  ?? 0);
    if (selfPts > oppPts) selfWins++;
    else if (oppPts > selfPts) oppWins++;
  }

  const now         = Date.now();
  const twoHoursAgo = now - 2 * 3600 * 1000;

  const upcoming = allSOO.filter((e: any) => {
    const completed = e.status?.type?.completed === true;
    const gameTime  = new Date(e.date).getTime();
    return !completed && gameTime > twoHoursAgo;
  });

  return upcoming.map((e: any): UpcomingGame => {
    const gameNum  = allSOO.indexOf(e) + 1; // 1, 2, or 3
    const comp     = e.competitions?.[0] ?? {};
    const comps: any[] = comp.competitors ?? [];
    const selfC    = comps.find(c => c.team?.displayName === meta.self);
    const isHome   = selfC?.homeAway === 'home';
    const utcDate  = new Date(e.date);
    const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);

    // Series context label
    const seriesDecided = selfWins >= 2 || oppWins >= 2;
    let seriesCtx = '';
    if (seriesDecided) {
      const wAbbr = selfWins >= 2 ? meta.selfAbbr : meta.oppAbbr;
      const wCount = Math.max(selfWins, oppWins);
      const lCount = Math.min(selfWins, oppWins);
      seriesCtx = ` (Series won: ${wAbbr} ${wCount}-${lCount})`;
    } else if (selfWins + oppWins > 0) {
      if (selfWins > oppWins)       seriesCtx = ` (${meta.selfAbbr} lead ${selfWins}-${oppWins})`;
      else if (oppWins > selfWins)  seriesCtx = ` (${meta.oppAbbr} lead ${oppWins}-${selfWins})`;
      else                          seriesCtx = ` (Series level ${selfWins}-all)`;
    }

    return {
      id:              `soo-${teamId}-${e.id}`,
      teamId,
      opponent:        meta.opponent,
      opponentAbbr:    meta.oppAbbr,
      opponentColor:   meta.oppColor,
      opponentLogoUrl: meta.oppLogoUrl,
      isHome,
      date:            utcDate.toISOString(),
      time:            aestDisplay(aestDate),
      venue:           comp.venue?.fullName ?? '',
      broadcast:       ['Nine Network', 'Fox Sports'],
      streaming:       ['Kayo Sports', '9Now'],
      competition:     `State of Origin — Game ${gameNum}${seriesCtx}`,
    };
  });
}

// ─── Super Rugby Pacific — ESPN public API (league ID: 242041) ────────────────

/**
 * Maps our teamId slug to ESPN's team displayName.
 * Verified against ESPN rugby/242041/teams endpoint (March 2026).
 * ESPN uses full regional names: "Queensland Reds", "New South Wales Waratahs", "Western Force".
 */
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

const SRU_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(SRU_ESPN_NAME).map(([id, name]) => [name, id]),
);

/** ESPN CDN logo URLs keyed by all known displayName variants (verified March 2026). */
const SRU_ESPN_LOGO_URL = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';
const SRU_OPP_LOGO: Record<string, string> = {
  'Brumbies':                  `${SRU_ESPN_LOGO_URL}/25889.png`,
  'ACT Brumbies':              `${SRU_ESPN_LOGO_URL}/25889.png`,
  'Queensland Reds':           `${SRU_ESPN_LOGO_URL}/182.png`,
  'Reds':                      `${SRU_ESPN_LOGO_URL}/182.png`,
  'New South Wales Waratahs':  `${SRU_ESPN_LOGO_URL}/227.png`,
  'Waratahs':                  `${SRU_ESPN_LOGO_URL}/227.png`,
  'NSW Waratahs':              `${SRU_ESPN_LOGO_URL}/227.png`,
  'Western Force':             `${SRU_ESPN_LOGO_URL}/25893.png`,
  'Force':                     `${SRU_ESPN_LOGO_URL}/25893.png`,
  'Blues':                     `${SRU_ESPN_LOGO_URL}/25932.png`,
  'Chiefs':                    `${SRU_ESPN_LOGO_URL}/25934.png`,
  'Crusaders':                 `${SRU_ESPN_LOGO_URL}/25936.png`,
  'Highlanders':               `${SRU_ESPN_LOGO_URL}/25938.png`,
  'Hurricanes':                `${SRU_ESPN_LOGO_URL}/25939.png`,
  'Fijian Drua':               `${SRU_ESPN_LOGO_URL}/289338.png`,
  'Drua':                      `${SRU_ESPN_LOGO_URL}/289338.png`,
  'Moana Pasifika':            `${SRU_ESPN_LOGO_URL}/289319.png`,
  'Melbourne Rebels':          `${SRU_ESPN_LOGO_URL}/25894.png`,
  'Rebels':                    `${SRU_ESPN_LOGO_URL}/25894.png`,
};

/**
 * Super Rugby team colour + abbreviation (keyed by all known ESPN displayName variants).
 */
const SRU_OPP_TEAM: Record<string, { color: string; abbr: string }> = {
  'Brumbies':                  { color: '#003399', abbr: 'BRU' },
  'ACT Brumbies':              { color: '#003399', abbr: 'BRU' },
  'Queensland Reds':           { color: '#8B0000', abbr: 'RED' },
  'Reds':                      { color: '#8B0000', abbr: 'RED' },
  'New South Wales Waratahs':  { color: '#003087', abbr: 'WAR' },
  'Waratahs':                  { color: '#003087', abbr: 'WAR' },
  'NSW Waratahs':              { color: '#003087', abbr: 'WAR' },
  'Western Force':             { color: '#003087', abbr: 'FOR' },
  'Force':                     { color: '#003087', abbr: 'FOR' },
  'Blues':                     { color: '#003087', abbr: 'BLU' },
  'Chiefs':                    { color: '#BA0020', abbr: 'CHI' },
  'Crusaders':                 { color: '#CC0000', abbr: 'CRU' },
  'Highlanders':               { color: '#003087', abbr: 'HIG' },
  'Hurricanes':                { color: '#FFD700', abbr: 'HUR' },
  'Fijian Drua':               { color: '#00A3DE', abbr: 'DRU' },
  'Drua':                      { color: '#00A3DE', abbr: 'DRU' },
  'Moana Pasifika':            { color: '#003087', abbr: 'MOA' },
  'Melbourne Rebels':          { color: '#4B0082', abbr: 'REB' },
  'Rebels':                    { color: '#4B0082', abbr: 'REB' },
};

async function fetchSuperRugbyFixtures(teamId: string): Promise<UpcomingGame[]> {
  const teamName = SRU_ESPN_NAME[teamId];
  if (!teamName) return [];

  // 90-day forward window
  const now = new Date();
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

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
    return !completed && competitors.some(matchesTeam);
  });

  return events
    .map((e: any): UpcomingGame => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find(matchesTeam);
      const oppComp = competitors.find((c: any) => !matchesTeam(c));
      const isHome  = ourComp?.homeAway === 'home';
      const oppName = oppComp?.team?.displayName ?? 'Unknown';
      const opp     = SRU_OPP_TEAM[oppName] ?? unknownTeam(oppName);

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const time     = aestDisplay(aestDate);

      return {
        id:              `sru-${e.id}`,
        teamId,
        opponent:        oppName,
        opponentAbbr:    opp.abbr,
        opponentColor:   opp.color,
        isHome,
        date:            utcDate.toISOString(),
        time,
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Stan Sport'],
        streaming:       ['Stan Sport'],
        opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined)
          ?? (oppComp?.team?.logo as string | undefined)
          ?? SRU_OPP_LOGO[oppName],
        opponentId:      SRU_DISP_TO_ID[oppName],
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 10);
}

// ─── International Rugby Union — ESPN public API ──────────────────────────────
//
// Competitions (verified March 2026):
//   244293 — The Rugby Championship (AU / NZ / SA / ARG)
//   180659 — Six Nations (ENG / IRE / FRA / SCO / WAL / ITA)
//   289234 — International Test Match (all others + summer/autumn tours)

/** Maps our teamId → ESPN displayName. */
const RINT_ESPN_NAME: Record<string, string> = {
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

/** Opponent metadata keyed by ESPN displayName (covers all nations we might face). */
const RINT_CDN = 'https://a.espncdn.com/i/teamlogos/rugby/teams/500';
const RINT_OPP: Record<string, { color: string; abbr: string; logoUrl: string; teamId: string }> = {
  'Australia':     { color: '#FFD700', abbr: 'AUS', logoUrl: `${RINT_CDN}/6.png`,  teamId: 'rint-wallabies' },
  'New Zealand':   { color: '#000000', abbr: 'NZL', logoUrl: `${RINT_CDN}/8.png`,  teamId: 'rint-allblacks' },
  'South Africa':  { color: '#006847', abbr: 'RSA', logoUrl: `${RINT_CDN}/5.png`,  teamId: 'rint-boks'      },
  'England':       { color: '#CC0000', abbr: 'ENG', logoUrl: `${RINT_CDN}/1.png`,  teamId: 'rint-england'   },
  'Ireland':       { color: '#009A44', abbr: 'IRE', logoUrl: `${RINT_CDN}/3.png`,  teamId: 'rint-ireland'   },
  'France':        { color: '#003087', abbr: 'FRA', logoUrl: `${RINT_CDN}/9.png`,  teamId: 'rint-france'    },
  'Scotland':      { color: '#003087', abbr: 'SCO', logoUrl: `${RINT_CDN}/2.png`,  teamId: 'rint-scotland'  },
  'Wales':         { color: '#CC0000', abbr: 'WAL', logoUrl: `${RINT_CDN}/4.png`,  teamId: 'rint-wales'     },
  'Argentina':     { color: '#74ACDF', abbr: 'ARG', logoUrl: `${RINT_CDN}/10.png`, teamId: 'rint-argentina' },
  'Fiji':          { color: '#00A3DE', abbr: 'FIJ', logoUrl: `${RINT_CDN}/14.png`, teamId: 'rint-fiji'      },
  'Samoa':         { color: '#003087', abbr: 'SAM', logoUrl: `${RINT_CDN}/15.png`, teamId: 'rint-samoa'     },
  'Tonga':         { color: '#CC0000', abbr: 'TON', logoUrl: `${RINT_CDN}/16.png`, teamId: 'rint-tonga'     },
  'Italy':         { color: '#003087', abbr: 'ITA', logoUrl: `${RINT_CDN}/20.png`, teamId: ''               },
  'Japan':         { color: '#CC0000', abbr: 'JPN', logoUrl: `${RINT_CDN}/23.png`, teamId: ''               },
  'United States': { color: '#002868', abbr: 'USA', logoUrl: `${RINT_CDN}/11.png`, teamId: ''               },
  'Portugal':      { color: '#006600', abbr: 'POR', logoUrl: `${RINT_CDN}/27.png`, teamId: ''               },
  'Georgia':       { color: '#CC0000', abbr: 'GEO', logoUrl: `${RINT_CDN}/81.png`, teamId: ''               },
  'Namibia':       { color: '#003087', abbr: 'NAM', logoUrl: `${RINT_CDN}/82.png`, teamId: ''               },
};

/** Rugby Championship teams — get standings + RC scoreboard. */
const RC_TEAMS  = new Set(['rint-wallabies', 'rint-allblacks', 'rint-boks', 'rint-argentina']);
/** Six Nations teams — get standings + SN scoreboard. */
const SN_TEAMS  = new Set(['rint-england', 'rint-ireland', 'rint-france', 'rint-scotland', 'rint-wales']);

async function fetchRintCompetition(
  teamName: string,
  compId: string,
  compLabel: string | undefined,
  teamId: string,
  range: string,
): Promise<UpcomingGame[]> {
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/rugby/${compId}/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const matchesTeam = (c: any) =>
    c.team?.displayName === teamName || c.team?.name === teamName;

  const events = ((data.events ?? []) as any[]).filter(e => {
    const completed    = e.status?.type?.completed === true;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return !completed && competitors.some(matchesTeam);
  });

  return events.map((e: any): UpcomingGame => {
    const comp:        any   = e.competitions?.[0] ?? {};
    const competitors: any[] = comp.competitors ?? [];
    const ourComp = competitors.find(matchesTeam);
    const oppComp = competitors.find((c: any) => !matchesTeam(c));
    const isHome  = ourComp?.homeAway === 'home';
    const oppName = oppComp?.team?.displayName ?? 'Unknown';
    const oppData = RINT_OPP[oppName] ?? { color: '#6B7280', abbr: oppName.slice(0, 3).toUpperCase(), logoUrl: undefined, teamId: '' };

    const utcDate  = new Date(e.date);
    const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
    const time     = aestDisplay(aestDate);

    // Wallabies home tests get Nine Network FTA; everything else is Stan Sport
    const broadcast = (teamId === 'rint-wallabies' && isHome)
      ? ['Nine Network', 'Stan Sport']
      : ['Stan Sport'];

    return {
      id:              `rint-${e.id}`,  // ESPN event ID is globally unique → safe dedup key
      teamId,
      opponent:        oppName,
      opponentAbbr:    oppComp?.team?.abbreviation ?? oppData.abbr,
      opponentColor:   oppData.color,
      isHome,
      date:            utcDate.toISOString(),
      time,
      venue:           comp.venue?.fullName ?? '',
      broadcast,
      streaming:       ['Stan Sport'],
      competition:     compLabel,
      opponentLogoUrl: (oppComp?.team?.logos?.[0]?.href as string | undefined) ?? oppData.logoUrl,
      opponentId:      oppData.teamId || undefined,
    };
  });
}


async function fetchInternationalRugbyFixtures(teamId: string): Promise<UpcomingGame[]> {
  const teamName = RINT_ESPN_NAME[teamId];
  if (!teamName) return [];

  // 6-month forward window to capture the full international calendar
  const now = new Date();
  const end = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const range = `${fmt(now)}-${fmt(end)}`;

  // Named competitions first so they win the dedup over the generic Int'l Tests feed
  const competitions: Array<{ id: string; label: string | undefined }> = [];
  if (RC_TEAMS.has(teamId)) competitions.push({ id: '244293', label: 'Rugby Championship' });
  if (SN_TEAMS.has(teamId)) competitions.push({ id: '180659', label: 'Six Nations' });
  competitions.push({ id: '289234', label: undefined }); // summer/autumn tours + Bledisloe

  const results = await Promise.allSettled(
    competitions.map(({ id, label }) =>
      fetchRintCompetition(teamName, id, label, teamId, range),
    ),
  );

  const allGames = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Dedup on ESPN event ID (id is 'rint-{espnEventId}')
  const seen = new Set<string>();
  const unique = allGames.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });

  return unique
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 10);
}

// ─── Formula 1 — Jolpi Ergast API ────────────────────────────────────────────
//
// Returns all sessions for the next 2 race weekends (Practice, Qualifying, Race, etc.)
// All entries use teamId: 'f1-championship' and store circuitId in opponentId.

interface F1SessionDef {
  key: string;
  label: string;
  dateField?: string;
}

const F1_FIXTURE_SESSIONS: F1SessionDef[] = [
  { key: 'fp1',        label: 'Practice 1',       dateField: 'FirstPractice' },
  { key: 'fp2',        label: 'Practice 2',       dateField: 'SecondPractice' },
  { key: 'fp3',        label: 'Practice 3',       dateField: 'ThirdPractice' },
  { key: 'sprintq',    label: 'Sprint Qualifying', dateField: 'SprintQualifying' },
  { key: 'sprint',     label: 'Sprint',            dateField: 'Sprint' },
  { key: 'qualifying', label: 'Qualifying',        dateField: 'Qualifying' },
  { key: 'race',       label: 'Race' },
];

function buildF1Sessions(races: any[], teamId: string): UpcomingGame[] {
  const now          = Date.now();
  const twoHoursAgo  = now - 2 * 3600 * 1000;

  // Find next 2 upcoming race weekends
  const upcomingRaces = races.filter((race: any) => {
    const raceDate = new Date(`${race.date}T${race.time ?? '14:00:00Z'}`);
    return raceDate.getTime() > twoHoursAgo;
  }).slice(0, 2);

  if (upcomingRaces.length === 0) return [];

  const fixtures: UpcomingGame[] = [];

  for (const race of upcomingRaces) {
    const raceName  = race.raceName as string;
    const country   = (race.Circuit?.Location?.country as string) ?? '';
    const abbr      = COUNTRY_TO_ABBR[country] ?? country.slice(0, 3).toUpperCase();
    const circuitId = race.Circuit?.circuitId ?? '';

    for (const session of F1_FIXTURE_SESSIONS) {
      let sessionDate: Date;
      if (session.dateField) {
        const sessionData = race[session.dateField];
        if (!sessionData?.date) continue;
        const sessionTime = sessionData.time ?? '12:00:00Z';
        sessionDate = new Date(`${sessionData.date}T${sessionTime}`);
      } else {
        const raceTime = race.time ?? '14:00:00Z';
        sessionDate = new Date(`${race.date}T${raceTime}`);
      }

      if (isNaN(sessionDate.getTime())) continue;
      if (sessionDate.getTime() <= twoHoursAgo) continue;

      const aestDate = new Date(sessionDate.getTime() + 10 * 3600 * 1000);

      fixtures.push({
        id:              `f1-${race.round}-${session.key}`,
        teamId,
        opponent:        raceName,
        opponentAbbr:    abbr,
        opponentColor:   '#E8002D',
        isHome:          false,
        date:            sessionDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           race.Circuit?.circuitName ?? '',
        broadcast:       ['Fox Sports', 'Kayo Sports'],
        streaming:       ['Kayo Sports'],
        competition:     session.label,
        opponentId:      circuitId,
      });
    }
  }

  return fixtures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

async function fetchF1Fixtures(teamId: string): Promise<UpcomingGame[]> {
  const tryUrls = [
    'https://api.jolpi.ca/ergast/f1/current.json',
    'https://api.jolpi.ca/ergast/f1/2025.json',
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

  return buildF1Sessions(races, teamId);
}

// ─── BBL — ESPN public API (league ID: 8044) ──────────────────────────────────

const BBL_ESPN_NAME: Record<string, string> = {
  'bbl-scorchers':  'Perth Scorchers',
  'bbl-sixers':     'Sydney Sixers',
  'bbl-hurricanes': 'Hobart Hurricanes',
  'bbl-heat':       'Brisbane Heat',
  'bbl-strikers':   'Adelaide Strikers',
  'bbl-stars':      'Melbourne Stars',
  'bbl-renegades':  'Melbourne Renegades',
  'bbl-thunder':    'Sydney Thunder',
};

const BBL_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(BBL_ESPN_NAME).map(([id, name]) => [name, id]),
);

const BBL_OPP_TEAM: Record<string, { color: string; abbr: string }> = {
  'Perth Scorchers':    { color: '#ef660b', abbr: 'PS'  },
  'Sydney Sixers':      { color: '#d917a5', abbr: 'SS'  },
  'Hobart Hurricanes':  { color: '#5b0db7', abbr: 'HH'  },
  'Brisbane Heat':      { color: '#c8102e', abbr: 'BH'  },
  'Adelaide Strikers':  { color: '#005aab', abbr: 'AS'  },
  'Melbourne Stars':    { color: '#00b140', abbr: 'MS'  },
  'Melbourne Renegades':{ color: '#c8102e', abbr: 'MR'  },
  'Sydney Thunder':     { color: '#8dc63f', abbr: 'ST'  },
};

async function fetchBBLFixtures(teamId: string): Promise<UpcomingGame[]> {
  const teamName = BBL_ESPN_NAME[teamId];
  if (!teamName) return [];

  const range = espnDateRange(0, 150); // look 150 days forward (season may be months away)
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/cricket/8044/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const events = ((data.events ?? []) as any[]).filter((e: any) => {
    const state       = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state;
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return state !== 'post' && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return events
    .map((e: any): UpcomingGame => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find((c: any) => c.team?.displayName === teamName);
      const oppComp = competitors.find((c: any) => c.team?.displayName !== teamName);
      const isHome  = ourComp?.homeAway === 'home';
      const oppName = oppComp?.team?.displayName ?? 'Unknown';
      const opp     = BBL_OPP_TEAM[oppName] ?? unknownTeam(oppName);

      const utcDate  = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const eventType = comp.class?.eventType ?? comp.class?.name ?? 'T20';
      const fmt = parseCricketFormat(eventType);

      return {
        id:              `bbl-${e.id}`,
        teamId,
        opponent:        oppName,
        opponentAbbr:    opp.abbr,
        opponentColor:   opp.color,
        isHome,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Fox Cricket', 'Channel 7'],
        streaming:       ['Kayo Sports', '7plus'],
        opponentLogoUrl: oppComp?.team?.logo as string | undefined,
        opponentId:      BBL_DISP_TO_ID[oppName],
        cricketFormat:   fmt,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 10);
}

// ─── International Cricket — ESPN per-team series + event fetching ────────────
//
// International cricket has no single "league" feed. Instead each bilateral
// series or tournament has its own ESPN series ID, and the scoreboard endpoint
// returns only the NEXT upcoming match per series (?dates= is not supported).
//
// For teams with a confirmed schedule we store individual ESPN event IDs so we
// can fetch every match in the series, not just the next one.
// Update CRICKET_INT_TEAM_SERIES and CRICKET_INT_EVENT_IDS when new tours begin.

const CRICKET_INT_ESPN_NAME: Record<string, string> = {
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

const CRICKET_INT_DISP_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CRICKET_INT_ESPN_NAME).map(([id, name]) => [name, id]),
);

// Primary colors for each int'l cricket team — used for opponent badge theming.
// Mirrors the primaryColor values in src/lib/teams.ts.
const CRICKET_INT_PRIMARY_COLOR: Record<string, string> = {
  'int-aus': '#f5c518',
  'int-eng': '#003082',
  'int-ind': '#003082',
  'int-pak': '#01411c',
  'int-nz':  '#000000',
  'int-sa':  '#007a4d',
  'int-sl':  '#003478',
  'int-wi':  '#7b0041',
  'int-ban': '#006a4e',
  'int-zim': '#007a3d',
  'int-ire': '#169b62',
  'int-afg': '#000000',
};

// Per-team series IDs. Keys are our internal team IDs.
// Add new series IDs here when bilateral tours are confirmed.
const CRICKET_INT_TEAM_SERIES: Partial<Record<string, number[]>> = {
  'int-aus': [
    24231,    // Bangladesh tour of Australia 2026 (2 Tests, Aug)
    1530201,  // Australia tour of Zimbabwe 2026 (3 ODIs, Sep)
    24203,    // Australia tour of South Africa 2026/27 (3 ODIs + 1 Test, Sep-Oct)
  ],
};

// Individual ESPN event IDs per series, allowing us to surface every fixture
// in a series rather than just the scoreboard's "next one".
// seriesId → [eventId, ...]
const CRICKET_INT_EVENT_IDS: Record<number, number[]> = {
  24231:   [1527273, 1527274],                    // 1st Test, 2nd Test vs Bangladesh
  1530201: [1530203, 1530204, 1530205],            // ODI 1-3 vs Zimbabwe
  24203:   [1525655, 1525656, 1525657, 1525659],   // ODI 1-3 + 1st Test vs South Africa
};

// Fallback for teams without a configured schedule — generic ongoing ICC events
const CRICKET_INT_GENERIC_SERIES = [8037];

/** Fetch a single ESPN cricket event, trying scoreboard?event= then summary?event= */
async function fetchCricketEventById(seriesId: number, eventId: number): Promise<any | null> {
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard?event=${eventId}`,
    `https://site.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/summary?event=${eventId}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetchTimeout(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      // Scoreboard wraps in events[]
      const fromEvents = (data.events ?? []).find(
        (e: any) => String(e.id) === String(eventId),
      );
      if (fromEvents) return fromEvents;
      // Summary wraps in header / top-level competitions
      const comps: any[] = data.header?.competitions ?? data.competitions ?? [];
      if (comps.length > 0) {
        return {
          id:           String(eventId),
          date:         comps[0].date ?? data.header?.date ?? '',
          name:         data.header?.name ?? '',
          competitions: comps,
          status:       comps[0].status,
        };
      }
    } catch { /* skip and try next */ }
  }
  return null;
}

/** Fetch just the next/current event from a series scoreboard (no event param) */
async function fetchCricketSeriesNext(seriesId: number): Promise<any[]> {
  try {
    const res = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch { return []; }
}

async function fetchCricketIntFixtures(teamId: string): Promise<UpcomingGame[]> {
  const teamName = CRICKET_INT_ESPN_NAME[teamId];
  if (!teamName) return [];

  const seriesIds = CRICKET_INT_TEAM_SERIES[teamId] ?? CRICKET_INT_GENERIC_SERIES;

  // For each series, fetch known individual events AND the scoreboard "next" event
  const eventPromises: Promise<any | null>[] = [];
  for (const seriesId of seriesIds) {
    const eventIds = CRICKET_INT_EVENT_IDS[seriesId];
    if (eventIds?.length) {
      // Fetch all individual events for this series
      for (const eid of eventIds) {
        eventPromises.push(fetchCricketEventById(seriesId, eid));
      }
    } else {
      // No event IDs known — just get the next upcoming event from the scoreboard
      eventPromises.push(fetchCricketSeriesNext(seriesId).then(evts => evts[0] ?? null));
    }
  }

  const settled = await Promise.allSettled(eventPromises);
  const allEvents: any[] = settled
    .filter(r => r.status === 'fulfilled' && r.value != null)
    .map(r => (r as PromiseFulfilledResult<any>).value);

  // Dedup by event ID, then filter for upcoming events involving this team
  const seen = new Set<string>();
  const upcoming = allEvents.filter((e: any) => {
    const id = String(e.id ?? '');
    if (seen.has(id)) return false;
    seen.add(id);
    const state = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state ?? '';
    const competitors: any[] = e.competitions?.[0]?.competitors ?? [];
    return state !== 'post' && competitors.some((c: any) => c.team?.displayName === teamName);
  });

  return upcoming
    .map((e: any): UpcomingGame => {
      const comp:        any   = e.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const ourComp = competitors.find((c: any) => c.team?.displayName === teamName);
      const oppComp = competitors.find((c: any) => c.team?.displayName !== teamName);
      const isHome  = ourComp?.homeAway === 'home';
      const oppName = oppComp?.team?.displayName ?? 'Unknown';
      const utcDate = new Date(e.date);
      const aestDate = new Date(utcDate.getTime() + 10 * 3600 * 1000);
      const eventType = comp.class?.eventType ?? comp.class?.name ?? '';
      const fmt = parseCricketFormat(eventType);
      const seriesName = e.name ?? comp.description ?? '';

      return {
        id:              `cint-${e.id}`,
        teamId,
        opponent:        oppName,
        opponentAbbr:    CRICKET_INT_ESPN_NAME[CRICKET_INT_DISP_TO_ID[oppName] ?? '']
                           ? (oppName.slice(0, 3).toUpperCase()) : unknownTeam(oppName).abbr,
        opponentColor:   CRICKET_INT_PRIMARY_COLOR[CRICKET_INT_DISP_TO_ID[oppName] ?? ''] ?? '#888888',
        isHome,
        date:            utcDate.toISOString(),
        time:            aestDisplay(aestDate),
        venue:           comp.venue?.fullName ?? '',
        broadcast:       ['Fox Cricket'],
        streaming:       ['Kayo Sports'],
        // Prefer our internal ICC logo over ESPN's (which returns country flags for int'l cricket)
        opponentLogoUrl: TEAM_LOGOS[CRICKET_INT_DISP_TO_ID[oppName] ?? ''] ?? (oppComp?.team?.logo as string | undefined),
        opponentId:      CRICKET_INT_DISP_TO_ID[oppName],
        cricketFormat:   fmt,
        matchDays:       fmt === 'test' ? 5 : undefined,
        competition:     seriesName || undefined,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 10);
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'f1', 'bbl', 'cricket_int']);
// Allowlist of valid teamId prefixes keeps arbitrary strings out of upstream URLs
const TEAMID_RE = /^[a-z0-9]+-?[a-z0-9_-]*$/;

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';

  if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    let fixtures: UpcomingGame[] = [];
    if      (league === 'afl')         fixtures = await fetchAFL(teamId);
    else if (league === 'epl')         fixtures = await fetchEPL(teamId);
    else if (league === 'nrl' && (teamId === 'nrl-maroons' || teamId === 'nrl-blues')) fixtures = await fetchSOOFixtures(teamId);
    else if (league === 'nrl')         fixtures = await fetchNRLFixtures(teamId);
    else if (league === 'super_rugby') fixtures = await fetchSuperRugbyFixtures(teamId);
    else if (league === 'rugby_int')   fixtures = await fetchInternationalRugbyFixtures(teamId);
    else if (league === 'f1')          fixtures = await fetchF1Fixtures(teamId);
    else if (league === 'bbl')         fixtures = await fetchBBLFixtures(teamId);
    else if (league === 'cricket_int') fixtures = await fetchCricketIntFixtures(teamId);

    return NextResponse.json(fixtures, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/fixtures]', err);
    return NextResponse.json([]);
  }
}
