/**
 * Mock data generators for the MVP.
 *
 * Each function uses a deterministic seed so the same team always returns
 * the same data across renders. Replace these with real API calls when
 * integrating Squiggle (AFL), API-Sports (NRL), football-data.org (EPL),
 * or Balldontlie (NBA).
 */

import type { GameResult, GamePreview, NewsItem, UpcomingGame, PreviewContext } from '@/types';
import type { Team } from '@/types';
import { seededRandom, ordinal } from '@/lib/utils';

// ─── Opponent pools (one per league) ─────────────────────────────────────────

const ESPN = 'https://a.espncdn.com/i/teamlogos';

const AFL_OPPONENTS = [
  { name: 'Richmond Tigers',       abbr: 'RIC', color: '#FFD200', logo: `${ESPN}/afl/500/rich.png` },
  { name: 'Collingwood Magpies',   abbr: 'COL', color: '#000000', logo: `${ESPN}/afl/500/coll.png` },
  { name: 'Carlton Blues',         abbr: 'CAR', color: '#0E1E2E', logo: `${ESPN}/afl/500/carl.png` },
  { name: 'Melbourne Demons',      abbr: 'MEL', color: '#CC2031', logo: `${ESPN}/afl/500/melb.png` },
  { name: 'Geelong Cats',          abbr: 'GEE', color: '#001F5B', logo: `${ESPN}/afl/500/geel.png` },
  { name: 'Sydney Swans',          abbr: 'SYD', color: '#ED171F', logo: `${ESPN}/afl/500/syd.png`  },
  { name: 'Brisbane Lions',        abbr: 'BRI', color: '#A30046', logo: `${ESPN}/afl/500/bl.png`   },
  { name: 'Essendon Bombers',      abbr: 'ESS', color: '#CC2031', logo: `${ESPN}/afl/500/ess.png`  },
];

// NRL — ESPN CDN serves these via rugby/teams/500/{numericId}.png (see team-logos.ts)
// Super Rugby — official logos from super.rugby/sites/sanzar/assets/teamlogos/
// Opponent entries here don't need logos; the TEAM_LOGOS map covers followed teams.
const NRL_OPPONENTS = [
  { name: 'Penrith Panthers',       abbr: 'PEN', color: '#1C1C1C' },
  { name: 'Melbourne Storm',        abbr: 'MEL', color: '#4B0082' },
  { name: 'Brisbane Broncos',       abbr: 'BRO', color: '#4D0045' },
  { name: 'Sydney Roosters',        abbr: 'SYD', color: '#003087' },
  { name: 'South Sydney Rabbitohs', abbr: 'SSR', color: '#006633' },
  { name: 'Newcastle Knights',      abbr: 'NEW', color: '#003087' },
  { name: 'Cronulla Sharks',        abbr: 'SHA', color: '#00A2D4' },
  { name: 'Parramatta Eels',        abbr: 'PAR', color: '#003087' },
];

const SUPER_RUGBY_OPPONENTS = [
  { name: 'Crusaders',    abbr: 'CRU', color: '#CC2031' },
  { name: 'Blues',        abbr: 'BLU', color: '#003087' },
  { name: 'Chiefs',       abbr: 'CHF', color: '#CC2031' },
  { name: 'Hurricanes',   abbr: 'HUR', color: '#F5C900' },
  { name: 'Highlanders',  abbr: 'HIG', color: '#002B5C' },
  { name: 'Brumbies',     abbr: 'BRU', color: '#003087' },
  { name: 'Queensland Reds', abbr: 'RED', color: '#CC2031' },
  { name: 'NSW Waratahs', abbr: 'WAR', color: '#003087' },
];

const RUGBY_INT_OPPONENTS = [
  { name: 'New Zealand', abbr: 'NZL', color: '#000000' },
  { name: 'South Africa',abbr: 'RSA', color: '#007A4D' },
  { name: 'England',     abbr: 'ENG', color: '#003087' },
  { name: 'France',      abbr: 'FRA', color: '#002395' },
  { name: 'Ireland',     abbr: 'IRL', color: '#004225' },
  { name: 'Argentina',   abbr: 'ARG', color: '#75AADB' },
  { name: 'Wales',       abbr: 'WAL', color: '#C8102E' },
  { name: 'Scotland',    abbr: 'SCO', color: '#003087' },
];

