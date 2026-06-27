/**
 * Shared preview data fetchers — the SINGLE source of truth for per-league
 * context (standings, news, lineups, injuries, key performers, squads, tips,
 * F1 race data, World Cup groups).
 *
 * Both /api/preview (display route) and buildPreviewContext (generation path)
 * import these. Do NOT duplicate a fetcher anywhere else — extend it here.
 *
 * Each fetch*Preview(teamId, opponentName, ...) returns a Partial<PreviewContext>.
 * NOT safe to import in client components — Node-only network fetches.
 */

import type {
  PreviewContext, TeamStanding, NewsHeadline, TipSummary, CompetitionStage,
  LeagueTableRow, WorldCupMatchContext, WorldCupGroupRow, WorldCupStage,
  GameResult, HeadToHeadMeeting,
} from '@/types';
import { F1_DRIVER_IDS, ERGAST_ID_TO_TEAM_ID, F1_DRIVERS, F1_CONSTRUCTOR_TEAMS } from '@/lib/f1-data';
import { lookupEnglishDivision, ENGLISH_TIER_SLUG } from '@/lib/english-football-divisions';
import { fetchTimeout } from '@/lib/espn';
import { SQUIGGLE_NAME } from '@/lib/afl';
import { WC_ID_TO_ESPN_NAME, WC_ESPN_NAME_TO_ID, WC_TEAM_GROUPS, computeGroupAdvancementScenario } from '@/lib/world-cup';
import {
  cricketConfigured, cricMatchInfo, cricMatchSquad, cricSeriesInfo, type CricMatch,
} from '@/lib/cricketdata';
import { fetchAflLineups } from '@/lib/afl-roster';
import { SOO_META, isSOOEvent, tallySeries, seriesStateForPreview } from '@/lib/soo';

// ─── AFL — Squiggle ───────────────────────────────────────────────────────────
// SQUIGGLE_NAME lives in @/lib/afl (derived from teams.ts/team-logos.ts).

export async function fetchAFLPreview(
  teamId: string,
  opponentName: string,
  gameId: string,
): Promise<PreviewContext> {
  const sqTeam = SQUIGGLE_NAME[teamId];
  if (!sqTeam) return {};

  const year = new Date().getFullYear();

  // Fan out — standings + upcoming game tips in parallel
  const [standingsRes, gamesRes] = await Promise.allSettled([
    fetchTimeout(
      `https://api.squiggle.com.au/?q=standings;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
    ),
    fetchTimeout(
      `https://api.squiggle.com.au/?q=games;year=${year}`,
      { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
    ),
  ]);

  // ── Standings ──
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;
  let leagueTable: LeagueTableRow[] | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
    const { standings = [] } = await standingsRes.value.json();
    const oppSqName = SQUIGGLE_NAME[Object.keys(SQUIGGLE_NAME).find(k => SQUIGGLE_NAME[k].toLowerCase() === opponentName.toLowerCase()) ?? ''];
    for (const s of standings as any[]) {
      const entry: TeamStanding = {
        name:       s.name,
        position:   Number(s.rank),
        played:     Number(s.played ?? 0),
        wins:       Number(s.wins ?? 0),
        draws:      Number(s.draws ?? 0),
        losses:     Number(s.losses ?? 0),
        percentage: parseFloat(s.percentage ?? '0'),
      };
      if (s.name === sqTeam) teamStanding = entry;
      if (s.name === (oppSqName ?? opponentName)) opponentStanding = entry;
    }
    // Full table for mathematical analysis (AFL: 4pts/win, 2pts/draw)
    // Percentage is the AFL tiebreaker when teams are level on ladder points.
    leagueTable = (standings as any[]).map((s: any): LeagueTableRow => ({
      name:       String(s.name ?? ''),
      position:   Number(s.rank ?? 0),
      played:     Number(s.played ?? 0),
      wins:       Number(s.wins ?? 0),
      draws:      Number(s.draws ?? 0),
      losses:     Number(s.losses ?? 0),
      // Squiggle uses "pts" not "points" — check both
      points:     Number(s.pts ?? s.points ?? 0),
      percentage: s.percentage != null ? parseFloat(String(s.percentage)) : undefined,
    })).filter(r => r.name);
  }

  // ── Tips for the specific upcoming game ──
  let tips: TipSummary | undefined;
  let teamSquad: string[] | undefined;
  let opponentSquad: string[] | undefined;
  let teamRecentForm: GameResult[] | undefined;
  let opponentRecentForm: GameResult[] | undefined;
  let headToHead: HeadToHeadMeeting[] | undefined;

  // gameId is like "afl-1234" or "afl-lions-vs-geelong-..." — extract numeric portion
  const numericId = gameId.replace(/^afl-/, '').match(/^\d+$/)?.[0];

  // Resolve opponent's Squiggle name once (used by squad, form, and H2H below).
  const oppSqKey  = Object.entries(SQUIGGLE_NAME).find(
    ([, v]) => v.toLowerCase() === opponentName.toLowerCase(),
  )?.[0];
  const oppSqName = oppSqKey ? SQUIGGLE_NAME[oppSqKey] : opponentName;

  // Parse the season's games once — shared by tips/squad and the form/H2H derivation.
  const aflGames: any[] = (gamesRes.status === 'fulfilled' && gamesRes.value.ok)
    ? ((await gamesRes.value.json()).games ?? [])
    : [];

  // ── Recent form + head-to-head from completed games (no extra fetch) ──
  {
    const completed = aflGames
      .filter(g => Number(g.complete) === 100)
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

    const mapAflGame = (g: any, subject: string): GameResult => {
      const isHome    = g.hteam === subject;
      const teamScore = isHome ? Number(g.hscore ?? 0) : Number(g.ascore ?? 0);
      const oppScore  = isHome ? Number(g.ascore ?? 0) : Number(g.hscore ?? 0);
      return {
        opponent:      isHome ? (g.ateam ?? '') : (g.hteam ?? ''),
        opponentAbbr:  '',
        isHome,
        isWin:         teamScore > oppScore,
        isDraw:        teamScore === oppScore,
        teamScore,
        opponentScore: oppScore,
        date:          g.date ?? '',
      };
    };

    const teamForm = completed.filter(g => g.hteam === sqTeam || g.ateam === sqTeam).slice(0, 5);
    const oppForm  = completed.filter(g => g.hteam === oppSqName || g.ateam === oppSqName).slice(0, 5);
    if (teamForm.length > 0) teamRecentForm     = teamForm.map(g => mapAflGame(g, sqTeam));
    if (oppForm.length  > 0) opponentRecentForm = oppForm.map(g => mapAflGame(g, oppSqName));

    const meetings = completed
      .filter(g =>
        (g.hteam === sqTeam && g.ateam === oppSqName) ||
        (g.hteam === oppSqName && g.ateam === sqTeam))
      .slice(0, 5)
      .map((g): HeadToHeadMeeting => {
        const r = mapAflGame(g, sqTeam);
        return {
          date:          r.date,
          teamScore:     r.teamScore,
          opponentScore: r.opponentScore,
          result:        r.isDraw ? 'D' : r.isWin ? 'W' : 'L',
          teamWasHome:   r.isHome,
        };
      });
    if (meetings.length > 0) headToHead = meetings;
  }

  if (numericId && aflGames.length > 0) {
    // Find the game matching our teams (may not have tips endpoint without numeric ID)
    const matchGame = aflGames.find(g =>
      Number(g.complete) < 100 &&
      ((g.hteam === sqTeam || g.ateam === sqTeam)),
    );

    if (matchGame) {
      const tipsRes = await fetchTimeout(
        `https://api.squiggle.com.au/?q=tips;game=${matchGame.id}`,
        { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 3600 } },
      ).catch(() => null);

      if (tipsRes?.ok) {
        const { tips: rawTips = [] } = await tipsRes.json();
        if (rawTips.length > 0) {
          const counts: Record<string, number> = {};
          let totalMargin = 0;

          for (const t of rawTips as any[]) {
            const tip = t.tip as string;
            counts[tip] = (counts[tip] ?? 0) + 1;
            totalMargin += Math.abs(Number(t.margin ?? 0));
          }

          const favourite = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          tips = {
            favouriteTeam: favourite[0],
            tipsFor:       favourite[1],
            tipsTotal:     rawTips.length,
            avgMargin:     Math.round(totalMargin / rawTips.length),
          };
        }
      }

      // Fetch squad submissions for the current round — serial step (needs round from matchGame)
      if (matchGame.round) {
        const squadRes = await fetchTimeout(
          `https://api.squiggle.com.au/?q=squads;year=${year};round=${matchGame.round}`,
          { headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, next: { revalidate: 1800 } },
        ).catch(() => null);

        if (squadRes?.ok) {
          const { squads: rawSquads = [] } = await squadRes.json();
          // Squiggle sometimes returns an array, sometimes {home, away} dict — guard both.
          if (Array.isArray(rawSquads) && rawSquads.length > 0) {
          const teamEntries = rawSquads.filter((p: any) => p.team === sqTeam);
          const oppEntries  = rawSquads.filter((p: any) => p.team === oppSqName);

          if (teamEntries.length > 0) {
            teamSquad = teamEntries.map((p: any) => (p.name ?? '') as string).filter(Boolean);
          }
          if (oppEntries.length > 0) {
            opponentSquad = oppEntries.map((p: any) => (p.name ?? '') as string).filter(Boolean);
          }
          } // end Array.isArray guard
        }
      }

      // AFL.com named team lists (Squiggle squads return null) — the real source.
      // Empty until teams are named (~Thursday); overrides Squiggle when present.
      if (matchGame.round) {
        const afl = await fetchAflLineups(Number(matchGame.round), sqTeam, oppSqName);
        if (afl.teamSquad)     teamSquad = afl.teamSquad;
        if (afl.opponentSquad) opponentSquad = afl.opponentSquad;
      }
    }
  }

  return {
    teamStanding,
    opponentStanding,
    leagueTable: leagueTable && leagueTable.length > 0 ? leagueTable : undefined,
    tips,
    teamSquad,
    opponentSquad,
    teamRecentForm,
    opponentRecentForm,
    headToHead,
  };
}

// ─── NRL — ESPN (league ID: 3) ────────────────────────────────────────────────

