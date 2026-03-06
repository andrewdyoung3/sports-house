/**
 * Mock data generators for the MVP.
 *
 * Each function uses a deterministic seed so the same team always returns
 * the same data across renders. Replace these with real API calls when
 * integrating Squiggle (AFL), API-Sports (NRL), football-data.org (EPL),
 * or Balldontlie (NBA).
 */

import type { GameResult, GamePreview, NewsItem, UpcomingGame } from '@/types';
import type { Team } from '@/types';
import { seededRandom } from '@/lib/utils';

// ─── Opponent pools (one per league) ─────────────────────────────────────────

const AFL_OPPONENTS = [
  { name: 'Richmond Tigers',       abbr: 'RIC', color: '#FFD200' },
  { name: 'Collingwood Magpies',   abbr: 'COL', color: '#000000' },
  { name: 'Carlton Blues',         abbr: 'CAR', color: '#0E1E2E' },
  { name: 'Melbourne Demons',      abbr: 'MEL', color: '#CC2031' },
  { name: 'Geelong Cats',          abbr: 'GEE', color: '#001F5B' },
  { name: 'Sydney Swans',          abbr: 'SYD', color: '#ED171F' },
  { name: 'Brisbane Lions',        abbr: 'BRI', color: '#A30046' },
  { name: 'Essendon Bombers',      abbr: 'ESS', color: '#CC2031' },
];

const NRL_OPPONENTS = [
  { name: 'Penrith Panthers',      abbr: 'PEN', color: '#1C1C1C' },
  { name: 'Melbourne Storm',       abbr: 'MEL', color: '#4B0082' },
  { name: 'Brisbane Broncos',      abbr: 'BRO', color: '#4D0045' },
  { name: 'Sydney Roosters',       abbr: 'SYD', color: '#003087' },
  { name: 'South Sydney Rabbitohs',abbr: 'SSR', color: '#006633' },
  { name: 'Newcastle Knights',     abbr: 'NEW', color: '#003087' },
  { name: 'Cronulla Sharks',       abbr: 'SHA', color: '#00A2D4' },
  { name: 'Parramatta Eels',       abbr: 'PAR', color: '#003087' },
];

const SUPER_RUGBY_OPPONENTS = [
  { name: 'Crusaders',             abbr: 'CRU', color: '#CC2031' },
  { name: 'Blues',                 abbr: 'BLU', color: '#003087' },
  { name: 'Chiefs',                abbr: 'CHF', color: '#CC2031' },
  { name: 'Hurricanes',            abbr: 'HUR', color: '#F5C900' },
  { name: 'Highlanders',           abbr: 'HIG', color: '#002B5C' },
  { name: 'Brumbies',              abbr: 'BRU', color: '#003087' },
  { name: 'Queensland Reds',       abbr: 'RED', color: '#CC2031' },
  { name: 'NSW Waratahs',          abbr: 'WAR', color: '#003087' },
];

const RUGBY_INT_OPPONENTS = [
  { name: 'New Zealand',           abbr: 'NZL', color: '#000000' },
  { name: 'South Africa',          abbr: 'RSA', color: '#007A4D' },
  { name: 'England',               abbr: 'ENG', color: '#003087' },
  { name: 'France',                abbr: 'FRA', color: '#002395' },
  { name: 'Ireland',               abbr: 'IRL', color: '#004225' },
  { name: 'Argentina',             abbr: 'ARG', color: '#75AADB' },
  { name: 'Wales',                 abbr: 'WAL', color: '#C8102E' },
  { name: 'Scotland',              abbr: 'SCO', color: '#003087' },
];

const NFL_OPPONENTS = [
  { name: 'Kansas City Chiefs',    abbr: 'KC',  color: '#E31837' },
  { name: 'Philadelphia Eagles',   abbr: 'PHI', color: '#004C54' },
  { name: 'San Francisco 49ers',   abbr: 'SF',  color: '#AA0000' },
  { name: 'Baltimore Ravens',      abbr: 'BAL', color: '#241773' },
  { name: 'Dallas Cowboys',        abbr: 'DAL', color: '#003594' },
  { name: 'Miami Dolphins',        abbr: 'MIA', color: '#008E97' },
  { name: 'Detroit Lions',         abbr: 'DET', color: '#0076B6' },
  { name: 'Buffalo Bills',         abbr: 'BUF', color: '#00338D' },
];