const NFL_OPPONENTS = [
  { name: 'Kansas City Chiefs',  abbr: 'KC',  color: '#E31837', logo: `${ESPN}/nfl/500/kc.png`  },
  { name: 'Philadelphia Eagles', abbr: 'PHI', color: '#004C54', logo: `${ESPN}/nfl/500/phi.png` },
  { name: 'San Francisco 49ers', abbr: 'SF',  color: '#AA0000', logo: `${ESPN}/nfl/500/sf.png`  },
  { name: 'Baltimore Ravens',    abbr: 'BAL', color: '#241773', logo: `${ESPN}/nfl/500/bal.png` },
  { name: 'Dallas Cowboys',      abbr: 'DAL', color: '#003594', logo: `${ESPN}/nfl/500/dal.png` },
  { name: 'Miami Dolphins',      abbr: 'MIA', color: '#008E97', logo: `${ESPN}/nfl/500/mia.png` },
  { name: 'Detroit Lions',       abbr: 'DET', color: '#0076B6', logo: `${ESPN}/nfl/500/det.png` },
  { name: 'Buffalo Bills',       abbr: 'BUF', color: '#00338D', logo: `${ESPN}/nfl/500/buf.png` },
];

const NBA_OPPONENTS = [
  { name: 'Boston Celtics',        abbr: 'BOS', color: '#007A33', logo: `${ESPN}/nba/500/bos.png` },
  { name: 'Golden State Warriors', abbr: 'GSW', color: '#1D428A', logo: `${ESPN}/nba/500/gs.png`  },
  { name: 'Los Angeles Lakers',    abbr: 'LAL', color: '#552583', logo: `${ESPN}/nba/500/lal.png` },
  { name: 'Miami Heat',            abbr: 'MIA', color: '#98002E', logo: `${ESPN}/nba/500/mia.png` },
  { name: 'Milwaukee Bucks',       abbr: 'MIL', color: '#00471B', logo: `${ESPN}/nba/500/mil.png` },
  { name: 'Oklahoma City Thunder', abbr: 'OKC', color: '#007AC1', logo: `${ESPN}/nba/500/okc.png` },
  { name: 'Denver Nuggets',        abbr: 'DEN', color: '#0E2240', logo: `${ESPN}/nba/500/den.png` },
  { name: 'Phoenix Suns',          abbr: 'PHX', color: '#1D1160', logo: `${ESPN}/nba/500/phx.png` },
];

const MLB_OPPONENTS = [
  { name: 'New York Yankees',     abbr: 'NYY', color: '#132448', logo: `${ESPN}/mlb/500/nyy.png` },
  { name: 'Los Angeles Dodgers',  abbr: 'LAD', color: '#005A9C', logo: `${ESPN}/mlb/500/lad.png` },
  { name: 'Houston Astros',       abbr: 'HOU', color: '#002D62', logo: `${ESPN}/mlb/500/hou.png` },
  { name: 'Atlanta Braves',       abbr: 'ATL', color: '#CE1141', logo: `${ESPN}/mlb/500/atl.png` },
  { name: 'Boston Red Sox',       abbr: 'BOS', color: '#BD3039', logo: `${ESPN}/mlb/500/bos.png` },
  { name: 'St. Louis Cardinals',  abbr: 'STL', color: '#C41E3A', logo: `${ESPN}/mlb/500/stl.png` },
  { name: 'Chicago Cubs',         abbr: 'CHC', color: '#0E3386', logo: `${ESPN}/mlb/500/chc.png` },
  { name: 'San Francisco Giants', abbr: 'SF',  color: '#FD5A1E', logo: `${ESPN}/mlb/500/sf.png`  },
];

const NHL_OPPONENTS = [
  { name: 'Boston Bruins',       abbr: 'BOS', color: '#FCB514', logo: `${ESPN}/nhl/500/bos.png` },
  { name: 'Colorado Avalanche',  abbr: 'COL', color: '#6F263D', logo: `${ESPN}/nhl/500/col.png` },
  { name: 'Tampa Bay Lightning', abbr: 'TBL', color: '#002868', logo: `${ESPN}/nhl/500/tb.png`  },
  { name: 'Vegas Golden Knights',abbr: 'VGK', color: '#B4975A', logo: `${ESPN}/nhl/500/vgk.png` },
  { name: 'New York Rangers',    abbr: 'NYR', color: '#0038A8', logo: `${ESPN}/nhl/500/nyr.png` },
  { name: 'Edmonton Oilers',     abbr: 'EDM', color: '#041E42', logo: `${ESPN}/nhl/500/edm.png` },
  { name: 'Florida Panthers',    abbr: 'FLA', color: '#041E42', logo: `${ESPN}/nhl/500/fla.png` },
  { name: 'Toronto Maple Leafs', abbr: 'TOR', color: '#00205B', logo: `${ESPN}/nhl/500/tor.png` },
];

