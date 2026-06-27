/**
 * Canonical preview context builder — shared by ALL generation entry points.
 *
 * Delegates per-league data fetching to the shared fetchers in
 * @/lib/preview-fetchers (the SAME functions /api/preview uses — one source of
 * truth, no parallel paths). Overlays verified manager names. World Cup keeps
 * its own group/standings path here (intentionally untouched).
 *
 * Results are cached per fixture for the lifetime of the process so batch runs
 * (npm run warm) fetch each team's data at most once.
 *
 * Entry points (heartbeat, poller, regen) call generateAndStorePreview which
 * calls buildPreviewContext internally. Callers may pass additional enrichment
 * which is merged on top.
 */

import { MANAGER } from './managers';
import { WC_TEAM_GROUPS, WC_ID_TO_ESPN_NAME, WC_ESPN_NAME_TO_ID, computeGroupAdvancementScenario } from './world-cup';
import { TEAMS } from '@/lib/teams';
import {
  fetchAFLPreview, fetchNRLPreview, fetchEPLPreview, fetchSRUPreview,
  fetchRINTPreview, fetchNBAPreview, fetchNHLPreview, fetchF1Preview,
  fetchESPNMatchExtras, fetchCricketPreview,
} from './preview-fetchers';
import { fetchVenueWeather, OUTDOOR_LEAGUES } from './weather';
import type {
  LeagueTableRow,
  PreviewContext,
  UpcomingGame,
  WorldCupGroupRow,
  WorldCupMatchContext,
  WorldCupStage,
} from '@/types';

// ─── Module-level caches ──────────────────────────────────────────────────────
// Valid for the lifetime of a script process — reset on each new run.

// Rich per-fixture context (standings + news + lineups + injuries + ...). Keyed
// by the data-affecting fixture fields so repeated fixtures share one fetch.
const _richCache = new Map<string, Partial<PreviewContext>>();

// Raw ESPN WC standings response (all groups in one fetch).
let _wcRaw: unknown = null;

// Kickoff weather, keyed by venue+kickoff so repeated fixtures share one fetch
// and prod/sandbox stay deterministic within a process run.
const _weatherCache = new Map<string, import('@/types').WeatherData | undefined>();

// PERF-4: cap in-process cache age. The heartbeat runs as a fresh process per run,
// but a long-running server (dev / persistent host / sandbox routes) would otherwise
// serve these module caches indefinitely (e.g. _wcRaw never expired → days-old WC
// standings). The underlying fetches are still Next-cached with their own revalidate
// windows; this only bounds the extra in-process memo on top.
const CACHE_TTL_MS = 30 * 60_000;
let _cacheBornAt = Date.now();
function freshenCachesIfStale(): void {
  if (Date.now() - _cacheBornAt <= CACHE_TTL_MS) return;
  clearPreviewContextCache();
  _cacheBornAt = Date.now();
}