const NBA_OPPONENTS = [
  { name: 'Boston Celtics',        abbr: 'BOS', color: '#007A33' },
  { name: 'Golden State Warriors', abbr: 'GSW', color: '#1D428A' },
  { name: 'Los Angeles Lakers',    abbr: 'LAL', color: '#552583' },
  { name: 'Miami Heat',            abbr: 'MIA', color: '#98002E' },
  { name: 'Milwaukee Bucks',       abbr: 'MIL', color: '#00471B' },
  { name: 'Oklahoma City Thunder', abbr: 'OKC', color: '#007AC1' },
  { name: 'Denver Nuggets',        abbr: 'DEN', color: '#0E2240' },
  { name: 'Phoenix Suns',          abbr: 'PHX', color: '#1D1160' },
];

const MLB_OPPONENTS = [
  { name: 'New York Yankees',      abbr: 'NYY', color: '#132448' },
  { name: 'Los Angeles Dodgers',   abbr: 'LAD', color: '#005A9C' },
  { name: 'Houston Astros',        abbr: 'HOU', color: '#002D62' },
  { name: 'Atlanta Braves',        abbr: 'ATL', color: '#CE1141' },
  { name: 'Boston Red Sox',        abbr: 'BOS', color: '#BD3039' },
  { name: 'St. Louis Cardinals',   abbr: 'STL', color: '#C41E3A' },
  { name: 'Chicago Cubs',          abbr: 'CHC', color: '#0E3386' },
  { name: 'San Francisco Giants',  abbr: 'SF',  color: '#FD5A1E' },
];

const NHL_OPPONENTS = [
  { name: 'Boston Bruins',         abbr: 'BOS', color: '#FCB514' },
  { name: 'Colorado Avalanche',    abbr: 'COL', color: '#6F263D' },
  { name: 'Tampa Bay Lightning',   abbr: 'TBL', color: '#002868' },
  { name: 'Vegas Golden Knights',  abbr: 'VGK', color: '#B4975A' },
  { name: 'New York Rangers',      abbr: 'NYR', color: '#0038A8' },
  { name: 'Edmonton Oilers',       abbr: 'EDM', color: '#041E42' },
  { name: 'Florida Panthers',      abbr: 'FLA', color: '#041E42' },
  { name: 'Toronto Maple Leafs',   abbr: 'TOR', color: '#00205B' },
];

const EPL_OPPONENTS = [
  { name: 'Arsenal',               abbr: 'ARS', color: '#EF0107' },
  { name: 'Manchester City',       abbr: 'MCI', color: '#6CABDD' },
  { name: 'Liverpool',             abbr: 'LIV', color: '#C8102E' },
  { name: 'Chelsea',               abbr: 'CHE', color: '#034694' },
  { name: 'Tottenham Hotspur',     abbr: 'TOT', color: '#132257' },
  { name: 'Manchester United',     abbr: 'MUN', color: '#DA291C' },
  { name: 'Newcastle United',      abbr: 'NEW', color: '#241F20' },
  { name: 'Aston Villa',           abbr: 'AVL', color: '#670E36' },
];

type OpponentEntry = { name: string; abbr: string; color: string };

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
};

// ─── Broadcast pools ──────────────────────────────────────────────────────────

// Australian sports — broadcast info for AU audience
const AFL_BROADCASTS   = [['Seven Network', 'Fox Footy'], ['Seven Network'], ['Fox Footy']];
const NRL_BROADCASTS   = [['Nine Network', 'Fox League'], ['Nine Network'], ['Fox League']];
const SRUG_BROADCASTS  = [['Stan Sport'], ['Fox Sports', 'Stan Sport']];
const RINT_BROADCASTS  = [['Channel Nine', 'Stan Sport'], ['Stan Sport'], ['Fox Sports']];