const EPL_OPPONENTS = [
  { name: 'Arsenal',          abbr: 'ARS', color: '#EF0107', logo: `${ESPN}/soccer/500/359.png` },
  { name: 'Manchester City',  abbr: 'MCI', color: '#6CABDD', logo: `${ESPN}/soccer/500/382.png` },
  { name: 'Liverpool',        abbr: 'LIV', color: '#C8102E', logo: `${ESPN}/soccer/500/364.png` },
  { name: 'Chelsea',          abbr: 'CHE', color: '#034694', logo: `${ESPN}/soccer/500/363.png` },
  { name: 'Tottenham Hotspur',abbr: 'TOT', color: '#132257', logo: `${ESPN}/soccer/500/367.png` },
  { name: 'Manchester United',abbr: 'MUN', color: '#DA291C', logo: `${ESPN}/soccer/500/360.png` },
  { name: 'Newcastle United', abbr: 'NEW', color: '#241F20', logo: `${ESPN}/soccer/500/361.png` },
  { name: 'Aston Villa',      abbr: 'AVL', color: '#670E36', logo: `${ESPN}/soccer/500/362.png` },
];

// F1 — races are the "opponent" (no team badge; country code as abbr)
const F1_RACES = [
  { name: 'Australian Grand Prix',   abbr: 'AUS', color: '#E8002D', logo: undefined },
  { name: 'Bahrain Grand Prix',      abbr: 'BHR', color: '#E8002D', logo: undefined },
  { name: 'Saudi Arabian Grand Prix',abbr: 'KSA', color: '#E8002D', logo: undefined },
  { name: 'Japanese Grand Prix',     abbr: 'JPN', color: '#E8002D', logo: undefined },
  { name: 'Chinese Grand Prix',      abbr: 'CHN', color: '#E8002D', logo: undefined },
  { name: 'Miami Grand Prix',        abbr: 'MIA', color: '#E8002D', logo: undefined },
  { name: 'Emilia Romagna Grand Prix',abbr: 'IMO', color: '#E8002D', logo: undefined },
  { name: 'Monaco Grand Prix',       abbr: 'MON', color: '#E8002D', logo: undefined },
  { name: 'Canadian Grand Prix',     abbr: 'CAN', color: '#E8002D', logo: undefined },
  { name: 'Spanish Grand Prix',      abbr: 'ESP', color: '#E8002D', logo: undefined },
  { name: 'Austrian Grand Prix',     abbr: 'AUT', color: '#E8002D', logo: undefined },
  { name: 'British Grand Prix',      abbr: 'GBR', color: '#E8002D', logo: undefined },
  { name: 'Belgian Grand Prix',      abbr: 'BEL', color: '#E8002D', logo: undefined },
  { name: 'Hungarian Grand Prix',    abbr: 'HUN', color: '#E8002D', logo: undefined },
  { name: 'Dutch Grand Prix',        abbr: 'NED', color: '#E8002D', logo: undefined },
  { name: 'Italian Grand Prix',      abbr: 'ITA', color: '#E8002D', logo: undefined },
  { name: 'Azerbaijan Grand Prix',   abbr: 'AZE', color: '#E8002D', logo: undefined },
  { name: 'Singapore Grand Prix',    abbr: 'SGP', color: '#E8002D', logo: undefined },
  { name: 'United States Grand Prix',abbr: 'USA', color: '#E8002D', logo: undefined },
  { name: 'Mexico City Grand Prix',  abbr: 'MEX', color: '#E8002D', logo: undefined },
  { name: 'São Paulo Grand Prix',    abbr: 'BRA', color: '#E8002D', logo: undefined },
  { name: 'Las Vegas Grand Prix',    abbr: 'LVG', color: '#E8002D', logo: undefined },
  { name: 'Qatar Grand Prix',        abbr: 'QAT', color: '#E8002D', logo: undefined },
  { name: 'Abu Dhabi Grand Prix',    abbr: 'UAE', color: '#E8002D', logo: undefined },
];

type OpponentEntry = { name: string; abbr: string; color: string; logo?: string };

const OPPONENT_POOLS: Record<string, OpponentEntry[]> = {
  afl:         AFL_OPPONENTS,
  nrl:         NRL_OPPONENTS,
  super_rugby: SUPER_RUGBY_OPPONENTS,
  rugby_int:   RUGBY_INT_OPPONENTS,
  nfl:         NFL_OPPONENTS,
  nba:         NBA_OPPONENTS,
  mlb:         MLB_OPPONENTS,
  nhl:         NHL_OPPONENTS,
  epl:         EPL_OPPONENTS,
  f1:          F1_RACES,
};

// ─── Broadcast pools ──────────────────────────────────────────────────────────