export const NRL_ESPN_NAME: Record<string, string> = {
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

/**
 * Mock opponent names in NRL_OPPONENTS use full names; ESPN standings use short
 * names. This map translates so the standings lookup can match.
 */
const NRL_FULL_TO_ESPN: Record<string, string> = {
  'Penrith Panthers':          'Panthers',
  'Melbourne Storm':           'Storm',
  'Brisbane Broncos':          'Broncos',
  'Sydney Roosters':           'Roosters',
  'South Sydney Rabbitohs':    'Rabbitohs',
  'Newcastle Knights':         'Knights',
  'Cronulla Sharks':           'Sharks',
  'Parramatta Eels':           'Eels',
  'Canberra Raiders':          'Raiders',
  'Canterbury Bulldogs':       'Bulldogs',
  'Dolphins':                  'Dolphins',
  'Gold Coast Titans':         'Titans',
  'Manly-Warringah Sea Eagles':'Sea Eagles',
  'New Zealand Warriors':      'Warriors',
  'North Queensland Cowboys':  'Cowboys',
  'St George Illawarra Dragons':'Dragons',
  'Wests Tigers':              'Wests Tigers',
};

/** NRL ESPN standings use gamesWon/gamesLost/gamesDrawn, not wins/losses/ties. */
function parseNRLStandings(entries: any[], displayName: string): TeamStanding | undefined {
  const e = entries.find((x: any) => x.team?.displayName === displayName);
  if (!e) return undefined;
  const stats = e.stats ?? [];
  return {
    name:         displayName,
    position:     statVal(stats, 'rank'),
    played:       statVal(stats, 'gamesPlayed'),
    wins:         statVal(stats, 'gamesWon'),
    draws:        statVal(stats, 'gamesDrawn'),
    losses:       statVal(stats, 'gamesLost'),
    points:       statVal(stats, 'points'),
    goalsFor:     statVal(stats, 'pointsFor'),
    goalsAgainst: statVal(stats, 'pointsAgainst'),
  };
}

/**
 * State of Origin preview context. Reps have no club ladder, so standings are
 * suppressed; the SERIES STATE (from shared soo.ts) replaces it. Form + lineups
 * come from the ESPN summary extractor by rep name + eventId. Head-to-head is
 * omitted because for Origin it IS the recent form (the sides only play each
 * other) — surfacing both would be redundant.
 */
async function fetchSOOPreview(teamId: string, eventId?: string): Promise<PreviewContext> {
  const meta = SOO_META[teamId];
  if (!meta || !eventId) return {};

  const extras = await fetchESPNMatchExtras('rugby-league/3', eventId, meta.self, meta.opponent, 13);

  let seriesState: string | undefined;
  try {
    const year = new Date().getFullYear();
    const res = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=${year}0415-${year}0901&limit=200`,
      { next: { revalidate: 3600 } },
    );
    if (res.ok) {
      const data = await res.json();
      const allSOO = ((data.events ?? []) as any[])
        .filter(isSOOEvent)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const idx = allSOO.findIndex(e => String(e.id) === String(eventId));
      if (idx >= 0) seriesState = seriesStateForPreview(tallySeries(allSOO, meta), meta, idx + 1);
    }
  } catch { /* series state is best-effort */ }

  return {
    teamRecentForm:     extras.teamRecentForm,
    opponentRecentForm: extras.opponentRecentForm,
    teamLastLineup:     extras.teamLastLineup,
    opponentLastLineup: extras.opponentLastLineup,
    seriesState,
    // No leagueTable/standings (reps have no club ladder); no headToHead (= form here).
  };
}

export async function fetchNRLPreview(
  teamId: string,
  opponentName: string,
  eventId?: string,
): Promise<PreviewContext> {
  if (SOO_META[teamId]) return fetchSOOPreview(teamId, eventId);

  const teamESPNName = NRL_ESPN_NAME[teamId];
  const teamESPNId   = NRL_ESPN_ID[teamId];
  if (!teamESPNName) return {};

  // Opponent may be a full name (from mock data) — translate to ESPN short name
  const oppESPNName = NRL_FULL_TO_ESPN[opponentName] ?? opponentName;
  const oppId       = Object.entries(NRL_ESPN_NAME).find(([, v]) => v === oppESPNName)?.[0];
  const oppESPNId   = oppId ? NRL_ESPN_ID[oppId] : undefined;

  const [standingsRes, teamNewsRes, oppNewsRes, extrasRes, teamInjuryRes, oppInjuryRes] = await Promise.allSettled([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/rugby-league/3/standings',
      { next: { revalidate: 3600 } },
    ),
    teamESPNId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/teams/${teamESPNId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    oppESPNId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/teams/${oppESPNId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    fetchESPNMatchExtras('rugby-league/3', eventId, teamESPNName, oppESPNName, 13),
    teamESPNId ? fetchESPNInjuries('rugby-league/3', teamESPNId)   : Promise.resolve([]),
    oppESPNId  ? fetchESPNInjuries('rugby-league/3', oppESPNId)    : Promise.resolve([]),
  ]);

  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;
  let leagueTable: LeagueTableRow[] | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value?.ok) {
    const data = await standingsRes.value.json();
    const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
    teamStanding     = parseNRLStandings(entries, teamESPNName);
    opponentStanding = parseNRLStandings(entries, oppESPNName);
    leagueTable = sortByEntryRank(entries).map((e: any, i: number): LeagueTableRow => {
      const s = e.stats ?? [];
      const sv = (n: string) => Number(s.find((x: any) => x.name === n)?.value ?? 0);
      return {
        name:     e.team?.displayName ?? '',
        position: entryRank(e, i),
        played:   sv('gamesPlayed'),
        wins:     sv('gamesWon'),
        draws:    sv('gamesDrawn'),
        losses:   sv('gamesLost'),
        points:   sv('points'),
      };
    }).filter(r => r.name);
  }

  const teamNews: NewsHeadline[] = [];
  const opponentNews: NewsHeadline[] = [];

  if (teamNewsRes.status === 'fulfilled' && teamNewsRes.value?.ok) {
    const data = await teamNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      teamNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }
  if (oppNewsRes.status === 'fulfilled' && oppNewsRes.value?.ok) {
    const data = await oppNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      opponentNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};

  const teamInjuries = teamInjuryRes.status === 'fulfilled' ? teamInjuryRes.value : [];
  const oppInjuries  = oppInjuryRes.status  === 'fulfilled' ? oppInjuryRes.value  : [];

  return {
    teamStanding,
    opponentStanding,
    leagueTable:           leagueTable && leagueTable.length > 0 ? leagueTable : undefined,
    teamNews:              teamNews.length > 0     ? teamNews     : undefined,
    opponentNews:          opponentNews.length > 0 ? opponentNews : undefined,
    teamLastLineup:        extras.teamLastLineup,
    opponentLastLineup:    extras.opponentLastLineup,
    teamRecentForm:        extras.teamRecentForm,
    opponentRecentForm:    extras.opponentRecentForm,
    headToHead:            extras.headToHead,
    teamInjuryReport:      teamInjuries.length   > 0 ? teamInjuries   : undefined,
    opponentInjuryReport:  oppInjuries.length    > 0 ? oppInjuries    : undefined,
  };
}

// ─── Cup / European competition stage detection ───────────────────────────────

/** ESPN soccer slug for each tracked cup/European competition. */
const COMP_ESPN_SLUG: Record<string, string> = {
  'Champions League':  'uefa.champions',
  'Europa League':     'uefa.europa',
  'Conference League': 'uefa.conference.league',
  'FA Cup':            'eng.fa',
  'EFL Cup':           'eng.league_cup',
};

/** Normalise raw ESPN event-note text to a clean round label. */
function normaliseRoundName(raw: string): string {
  // Strip leading competition name prefixes ESPN sometimes includes
  const stripped = raw.replace(
    /^(UEFA Champions League|UEFA Europa League|UEFA Conference League|FA Cup|EFL Cup|Carabao Cup)\s*[-–]?\s*/i,
    '',
  ).trim();
  // Strip leg suffix: "Round of 16 - 1st Leg" → "Round of 16"
  const noLeg = stripped.includes(' - ') ? stripped.split(' - ')[0].trim() : stripped;
  // Normalise common variants to consistent labels
  const lower = noLeg.toLowerCase();
  if (lower.includes('quarter'))                           return 'Quarter-finals';
  if (lower.includes('semi'))                              return 'Semi-finals';
  if (/\bfinal\b/.test(lower) && !lower.includes('semi')) return 'Final';
  if (lower === 'round of 16')                             return 'Round of 16';
  // FA Cup / EFL Cup specific round names
  if (/third.round/i.test(noLeg))  return 'Third Round';
  if (/fourth.round/i.test(noLeg)) return 'Fourth Round';
  if (/fifth.round/i.test(noLeg))  return 'Fifth Round';
  if (/sixth.round/i.test(noLeg))  return 'Sixth Round';
  if (/round\s+3/i.test(noLeg))    return 'Third Round';
  if (/round\s+4/i.test(noLeg))    return 'Fourth Round';
  if (/round\s+5/i.test(noLeg))    return 'Fifth Round';
  if (/round\s+6/i.test(noLeg))    return 'Sixth Round';
  return noLeg;
}

/**
 * Fetch the current stage (knockout round or group phase) for a cup/European
 * competition from the ESPN API.
 *
 * Strategy:
 *  1. Scoreboard — event notes give the round name (e.g. "Round of 16 - 1st Leg")
 *  2. Standings  — if entries exist it's a group/league phase; extract team rows
 */
async function fetchCompetitionStage(
  slug:         string,
  teamName:     string,
  opponentName: string,
): Promise<CompetitionStage | undefined> {
  // Use a 120-day forward window so upcoming fixtures (FA Cup, EFL Cup rounds
  // that haven't kicked off yet) appear in the scoreboard with their round notes.
  const now = new Date();
  const end = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const dateRange = `${fmt(now)}-${fmt(end)}`;

  const [standingsRes, boardRes] = await Promise.allSettled([
    fetchTimeout(
      `https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`,
      { next: { revalidate: 3600 } },
    ),
    fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${dateRange}&limit=100`,
      { next: { revalidate: 1800 } },
    ),
  ]);

  // ── Round name from scoreboard event notes ──
  let roundName = '';
  if (boardRes.status === 'fulfilled' && boardRes.value.ok) {
    const data = await boardRes.value.json();

    // Build a list of events sorted: specific match first, then any event
    const events: any[] = data.events ?? [];
    const teamLower = teamName.toLowerCase().split(' ')[0]; // use first word for fuzzy match
    const oppLower  = opponentName.toLowerCase().split(' ')[0];

    // Try to find the exact event first, then fall back to any event in the board
    const sortedEvents = [...events].sort((a, b) => {
      const aComps: any[] = a.competitions?.[0]?.competitors ?? [];
      const bComps: any[] = b.competitions?.[0]?.competitors ?? [];
      const aMatch = aComps.some((c: any) => {
        const n = (c.team?.displayName ?? c.team?.name ?? '').toLowerCase();
        return n.includes(teamLower) || n.includes(oppLower);
      });
      const bMatch = bComps.some((c: any) => {
        const n = (c.team?.displayName ?? c.team?.name ?? '').toLowerCase();
        return n.includes(teamLower) || n.includes(oppLower);
      });
      return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
    });

    for (const ev of sortedEvents) {
      // ESPN stores cup round in competitions[0].notes OR top-level notes depending on comp
      const note = (
        ev.competitions?.[0]?.notes?.[0]?.headline ??
        ev.competitions?.[0]?.notes?.[0]?.text ??
        ev.notes?.[0]?.headline ??
        ev.notes?.[0]?.text ??
        ''
      ) as string;
      if (note) { roundName = normaliseRoundName(note); break; }
    }
    // Fallback: season type text (e.g. "Knockout Rounds")
    if (!roundName) {
      const typeText = (data.leagues?.[0]?.season?.type?.text ?? data.season?.type?.text ?? '') as string;
      if (typeText && typeText !== 'Regular Season') roundName = typeText;
    }
  }

  // ── Group / league-phase standings ──
  let isGroupPhase = false;
  let groupName: string | undefined;
  let teamStanding:  TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
    const data = await standingsRes.value.json();

    const sv = (e: any, ...names: string[]): number =>
      Number((e.stats as any[])?.find((s: any) => names.includes(s.name))?.value ?? 0);

    const parseEntry = (e: any, pos: number): TeamStanding => ({
      name:         e.team?.displayName ?? '',
      position:     entryRank(e, pos),
      played:       sv(e, 'gamesPlayed'),
      wins:         sv(e, 'wins', 'gamesWon'),
      draws:        sv(e, 'ties', 'gamesDrawn'),
      losses:       sv(e, 'losses', 'gamesLost'),
      points:       sv(e, 'points'),
      goalsFor:     sv(e, 'pointsFor'),
      goalsAgainst: sv(e, 'pointsAgainst'),
    });

    // Multiple groups (classic UCL group stage)
    const groups: any[] = data.children ?? [];
    if (groups.length > 0) {
      for (const group of groups) {
        const entries: any[] = group.standings?.entries ?? [];
        const ti = entries.findIndex((e: any) =>
          e.team?.displayName === teamName || e.team?.name === teamName,
        );
        const oi = entries.findIndex((e: any) =>
          e.team?.displayName === opponentName || e.team?.name === opponentName,
        );
        if (ti >= 0 || oi >= 0) {
          isGroupPhase = true;
          groupName    = group.name as string | undefined;
          if (ti >= 0) teamStanding     = parseEntry(entries[ti], ti);
          if (oi >= 0) opponentStanding = parseEntry(entries[oi], oi);
          break;
        }
      }
    }

    // Single-table league phase (new UCL format from 2024-25)
    if (!isGroupPhase) {
      const entries: any[] =
        data.standings?.entries ??
        data.children?.[0]?.standings?.entries ?? [];
      if (entries.length > 0) {
        const ti = entries.findIndex((e: any) => e.team?.displayName === teamName);
        const oi = entries.findIndex((e: any) => e.team?.displayName === opponentName);
        if (ti >= 0 || oi >= 0) {
          isGroupPhase = true;
          if (ti >= 0) teamStanding     = parseEntry(entries[ti], ti);
          if (oi >= 0) opponentStanding = parseEntry(entries[oi], oi);
        }
      }
    }
  }

  // If the scoreboard explicitly names a knockout round, the league phase is
  // over — ESPN's standings endpoint still returns the historical league-phase
  // table but it is no longer meaningful for this fixture.
  if (roundName) {
    const rl = roundName.toLowerCase();
    if (
      rl.includes('semi') ||
      rl.includes('quarter') ||
      rl.includes('final') ||
      rl.includes('round of') ||
      rl.includes('play-off') ||
      rl.includes('playoff') ||
      rl.includes('knockout')
    ) {
      isGroupPhase      = false;
      teamStanding      = undefined;
      opponentStanding  = undefined;
    }
  }

  if (!roundName && !isGroupPhase) return undefined;

  return {
    roundName:         roundName || (groupName ?? 'Group/League Phase'),
    isGroupPhase,
    groupName,
    teamStanding,
    opponentStanding,
  };
}