// International sports
const NFL_BROADCASTS   = [['ESPN'], ['CBS'], ['FOX'], ['NBC'], ['NFL Network'], ['Amazon Prime Video']];
const NBA_BROADCASTS   = [['ESPN'], ['TNT'], ['ABC'], ['NBA TV']];
const MLB_BROADCASTS   = [['ESPN'], ['FOX'], ['TBS'], ['Apple TV+'], ['Peacock']];
const NHL_BROADCASTS   = [['ESPN'], ['TNT'], ['ABC']];
const EPL_BROADCASTS   = [['Optus Sport'], ['beIN Sports'], ['Optus Sport', 'beIN Sports']];

const AFL_STREAMING    = ['Kayo Sports', 'AFL+'];
const NRL_STREAMING    = ['Kayo Sports'];
const SRUG_STREAMING   = ['Stan Sport'];
const RINT_STREAMING   = ['Stan Sport', 'Kayo Sports'];
const NFL_STREAMING    = ['NFL+', 'ESPN+'];
const NBA_STREAMING    = ['NBA League Pass', 'ESPN+'];
const MLB_STREAMING    = ['MLB.TV', 'Apple TV+'];
const NHL_STREAMING    = ['ESPN+', 'Hulu'];
const EPL_STREAMING    = ['Optus Sport', 'Kayo Sports'];

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
};

// ─── Sport-specific game time display strings ─────────────────────────────────

const GAME_TIMES: Record<string, string[]> = {
  afl:         ['1:10 PM AEST', '3:20 PM AEST', '4:35 PM AEST', '7:40 PM AEST'],
  nrl:         ['3:00 PM AEST', '5:30 PM AEST', '6:00 PM AEST', '7:50 PM AEST'],
  super_rugby: ['4:35 PM AEST', '7:05 PM AEST', '7:35 PM AEST'],
  rugby_int:   ['3:10 PM AEST', '5:05 PM AEST', '7:00 PM AEST'],
  nfl:         ['12:00 PM ET', '3:30 PM ET',  '7:00 PM ET',  '8:15 PM ET'],
  nba:         ['7:00 PM ET',  '7:30 PM ET',  '8:00 PM ET',  '10:00 PM ET'],
  mlb:         ['1:10 PM ET',  '4:05 PM ET',  '7:05 PM ET'],
  nhl:         ['7:00 PM ET',  '7:30 PM ET',  '8:00 PM ET'],
  epl:         ['3:00 PM BST', '5:30 PM BST', '8:00 PM BST'],
};

// ─── Upcoming games ───────────────────────────────────────────────────────────