// Australian sports — broadcast info for AU audience
const AFL_BROADCASTS   = [['Seven Network', 'Fox Footy'], ['Seven Network'], ['Fox Footy']];
const NRL_BROADCASTS   = [['Nine Network', 'Fox League'], ['Nine Network'], ['Fox League']];
const SRUG_BROADCASTS  = [['Stan Sport']];
const RINT_BROADCASTS  = [['Channel Nine', 'Stan Sport'], ['Stan Sport']];

// International sports — Australian broadcast rights
const NFL_BROADCASTS   = [['ESPN', 'Kayo Sports'], ['Kayo Sports']];
const NBA_BROADCASTS   = [['ESPN', 'Kayo Sports'], ['Kayo Sports']];
const MLB_BROADCASTS   = [['ESPN', 'Kayo Sports'], ['Kayo Sports']];
const NHL_BROADCASTS   = [['ESPN', 'Kayo Sports'], ['9GO!', 'Kayo Sports']];
const EPL_BROADCASTS   = [['Stan Sport'], ['Channel 9', 'Stan Sport']];

const AFL_STREAMING    = ['Kayo Sports', '7plus'];
const NRL_STREAMING    = ['Kayo Sports', '9Now'];
const SRUG_STREAMING   = ['Stan Sport'];
const RINT_STREAMING   = ['Stan Sport'];
const NFL_STREAMING    = ['Kayo Sports', 'NFL+'];
const NBA_STREAMING    = ['Kayo Sports', 'NBA League Pass'];
const MLB_STREAMING    = ['Kayo Sports', 'MLB.TV'];
const NHL_STREAMING    = ['Kayo Sports'];
const EPL_STREAMING    = ['Stan Sport'];
const F1_BROADCASTS    = [['Fox Sports', 'Kayo Sports'], ['Fox Sports']];
const F1_STREAMING     = ['Kayo Sports'];

const BROADCAST_POOLS: Record<string, string[][]> = {
  afl:         AFL_BROADCASTS,
  nrl:         NRL_BROADCASTS,
  super_rugby: SRUG_BROADCASTS,
  rugby_int:   RINT_BROADCASTS,
  nfl:         NFL_BROADCASTS,
  nba:         NBA_BROADCASTS,
  mlb:         MLB_BROADCASTS,
  nhl:         NHL_BROADCASTS,
  epl:         EPL_BROADCASTS,
  f1:          F1_BROADCASTS,
};

const STREAMING_POOLS: Record<string, string[]> = {
  afl:         AFL_STREAMING,
  nrl:         NRL_STREAMING,
  super_rugby: SRUG_STREAMING,
  rugby_int:   RINT_STREAMING,
  nfl:         NFL_STREAMING,
  nba:         NBA_STREAMING,
  mlb:         MLB_STREAMING,
  nhl:         NHL_STREAMING,
  epl:         EPL_STREAMING,
  f1:          F1_STREAMING,
};

// ─── Sport-specific kickoff times ─────────────────────────────────────────────

// Stored as UTC {h, m} so the date field carries the true kickoff timestamp.
// dayOffset: -1 means the UTC kickoff is the calendar day before the local AU date
// (e.g. a US Sunday afternoon game is Monday morning in AEST).
type KickoffUTC = { h: number; m: number; dayOffset?: number };

const GAME_TIMES_UTC: Record<string, KickoffUTC[]> = {
  // AU sports — AEST (UTC+10): subtract 10 h
  afl:         [{ h: 3, m: 10 }, { h: 5, m: 20 }, { h: 6, m: 35 }, { h: 9, m: 40 }],
  nrl:         [{ h: 5, m: 0  }, { h: 7, m: 30 }, { h: 8, m: 0  }, { h: 9, m: 50 }],
  super_rugby: [{ h: 6, m: 35 }, { h: 9, m: 5  }, { h: 9, m: 35 }],
  rugby_int:   [{ h: 5, m: 10 }, { h: 7, m: 5  }, { h: 9, m: 0  }],
  // US sports — Sunday afternoon ET; in AEST these are Monday morning
  nfl:         [{ h: 17, m: 0, dayOffset: -1 }, { h: 20, m: 30, dayOffset: -1 }, { h: 0, m: 0 }, { h: 1, m: 15 }],
  nba:         [{ h: 0, m: 0  }, { h: 0, m: 30 }, { h: 1, m: 0  }, { h: 3, m: 0  }],
  mlb:         [{ h: 18, m: 10, dayOffset: -1 }, { h: 21, m: 5, dayOffset: -1 }, { h: 0, m: 5 }],
  nhl:         [{ h: 0, m: 0  }, { h: 0, m: 30 }, { h: 1, m: 0  }],
  // EPL — UK afternoon (GMT): 15:00, 17:30, 20:00 UTC
  epl:         [{ h: 15, m: 0 }, { h: 17, m: 30 }, { h: 20, m: 0 }],
  // F1 — race start varies by timezone; Sunday local time → common UTC windows
  f1:          [{ h: 2, m: 0 }, { h: 6, m: 0 }, { h: 13, m: 0 }, { h: 14, m: 0 }],
};

