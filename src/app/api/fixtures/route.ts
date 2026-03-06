/**
 * GET /api/fixtures?league=afl&teamId=afl-lions
 *
 * Fetches real upcoming fixtures for a supported league/team.
 * AFL  → Squiggle API (free, no key)
 * EPL  → TheSportsDB free tier (test key "3", no registration)
 *
 * Returns UpcomingGame[] — same shape as mock-data.ts so the client
 * can drop real data in without changing the display layer.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { UpcomingGame } from '@/types';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** AFL team colour + abbreviation lookup (keyed by Squiggle display name). */
const AFL_TEAM: Record<string, { color: string; abbr: string }> = {
  'Adelaide':         { color: '#013A6E', abbr: 'ADL' },
  'Brisbane Lions':   { color: '#A30046', abbr: 'BRI' },
  'Carlton':          { color: '#0E1E2E', abbr: 'CAR' },
  'Collingwood':      { color: '#000000', abbr: 'COL' },
  'Essendon':         { color: '#CC2031', abbr: 'ESS' },
  'Fremantle':        { color: '#2A1A5E', abbr: 'FRE' },
  'Geelong':          { color: '#001F5B', abbr: 'GEE' },
  'Gold Coast':       { color: '#E8312D', abbr: 'GCS' },
  'GWS Giants':       { color: '#F47B20', abbr: 'GWS' },
  'Hawthorn':         { color: '#4D2004', abbr: 'HAW' },
  'Melbourne':        { color: '#CC2031', abbr: 'MEL' },
  'North Melbourne':  { color: '#003088', abbr: 'NME' },
  'Port Adelaide':    { color: '#000000', abbr: 'PAD' },
  'Richmond':         { color: '#FFD200', abbr: 'RIC' },
  'St Kilda':         { color: '#ED0F05', abbr: 'STK' },
  'Sydney':           { color: '#ED171F', abbr: 'SYD' },
  'West Coast':       { color: '#003087', abbr: 'WCE' },
  'Western Bulldogs': { color: '#014896', abbr: 'WBD' },
};

/** EPL team colour + abbreviation lookup (keyed by TheSportsDB display name). */
const EPL_TEAM: Record<string, { color: string; abbr: string }> = {
  'Arsenal':                    { color: '#EF0107', abbr: 'ARS' },
  'Aston Villa':                { color: '#670E36', abbr: 'AVL' },
  'Bournemouth':                { color: '#DA291C', abbr: 'BOU' },
  'Brentford':                  { color: '#E30613', abbr: 'BRE' },
  'Brighton and Hove Albion':   { color: '#0057B8', abbr: 'BHA' },
  'Brighton & Hove Albion':     { color: '#0057B8', abbr: 'BHA' },
  'Chelsea':                    { color: '#034694', abbr: 'CHE' },
  'Crystal Palace':             { color: '#1B458F', abbr: 'CRY' },
  'Everton':                    { color: '#003399', abbr: 'EVE' },
  'Fulham':                     { color: '#000000', abbr: 'FUL' },
  'Ipswich Town':               { color: '#0044A9', abbr: 'IPS' },
  'Leicester City':             { color: '#003090', abbr: 'LEI' },
  'Liverpool':                  { color: '#C8102E', abbr: 'LIV' },
  'Manchester City':            { color: '#6CABDD', abbr: 'MCI' },
  'Manchester United':          { color: '#DA291C', abbr: 'MUN' },
  'Newcastle United':           { color: '#241F20', abbr: 'NEW' },
  'Nottingham Forest':          { color: '#DD0000', abbr: 'NFO' },
  'Southampton':                { color: '#D71920', abbr: 'SOU' },
  'Tottenham Hotspur':          { color: '#132257', abbr: 'TOT' },
  'West Ham United':            { color: '#7A263A', abbr: 'WHU' },
  'Wolverhampton Wanderers':    { color: '#FDB913', abbr: 'WOL' },
};

