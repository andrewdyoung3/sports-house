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

  return (games as any[])
    .filter(g =>
      (g.hteam === sqName || g.ateam === sqName) &&
      g.complete < 100 &&
      g.unixtime * 1000 > now,
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
        streaming:      ['Kayo Sports'],
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
  'epl-chelsea':      'Chelsea',
  'epl-crystalpalace':'Crystal Palace',
  'epl-everton':      'Everton',
  'epl-fulham':       'Fulham',
  'epl-liverpool':    'Liverpool',
  'epl-mancity':      'Manchester City',
  'epl-manutd':       'Manchester United',
  'epl-newcastle':    'Newcastle United',
  'epl-forest':       'Nottingham Forest',
  'epl-spurs':        'Tottenham Hotspur',
  'epl-westham':      'West Ham United',
  'epl-wolves':       'Wolverhampton Wanderers',
};

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
 * Stan Sport acquired English football rights (PL, FA Cup, EFL Cup, UCL, UEL)
 * from the 2022-23 season onward, replacing Optus Sport.
 *
 * UPDATE THIS TABLE when rights deals change — nowhere else needs touching.
 * Last verified: March 2026.
 *
 * broadcast  = traditional TV channels (may include free-to-air)
 * streaming  = subscription streaming services
 */
const BROADCAST_RIGHTS: Record<string, { broadcast: string[]; streaming: string[] }> = {
  'eng.1':          { broadcast: ['Stan Sport'],          streaming: ['Stan Sport'] },
  'eng.fa':         { broadcast: ['Stan Sport'],          streaming: ['Stan Sport'] },
  'eng.league_cup': { broadcast: ['Stan Sport'],          streaming: ['Stan Sport'] },
  'uefa.champions': { broadcast: ['Stan Sport'],          streaming: ['Stan Sport'] },
  'uefa.europa':    { broadcast: ['Stan Sport'],          streaming: ['Stan Sport'] },
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
  const res = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=200`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const teamEvents = ((data.events ?? []) as any[]).filter(e => {
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

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'epl']);
// Allowlist of valid teamId prefixes keeps arbitrary strings out of upstream URLs
const TEAMID_RE = /^[a-z]+-[a-z0-9]+$/;

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';

  if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    let fixtures: UpcomingGame[] = [];
    if (league === 'afl') fixtures = await fetchAFL(teamId);
    else if (league === 'epl') fixtures = await fetchEPL(teamId);

    return NextResponse.json(fixtures);
  } catch (err) {
    console.error('[/api/fixtures]', err);
    // Return empty — client falls back to mock data
    return NextResponse.json([]);
  }
}