// ─── Upcoming games ───────────────────────────────────────────────────────────

export function getUpcomingGames(team: Team, count = 2): UpcomingGame[] {
  // F1 championship entity: return mock race sessions
  if (team.id === 'f1-championship') {
    const now    = Date.now();
    const dayMs  = 86_400_000;
    const sessions = ['Practice 1', 'Qualifying', 'Race'];
    const races    = F1_RACES;
    return Array.from({ length: count }, (_, i) => {
      const r1        = seededRandom('f1-championship', i * 3);
      const race      = races[Math.floor(r1 * races.length)];
      const session   = sessions[i % sessions.length];
      const daysAhead = 3 + i * 4;
      const gameDate  = new Date(now + daysAhead * dayMs);
      return {
        id:             `game-f1-championship-${i}`,
        teamId:         'f1-championship',
        opponent:       race.name,
        opponentAbbr:   race.abbr,
        opponentColor:  '#E8002D',
        isHome:         false,
        date:           gameDate.toISOString(),
        time:           '',
        venue:          '',
        broadcast:      ['Fox Sports', 'Kayo Sports'],
        streaming:      ['Kayo Sports'],
        competition:    session,
      };
    });
  }

  const pool   = OPPONENT_POOLS[team.league]    ?? AFL_OPPONENTS;
  const bcPool = BROADCAST_POOLS[team.league]   ?? AFL_BROADCASTS;
  const stPool = STREAMING_POOLS[team.league]   ?? AFL_STREAMING;
  const tPool  = GAME_TIMES_UTC[team.league]    ?? GAME_TIMES_UTC.afl;
  const now    = Date.now();
  const dayMs  = 86_400_000;

  return Array.from({ length: count }, (_, i) => {
    const r1 = seededRandom(team.id, i * 3);
    const r2 = seededRandom(team.id, i * 3 + 1);
    const r3 = seededRandom(team.id, i * 3 + 2);

    const opp      = pool[Math.floor(r1 * pool.length)];
    const bc       = bcPool[Math.floor(r2 * bcPool.length)];
    const st       = [stPool[Math.floor(r3 * stPool.length)]];
    const kt       = tPool[Math.floor(r2 * tPool.length)];
    const isHome   = r3 > 0.5;
    const daysAhead = 3 + i * 5 + Math.floor(r1 * 3);

    // Build a true UTC kickoff timestamp: start from UTC midnight N days from now,
    // then apply the dayOffset and kickoff hour/minute.
    const baseMidnightUtc = new Date(now + daysAhead * dayMs);
    baseMidnightUtc.setUTCHours(0, 0, 0, 0);
    const kickoffMs = baseMidnightUtc.getTime()
      + (kt.dayOffset ?? 0) * dayMs
      + kt.h * 3_600_000
      + kt.m * 60_000;
    const gameDate = new Date(kickoffMs);
    // time field: kept as a locale-agnostic placeholder; client renders from date
    const time = '';

    // Spread is only meaningful for NFL/NBA — skip for rugby/AFL
    const hasSpread = ['nfl', 'nba', 'mlb', 'epl'].includes(team.league);
    const spreadVal = (r1 * 14 - 7).toFixed(1);

    // F1: each race is at a circuit — no home/away, venue is the race name
    const isF1 = team.league === 'f1';

    return {
      id:              `game-${team.id}-${i}`,
      teamId:          team.id,
      opponent:        opp.name,
      opponentAbbr:    opp.abbr,
      opponentColor:   opp.color,
      opponentLogoUrl: opp.logo,
      isHome:          isF1 ? false : isHome,
      date:            gameDate.toISOString(),
      time,
      venue:           isF1 ? opp.name : (isHome ? team.venue : `${opp.name} Home Ground`),
      broadcast:       bc,
      streaming:       st,
      ...(hasSpread && {
        odds: {
          spread:     (Number(spreadVal) >= 0 ? '+' : '') + spreadVal,
          overUnder: (team.league === 'nba' ? 220 + Math.floor(r2 * 30) : 42 + Math.floor(r2 * 12)).toFixed(1),
        },
      }),
    };
  });
}

// ─── Recent results ───────────────────────────────────────────────────────────