/** Fallback for unknown opponents: grey + initials. */
function unknownTeam(name: string): { color: string; abbr: string } {
  const words = name.trim().split(/\s+/);
  const abbr  = words.length >= 2
    ? words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
    : name.slice(0, 3).toUpperCase();
  return { color: '#6B7280', abbr };
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

// AFL broadcast rotates by round index — real broadcast rights vary per game,
// but we don't have that data from Squiggle so we approximate.
const AFL_BROADCAST_ROTATION = [
  ['Seven Network', 'Fox Footy'],
  ['Seven Network'],
  ['Fox Footy'],
];

async function fetchAFL(teamId: string): Promise<UpcomingGame[]> {
  const sqName = SQUIGGLE_NAME[teamId];
  if (!sqName) return [];

  const year = new Date().getFullYear();
  const res = await fetch(
    `https://api.squiggle.com.au/?q=games;year=${year};team=${encodeURIComponent(sqName)}`,
    {
      headers: { 'User-Agent': 'SportsHouseMVP/1.0' },
      next:    { revalidate: 3600 },
    },
  );
  if (!res.ok) return [];

  const { games = [] } = await res.json();
  const now = Date.now();

  return (games as any[])
    .filter(g => g.complete < 100 && new Date(g.date.replace(' ', 'T')).getTime() > now)
    .slice(0, 10)
    .map((g, i): UpcomingGame => {
      const isHome   = g.hteam === sqName;
      const oppName  = isHome ? g.ateam : g.hteam;
      const opp      = AFL_TEAM[oppName] ?? unknownTeam(oppName);

      // Squiggle date: "YYYY-MM-DD HH:MM:SS" AEST — append offset to parse correctly
      const d       = new Date(g.date.replace(' ', 'T') + '+10:00');
      const h       = d.getHours();
      const m       = d.getMinutes().toString().padStart(2, '0');
      const ap      = h >= 12 ? 'PM' : 'AM';
      const h12     = h % 12 || 12;
      const time    = `${h12}:${m} ${ap} AEST`;

      return {
        id:            `afl-${g.id}`,
        teamId,
        opponent:      oppName,
        opponentAbbr:  opp.abbr,
        opponentColor: opp.color,
        isHome,
        date:          d.toISOString(),
        time,
        venue:         g.venue ?? '',
        broadcast:     AFL_BROADCAST_ROTATION[i % AFL_BROADCAST_ROTATION.length],
        streaming:     ['Kayo Sports'],
      };
    });
}

// ─── EPL — TheSportsDB free tier ─────────────────────────────────────────────

const EPL_SEARCH_NAME: Record<string, string> = {
  'epl-arsenal':      'Arsenal',
  'epl-astonvilla':   'Aston Villa',
  'epl-bournemouth':  'Bournemouth',
  'epl-brentford':    'Brentford',
  'epl-brighton':     'Brighton and Hove Albion',
  'epl-chelsea':      'Chelsea',
  'epl-crystalpalace':'Crystal Palace',
  'epl-everton':      'Everton',
  'epl-fulham':       'Fulham',
  'epl-ipswich':      'Ipswich Town',
  'epl-leicester':    'Leicester City',
  'epl-liverpool':    'Liverpool',
  'epl-mancity':      'Manchester City',
  'epl-manutd':       'Manchester United',
  'epl-newcastle':    'Newcastle United',
  'epl-forest':       'Nottingham Forest',
  'epl-southampton':  'Southampton',
  'epl-spurs':        'Tottenham Hotspur',
  'epl-westham':      'West Ham United',
  'epl-wolves':       'Wolverhampton Wanderers',
};

async function fetchEPL(teamId: string): Promise<UpcomingGame[]> {
  const searchName = EPL_SEARCH_NAME[teamId];
  if (!searchName) return [];

  // Step 1 — resolve TheSportsDB internal team ID (cached 24 h)
  const searchRes = await fetch(
    `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(searchName)}`,
    { next: { revalidate: 86400 } },
  );
  if (!searchRes.ok) return [];
  const searchData = await searchRes.json();
  const sdbId = searchData.teams?.[0]?.idTeam;
  if (!sdbId) return [];

  // Step 2 — next events (cached 1 h)
  const eventsRes = await fetch(
    `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${sdbId}`,
    { next: { revalidate: 3600 } },
  );
  if (!eventsRes.ok) return [];
  const eventsData = await eventsRes.json();

  return ((eventsData.events ?? []) as any[]).slice(0, 10).map((e): UpcomingGame => {
    const isHome   = e.strHomeTeam === searchName;
    const oppName  = isHome ? e.strAwayTeam : e.strHomeTeam;
    const opp      = EPL_TEAM[oppName] ?? unknownTeam(oppName);

    // TheSportsDB times are local UK time (BST/GMT)
    const timeRaw  = (e.strTime ?? '15:00:00').slice(0, 5); // "15:00"
    const [hh, mm] = timeRaw.split(':').map(Number);
    const ap       = hh >= 12 ? 'PM' : 'AM';
    const h12      = hh % 12 || 12;
    const time     = `${h12}:${mm.toString().padStart(2, '0')} ${ap} GMT`;

    return {
      id:            `epl-${e.idEvent}`,
      teamId,
      opponent:      oppName,
      opponentAbbr:  opp.abbr,
      opponentColor: opp.color,
      isHome,
      date:          `${e.dateEvent}T${e.strTime ?? '15:00:00'}`,
      time,
      venue:         e.strVenue ?? '',
      broadcast:     ['Optus Sport'],
      streaming:     ['Optus Sport'],
    };
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league');
  const teamId = req.nextUrl.searchParams.get('teamId');

  if (!league || !teamId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
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
