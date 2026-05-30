/**
 * GET /api/match-stats?league=epl&teamId=epl-arsenal&date=2026-03-15&teamScore=2&opponentScore=1
 *
 * Returns player and team stats for a completed game by locating the ESPN
 * event via scoreboard search then fetching the event summary.
 *
 * Supported leagues: EPL, NRL, Super Rugby, Rugby Int (AFL has no usable ESPN player stats).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { MatchStats, PlayerStatLine, TeamMatchStats } from '@/types';
import { fetchTimeout } from '@/lib/espn';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' };

// ─── ESPN team ID maps ────────────────────────────────────────────────────────

const EPL_ESPN_ID: Record<string, string> = {
  'epl-arsenal':       '359',
  'epl-astonvilla':    '362',
  'epl-bournemouth':   '349',
  'epl-brentford':     '337',
  'epl-brighton':      '331',
  'epl-burnley':       '379',
  'epl-chelsea':       '363',
  'epl-crystalpalace': '384',
  'epl-everton':       '368',
  'epl-fulham':        '370',
  'epl-leeds':         '357',
  'epl-liverpool':     '364',
  'epl-mancity':       '382',
  'epl-manutd':        '360',
  'epl-newcastle':     '361',
  'epl-forest':        '393',
  'epl-spurs':         '367',
  'epl-sunderland':    '366',
  'epl-westham':       '371',
  'epl-wolves':        '380',
};

const NRL_ESPN_ID: Record<string, string> = {
  'nrl-broncos':   '289195',
  'nrl-raiders':   '289198',
  'nrl-bulldogs':  '289197',
  'nrl-sharks':    '289203',
  'nrl-dolphins':  '289346',
  'nrl-titans':    '289206',
  'nrl-eels':      '289194',
  'nrl-panthers':  '289199',
  'nrl-seahawks':  '289196',
  'nrl-storm':     '289208',
  'nrl-knights':   '289207',
  'nrl-warriors':  '289201',
  'nrl-cowboys':   '289202',
  'nrl-rabbitohs': '289205',
  'nrl-dragons':   '289209',
  'nrl-roosters':  '289204',
  'nrl-tigers':    '289200',
};

const SRU_ESPN_ID: Record<string, string> = {
  'sru-brumbies':    '25889',
  'sru-reds':        '182',
  'sru-waratahs':    '227',
  'sru-force':       '25893',
  'sru-blues':       '25932',
  'sru-chiefs':      '25934',
  'sru-crusaders':   '25936',
  'sru-highlanders': '25938',
  'sru-hurricanes':  '25939',
  'sru-drua':        '289338',
  'sru-moana':       '289319',
};

const RINT_ESPN_ID: Record<string, string> = {
  'rint-wallabies': '6',
  'rint-allblacks': '8',
  'rint-boks':      '5',
  'rint-england':   '1',
  'rint-ireland':   '3',
  'rint-france':    '9',
  'rint-scotland':  '2',
  'rint-wales':     '4',
  'rint-argentina': '10',
  'rint-fiji':      '14',
  'rint-samoa':     '15',
  'rint-tonga':     '16',
};

// ─── Sport / competition config ───────────────────────────────────────────────

/** Map competition label → ESPN soccer slug. */
const COMP_SLUG: Record<string, string> = {
  'Premier League':   'eng.1',
  'FA Cup':           'eng.fa',
  'EFL Cup':          'eng.league_cup',
  'Champions League': 'uefa.champions',
  'Europa League':    'uefa.europa',
};

/** Which ESPN scoreboards to search for each league. Order matters — default slug first. */
function getSlugsForLeague(league: string, competition?: string): { sportPath: string }[] {
  if (league === 'nrl') {
    return [{ sportPath: 'rugby-league/3' }];
  }
  if (league === 'super_rugby') {
    return [{ sportPath: 'rugby/242041' }];
  }
  if (league === 'rugby_int') {
    // Try all three international rugby competition feeds
    return [
      { sportPath: 'rugby/289234' }, // International tests
      { sportPath: 'rugby/244293' }, // Rugby Championship
      { sportPath: 'rugby/180659' }, // Six Nations
    ];
  }
  if (league === 'epl') {
    // If we know the competition, try that slug first
    const compSlug = competition ? COMP_SLUG[competition] : undefined;
    const allSlugs = ['eng.1', 'eng.fa', 'eng.league_cup', 'uefa.champions', 'uefa.europa'];
    const ordered  = compSlug
      ? [compSlug, ...allSlugs.filter(s => s !== compSlug)]
      : allSlugs;
    return ordered.map(s => ({ sportPath: `soccer/${s}` }));
  }
  return [];
}

// ─── Event discovery ──────────────────────────────────────────────────────────

/**
 * Search the scoreboard for a specific date, returning the event ID and
 * the sport path where it was found (needed for the summary URL).
 */