export function getRecentResults(team: Team, count = 5): GameResult[] {
  // F1 championship: return mock race result summaries
  if (team.id === 'f1-championship') {
    const now   = Date.now();
    const dayMs = 86_400_000;
    const races = F1_RACES;
    return Array.from({ length: count }, (_, i) => {
      const r1   = seededRandom('f1-championship', 100 + i * 3);
      const race = races[Math.floor(r1 * races.length)];
      return {
        opponent:      race.name,
        opponentAbbr:  race.abbr,
        isHome:        false,
        isWin:         false,
        teamScore:     1,
        opponentScore: 20,
        date:          new Date(now - (i + 1) * 14 * dayMs).toISOString(),
        competition:   'Formula 1',
      };
    });
  }

  const pool      = OPPONENT_POOLS[team.league] ?? AFL_OPPONENTS;
  const now       = Date.now();
  const dayMs     = 86_400_000;
  const winBias   = 0.40 + seededRandom(team.id, 99) * 0.40;

  return Array.from({ length: count }, (_, i) => {
    const r1   = seededRandom(team.id, 100 + i * 3);
    const r2   = seededRandom(team.id, 101 + i * 3);
    const r3   = seededRandom(team.id, 102 + i * 3);
    const r4   = seededRandom(team.id, 103 + i * 3); // used for draw roll (EPL only)
    const opp  = pool[Math.floor(r1 * pool.length)];
    const isWin  = r2 < winBias;
    const isHome = r3 > 0.5;

    let teamScore: number;
    let oppScore: number;
    let isDraw: boolean | undefined;

    switch (team.league) {
      case 'afl': {
        // AFL scores in points; typical game ~80–120
        teamScore = 70  + Math.floor(r1 * 60);
        oppScore  = isWin ? Math.max(40, teamScore - 3 - Math.floor(r2 * 40)) : teamScore + 3 + Math.floor(r2 * 40);
        break;
      }
      case 'nrl':
      case 'super_rugby':
      case 'rugby_int': {
        // Rugby scores in points; typical game ~18–36
        teamScore = 10 + Math.floor(r1 * 30);
        oppScore  = isWin ? Math.max(0, teamScore - 3 - Math.floor(r2 * 20)) : teamScore + 3 + Math.floor(r2 * 20);
        break;
      }
      case 'nba': {
        teamScore = 95 + Math.floor(r1 * 35);
        oppScore  = isWin ? teamScore - 1 - Math.floor(r2 * 20) : teamScore + 1 + Math.floor(r2 * 20);
        break;
      }
      case 'nfl': {
        const nflScores = [7, 10, 13, 14, 17, 20, 21, 24, 27, 28, 31, 35, 38];
        teamScore = nflScores[Math.floor(r1 * nflScores.length)];
        const filtered = isWin
          ? nflScores.filter(s => s < teamScore)
          : nflScores.filter(s => s > teamScore);
        oppScore = filtered[Math.floor(r2 * filtered.length)] ?? (isWin ? teamScore - 3 : teamScore + 3);
        break;
      }
      case 'mlb': {
        teamScore = Math.floor(r1 * 9);
        oppScore  = isWin ? Math.max(0, teamScore - 1 - Math.floor(r2 * 5)) : teamScore + 1 + Math.floor(r2 * 5);
        break;
      }
      case 'nhl': {
        teamScore = 1 + Math.floor(r1 * 5);
        oppScore  = isWin ? Math.max(0, teamScore - 1 - Math.floor(r2 * 2)) : teamScore + 1 + Math.floor(r2 * 2);
        break;
      }
      default: {
        // EPL / football — draws are common (~25% of games in a real PL season)
        if (!isWin && r4 > 0.45) {
          // ~55% of non-wins are draws (realistic relative rate)
          isDraw    = true;
          teamScore = Math.floor(r1 * 3);   // 0–2 typical draw scoreline
          oppScore  = teamScore;
        } else {
          teamScore = Math.floor(r1 * 4);
          oppScore  = isWin
            ? Math.max(0, teamScore - Math.floor(r2 * 2))
            : teamScore + 1 + Math.floor(r2 * 2);
        }
      }
    }

    return {
      opponent:      opp.name,
      opponentAbbr:  opp.abbr,
      isHome,
      isWin,
      isDraw:        isDraw || undefined,
      teamScore,
      opponentScore: Math.max(0, oppScore),
      date:          new Date(now - (i + 1) * 7 * dayMs).toISOString(),
    };
  });
}

// ─── News ─────────────────────────────────────────────────────────────────────

