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
import {
  fetchAFLPreview, fetchNRLPreview, fetchEPLPreview, fetchSRUPreview,
  fetchRINTPreview, fetchNBAPreview, fetchNHLPreview, fetchF1Preview,
  fetchCricketPreview,
} from './preview-fetchers';
import { fetchVenueWeather, OUTDOOR_LEAGUES } from './weather';
import type {
  PreviewContext,
  UpcomingGame,
} from '@/types';

// ─── Module-level caches ──────────────────────────────────────────────────────
// Valid for the lifetime of a script process — reset on each new run.

// Rich per-fixture context (standings + news + lineups + injuries + ...). Keyed
// by the data-affecting fixture fields so repeated fixtures share one fetch.
const _richCache = new Map<string, Partial<PreviewContext>>();

// Kickoff weather, keyed by venue+kickoff so repeated fixtures share one fetch
// and prod/sandbox stay deterministic within a process run.
const _weatherCache = new Map<string, import('@/types').WeatherData | undefined>();

// PERF-4: cap in-process cache age.
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
  const ctx: Partial<PreviewContext> = { ...(await cachedRichContext(league, fixture, teamName)) };

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
  _cacheBornAt = Date.now();
}