async function findEvent(
  sportPaths: { sportPath: string }[],
  espnTeamId: string,
  date: string,         // ISO date string
  teamScore: number,
  opponentScore: number,
): Promise<{ eventId: string; sportPath: string } | null> {
  const dateStr = date.slice(0, 10).replace(/-/g, '');

  for (const { sportPath } of sportPaths) {
    try {
      const res = await fetchTimeout(
        `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}&limit=100`,
        { next: { revalidate: 86400 } },
      );
      if (!res.ok) continue;

      const data    = await res.json();
      const events  = (data.events ?? []) as any[];

      for (const event of events) {
        const comp: any   = event.competitions?.[0];
        if (!comp?.competitors) continue;

        const competitors: any[] = comp.competitors;
        const ourComp = competitors.find((c: any) => String(c.team?.id) === espnTeamId);
        if (!ourComp) continue;

        const oppComp = competitors.find((c: any) => String(c.team?.id) !== espnTeamId);
        if (!oppComp) continue;

        const evTeam = Number(ourComp.score ?? -1);
        const evOpp  = Number(oppComp.score  ?? -1);

        if (evTeam === teamScore && evOpp === opponentScore) {
          return { eventId: String(event.id), sportPath };
        }
      }
    } catch { /* ignore per-slug errors, try next */ }
  }
  return null;
}

// ─── Stats parsing ────────────────────────────────────────────────────────────

/** Priority player stat keys + short display labels per league. */
const PLAYER_STAT_KEYS: Record<string, Array<{ key: string; label: string }>> = {
  epl: [
    { key: 'goals',              label: 'G'  },
    { key: 'assists',            label: 'A'  },
    { key: 'totalShots',         label: 'SH' },
    { key: 'shotsOnTarget',      label: 'SoT'},
    { key: 'yellowCards',        label: 'YC' },
  ],
  nrl: [
    { key: 'tries',      label: 'T'  },
    { key: 'goals',      label: 'G'  },
    { key: 'tackles',    label: 'Tk' },
    { key: 'runs',       label: 'R'  },
    { key: 'runMetres',  label: 'M'  },
  ],
  super_rugby: [
    { key: 'tries',          label: 'T'  },
    { key: 'carries',        label: 'C'  },
    { key: 'metresGained',   label: 'M'  },
    { key: 'tackles',        label: 'Tk' },
    { key: 'lineoutsWon',    label: 'LW' },
  ],
  rugby_int: [
    { key: 'tries',          label: 'T'  },
    { key: 'carries',        label: 'C'  },
    { key: 'metresGained',   label: 'M'  },
    { key: 'tackles',        label: 'Tk' },
    { key: 'lineoutsWon',    label: 'LW' },
  ],
};

/** Priority aggregate team-level stat keys per league. */
const TEAM_STAT_KEYS: Record<string, Array<{ key: string; label: string }>> = {
  epl: [
    { key: 'possessionPct',    label: 'Poss %'  },
    { key: 'totalShots',       label: 'Shots'   },
    { key: 'shotsOnTarget',    label: 'On Target'},
    { key: 'cornersTotal',     label: 'Corners'  },
    { key: 'foulsCommitted',   label: 'Fouls'    },
  ],
  nrl: [
    { key: 'possessionPct',    label: 'Poss %'   },
    { key: 'completionRate',   label: 'Comp %'   },
    { key: 'errors',           label: 'Errors'   },
    { key: 'penalties',        label: 'Pens'     },
    { key: 'tries',            label: 'Tries'    },
  ],
  super_rugby: [
    { key: 'possessionPct',    label: 'Poss %'   },
    { key: 'territory',        label: 'Terr %'   },
    { key: 'trysScored',       label: 'Tries'    },
    { key: 'scrumsPct',        label: 'Scrums %' },
    { key: 'lineoutsWonPct',   label: 'Lineouts %'},
  ],
  rugby_int: [
    { key: 'possessionPct',    label: 'Poss %'   },
    { key: 'territory',        label: 'Terr %'   },
    { key: 'trysScored',       label: 'Tries'    },
    { key: 'scrumsPct',        label: 'Scrums %' },
    { key: 'lineoutsWonPct',   label: 'Lineouts %'},
  ],
};

/** Extract team aggregate stats from boxscore.teams. */
function extractTeamAggStats(
  teams: any[],
  espnTeamId: string,
  keys: Array<{ key: string; label: string }>,
): Array<{ label: string; value: string }> {
  const teamEntry = teams.find((t: any) => String(t.team?.id) === espnTeamId);
  if (!teamEntry) return [];

  const statistics: any[] = teamEntry.statistics ?? [];
  const result: Array<{ label: string; value: string }> = [];

  for (const { key, label } of keys) {
    const stat = statistics.find((s: any) => s.name === key || s.abbreviation === key);
    if (stat?.displayValue && stat.displayValue !== '0' && stat.displayValue !== '0.0') {
      result.push({ label, value: stat.displayValue });
    }
  }

  return result;
}