const NEWS_TEMPLATES = [
  { category: 'general' as const,  title: `{team} Gear Up for Crucial {league} Clash`,          summary: `{team} head coach addressed the media after training, highlighting defensive improvements and the team's preparation heading into the weekend fixture.` },
  { category: 'injury'  as const,  title: `{team} Key Player Listed as Doubtful for Round Fixture`, summary: `The club has confirmed their star contributor is racing the clock to be fit after picking up a knock in training. A decision is expected to be made on game day.` },
  { category: 'preview' as const,  title: `Three Things to Watch When {team} Takes the Field`,  summary: `A breakdown of the key tactical battles and individual matchups that could swing the result when {team} face their next opponent.` },
  { category: 'recap'   as const,  title: `{team} Grind Out Important Win in Hard-Fought Contest`, summary: `It wasn't pretty, but {team} claimed a crucial two points in a physical encounter that showcased the side's defensive resolve and ability to win tight games.` },
  { category: 'trade'   as const,  title: `{team} Active in Trade Market Ahead of Deadline`,    summary: `Sources indicate the club has held discussions with multiple clubs as they look to bolster depth in key positions before the trade window closes.` },
  { category: 'general' as const,  title: `{team} Coach Puts Trust in Youth Despite Pressure`,  summary: `The coaching staff have reaffirmed their commitment to several younger players, with the club backing long-term development over short-term fixes.` },
  { category: 'injury'  as const,  title: `Injury Update: {team} Receive Boost Ahead of Weekend`,summary: `Three players who have been sidelined returned to full training on Thursday, giving the coaching staff more selection options for the weekend's fixture.` },
  { category: 'preview' as const,  title: `Scouting Report: How {team} Can Beat Their Next Opponent`, summary: `Statistical analysis reveals the areas where {team} hold a measurable advantage and the matchup problems they'll need to exploit to come away with the win.` },
];

const SOURCES_AU = ['Fox Sports', 'The Age', 'Herald Sun', 'Sydney Morning Herald', 'AFL.com.au', 'NRL.com', 'Rugbypass', 'Zero Tackle'];
const SOURCES_INT = ['ESPN', 'The Athletic', 'Bleacher Report', 'CBS Sports', 'Fox Sports', 'Sky Sports'];

export function getRecentNews(team: Team, count = 3): NewsItem[] {
  const now     = Date.now();
  const hourMs  = 3_600_000;
  const isAus   = ['afl', 'nrl', 'super_rugby', 'rugby_int'].includes(team.league);
  const sources = isAus ? SOURCES_AU : SOURCES_INT;

  return Array.from({ length: count }, (_, i) => {
    const r1       = seededRandom(team.id, 200 + i);
    const r2       = seededRandom(team.id, 250 + i);
    const template = NEWS_TEMPLATES[Math.floor(r1 * NEWS_TEMPLATES.length)];
    const source   = sources[Math.floor(r2 * sources.length)];
    const hoursAgo = 1 + Math.floor(r1 * 47);

    return {
      id:          `news-${team.id}-${i}`,
      title:       template.title.replace(/{team}/g, team.shortName).replace(/{league}/g, team.league.toUpperCase()),
      summary:     template.summary.replace(/{team}/g, team.shortName),
      source,
      publishedAt: new Date(now - hoursAgo * hourMs).toISOString(),
      url:         '#',
      category:    template.category,
    };
  });
}

// ─── Rule-based matchup preview (no LLM — zero cost) ─────────────────────────
//
// Generates a 2–3 sentence preview and key factors entirely from the stats
// already collected. No API call, no hallucination, always available.

const FORM_INTROS: Record<number, string> = {
  5: 'in outstanding form, having won all five of their last five fixtures',
  4: 'carrying strong momentum, having won four of their last five',
  3: 'in reasonable form with three wins from their last five outings',
  2: 'looking to arrest a patchy run after winning just two of their last five',
  1: 'under pressure heading into this fixture, with only one win in five',
  0: 'in poor form, having failed to win any of their last five contests',
};