// ─── First-leg result fetch (two-legged knockout ties) ────────────────────────

/**
 * For cup/European knockout rounds, fetches the score from the most recent
 * completed fixture between these two teams in the same competition.
 * Returns null if no such fixture is found or data is unavailable.
 */
async function fetchFirstLegResult(
  cupSlug:      string,
  espnTeamId:   string,
  opponentName: string,
): Promise<{ teamScore: number; opponentScore: number } | null> {
  try {
    const res = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${cupSlug}/teams/${espnTeamId}/schedule`,
      { next: { revalidate: 3600 }, timeoutMs: 5000 },
    );
    if (!res.ok) return null;

    const data    = await res.json();
    const events: any[] = data.events ?? [];
    const oppLower = opponentName.toLowerCase();

    // Find the most recent completed event vs this opponent
    const leg = events
      .filter((e: any) => {
        if (!e.competitions?.[0]?.status?.type?.completed) return false;
        const competitors: any[] = e.competitions[0].competitors ?? [];
        return competitors.some((c: any) => {
          const name = (c.team?.displayName ?? c.team?.name ?? '').toLowerCase();
          return name.includes(oppLower) || oppLower.includes(name);
        });
      })
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    if (!leg) return null;

    const competitors: any[] = leg.competitions[0].competitors ?? [];
    const teamComp = competitors.find((c: any) =>
      String(c.id) === espnTeamId || String(c.team?.id) === espnTeamId,
    );
    const oppComp = competitors.find((c: any) =>
      String(c.id) !== espnTeamId && String(c.team?.id) !== espnTeamId,
    );
    if (!teamComp || !oppComp) return null;

    return {
      teamScore:     parseInt(teamComp.score ?? '0', 10),
      opponentScore: parseInt(oppComp.score  ?? '0', 10),
    };
  } catch {
    return null;
  }
}

// ─── Shared ESPN match-data extractor (summary?event=) ────────────────────────
//
// ESPN's per-event `summary` endpoint carries four blocks that are available
// across every ESPN sport but were previously unwired:
//   • lastFiveGames    → each team's recent form (most recent first)
//   • headToHeadGames  → the two teams' recent meetings
//   • rosters          → the starting lineup of a completed game
//   • boxscore.players → per-player stat lines (key performers; NBA path below)
//
// This single extractor unlocks form + H2H + lineup for NRL, EPL, Super Rugby,
// International Rugby, NBA, NHL and the World Cup. It is name-driven: the summary
// blocks all carry team displayNames, so no per-sport ESPN id map is needed.

/** Loose team-name match: handles ESPN short names vs the app's full names. */
function espnNameMatch(a: string, b: string): boolean {
  const x = (a ?? '').toLowerCase().trim();
  const y = (b ?? '').toLowerCase().trim();
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return x.split(/\s+/).pop() === y.split(/\s+/).pop();
}

/** Map one ESPN lastFiveGames / headToHeadGames event to a GameResult. */
function mapEspnGame(g: any): GameResult {
  const isHome  = g.atVs === 'vs';
  const homeSc  = parseInt(g.homeTeamScore ?? '0', 10) || 0;
  const awaySc  = parseInt(g.awayTeamScore ?? '0', 10) || 0;
  const result  = String(g.gameResult ?? '').toUpperCase();
  return {
    opponent:      g.opponent?.displayName ?? '',
    opponentAbbr:  g.opponent?.abbreviation ?? '',
    isHome,
    isWin:         result === 'W',
    isDraw:        result === 'D',
    teamScore:     isHome ? homeSc : awaySc,
    opponentScore: isHome ? awaySc : homeSc,
    date:          g.gameDate ?? '',
  };
}

/** Extract the starting lineup for a team from a completed-game summary. */
function extractStarters(summary: any, teamName: string, jerseyThreshold?: number): string[] {
  const rosters: any[] = summary?.rosters ?? [];
  const entry = rosters.find((r: any) => espnNameMatch(r.team?.displayName ?? '', teamName));
  // ESPN lineups live under `.roster` (NOT `.entries` — that was the parse bug).
  const roster: any[] = entry?.roster ?? [];
  if (roster.length === 0) return [];

  let starters = roster.filter((p: any) => p.starter === true);
  // Rugby (league/union) summaries never set `starter`; derive the run-on side by
  // jersey number (≤13 league, ≤15 union).
  if (starters.length === 0 && jerseyThreshold) {
    starters = roster
      .filter((p: any) => {
        const j = parseInt(p.jersey ?? '', 10);
        return !Number.isNaN(j) && j >= 1 && j <= jerseyThreshold;
      })
      .sort((a: any, b: any) => parseInt(a.jersey, 10) - parseInt(b.jersey, 10));
  }
  return starters
    .map((p: any) => (p.athlete?.displayName ?? p.athlete?.fullName ?? '') as string)
    .filter(Boolean);
}

/** Most-recent completed game id for a lastFiveGames entry (for lineup lookup). */
function lastCompletedGameId(entry: any): string | undefined {
  const events: any[] = entry?.events ?? [];
  const sorted = [...events].sort(
    (a, b) => new Date(b.gameDate ?? 0).getTime() - new Date(a.gameDate ?? 0).getTime(),
  );
  return sorted[0]?.id ? String(sorted[0].id) : undefined;
}

export interface ESPNMatchExtras {
  teamRecentForm?: GameResult[];
  opponentRecentForm?: GameResult[];
  headToHead?: HeadToHeadMeeting[];
  teamLastLineup?: string[];
  opponentLastLineup?: string[];
}

/**
 * Pulls recent form (both sides), head-to-head meetings, and each side's most
 * recent starting lineup from ESPN's summary for the given event.
 *
 * @param sportPath       e.g. 'rugby-league/3', 'soccer/eng.1', 'basketball/nba'
 * @param eventId         numeric ESPN event id (from fixture.id's last segment)
 * @param jerseyThreshold rugby only — 13 (league) / 15 (union); omit for sports
 *                        that set the `starter` flag.
 */
export async function fetchESPNMatchExtras(
  sportPath: string,
  eventId: string | undefined,
  teamName: string,
  opponentName: string,
  jerseyThreshold?: number,
): Promise<ESPNMatchExtras> {
  if (!eventId) return {};
  const base = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=`;
  try {
    const res = await fetchTimeout(`${base}${eventId}`, { next: { revalidate: 1800 }, timeoutMs: 6000 });
    if (!res.ok) return {};
    const summary = await res.json();

    const out: ESPNMatchExtras = {};

    // ── Recent form (lastFiveGames) ──
    const lfg: any[] = Array.isArray(summary.lastFiveGames) ? summary.lastFiveGames : [];
    const teamEntry = lfg.find((t: any) => espnNameMatch(t.team?.displayName ?? '', teamName));
    const oppEntry  =
      lfg.find((t: any) => espnNameMatch(t.team?.displayName ?? '', opponentName)) ??
      (lfg.length === 2 ? lfg.find((t: any) => t !== teamEntry) : undefined);

    const toForm = (entry: any): GameResult[] | undefined => {
      const events: any[] = entry?.events ?? [];
      if (events.length === 0) return undefined;
      const form = [...events]
        .sort((a, b) => new Date(b.gameDate ?? 0).getTime() - new Date(a.gameDate ?? 0).getTime())
        .slice(0, 5)
        .map(mapEspnGame);
      return form.length > 0 ? form : undefined;
    };
    out.teamRecentForm     = toForm(teamEntry);
    out.opponentRecentForm = toForm(oppEntry);

    // ── Head-to-head (headToHeadGames) ──
    const h2hArr: any[] = Array.isArray(summary.headToHeadGames) ? summary.headToHeadGames : [];
    const h2hEntry = h2hArr[0];
    if (h2hEntry?.events?.length) {
      const subjectIsOurs = espnNameMatch(h2hEntry.team?.displayName ?? '', teamName);
      const invert = (r: string) => (r === 'W' ? 'L' : r === 'L' ? 'W' : 'D');
      const meetings: HeadToHeadMeeting[] = (h2hEntry.events as any[])
        .sort((a, b) => new Date(b.gameDate ?? 0).getTime() - new Date(a.gameDate ?? 0).getTime())
        .slice(0, 5)
        .map((g: any): HeadToHeadMeeting => {
          const subHome  = g.atVs === 'vs';
          const homeSc   = parseInt(g.homeTeamScore ?? '0', 10) || 0;
          const awaySc   = parseInt(g.awayTeamScore ?? '0', 10) || 0;
          const subScore = subHome ? homeSc : awaySc;
          const othScore = subHome ? awaySc : homeSc;
          const subRes   = String(g.gameResult ?? '').toUpperCase();
          return {
            date:          g.gameDate ?? '',
            teamScore:     subjectIsOurs ? subScore : othScore,
            opponentScore: subjectIsOurs ? othScore : subScore,
            result:        (subjectIsOurs ? subRes : invert(subRes)) as 'W' | 'L' | 'D',
            teamWasHome:   subjectIsOurs ? subHome : !subHome,
          };
        });
      if (meetings.length > 0) out.headToHead = meetings;
    }

    // ── Lineups — each side's most recent completed game's rosters ──
    const teamGameId = lastCompletedGameId(teamEntry);
    const oppGameId  = lastCompletedGameId(oppEntry);
    const fetchLineup = async (gameId: string | undefined, name: string): Promise<string[]> => {
      if (!gameId) return [];
      try {
        const r = await fetchTimeout(`${base}${gameId}`, { next: { revalidate: 3600 }, timeoutMs: 6000 });
        if (!r.ok) return [];
        return extractStarters(await r.json(), name, jerseyThreshold);
      } catch { return []; }
    };
    const [teamLineup, oppLineup] = await Promise.all([
      fetchLineup(teamGameId, teamName),
      fetchLineup(oppGameId, opponentName),
    ]);
    if (teamLineup.length > 0) out.teamLastLineup     = teamLineup;
    if (oppLineup.length  > 0) out.opponentLastLineup = oppLineup;

    return out;
  } catch {
    return {};
  }
}

// ─── ESPN injury report fetch ──────────────────────────────────────────────────

/**
 * Fetches the current injury report for a team from ESPN.
 * Returns players with status 'Out' or 'Doubtful' only — these are the ones that matter.
 * sportPath examples: 'rugby-league/3', 'soccer/eng.1', 'rugby/242041'
 */
async function fetchESPNInjuries(
  sportPath: string,
  espnTeamId: string,
): Promise<Array<{ name: string; status: string }>> {
  try {
    const res = await fetchTimeout(
      `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${espnTeamId}/injuries`,
      { next: { revalidate: 900 }, timeoutMs: 5000 }, // 15-min cache — injury status changes frequently
    );
    if (!res.ok) return [];
    const data = await res.json();
    const injuries: any[] = data.injuries ?? [];
    return injuries
      .filter((i: any) => ['Out', 'Doubtful'].includes(i.status))
      .map((i: any) => ({
        name:   (i.athlete?.displayName ?? i.athlete?.shortName ?? '') as string,
        status: (i.status ?? 'Unknown') as string,
      }))
      .filter((i: any) => i.name);
  } catch {
    return [];
  }
}

// ─── EPL — ESPN ───────────────────────────────────────────────────────────────

const ESPN_TEAM_ID: Record<string, string> = {
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

export const ESPN_TEAM_NAME: Record<string, string> = {
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

function statVal(stats: any[], name: string): number {
  return Number(stats.find((s: any) => s.name === name)?.value ?? 0);
}

/**
 * COR-1: ESPN standings `entries` are not guaranteed to be returned in rank order
 * (ties, conference/division splits, alphabetical). Each entry carries a `rank`
 * stat; prefer it for `position`, falling back to the 1-based array index only when
 * the feed omits it. Downstream finals-cutoff / Nth-place facts AND the team's own
 * "Nth place" claim depend on the true rank — trusting array order can feed the
 * model standings facts that look authoritative but are wrong.
 */
export function entryRank(entry: any, fallbackIndex: number): number {
  const r = Number(entry?.stats?.find((s: any) => s.name === 'rank')?.value);
  return Number.isFinite(r) && r > 0 ? r : fallbackIndex + 1;
}

/** Order ESPN standings entries by their true rank (rank stat, fallback to feed order). */
export function sortByEntryRank(entries: any[]): any[] {
  return entries
    .map((e, i) => ({ e, r: entryRank(e, i) }))
    .sort((a, b) => a.r - b.r)
    .map(x => x.e);
}

function parseESPNStandings(entries: any[], displayName: string): TeamStanding | undefined {
  const e = entries.find((x: any) => x.team?.displayName === displayName);
  if (!e) return undefined;
  const stats = e.stats ?? [];
  return {
    name:         displayName,
    position:     statVal(stats, 'rank'),
    played:       statVal(stats, 'gamesPlayed'),
    wins:         statVal(stats, 'wins'),
    draws:        statVal(stats, 'ties'),
    losses:       statVal(stats, 'losses'),
    points:       statVal(stats, 'points'),
    goalsFor:     statVal(stats, 'pointsFor'),
    goalsAgainst: statVal(stats, 'pointsAgainst'),
  };
}

export async function fetchEPLPreview(
  teamId: string,
  opponentName: string,
  competition?: string,
  eventId?: string,
): Promise<PreviewContext> {
  const teamName   = ESPN_TEAM_NAME[teamId];
  const espnTeamId = ESPN_TEAM_ID[teamId];
  if (!teamName) return {};

  // Resolve opponent ESPN ID upfront so news + injuries can run in parallel
  const oppTeamKey = Object.entries(ESPN_TEAM_NAME).find(([, v]) => v === opponentName)?.[0];
  const oppEspnId  = oppTeamKey ? ESPN_TEAM_ID[oppTeamKey] : undefined;

  // The event id is namespaced to the competition's slug; form/H2H/lineup come
  // from that competition's summary endpoint.
  const extrasSlug = (competition && COMP_ESPN_SLUG[competition]) || 'eng.1';

  const [standingsRes, teamNewsRes, oppNewsRes, extrasRes, teamInjuryRes, oppInjuryRes] = await Promise.allSettled([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings',
      { next: { revalidate: 3600 } },
    ),
    espnTeamId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${espnTeamId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    oppEspnId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${oppEspnId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    fetchESPNMatchExtras(`soccer/${extrasSlug}`, eventId, teamName, opponentName),
    espnTeamId ? fetchESPNInjuries('soccer/eng.1', espnTeamId)   : Promise.resolve([]),
    oppEspnId  ? fetchESPNInjuries('soccer/eng.1', oppEspnId)    : Promise.resolve([]),
  ]);

  // ── Standings ──
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;
  let leagueTable: LeagueTableRow[] | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value?.ok) {
    const data = await standingsRes.value.json();
    // ESPN v2 standings: data.children[0].standings.entries (not an array)
    const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
    teamStanding     = parseESPNStandings(entries, teamName);
    opponentStanding = parseESPNStandings(entries, opponentName);
    // Full table — used server-side for mathematical clinching/elimination analysis
    leagueTable = sortByEntryRank(entries).map((e: any, i: number): LeagueTableRow => ({
      name:     e.team?.displayName ?? '',
      position: entryRank(e, i),
      played:   statVal(e.stats ?? [], 'gamesPlayed'),
      wins:     statVal(e.stats ?? [], 'wins'),
      draws:    statVal(e.stats ?? [], 'ties'),
      losses:   statVal(e.stats ?? [], 'losses'),
      points:   statVal(e.stats ?? [], 'points'),
    })).filter(r => r.name);
  }

  // ── Cup fixture: look up opponent division if not in PL standings ──
  let opponentLeague: string | undefined;
  if (competition && !opponentStanding) {
    const divEntry = lookupEnglishDivision(opponentName);
    if (divEntry) {
      opponentLeague = divEntry.division;
      // Try to fetch their actual standing from their tier's ESPN endpoint
      if (divEntry.espnId && ENGLISH_TIER_SLUG[divEntry.tier]) {
        try {
          const slug = ENGLISH_TIER_SLUG[divEntry.tier];
          const res = await fetchTimeout(
            `https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`,
            { next: { revalidate: 3600 }, timeoutMs: 5000 },
          );
          if (res.ok) {
            const data = await res.json();
            const entries: any[] = data.children?.[0]?.standings?.entries ?? [];
            // Try to find by ESPN ID or by display name
            const found = entries.find((e: any) =>
              String(e.team?.id) === divEntry.espnId ||
              (e.team?.displayName ?? e.team?.name ?? '').toLowerCase().includes(opponentName.toLowerCase().split(' ')[0])
            );
            if (found) {
              opponentStanding = parseESPNStandings(entries, found.team?.displayName ?? opponentName);
              if (opponentStanding) opponentStanding.name = opponentName;
            }
          }
        } catch { /* standing fetch failed — opponentLeague string is still set */ }
      }
    }
  }

  // ── News ──
  const teamNews: NewsHeadline[] = [];
  const opponentNews: NewsHeadline[] = [];

  if (teamNewsRes.status === 'fulfilled' && teamNewsRes.value?.ok) {
    const data = await teamNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      teamNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  if (oppNewsRes.status === 'fulfilled' && oppNewsRes.value?.ok) {
    const data = await oppNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      opponentNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  // ── Cup / European competition stage + first-leg result (when applicable) ──
  let competitionStage: CompetitionStage | undefined;
  let firstLegResult: { teamScore: number; opponentScore: number } | undefined;
  if (competition) {
    const slug = COMP_ESPN_SLUG[competition];
    if (slug) {
      [competitionStage, firstLegResult] = await Promise.all([
        fetchCompetitionStage(slug, teamName, opponentName).catch(() => undefined),
        // Only fetch first-leg result for knockout stages (not group/league phase)
        espnTeamId
          ? fetchFirstLegResult(slug, espnTeamId, opponentName).then(r => r ?? undefined).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      // Discard first-leg result if this is a group/league phase (no aggregate applies)
      if (competitionStage?.isGroupPhase) firstLegResult = undefined;
    }
  }

  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};

  const teamInjuries = teamInjuryRes.status === 'fulfilled' ? teamInjuryRes.value : [];
  const oppInjuries  = oppInjuryRes.status  === 'fulfilled' ? oppInjuryRes.value  : [];

  return {
    teamStanding,
    opponentStanding,
    leagueTable:           leagueTable && leagueTable.length > 0 ? leagueTable : undefined,
    opponentLeague,
    teamNews:              teamNews.length > 0     ? teamNews     : undefined,
    opponentNews:          opponentNews.length > 0 ? opponentNews : undefined,
    competitionStage,
    firstLegResult,
    teamLastLineup:        extras.teamLastLineup,
    opponentLastLineup:    extras.opponentLastLineup,
    teamRecentForm:        extras.teamRecentForm,
    opponentRecentForm:    extras.opponentRecentForm,
    headToHead:            extras.headToHead,
    teamInjuryReport:      teamInjuries.length   > 0 ? teamInjuries   : undefined,
    opponentInjuryReport:  oppInjuries.length    > 0 ? oppInjuries    : undefined,
  };
}

// ─── International Rugby Union — ESPN ────────────────────────────────────────

export const RINT_ESPN_NAME_P: Record<string, string> = {
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

const RINT_RC_TEAM_NAMES = new Set(['Australia', 'New Zealand', 'South Africa', 'Argentina']);
const RINT_SN_TEAM_NAMES = new Set(['England', 'Ireland', 'France', 'Scotland', 'Wales']);

export async function fetchRINTPreview(
  teamId: string,
  opponentName: string,
  eventId?: string,
): Promise<PreviewContext> {
  const teamName = RINT_ESPN_NAME_P[teamId];
  if (!teamName) return {};

  // Choose competition based on team membership (also the summary's league path).
  const compId = RINT_RC_TEAM_NAMES.has(teamName) ? '244293'
    : RINT_SN_TEAM_NAMES.has(teamName) ? '180659'
    : null;

  // Form/H2H/lineup come from the event summary — available even for Pacific teams
  // that have no league standings. 15-a-side: derive starters by jersey ≤15.
  // International rugby spreads events across several ESPN comp ids (Rugby
  // Championship, Six Nations, the July/November test windows); the summary only
  // resolves under the event's own comp, so try the likely candidates in order.
  const extrasCandidates = [...new Set([
    compId, '289234', '244293', '180659', '267979',
  ].filter(Boolean))] as string[];
  const fetchRintExtras = async (): Promise<ESPNMatchExtras> => {
    if (!eventId) return {};
    for (const cid of extrasCandidates) {
      const ex = await fetchESPNMatchExtras(`rugby/${cid}`, eventId, teamName, opponentName, 15);
      if (ex.teamRecentForm || ex.headToHead || ex.teamLastLineup) return ex;
    }
    return {};
  };

  const [standRes, extrasRes] = await Promise.allSettled([
    compId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/v2/sports/rugby/${compId}/standings`,
          { next: { revalidate: 3600 } },
        )
      : Promise.resolve(null),
    fetchRintExtras(),
  ]);

  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;

  if (standRes.status === 'fulfilled' && standRes.value?.ok) {
    const data = await standRes.value.json();
    const entries: any[] =
      data.children?.[0]?.standings?.entries ??
      data.standings?.entries ??
      [];

    const parseRintStanding = (name: string): TeamStanding | undefined => {
      const idx = entries.findIndex((x: any) =>
        x.team?.displayName === name || x.team?.name === name,
      );
      if (idx < 0) return undefined;
      const stats = entries[idx].stats ?? [];
      const sv = (...names: string[]): number =>
        Number(stats.find((s: any) => names.includes(s.name))?.value ?? 0);
      return {
        name,
        position: entryRank(entries[idx], idx),
        played:   sv('gamesPlayed'),
        wins:     sv('wins', 'gamesWon'),
        draws:    sv('ties', 'gamesDrawn'),
        losses:   sv('losses', 'gamesLost'),
        points:   sv('points'),
      };
    };
    teamStanding     = parseRintStanding(teamName);
    opponentStanding = parseRintStanding(opponentName);
  }

  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};

  return {
    teamStanding,
    opponentStanding,
    teamLastLineup:     extras.teamLastLineup,
    opponentLastLineup: extras.opponentLastLineup,
    teamRecentForm:     extras.teamRecentForm,
    opponentRecentForm: extras.opponentRecentForm,
    headToHead:         extras.headToHead,
  };
}

// ─── Super Rugby — ESPN ───────────────────────────────────────────────────────

const SRU_ESPN_ID_P: Record<string, string> = {
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

export const SRU_ESPN_NAME: Record<string, string> = {
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

function parseSRUStandings(entries: any[], displayName: string, idx: number): TeamStanding | undefined {
  const e = entries.find((x: any) =>
    x.team?.displayName === displayName || x.team?.name === displayName,
  );
  if (!e) return undefined;
  const stats = e.stats ?? [];
  const sv = (...names: string[]): number =>
    Number(stats.find((s: any) => names.includes(s.name))?.value ?? 0);
  return {
    name:     displayName,
    position: entryRank(e, idx),
    played:   sv('gamesPlayed'),
    wins:     sv('wins', 'gamesWon'),
    draws:    sv('ties', 'gamesDrawn'),
    losses:   sv('losses', 'gamesLost'),
    points:   sv('points'),
  };
}

export async function fetchSRUPreview(
  teamId: string,
  opponentName: string,
  eventId?: string,
): Promise<PreviewContext> {
  const teamName = SRU_ESPN_NAME[teamId];
  if (!teamName) return {};

  const res = await fetchTimeout(
    'https://site.api.espn.com/apis/v2/sports/rugby/242041/standings',
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return {};

  const data = await res.json();
  const entries: any[] =
    data.children?.[0]?.standings?.entries ??
    data.standings?.entries ??
    [];

  const teamIdx = entries.findIndex((x: any) =>
    x.team?.displayName === teamName || x.team?.name === teamName,
  );
  const oppIdx = entries.findIndex((x: any) =>
    x.team?.displayName === opponentName || x.team?.name === opponentName,
  );

  const teamStanding:     TeamStanding | undefined = teamIdx >= 0 ? parseSRUStandings(entries, teamName, teamIdx)     : undefined;
  const opponentStanding: TeamStanding | undefined = oppIdx  >= 0 ? parseSRUStandings(entries, opponentName, oppIdx)  : undefined;

  // Full table — Super Rugby has bonus points (max 5/game: 4 win + 1 try bonus)
  // We record raw competition points; the computeCompetitionStatus function uses
  // ppw=5 for SRU to be conservative (only flags clinching when mathematically certain).
  const leagueTable: LeagueTableRow[] = sortByEntryRank(entries).map((e: any, i: number): LeagueTableRow => {
    const stats = e.stats ?? [];
    const sv = (...names: string[]): number =>
      Number(stats.find((s: any) => names.includes(s.name))?.value ?? 0);
    return {
      name:     e.team?.displayName ?? e.team?.name ?? '',
      position: entryRank(e, i),
      played:   sv('gamesPlayed'),
      wins:     sv('wins', 'gamesWon'),
      draws:    sv('ties', 'gamesDrawn'),
      losses:   sv('losses', 'gamesLost'),
      points:   sv('points'),
    };
  }).filter(r => r.name);

  // Injury fetches — fan out in parallel
  const teamESPNId = SRU_ESPN_ID_P[teamId];
  const oppTeamKey = Object.entries(SRU_ESPN_NAME).find(([, v]) => v === opponentName)?.[0];
  const oppESPNId  = oppTeamKey ? SRU_ESPN_ID_P[oppTeamKey] : undefined;

  const [teamInjuryRes, oppInjuryRes, extrasRes] = await Promise.allSettled([
    teamESPNId ? fetchESPNInjuries('rugby/242041', teamESPNId) : Promise.resolve([]),
    oppESPNId  ? fetchESPNInjuries('rugby/242041', oppESPNId)  : Promise.resolve([]),
    fetchESPNMatchExtras('rugby/242041', eventId, teamName, opponentName, 15),
  ]);

  const teamInjuries = teamInjuryRes.status === 'fulfilled' ? teamInjuryRes.value : [];
  const oppInjuries  = oppInjuryRes.status  === 'fulfilled' ? oppInjuryRes.value  : [];
  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};

  return {
    teamStanding,
    opponentStanding,
    leagueTable: leagueTable.length > 0 ? leagueTable : undefined,
    teamLastLineup:       extras.teamLastLineup,
    opponentLastLineup:   extras.opponentLastLineup,
    teamRecentForm:       extras.teamRecentForm,
    opponentRecentForm:   extras.opponentRecentForm,
    headToHead:           extras.headToHead,
    teamInjuryReport:     teamInjuries.length > 0 ? teamInjuries : undefined,
    opponentInjuryReport: oppInjuries.length  > 0 ? oppInjuries  : undefined,
  };
}

// ─── NBA — ESPN ───────────────────────────────────────────────────────────────

// ESPN numeric team IDs for the news + injury endpoints
const NBA_ESPN_ID: Record<string, string> = {
  'nba-hawks':        '1',
  'nba-celtics':      '2',
  'nba-nets':         '17',
  'nba-hornets':      '30',
  'nba-bulls':        '4',
  'nba-cavaliers':    '5',
  'nba-mavericks':    '6',
  'nba-nuggets':      '7',
  'nba-pistons':      '8',
  'nba-warriors':     '9',
  'nba-rockets':      '10',
  'nba-pacers':       '11',
  'nba-clippers':     '12',
  'nba-lakers':       '13',
  'nba-grizzlies':    '29',
  'nba-heat':         '14',
  'nba-bucks':        '15',
  'nba-timberwolves': '16',
  'nba-pelicans':     '3',
  'nba-knicks':       '18',
  'nba-thunder':      '25',
  'nba-magic':        '19',
  'nba-76ers':        '20',
  'nba-suns':         '21',
  'nba-blazers':      '22',
  'nba-kings':        '23',
  'nba-spurs':        '24',
  'nba-raptors':      '28',
  'nba-jazz':         '26',
  'nba-wizards':      '27',
};

export const NBA_ESPN_NAME: Record<string, string> = {
  'nba-celtics':      'Boston Celtics',
  'nba-nets':         'Brooklyn Nets',
  'nba-knicks':       'New York Knicks',
  'nba-76ers':        'Philadelphia 76ers',
  'nba-raptors':      'Toronto Raptors',
  'nba-bulls':        'Chicago Bulls',
  'nba-cavaliers':    'Cleveland Cavaliers',
  'nba-pistons':      'Detroit Pistons',
  'nba-pacers':       'Indiana Pacers',
  'nba-bucks':        'Milwaukee Bucks',
  'nba-hawks':        'Atlanta Hawks',
  'nba-hornets':      'Charlotte Hornets',
  'nba-heat':         'Miami Heat',
  'nba-magic':        'Orlando Magic',
  'nba-wizards':      'Washington Wizards',
  'nba-nuggets':      'Denver Nuggets',
  'nba-timberwolves': 'Minnesota Timberwolves',
  'nba-thunder':      'Oklahoma City Thunder',
  'nba-blazers':      'Portland Trail Blazers',
  'nba-jazz':         'Utah Jazz',
  'nba-warriors':     'Golden State Warriors',
  'nba-clippers':     'Los Angeles Clippers',
  'nba-lakers':       'Los Angeles Lakers',
  'nba-suns':         'Phoenix Suns',
  'nba-kings':        'Sacramento Kings',
  'nba-mavericks':    'Dallas Mavericks',
  'nba-rockets':      'Houston Rockets',
  'nba-grizzlies':    'Memphis Grizzlies',
  'nba-pelicans':     'New Orleans Pelicans',
  'nba-spurs':        'San Antonio Spurs',
};

function parseNBAStandings(entries: any[], displayName: string): TeamStanding | undefined {
  const idx = entries.findIndex((e: any) =>
    e.team?.displayName === displayName || e.team?.name === displayName,
  );
  if (idx < 0) return undefined;
  const stats = entries[idx].stats ?? [];
  const sv = (...names: string[]): number =>
    Number(stats.find((s: any) => names.includes(s.name))?.value ?? 0);
  const wins   = sv('wins', 'gamesWon');
  const losses = sv('losses', 'gamesLost');
  const played = sv('gamesPlayed') || wins + losses;
  // ESPN returns winPercent as a decimal (0.692); convert to % for display
  const rawPct = sv('winPercent', 'pct');
  const pct    = rawPct > 1 ? rawPct : rawPct * 100;
  return {
    name:       displayName,
    position:   entryRank(entries[idx], idx),
    played,
    wins,
    draws:      0,
    losses,
    percentage: parseFloat(pct.toFixed(1)),
  };
}

/** Extract top-N players by points from an ESPN boxscore players array. */
function extractNBALeaders(
  boxscorePlayers: any[],
  teamDisplayName: string,
  topN = 5,
): Array<{ name: string; stats: string }> {
  const teamEntry = boxscorePlayers.find(
    (t: any) => t.team?.displayName === teamDisplayName,
  );
  if (!teamEntry) return [];
  const statGrp: any = (teamEntry.statistics ?? [])[0];
  if (!statGrp) return [];
  const headers: string[] = statGrp.names ?? statGrp.keys ?? [];
  const ptsIdx = headers.findIndex((h: string) => h === 'PTS');
  const rebIdx = headers.findIndex((h: string) => h === 'REB');
  const astIdx = headers.findIndex((h: string) => h === 'AST');
  if (ptsIdx < 0) return [];

  return ((statGrp.athletes ?? []) as any[])
    .filter((a: any) => Number(a.stats?.[ptsIdx] ?? 0) > 0 || a.stats?.[0] !== '0')
    .sort((a: any, b: any) => Number(b.stats?.[ptsIdx] ?? 0) - Number(a.stats?.[ptsIdx] ?? 0))
    .slice(0, topN)
    .map((a: any) => {
      const pts = a.stats?.[ptsIdx] ?? '0';
      const reb = rebIdx >= 0 ? a.stats?.[rebIdx] ?? '0' : null;
      const ast = astIdx >= 0 ? a.stats?.[astIdx] ?? '0' : null;
      const statStr = [
        `${pts} pts`,
        reb !== null ? `${reb} reb` : null,
        ast !== null ? `${ast} ast` : null,
      ].filter(Boolean).join('/');
      return { name: a.athlete?.displayName ?? '', stats: statStr };
    })
    .filter(p => p.name);
}

export async function fetchNBAPreview(teamId: string, opponentName: string, eventId?: string): Promise<PreviewContext> {
  const teamName   = NBA_ESPN_NAME[teamId];
  const espnTeamId = NBA_ESPN_ID[teamId];
  if (!teamName) return {};

  // Resolve opponent ESPN ID for parallel fetches
  const oppTeamKey = Object.entries(NBA_ESPN_NAME).find(([, v]) => v === opponentName)?.[0];
  const oppEspnId  = oppTeamKey ? NBA_ESPN_ID[oppTeamKey] : undefined;

  // Most recent completed game: fetch scoreboard (last 14 days) to find event IDs
  const fmt  = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now  = new Date();
  const past = new Date(now.getTime() - 14 * 86400000);
  const scoreboard = await fetchTimeout(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${fmt(past)}-${fmt(now)}&limit=50`,
    { next: { revalidate: 300 } },
  ).then(r => r.ok ? r.json() : null).catch(() => null);

  // Find the most recent completed game involving the team and/or opponent
  const completedEvents: any[] = ((scoreboard?.events ?? []) as any[])
    .filter((e: any) => {
      if (e.status?.type?.completed !== true) return false;
      const comps: any[] = e.competitions?.[0]?.competitors ?? [];
      return comps.some((c: any) => c.team?.displayName === teamName || c.team?.displayName === opponentName);
    })
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Prefer a game featuring BOTH teams (series game), fallback to either team's last game
  const seriesGame   = completedEvents.find((e: any) => {
    const names = (e.competitions?.[0]?.competitors ?? []).map((c: any) => c.team?.displayName);
    return names.includes(teamName) && names.includes(opponentName);
  });
  const lastTeamGame = completedEvents.find((e: any) =>
    (e.competitions?.[0]?.competitors ?? []).some((c: any) => c.team?.displayName === teamName),
  );
  const recentEvent = seriesGame ?? lastTeamGame;

  const [standingsRes, teamNewsRes, oppNewsRes, teamInjuryRes, oppInjuryRes, boxscoreRes, extrasRes] = await Promise.allSettled([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings',
      { next: { revalidate: 3600 } },
    ),
    espnTeamId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    oppEspnId
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${oppEspnId}/news?limit=4`,
          { next: { revalidate: 1800 } },
        )
      : Promise.resolve(null),
    espnTeamId ? fetchESPNInjuries('basketball/nba', espnTeamId)  : Promise.resolve([]),
    oppEspnId  ? fetchESPNInjuries('basketball/nba', oppEspnId)   : Promise.resolve([]),
    recentEvent
      ? fetchTimeout(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${recentEvent.id}`,
          { next: { revalidate: 3600 } },
        )
      : Promise.resolve(null),
    fetchESPNMatchExtras('basketball/nba', eventId, teamName, opponentName),
  ]);

  // Standings
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;
  if (standingsRes.status === 'fulfilled' && standingsRes.value?.ok) {
    const data = await standingsRes.value.json();
    const entries: any[] = data.children?.[0]?.standings?.entries ?? data.standings?.entries ?? [];
    teamStanding     = parseNBAStandings(entries, teamName);
    opponentStanding = parseNBAStandings(entries, opponentName);
  }

  // News
  const teamNews: NewsHeadline[] = [];
  const opponentNews: NewsHeadline[] = [];
  if (teamNewsRes.status === 'fulfilled' && teamNewsRes.value?.ok) {
    const data = await teamNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      teamNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }
  if (oppNewsRes.status === 'fulfilled' && oppNewsRes.value?.ok) {
    const data = await oppNewsRes.value.json();
    for (const a of (data.articles ?? []) as any[]) {
      opponentNews.push({ headline: a.headline, description: a.description, published: a.published });
    }
  }

  // Injuries
  const teamInjuries = teamInjuryRes.status === 'fulfilled' ? teamInjuryRes.value : [];
  const oppInjuries  = oppInjuryRes.status  === 'fulfilled' ? oppInjuryRes.value  : [];

  // Key players from the most recent game's boxscore
  let teamKeyPlayers: Array<{ name: string; stats: string }> | undefined;
  let opponentKeyPlayers: Array<{ name: string; stats: string }> | undefined;
  let keyPlayersGameLabel: string | undefined;
  if (boxscoreRes.status === 'fulfilled' && boxscoreRes.value?.ok) {
    const summary = await boxscoreRes.value.json();
    const bsPlayers: any[] = summary.boxscore?.players ?? [];
    const tLeaders = extractNBALeaders(bsPlayers, teamName);
    const oLeaders = extractNBALeaders(bsPlayers, opponentName);
    if (tLeaders.length > 0 || oLeaders.length > 0) {
      teamKeyPlayers     = tLeaders.length > 0 ? tLeaders : undefined;
      opponentKeyPlayers = oLeaders.length > 0 ? oLeaders : undefined;
      keyPlayersGameLabel = (recentEvent?.competitions?.[0]?.notes?.[0]?.headline as string | undefined)
        ?? recentEvent?.name;
    }
  }

  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};

  return {
    teamStanding,
    opponentStanding,
    teamNews:              teamNews.length     > 0 ? teamNews     : undefined,
    opponentNews:          opponentNews.length > 0 ? opponentNews : undefined,
    teamInjuryReport:      teamInjuries.length > 0 ? teamInjuries : undefined,
    opponentInjuryReport:  oppInjuries.length  > 0 ? oppInjuries  : undefined,
    teamKeyPlayers,
    opponentKeyPlayers,
    keyPlayersGameLabel,
    teamLastLineup:        extras.teamLastLineup,
    opponentLastLineup:    extras.opponentLastLineup,
    teamRecentForm:        extras.teamRecentForm,
    opponentRecentForm:    extras.opponentRecentForm,
    headToHead:            extras.headToHead,
  };
}

// ─── NHL — ESPN ───────────────────────────────────────────────────────────────

export const NHL_ESPN_NAME: Record<string, string> = {
  'nhl-bruins':        'Boston Bruins',
  'nhl-sabres':        'Buffalo Sabres',
  'nhl-redwings':      'Detroit Red Wings',
  'nhl-panthers':      'Florida Panthers',
  'nhl-canadiens':     'Montréal Canadiens',
  'nhl-senators':      'Ottawa Senators',
  'nhl-lightning':     'Tampa Bay Lightning',
  'nhl-leafs':         'Toronto Maple Leafs',
  'nhl-canes':         'Carolina Hurricanes',
  'nhl-jackets':       'Columbus Blue Jackets',
  'nhl-devils':        'New Jersey Devils',
  'nhl-islanders':     'New York Islanders',
  'nhl-rangers':       'New York Rangers',
  'nhl-flyers':        'Philadelphia Flyers',
  'nhl-penguins':      'Pittsburgh Penguins',
  'nhl-capitals':      'Washington Capitals',
  'nhl-coyotes':       'Utah Hockey Club',
  'nhl-blackhawks':    'Chicago Blackhawks',
  'nhl-avalanche':     'Colorado Avalanche',
  'nhl-stars':         'Dallas Stars',
  'nhl-wild':          'Minnesota Wild',
  'nhl-predators':     'Nashville Predators',
  'nhl-blues':         'St. Louis Blues',
  'nhl-jets':          'Winnipeg Jets',
  'nhl-ducks':         'Anaheim Ducks',
  'nhl-flames':        'Calgary Flames',
  'nhl-oilers':        'Edmonton Oilers',
  'nhl-kings':         'Los Angeles Kings',
  'nhl-sharks':        'San Jose Sharks',
  'nhl-kraken':        'Seattle Kraken',
  'nhl-canucks':       'Vancouver Canucks',
  'nhl-goldenknights': 'Vegas Golden Knights',
};

function parseNHLStandings(entries: any[], displayName: string): TeamStanding | undefined {
  const idx = entries.findIndex((e: any) =>
    e.team?.displayName === displayName || e.team?.name === displayName,
  );
  if (idx < 0) return undefined;
  const stats = entries[idx].stats ?? [];
  const sv = (...names: string[]): number =>
    Number(stats.find((s: any) => names.includes(s.name))?.value ?? 0);
  return {
    name:     displayName,
    position: entryRank(entries[idx], idx),
    played:   sv('gamesPlayed'),
    wins:     sv('wins', 'gamesWon'),
    draws:    sv('otLosses', 'ties', 'gamesDrawn'), // OT losses shown in draws column
    losses:   sv('losses', 'gamesLost'),
    points:   sv('points'),
  };
}

export async function fetchNHLPreview(teamId: string, opponentName: string, eventId?: string): Promise<PreviewContext> {
  const teamName = NHL_ESPN_NAME[teamId];
  if (!teamName) return {};
  const [standRes, extrasRes] = await Promise.allSettled([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings',
      { next: { revalidate: 3600 } },
    ),
    fetchESPNMatchExtras('hockey/nhl', eventId, teamName, opponentName),
  ]);

  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;
  if (standRes.status === 'fulfilled' && standRes.value?.ok) {
    const data    = await standRes.value.json();
    const entries: any[] =
      data.children?.[0]?.standings?.entries ??
      data.standings?.entries ?? [];
    teamStanding     = parseNHLStandings(entries, teamName);
    opponentStanding = parseNHLStandings(entries, opponentName);
  }

  const extras: ESPNMatchExtras = extrasRes.status === 'fulfilled' ? extrasRes.value : {};
  return {
    teamStanding,
    opponentStanding,
    teamLastLineup:     extras.teamLastLineup,
    opponentLastLineup: extras.opponentLastLineup,
    teamRecentForm:     extras.teamRecentForm,
    opponentRecentForm: extras.opponentRecentForm,
    headToHead:         extras.headToHead,
  };
}

// ─── Formula 1 — Jolpi Ergast API ────────────────────────────────────────────

export async function fetchF1Preview(
  teamId: string,
  raceName: string,
  circuitName: string,
  sessionType: string,
  roundNumber?: number,
): Promise<PreviewContext> {
  // ── Fan out: driver standings + constructor standings + recent results + qualifying ──
  const qualifyingUrl = roundNumber
    ? `https://api.jolpi.ca/ergast/f1/current/${roundNumber}/qualifying.json`
    : null;

  const [driverStandRes, constructorStandRes, resultsRes, qualifyingRes] = await Promise.allSettled([
    (async () => {
      for (const url of [
        'https://api.jolpi.ca/ergast/f1/current/driverstandings.json',
        'https://api.jolpi.ca/ergast/f1/2025/driverstandings.json',
      ]) {
        try {
          const r = await fetchTimeout(url, { next: { revalidate: 3600 } });
          if (r.ok) { const d = await r.json(); return d; }
        } catch { /* try next */ }
      }
      return null;
    })(),
    (async () => {
      for (const url of [
        'https://api.jolpi.ca/ergast/f1/current/constructorstandings.json',
        'https://api.jolpi.ca/ergast/f1/2025/constructorstandings.json',
      ]) {
        try {
          const r = await fetchTimeout(url, { next: { revalidate: 3600 } });
          if (r.ok) { const d = await r.json(); return d; }
        } catch { /* try next */ }
      }
      return null;
    })(),
    fetchTimeout('https://api.jolpi.ca/ergast/f1/current/results.json?limit=200', { next: { revalidate: 3600 } })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null),
    qualifyingUrl
      ? fetchTimeout(qualifyingUrl, { next: { revalidate: 1800 } })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // ── Driver standings ──────────────────────────────────────────────────────
  const rawDriverStandings: any[] =
    (driverStandRes.status === 'fulfilled' && driverStandRes.value)
      ? (driverStandRes.value?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [])
      : [];

  const f1DriverStandings = rawDriverStandings.map((s: any) => ({
    position:       parseInt(s.position, 10),
    driverName:     `${s.Driver?.givenName ?? ''} ${s.Driver?.familyName ?? ''}`.trim(),
    teamId:         ERGAST_ID_TO_TEAM_ID[s.Driver?.driverId ?? ''] ?? undefined,
    constructorName: s.Constructors?.[0]?.name ?? '',
    points:         parseFloat(s.points ?? '0'),
    wins:           parseInt(s.wins ?? '0', 10),
    ergastDriverId: s.Driver?.driverId ?? '',
  }));

  // Also maintain the old teamStanding for backward compat (legacy display uses it)
  const ergastId = F1_DRIVER_IDS[teamId];
  const driverEntry = ergastId ? rawDriverStandings.find((s: any) => s.Driver?.driverId === ergastId) : null;
  let teamStanding: TeamStanding | undefined;
  if (driverEntry) {
    teamStanding = {
      name:            `${driverEntry.Driver?.givenName ?? ''} ${driverEntry.Driver?.familyName ?? ''}`.trim(),
      position:        parseInt(driverEntry.position, 10),
      played:          0,
      wins:            parseInt(driverEntry.wins ?? '0', 10),
      draws:           0,
      losses:          0,
      points:          parseFloat(driverEntry.points ?? '0'),
      constructorName: driverEntry.Constructors?.[0]?.name ?? '',
    };
  }

  // ── Constructor standings ─────────────────────────────────────────────────
  const rawConstructorStandings: any[] =
    (constructorStandRes.status === 'fulfilled' && constructorStandRes.value)
      ? (constructorStandRes.value?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [])
      : [];

  const f1ConstructorStandings = rawConstructorStandings.map((s: any) => ({
    position:        parseInt(s.position, 10),
    constructorName: s.Constructor?.name ?? '',
    points:          parseFloat(s.points ?? '0'),
    wins:            parseInt(s.wins ?? '0', 10),
  }));

  // ── Recent race results (last 4 completed rounds) ─────────────────────────
  const rawRaces: any[] =
    (resultsRes.status === 'fulfilled' && resultsRes.value)
      ? (resultsRes.value?.MRData?.RaceTable?.Races ?? [])
      : [];

  const completedRaces = rawRaces
    .filter((race: any) => Array.isArray(race.Results) && race.Results.length > 0)
    .sort((a: any, b: any) => parseInt(b.round, 10) - parseInt(a.round, 10))
    .slice(0, 4);

  const f1RecentRaceResults = completedRaces.map((race: any) => ({
    round:    parseInt(race.round, 10),
    raceName: race.raceName ?? '',
    results:  (race.Results as any[]).slice(0, 10).map((r: any) => ({
      position:       parseInt(r.position, 10),
      driverName:     `${r.Driver?.givenName ?? ''} ${r.Driver?.familyName ?? ''}`.trim(),
      constructorName: r.Constructor?.name ?? '',
      ergastDriverId: r.Driver?.driverId ?? '',
    })),
  }));

  // ── Determine followed entity ─────────────────────────────────────────────
  let f1FollowedType: 'driver' | 'constructor' | undefined;
  let f1FollowedName: string | undefined;
  let f1FollowedConstructorName: string | undefined;

  if (teamId.startsWith('f1-team-')) {
    // Following a constructor
    const constructorTeam = F1_CONSTRUCTOR_TEAMS.find(t => t.id === teamId);
    if (constructorTeam) {
      f1FollowedType = 'constructor';
      f1FollowedName = constructorTeam.division ?? constructorTeam.name;
      f1FollowedConstructorName = f1FollowedName;
    }
  } else if (teamId === 'f1-championship') {
    // Generic championship follow — no specific entity focus
    f1FollowedType = undefined;
  } else if (teamId.startsWith('f1_') || F1_DRIVER_IDS[teamId]) {
    // Following a driver
    const driverTeam = F1_DRIVERS.find(d => d.id === teamId);
    if (driverTeam) {
      f1FollowedType = 'driver';
      f1FollowedName = driverTeam.name;
      f1FollowedConstructorName = driverTeam.division;
    }
  }

  // ── Qualifying grid ───────────────────────────────────────────────────────
  const rawQualifying: any[] =
    (qualifyingRes.status === 'fulfilled' && qualifyingRes.value)
      ? (qualifyingRes.value?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults ?? [])
      : [];

  const f1QualifyingGrid = rawQualifying.length > 0
    ? rawQualifying.map((q: any) => ({
        position:       parseInt(q.position, 10),
        driverName:     `${q.Driver?.givenName ?? ''} ${q.Driver?.familyName ?? ''}`.trim(),
        constructorName: q.Constructor?.name ?? '',
        ergastDriverId: q.Driver?.driverId ?? '',
        q1: q.Q1 || undefined,
        q2: q.Q2 || undefined,
        q3: q.Q3 || undefined,
      }))
    : undefined;

  return {
    teamStanding,
    f1DriverStandings:      f1DriverStandings.length > 0 ? f1DriverStandings : undefined,
    f1ConstructorStandings: f1ConstructorStandings.length > 0 ? f1ConstructorStandings : undefined,
    f1RecentRaceResults:    f1RecentRaceResults.length > 0 ? f1RecentRaceResults : undefined,
    f1QualifyingGrid,
    f1FollowedType,
    f1FollowedName,
    f1FollowedConstructorName,
    f1SessionType:  sessionType,
    f1RaceName:     raceName || undefined,
    f1CircuitName:  circuitName || undefined,
    f1RoundNumber:  roundNumber,
  };
}

// ─── FIFA World Cup 2026 ──────────────────────────────────────────────────────

export async function fetchWorldCupPreview(
  teamId: string,
  opponentName: string,
  worldCupStage?: WorldCupStage,
  worldCupGroup?: string,
  eventId?: string,
): Promise<PreviewContext> {
  const teamName = WC_ID_TO_ESPN_NAME[teamId];
  if (!teamName) return {};

  const [standingsRes, extras] = await Promise.all([
    fetchTimeout(
      'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',
      { next: { revalidate: 3600 } },
    ).catch(() => null),
    fetchESPNMatchExtras('soccer/fifa.world', eventId, teamName, opponentName),
  ]);

  let worldCup: WorldCupMatchContext | undefined;
  let teamStanding: TeamStanding | undefined;
  let opponentStanding: TeamStanding | undefined;

  if (standingsRes?.ok) {
    const data = await standingsRes.json().catch(() => null);
    const groups: any[] = data?.children ?? [];

    for (const group of groups) {
      const entries: any[] = group.standings?.entries ?? [];
      const ourEntry = entries.find((e: any) => e.team?.displayName === teamName);
      if (!ourEntry) continue;

      const getStat = (e: any, ...names: string[]): number => {
        for (const name of names) {
          const s = (e.stats ?? []).find((st: any) => st.name === name);
          if (s !== undefined && s.value !== undefined) return Number(s.value);
        }
        return 0;
      };

      const groupTable: WorldCupGroupRow[] = entries.map((e: any, i: number) => {
        const gf = getStat(e, 'pointsFor', 'goalsFor');
        const ga = getStat(e, 'pointsAgainst', 'goalsAgainst');
        return {
          teamName:       e.team?.displayName ?? '',
          teamId:         WC_ESPN_NAME_TO_ID[e.team?.displayName ?? ''],
          position:       i + 1,
          played:         getStat(e, 'gamesPlayed', 'played'),
          wins:           getStat(e, 'wins'),
          draws:          getStat(e, 'ties', 'draws'),
          losses:         getStat(e, 'losses'),
          goalsFor:       gf,
          goalsAgainst:   ga,
          goalDifference: gf - ga,
          points:         getStat(e, 'points'),
        };
      });

      const ourRow      = groupTable.find(r => r.teamName === teamName);
      const oppRow      = groupTable.find(r => r.teamName === opponentName);
      const stage       = worldCupStage ?? 'group';
      const groupLetter = worldCupGroup ?? WC_TEAM_GROUPS[teamId] ?? group.name?.replace(/^Group\s*/i, '') ?? '';

      if (stage === 'group' && ourRow) {
        const played         = ourRow.played;
        const gamesRemaining = Math.max(0, 3 - played);
        worldCup = {
          stage:               'group',
          group:               groupLetter,
          groupTable,
          gamesPlayed:         played,
          gamesRemaining,
          advancementScenario: computeGroupAdvancementScenario(
            teamName, ourRow.points, played, gamesRemaining, ourRow.position,
          ),
        };
      } else {
        worldCup = {
          stage,
          group:               groupLetter,
          opponentTBD:         opponentName === 'TBD',
          opponentPlaceholder: opponentName === 'TBD' ? opponentName : undefined,
        };
      }

      if (ourRow) {
        teamStanding = {
          name:         ourRow.teamName,
          position:     ourRow.position,
          wins:         ourRow.wins,
          draws:        ourRow.draws,
          losses:       ourRow.losses,
          played:       ourRow.played,
          points:       ourRow.points,
          goalsFor:     ourRow.goalsFor,
          goalsAgainst: ourRow.goalsAgainst,
        };
      }
      if (oppRow) {
        opponentStanding = {
          name:         oppRow.teamName,
          position:     oppRow.position,
          wins:         oppRow.wins,
          draws:        oppRow.draws,
          losses:       oppRow.losses,
          played:       oppRow.played,
          points:       oppRow.points,
          goalsFor:     oppRow.goalsFor,
          goalsAgainst: oppRow.goalsAgainst,
        };
      }
      break;
    }
  }

  // Fallback: stage/group context only (standings unavailable)
  if (!worldCup && (worldCupStage || worldCupGroup)) {
    worldCup = {
      stage:               worldCupStage ?? 'group',
      group:               worldCupGroup,
      opponentTBD:         opponentName === 'TBD',
      opponentPlaceholder: opponentName === 'TBD' ? opponentName : undefined,
    };
  }

  return {
    worldCup,
    teamStanding,
    opponentStanding,
    teamLastLineup:     extras.teamLastLineup,
    opponentLastLineup: extras.opponentLastLineup,
    teamRecentForm:     extras.teamRecentForm,
    opponentRecentForm: extras.opponentRecentForm,
    headToHead:         extras.headToHead,
  };
}

// ─── Cricket (BBL + internationals) — cricketdata.org / CricAPI ────────────────

/**
 * Strict cricket team-name match — exact or full-substring only. Does NOT use the
 * last-word fallback espnNameMatch has: every women's side ends in "Women", so the
 * fallback would match "India Women" to "South Africa Women" and scramble
 * form/H2H/squad assignment. "United States Of America" still matches
 * "United States" by substring.
 */
function cricNameMatch(a: string, b: string): boolean {
  const x = (a ?? '').toLowerCase().trim();
  const y = (b ?? '').toLowerCase().trim();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Opponent name for a match, from its `teams` (preferred) or "A vs B" name. */
function cricOpponent(match: CricMatch, teamName: string): string {
  const fromTeams = (match.teams ?? []).find(t => !cricNameMatch(t, teamName));
  if (fromTeams) return fromTeams;
  const head = (match.name ?? '').split(',')[0];
  const sides = head.split(/\s+vs\.?\s+/i).map(s => s.trim()).filter(Boolean);
  return sides.find(s => !cricNameMatch(s, teamName)) ?? '';
}

/** Format a cricketdata score entry as a scoreline, e.g. "170/6 (20 ov)". */
function cricScoreLine(match: CricMatch, teamName: string): string | undefined {
  const first = teamName.toLowerCase().split(' ')[0];
  const s = (match.score ?? []).find(x => (x.inning ?? '').toLowerCase().includes(first));
  if (!s) return undefined;
  const ov = s.o != null ? ` (${s.o} ov)` : '';
  return `${s.r ?? 0}/${s.w ?? 0}${ov}`;
}

/** Turn a cricketdata status string into a qualitative result for the followed team. */
function cricResult(status: string | undefined, teamName: string, oppName: string): string {
  const s = status ?? '';
  const m = s.match(/^(.+?)\s+won\b/i);
  if (m) return cricNameMatch(m[1].trim(), teamName) ? `beat ${oppName}` : `lost to ${oppName}`;
  if (/\btie(d)?\b/i.test(s))       return `tied with ${oppName}`;
  if (/\bdraw/i.test(s))            return `drew with ${oppName}`;
  if (/no result|abandon/i.test(s)) return `no result vs ${oppName}`;
  return '';
}

/**
 * Builds cricket preview context from cricketdata.org for a given match id.
 * Pulls match_info (context/toss/score), match_squad (named players — only when
 * the match has a published squad), and series_info (series name + matchList for
 * recent form & head-to-head). All calls are cached per process (daily quota).
 */
export async function fetchCricketPreview(
  matchId: string,
  teamName: string,
  opponentName: string,
): Promise<PreviewContext> {
  if (!cricketConfigured() || !matchId) return {};
  const info = await cricMatchInfo(matchId);
  if (!info) return {};

  const fmtMap: Record<string, string> = { t20: 'T20', odi: 'ODI', test: 'Test' };
  const format = fmtMap[(info.matchType ?? '').toLowerCase()] ?? ((info.matchType ?? '').toUpperCase() || undefined);

  // "India vs Pakistan, 6th Match, Group A, ICC Womens T20 World Cup 2026"
  // → matchDesc "6th Match, Group A" (drop the "X vs Y" head and the series tail).
  let matchDesc: string | undefined;
  if (info.name) {
    const parts = info.name.split(',').map(s => s.trim()).filter(Boolean);
    const middle = parts.slice(1).filter(p => !/\b(cup|series|trophy|tour|league|championship)\b/i.test(p));
    matchDesc = middle.join(', ') || undefined;
  }

  const toss = info.tossWinner
    ? `${info.tossWinner}${info.tossChoice ? ` won the toss and chose to ${info.tossChoice}` : ' won the toss'}`
    : undefined;

  // ── Named squads (only when published) ──
  let teamSquad: string[] | undefined;
  let opponentSquad: string[] | undefined;
  if (info.hasSquad) {
    const groups = await cricMatchSquad(matchId);
    for (const g of groups) {
      const names = (g.players ?? []).map(p => p.name ?? '').filter(Boolean);
      if (names.length === 0) continue;
      if (cricNameMatch(g.teamName ?? '', teamName))          teamSquad = names;
      else if (cricNameMatch(g.teamName ?? '', opponentName)) opponentSquad = names;
    }
  }

  // ── Series state + recent form + head-to-head (from series matchList) ──
  let seriesName: string | undefined;
  let teamRecentResults: string[] | undefined;
  let h2hNote: string | undefined;
  if (info.series_id) {
    const series = await cricSeriesInfo(info.series_id);
    seriesName = series?.info?.name;
    const ended = (series?.matchList ?? [])
      .filter(m => m.matchEnded && m.status)
      .sort((a, b) => new Date(b.dateTimeGMT ?? 0).getTime() - new Date(a.dateTimeGMT ?? 0).getTime());

    const teamGames = ended.filter(m => (m.teams ?? []).some(t => cricNameMatch(t, teamName)));
    const results = teamGames.slice(0, 5).map(m => cricResult(m.status, teamName, cricOpponent(m, teamName))).filter(Boolean);
    if (results.length > 0) teamRecentResults = results;

    const meetings = ended.filter(m =>
      (m.teams ?? []).some(t => cricNameMatch(t, teamName)) &&
      (m.teams ?? []).some(t => cricNameMatch(t, opponentName)),
    );
    if (meetings.length >= 2) {
      const wins = meetings.filter(m => {
        const mm = (m.status ?? '').match(/^(.+?)\s+won\b/i);
        return mm ? cricNameMatch(mm[1].trim(), teamName) : false;
      }).length;
      h2hNote = wins * 2 > meetings.length
        ? `${teamName} have won most of the recent meetings in this series`
        : wins * 2 < meetings.length
          ? `${opponentName} have won most of the recent meetings in this series`
          : 'recent meetings in this series have been evenly split';
    }
  }

  return {
    teamSquad,
    opponentSquad,
    cricketContext: {
      format,
      seriesName,
      matchDesc,
      venue: info.venue,
      status: info.status,
      started: info.matchStarted,
      ended: info.matchEnded,
      toss,
      teamScoreLine:     info.matchStarted ? cricScoreLine(info, teamName) : undefined,
      opponentScoreLine: info.matchStarted ? cricScoreLine(info, opponentName) : undefined,
      teamRecentResults,
      h2hNote,
    },
  };
}