/** Extract player stats from boxscore.players (one entry per team). */
function extractPlayerStats(
  playersData: any[],
  espnTeamId: string,
  keys: Array<{ key: string; label: string }>,
  maxPlayers = 8,
): PlayerStatLine[] {
  const teamEntry = playersData.find((p: any) => String(p.team?.id) === espnTeamId);
  if (!teamEntry) return [];

  const statsGroups: any[] = teamEntry.statistics ?? [];
  if (statsGroups.length === 0) return [];

  // Use the stat group with the most athletes (usually the combined starters+bench group)
  const mainGroup = statsGroups.reduce(
    (best: any, g: any) => ((g.athletes?.length ?? 0) > (best.athletes?.length ?? 0) ? g : best),
    statsGroups[0],
  );

  const groupKeys: string[]   = mainGroup.keys  ?? mainGroup.names ?? [];
  const athletes:  any[]      = mainGroup.athletes ?? [];

  // Build key → column index map
  const keyIdx: Record<string, number> = {};
  groupKeys.forEach((k: string, i: number) => { keyIdx[k] = i; });

  const players: PlayerStatLine[] = athletes
    .map((a: any): PlayerStatLine => {
      const rawStats: string[] = a.stats ?? [];
      const extractedStats = keys
        .filter(({ key }) => keyIdx[key] !== undefined)
        .map(({ key, label }) => ({
          label,
          value: rawStats[keyIdx[key]] ?? '0',
        }))
        .filter(({ value }) => value !== '' && value !== '--');

      return {
        name:     a.athlete?.displayName ?? a.athlete?.shortName ?? 'Unknown',
        position: a.athlete?.position?.abbreviation,
        stats:    extractedStats,
      };
    })
    // Sort: players with scoring contribution first (first key = primary scoring stat)
    .sort((a, b) => {
      const aVal = Number(a.stats[0]?.value ?? 0);
      const bVal = Number(b.stats[0]?.value ?? 0);
      return bVal - aVal;
    })
    .filter(p => p.stats.length > 0);

  return players.slice(0, maxPlayers);
}

/** Parse the event summary into MatchStats. */
function parseSummary(
  summary: any,
  league: string,
  espnTeamId: string,
): MatchStats | null {
  const boxscore = summary.boxscore;
  if (!boxscore) return null;

  const bsTeams:   any[] = boxscore.teams   ?? [];
  const bsPlayers: any[] = boxscore.players ?? [];

  const playerKeys = PLAYER_STAT_KEYS[league] ?? PLAYER_STAT_KEYS.super_rugby;
  const teamKeys   = TEAM_STAT_KEYS[league]   ?? TEAM_STAT_KEYS.super_rugby;

  // Identify opponent team ID
  const oppTeamId = bsTeams
    .map((t: any) => String(t.team?.id))
    .find(id => id !== espnTeamId) ?? '';

  const getTeamName = (id: string) =>
    bsTeams.find((t: any) => String(t.team?.id) === id)?.team?.displayName ?? '';

  const team: TeamMatchStats = {
    teamName: getTeamName(espnTeamId),
    aggStats: extractTeamAggStats(bsTeams, espnTeamId, teamKeys),
    players:  extractPlayerStats(bsPlayers, espnTeamId, playerKeys),
  };

  const opponent: TeamMatchStats = {
    teamName: getTeamName(oppTeamId),
    aggStats: extractTeamAggStats(bsTeams, oppTeamId, teamKeys),
    players:  extractPlayerStats(bsPlayers, oppTeamId, playerKeys),
  };

  // If neither team has player data, the sport doesn't provide it via this endpoint
  if (team.players.length === 0 && opponent.players.length === 0) return null;

  return { team, opponent };
}

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED = new Set(['nrl', 'epl', 'super_rugby', 'rugby_int']);
const TEAMID_RE = /^[a-z]+-[a-z0-9-]+$/;

export async function GET(req: NextRequest) {
  const p            = req.nextUrl.searchParams;
  const league       = p.get('league')       ?? '';
  const teamId       = p.get('teamId')       ?? '';
  const date         = p.get('date')         ?? '';
  const teamScore    = Number(p.get('teamScore')    ?? '');
  const opponentScore = Number(p.get('opponentScore') ?? '');
  const competition  = p.get('competition')  ?? undefined;

  if (!ALLOWED.has(league) || !TEAMID_RE.test(teamId) || !date) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  // Resolve ESPN team ID
  const idMaps: Record<string, Record<string, string>> = {
    epl: EPL_ESPN_ID, nrl: NRL_ESPN_ID, super_rugby: SRU_ESPN_ID, rugby_int: RINT_ESPN_ID,
  };
  const espnTeamId = idMaps[league]?.[teamId];
  if (!espnTeamId) {
    return NextResponse.json({ error: 'Unknown team' }, { status: 404 });
  }

  try {
    const sportPaths = getSlugsForLeague(league, competition);

    const found = await findEvent(sportPaths, espnTeamId, date, teamScore, opponentScore);
    if (!found) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const summaryRes = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/${found.sportPath}/summary?event=${found.eventId}`,
      { next: { revalidate: 86400 } },
    );
    if (!summaryRes.ok) {
      return NextResponse.json({ error: 'Summary unavailable' }, { status: 502 });
    }

    const summary  = await summaryRes.json();
    const stats    = parseSummary(summary, league, espnTeamId);
    if (!stats) {
      return NextResponse.json({ error: 'No stats in summary' }, { status: 404 });
    }

    return NextResponse.json(stats, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/match-stats]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