export function getAIPreview(
  team: Team,
  opponentName: string,
  recentResults?: GameResult[],
  context?: PreviewContext | null,
  competition?: string,
): { content: string; keyInsights: string[] } {
  const r1 = seededRandom(team.id + opponentName, 0);

  const hasReal = Array.isArray(recentResults) && recentResults.length >= 1;
  const total   = hasReal ? recentResults!.length : 5;
  const wins    = hasReal ? recentResults!.filter(r => r.isWin).length  : Math.floor(r1 * 6);
  const draws   = hasReal ? recentResults!.filter(r => r.isDraw).length : 0;
  const losses  = total - wins - draws;

  // For cup/off-league fixtures, ladder positions are irrelevant — suppress them.
  const isCup = !!competition;
  const ts = isCup ? undefined : context?.teamStanding;
  const os = isCup ? undefined : context?.opponentStanding;

  // ── Opening: standings position + games played (primary league only)
  let openingText: string;
  if (ts) {
    const pos = ordinal(ts.position);
    const playedNote = ts.played > 0 ? ` after ${ts.played} games` : '';
    openingText = `${team.shortName} sit ${pos} on the ladder${playedNote}`;
  } else if (hasReal && draws > 0) {
    openingText = `${team.shortName} head into this fixture on a run of ${wins}W-${draws}D-${losses}L from their last ${total}`;
  } else {
    openingText = `${team.shortName} head into this fixture ${FORM_INTROS[wins] ?? FORM_INTROS[3]}`;
  }

  // ── Form detail
  const formLabel = draws > 0
    ? `${wins}W-${draws}D-${losses}L from last ${total}`
    : `${wins}/${total} wins from their last ${total}`;
  const formNote = hasReal ? ` (${formLabel})` : '';

  // ── Mini-recap of last 3 actual results
  const recentStr = hasReal
    ? ` Last results: ${recentResults!.slice(0, 3).map(r => {
        const label = r.isDraw ? 'D' : r.isWin ? 'W' : 'L';
        const comp  = r.competition ? ` [${r.competition}]` : '';
        return `${label} v ${r.opponentAbbr} ${r.teamScore}–${r.opponentScore}${comp}`;
      }).join(', ')}.`
    : '';

  // ── Cup competition context (replaces ladder info for cup fixtures)
  const cupNote = isCup
    ? ` ${competition} fixture — league table positions are not relevant to this tie.`
    : '';

  // ── Opponent context
  let opponentNote = '';
  if (os) {
    const oPos = ordinal(os.position);
    opponentNote = ` They face ${opponentName}, who are ${oPos} on the table${os.played > 0 ? ` with ${os.played} games played` : ''}.`;
  } else {
    opponentNote = ` They face ${opponentName} in what promises to be a closely fought affair.`;
  }

  // ── Goals / scoring context (primary league only — not meaningful for cups)
  let scoringNote = '';
  if (!isCup && ts?.goalsFor !== undefined && ts.played > 0) {
    const gfAvg  = (ts.goalsFor / ts.played).toFixed(1);
    const gcAvg  = ts.goalsAgainst !== undefined ? (ts.goalsAgainst / ts.played).toFixed(1) : null;
    scoringNote = ` ${team.shortName} are averaging ${gfAvg} goals per game${gcAvg ? ` and conceding ${gcAvg}` : ''}.`;
  } else if (!isCup && ts?.percentage !== undefined) {
    scoringNote = ` Their percentage of ${ts.percentage.toFixed(1)} reflects their season${ts.percentage >= 100 ? ' in the black' : ' with room to improve'}.`;
  }

  // ── Tips (AFL model consensus)
  let tipsNote = '';
  if (context?.tips) {
    const t = context.tips;
    tipsNote = ` Squiggle models favour ${t.favouriteTeam} (${t.tipsFor}/${t.tipsTotal} tips, avg margin ${t.avgMargin} pts).`;
  }

  // ── Closing
  const closing = wins >= 4
    ? `${team.shortName} arrive in strong form and will be looking to extend that run.`
    : wins <= 1
      ? `${team.shortName} will be looking to turn their form around.`
      : `This shapes up as a competitive fixture.`;

  const content = [
    `${openingText}${formNote}.${recentStr}`,
    cupNote || opponentNote,
    scoringNote,
    tipsNote || closing,
  ].filter(Boolean).join('');

  // ── Key insights
  const keyInsights: string[] = [];

  if (ts) {
    keyInsights.push(`${team.shortName} ladder: ${ordinal(ts.position)} (${ts.wins}W-${ts.draws}D-${ts.losses}L, ${ts.played} played)`);
  } else {
    keyInsights.push(`${team.shortName}: ${formLabel}`);
  }

  if (os) {
    keyInsights.push(`${opponentName}: ${ordinal(os.position)} (${os.wins}W-${os.draws}D-${os.losses}L, ${os.played} played)`);
  } else {
    const cups = hasReal
      ? Array.from(new Set(recentResults!.filter(r => r.competition).map(r => r.competition!)))
      : [];
    if (cups.length > 0) {
      keyInsights.push(`Last ${total} spans ${cups.join(' + ')} + league fixtures`);
    } else {
      keyInsights.push(`Home advantage at ${team.venue} is a key factor`);
    }
  }

  if (context?.tips) {
    const t = context.tips;
    keyInsights.push(`Models tip ${t.favouriteTeam} (${t.tipsFor}/${t.tipsTotal}, ~${t.avgMargin} pt margin)`);
  } else {
    const homeGames = hasReal ? recentResults!.filter(r => r.isHome) : [];
    const homeWins  = homeGames.filter(r => r.isWin).length;
    if (homeGames.length > 0) {
      keyInsights.push(`${homeWins}/${homeGames.length} wins from recent home games`);
    }
  }

  return { content, keyInsights };
}