async function _cachedWeather(
  venue: string | undefined,
  kickoffISO: string,
): Promise<import('@/types').WeatherData | undefined> {
  const key = `${venue ?? ''}|${kickoffISO}`;
  if (_weatherCache.has(key)) return _weatherCache.get(key);
  let wx: import('@/types').WeatherData | undefined;
  try {
    wx = await fetchVenueWeather(venue, kickoffISO);
  } catch {
    wx = undefined;
  }
  _weatherCache.set(key, wx);
  return wx;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'SportsHouseMVP/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ─── Rich per-league fetch (delegates to shared fetchers) ─────────────────────

/**
 * Fetches the full data suite for a fixture via the shared @/lib/preview-fetchers
 * functions — the exact same code /api/preview runs. Returns standings, news,
 * lineups, injuries, key performers, squads, tips, F1 race data, etc.
 *
 * World Cup is handled separately in buildPreviewContext (its own group path).
 */
async function fetchRichContext(
  league: string,
  fixture: UpcomingGame,
  teamName: string,
): Promise<Partial<PreviewContext>> {
  const opp = fixture.opponent;
  // Fixture ids embed the ESPN event id as the final segment (e.g. nrl-603367 →
  // 603367, soccer-eng.1-740596 → 740596). The shared extractor uses it to fetch
  // recent form / head-to-head / lineups from that event's summary endpoint.
  const eventId = fixture.id.split('-').pop();
  switch (league) {
    case 'afl':         return fetchAFLPreview(fixture.teamId, opp, fixture.id);
    case 'nrl':         return fetchNRLPreview(fixture.teamId, opp, eventId);
    case 'epl':         return fetchEPLPreview(fixture.teamId, opp, fixture.competition, eventId);
    case 'super_rugby': return fetchSRUPreview(fixture.teamId, opp, eventId);
    case 'rugby_int':   return fetchRINTPreview(fixture.teamId, opp, eventId);
    case 'nba':         return fetchNBAPreview(fixture.teamId, opp, eventId);
    case 'nhl':         return fetchNHLPreview(fixture.teamId, opp, eventId);
    // Cricket fixture ids are `cint-<uuid>` / `bbl-<uuid>` where the uuid is the
    // cricketdata.org match id (which itself contains hyphens — strip the prefix).
    case 'bbl':
    case 'cricket_int': {
      const matchId = fixture.id.replace(/^(cint|bbl)-/, '');
      return fetchCricketPreview(matchId, teamName, opp);
    }
    case 'f1': {
      // F1 fixture id is `f1-<round>-<sessionKey>`; raceName=opponent, circuit=venue,
      // sessionType=competition label (e.g. "Race", "Qualifying").
      const round = parseInt(fixture.id.split('-')[1] ?? '', 10) || undefined;
      return fetchF1Preview(
        fixture.teamId, fixture.opponent, fixture.venue ?? '',
        fixture.competition ?? 'Race', round,
      );
    }
    default: return {};
  }
}

/** Per-fixture cached wrapper around fetchRichContext. */
async function cachedRichContext(
  league: string,
  fixture: UpcomingGame,
  teamName: string,
): Promise<Partial<PreviewContext>> {
  const key = `${league}:${fixture.teamId}:${fixture.opponent}:${fixture.competition ?? ''}:${fixture.id}`;
  if (_richCache.has(key)) return _richCache.get(key)!;
  let ctx: Partial<PreviewContext>;
  try {
    ctx = await fetchRichContext(league, fixture, teamName);
  } catch (err) {
    // REL-2: a transient fetch error must NOT be cached as {} — doing so blanked
    // the fixture's entire context for the whole process run (every later call
    // returned the empty object, so the preview generated from no data). Return
    // empty for THIS call but leave the cache unset so a later call retries.
    console.warn(`[preview-context] rich fetch failed league=${league} team=${fixture.teamId}: ${err instanceof Error ? err.message : err}`);
    return {};
  }
  _richCache.set(key, ctx);
  return ctx;
}

// ─── World Cup standings/group (kept here — intentionally untouched) ──────────

async function _fetchRawWC(): Promise<unknown> {
  if (_wcRaw) return _wcRaw;
  _wcRaw = await fetchJson('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings');
  return _wcRaw;
}

// Completed GROUP-STAGE results, cached per process. Sourced from the SAME ESPN
// scoreboard endpoint already used for WC fixtures (not a new dependency). The
// standings payload is aggregate-only, so who-beat-whom must come from here.
let _wcScoreboard: unknown = null;
async function _fetchWCScoreboard(): Promise<unknown> {
  if (_wcScoreboard) return _wcScoreboard;
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date(now.getTime() - 40 * 86400_000);
  const end   = new Date(now.getTime() + 10 * 86400_000);
  _wcScoreboard = await fetchJson(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${fmt(start)}-${fmt(end)}&limit=300`,
  ).catch(() => null);
  return _wcScoreboard;
}

/**
 * Completed group-stage results among a given set of group team names (who-beat-whom).
 * Filters to season.slug==='group-stage' + completed; a scheduled meeting is omitted
 * (⇒ "not met"). Goals taken from each listed competitor's score.
 */
async function _wcGroupResults(
  groupTeams: Set<string>,
): Promise<Array<{ teamA: string; teamB: string; goalsA: number; goalsB: number }>> {
  const sb = await _fetchWCScoreboard() as Record<string, unknown> | null;
  const events = (sb?.events as Record<string, unknown>[]) ?? [];
  const out: Array<{ teamA: string; teamB: string; goalsA: number; goalsB: number }> = [];
  for (const e of events) {
    const slug = ((e.season as Record<string, unknown> | undefined)?.slug ?? '') as string;
    if (slug !== 'group-stage') continue;
    const completed = !!((e.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined)?.completed;
    if (!completed) continue;
    const comp = ((e.competitions as Record<string, unknown>[]) ?? [])[0];
    const cs   = (comp?.competitors as Record<string, unknown>[]) ?? [];
    if (cs.length !== 2) continue;
    // Normalise to our canonical names so the H2H provider, groupTeams set, and the
    // ranked rows all key on the same names (the rows are already canonicalised).
    const nm = (c: Record<string, unknown>) => _canonicalWCName(String((c.team as Record<string, unknown> | undefined)?.displayName ?? ''));
    const a = nm(cs[0]), b = nm(cs[1]);
    if (!groupTeams.has(a) || !groupTeams.has(b)) continue;
    out.push({ teamA: a, teamB: b, goalsA: Number(cs[0].score ?? 0), goalsB: Number(cs[1].score ?? 0) });
  }
  return out;
}

interface WCGroupData { table: LeagueTableRow[]; wcRows: WorldCupGroupRow[] }

/**
 * ESPN WC displayName → our canonical TEAMS name (e.g. "Türkiye" → "Turkey",
 * "United States" → "USA"). Keeps the whole WC subsystem — group rows, completed
 * group results, and the downstream teamName/opponentName comparisons in the prompt
 * — on ONE name convention, so a followed team is never lost to a name-variant gap
 * (the bug that dropped the entire group context for Turkey and let the model
 * invent the group letter). Falls back to the ESPN name when unmapped.
 */
function _canonicalWCName(espnName: string): string {
  const id = WC_ESPN_NAME_TO_ID[espnName];
  return (id ? TEAMS.find(t => t.id === id)?.name : undefined) ?? espnName;
}

async function _wcGroupForTeam(teamName: string, groupLetter?: string): Promise<WCGroupData> {
  const data   = await _fetchRawWC() as Record<string, unknown>;
  const groups = (data.children as unknown[]) ?? [];

  const sv = (e: Record<string, unknown>, ...ns: string[]): number =>
    ns.reduce(
      (v, n) => v || Number(((e.stats as Record<string, unknown>[]) ?? []).find(s => s.name === n)?.value ?? 0),
      0,
    );

  for (const g of groups as Record<string, unknown>[]) {
    const entries = ((g.standings as Record<string, unknown> | undefined)?.entries as Record<string, unknown>[]) ?? [];
    // Locate the group by its LETTER (deterministic from WC_TEAM_GROUPS) first —
    // robust to name variants — then fall back to a canonical-name membership match.
    const espnGroupName = String(g.name ?? '');
    const byLetter = !!groupLetter && espnGroupName === `Group ${groupLetter}`;
    const byName   = entries.some(e => {
      const dn = String((e.team as Record<string, unknown> | undefined)?.displayName ?? '');
      return dn === teamName || _canonicalWCName(dn) === teamName;
    });
    if (!byLetter && !byName) continue;

    const table: LeagueTableRow[] = entries.map((e, j) => ({
      name:     _canonicalWCName(String((e.team as Record<string, unknown>)?.displayName ?? '')),
      position: j + 1,
      played:   sv(e, 'gamesPlayed', 'played'),
      wins:     sv(e, 'wins'),
      draws:    sv(e, 'ties', 'draws'),
      losses:   sv(e, 'losses'),
      points:   sv(e, 'points'),
    }));

    const wcRows: WorldCupGroupRow[] = entries.map((e, j) => {
      const gf = sv(e, 'pointsFor', 'goalsFor');
      const ga = sv(e, 'pointsAgainst', 'goalsAgainst');
      return {
        teamName:       _canonicalWCName(String((e.team as Record<string, unknown>)?.displayName ?? '')),
        position:       j + 1,
        played:         sv(e, 'gamesPlayed', 'played'),
        wins:           sv(e, 'wins'),
        draws:          sv(e, 'ties', 'draws'),
        losses:         sv(e, 'losses'),
        goalsFor:       gf,
        goalsAgainst:   ga,
        goalDifference: gf - ga,
        points:         sv(e, 'points'),
      };
    });

    return { table, wcRows };
  }

  return { table: [], wcRows: [] };
}

async function _buildWCMatchContext(
  teamName: string,
  teamId: string,
  worldCupStage: string | undefined,
): Promise<WorldCupMatchContext | undefined> {
  try {
    // Group letter from our own deterministic map drives the lookup (robust to the
    // ESPN/our name divergence — e.g. "Türkiye" vs "Turkey" — that previously
    // dropped the whole group context and let the model invent the group letter).
    const group  = WC_TEAM_GROUPS[teamId];
    const { wcRows } = await _wcGroupForTeam(teamName, group);
    if (wcRows.length === 0) return undefined;
    const ourRow = wcRows.find(r =>
      r.teamName === teamName || teamName.includes(r.teamName.split(' ')[0]),
    );
    const played         = ourRow?.played ?? 0;
    const gamesRemaining = Math.max(0, 3 - played);

    // Completed intra-group results (who-beat-whom) for the 2026 H2H tiebreaker.
    // Only fetched when the group has actually started (saves a call pre-tournament).
    const groupTeams   = new Set(wcRows.map(r => r.teamName));
    const groupResults = wcRows.some(r => r.played > 0)
      ? await _wcGroupResults(groupTeams)
      : [];

    return {
      stage:               (worldCupStage ?? 'group') as WorldCupStage,
      group,
      groupTable:          wcRows,
      gamesPlayed:         played,
      gamesRemaining,
      groupResults,
      advancementScenario: ourRow
        ? computeGroupAdvancementScenario(teamName, ourRow.points, played, gamesRemaining, ourRow.position)
        : '',
    };
  } catch (err) {
    console.warn(`[preview-context] WC context failed: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

async function _buildWorldCupContext(
  fixture: UpcomingGame,
  teamName: string,
): Promise<Partial<PreviewContext>> {
  const ctx: Partial<PreviewContext> = {};
  let table: LeagueTableRow[] = [];
  try {
    table = (await _wcGroupForTeam(teamName)).table;
  } catch (err) {
    console.warn(`[preview-context] WC standings fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  // REL-4: an empty group table for a followed WC team is the silent-drop symptom
  // (ESPN name-variant drift or feed change). Surface it instead of producing a
  // contentless group block. check-team-coverage guards the static name maps.
  if (table.length === 0) {
    console.warn(`[preview-context] WC group table empty for "${teamName}" (id=${fixture.teamId}) — group/form context will be missing`);
  }

  if (table.length > 0) {
    const sorted  = [...table].sort((a, b) => a.position - b.position);
    const teamRow = sorted.find(r =>
      r.name === teamName ||
      teamName.includes(r.name.split(' ')[0]) ||
      r.name.includes(teamName.split(' ')[0]),
    );
    const oppRow = sorted.find(r =>
      r.name === fixture.opponent ||
      fixture.opponent.includes(r.name.split(' ')[0]) ||
      r.name.includes(fixture.opponent.split(' ')[0]),
    );
    ctx.leagueTable = table;
    if (teamRow) ctx.teamStanding     = { ...teamRow };
    if (oppRow)  ctx.opponentStanding = { ...oppRow };
  }

  const wcCtx = await _buildWCMatchContext(teamName, fixture.teamId, fixture.worldCupStage);
  if (wcCtx) ctx.worldCup = wcCtx;

  // Recent form / head-to-head / lineups from the fixture's ESPN summary.
  const wcTeamName = WC_ID_TO_ESPN_NAME[fixture.teamId] ?? teamName;
  const extras = await fetchESPNMatchExtras(
    'soccer/fifa.world', fixture.id.split('-').pop(), wcTeamName, fixture.opponent,
  );
  ctx.teamRecentForm     = extras.teamRecentForm;
  ctx.opponentRecentForm = extras.opponentRecentForm;
  ctx.headToHead         = extras.headToHead;
  ctx.teamLastLineup     = extras.teamLastLineup;
  ctx.opponentLastLineup = extras.opponentLastLineup;

  return ctx;
}

// ─── Public: buildPreviewContext ──────────────────────────────────────────────

/**
 * Builds the canonical context for a fixture — the full data suite (standings,
 * news, lineups, injuries, key performers, squads, tips, F1 race data, WC group)
 * plus verified manager names. Single source of truth for all automated
 * generation paths (heartbeat, poller, regen).
 *
 * The caller may merge additional enrichment on top using object spread.
 */
export async function buildPreviewContext(
  league: string,
  fixture: UpcomingGame,
  teamName: string,
): Promise<Partial<PreviewContext>> {
  freshenCachesIfStale();  // PERF-4: bound in-process cache age on long-running servers
  const ctx: Partial<PreviewContext> = league === 'world_cup'
    ? await _buildWorldCupContext(fixture, teamName)
    : { ...(await cachedRichContext(league, fixture, teamName)) };

  // Fixture kickoff — lets the structure layer infer the finals round (the feed
  // carries no stage label for finals games).
  ctx.fixtureDate = fixture.date;

  // Verified head coaches — static map, never model-inferred.
  ctx.teamManager     = MANAGER[fixture.teamId];
  ctx.opponentManager = fixture.opponentId ? MANAGER[fixture.opponentId] : undefined;

  // Kickoff weather for outdoor fixtures (Open-Meteo). Cached per process; only
  // surfaces in the prompt when conditions are notable (see weather block).
  if (OUTDOOR_LEAGUES.has(league)) {
    ctx.weather = await _cachedWeather(fixture.venue, fixture.date);
  }

  return ctx;
}

/** Clear all caches — useful in tests. */
export function clearPreviewContextCache(): void {
  _richCache.clear();
  _weatherCache.clear();
  _wcRaw = null;
  _wcScoreboard = null;
  _cacheBornAt = Date.now();
}