export function getUpcomingGames(team: Team, count = 2): UpcomingGame[] {
  const pool   = OPPONENT_POOLS[team.league]  ?? AFL_OPPONENTS;
  const bcPool = BROADCAST_POOLS[team.league] ?? AFL_BROADCASTS;
  const stPool = STREAMING_POOLS[team.league] ?? AFL_STREAMING;
  const tPool  = GAME_TIMES[team.league]      ?? GAME_TIMES.afl;
  const now    = Date.now();
  const dayMs  = 86_400_000;

  return Array.from({ length: count }, (_, i) => {
    const r1 = seededRandom(team.id, i * 3);
    const r2 = seededRandom(team.id, i * 3 + 1);
    const r3 = seededRandom(team.id, i * 3 + 2);

    const opp      = pool[Math.floor(r1 * pool.length)];
    const bc       = bcPool[Math.floor(r2 * bcPool.length)];
    const st       = [stPool[Math.floor(r3 * stPool.length)]];
    const time     = tPool[Math.floor(r2 * tPool.length)];
    const isHome   = r3 > 0.5;
    const daysAhead = 3 + i * 5 + Math.floor(r1 * 3);
    const gameDate  = new Date(now + daysAhead * dayMs);

    // Spread is only meaningful for NFL/NBA — skip for rugby/AFL
    const hasSpread = ['nfl', 'nba', 'mlb', 'epl'].includes(team.league);
    const spreadVal = (r1 * 14 - 7).toFixed(1);

    return {
      id:            `game-${team.id}-${i}`,
      teamId:        team.id,
      opponent:      opp.name,
      opponentAbbr:  opp.abbr,
      opponentColor: opp.color,
      isHome,
      date:          gameDate.toISOString(),
      time,
      venue:         isHome ? team.venue : `${opp.name} Home Ground`,
      broadcast:     bc,
      streaming:     st,
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
  const pool      = OPPONENT_POOLS[team.league] ?? AFL_OPPONENTS;
  const now       = Date.now();
  const dayMs     = 86_400_000;
  const winBias   = 0.40 + seededRandom(team.id, 99) * 0.40;

  return Array.from({ length: count }, (_, i) => {
    const r1   = seededRandom(team.id, 100 + i * 3);
    const r2   = seededRandom(team.id, 101 + i * 3);
    const r3   = seededRandom(team.id, 102 + i * 3);
    const opp  = pool[Math.floor(r1 * pool.length)];
    const isWin  = r2 < winBias;
    const isHome = r3 > 0.5;

    let teamScore: number;
    let oppScore: number;

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
        // EPL / football
        teamScore = Math.floor(r1 * 4);
        oppScore  = isWin ? Math.max(0, teamScore - Math.floor(r2 * 2)) : teamScore + Math.floor(r2 * 2);
      }
    }

    return {
      opponent:      opp.name,
      opponentAbbr:  opp.abbr,
      isHome,
      isWin,
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

export function getAIPreview(team: Team, opponentName: string): { content: string; keyInsights: string[] } {
  const r1       = seededRandom(team.id + opponentName, 0);
  const r2       = seededRandom(team.id + opponentName, 1);
  const r3       = seededRandom(team.id + opponentName, 2);

  const homeWins = Math.floor(r1 * 6); // 0–5
  const awayWins = Math.floor(r2 * 6);
  const homePos  = 1 + Math.floor(r1 * 12);
  const awayPos  = 1 + Math.floor(r2 * 12);

  const homeFormText = FORM_INTROS[homeWins] ?? FORM_INTROS[3];
  const awayFormText = FORM_INTROS[awayWins] ?? FORM_INTROS[3];

  // Sentence 1: home team form
  const s1 = `${team.shortName} head into this fixture ${homeFormText}.`;

  // Sentence 2: away team context
  const posCompare = awayPos < homePos
    ? `${opponentName}, who sit higher on the ladder, will arrive with genuine confidence.`
    : `${opponentName} are ${awayFormText} heading into the contest.`;
  const s2 = posCompare;

  // Sentence 3: edge call
  const scoreDiff = homeWins - awayWins + (awayPos - homePos) * 0.3 + 0.5; // home advantage
  const edgeTeam  = scoreDiff > 1 ? team.shortName : scoreDiff < -1 ? opponentName : 'neither side';
  const s3 = edgeTeam === 'neither side'
    ? `With both sides evenly matched on current form, this shaping up as a genuinely open contest.`
    : `On current form and ladder position, ${edgeTeam} hold a slight advantage — but the margin could be tight.`;

  const content = [s1, s2, s3].join(' ');

  // Key insights — deterministic, grounded only in available stats
  const allInsights = [
    `${team.shortName} have won ${homeWins} of their last 5 games`,
    `${opponentName} have won ${awayWins} of their last 5 games`,
    `${team.shortName} are currently placed ${homePos}th on the ladder`,
    `${opponentName} sit ${awayPos}th — ${awayPos < homePos ? 'above' : 'below'} ${team.shortName}`,
    `Home advantage at ${team.venue} is a consistent factor in tight games`,
    `The team with better recent form has won ${55 + Math.floor(r3 * 15)}% of recent head-to-head meetings`,
  ];

  const seen    = new Set<string>();
  const keyInsights = [0, 1, 4].map(i => allInsights[i]).filter(s => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  return { content, keyInsights };
}
