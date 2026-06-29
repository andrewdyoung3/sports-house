/**
 * cricketdata.org (CricAPI) client — the cricket data source, since every
 * ESPN/cricinfo cricket endpoint is WAF-blocked from the server.
 *
 * Branding note: cricketdata.org === CricAPI. Account/docs at cricketdata.org;
 * the API itself is https://api.cricapi.com/v1/. Key in CRICKETDATA_API_KEY.
 *
 * QUOTA: the Lifetime Free tier is 100 hits/DAY (not feature-gated). So every
 * call is cached at module level for the lifetime of the process — a single
 * hourly heartbeat across several cricket fixtures must share one `currentMatches`
 * fetch and never re-fetch the same match/series. A daily-quota signal trips a
 * circuit breaker that suppresses all further calls this run.
 *
 * NOT safe to import in client components — Node-only network fetch + secret key.
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { fetchTimeout } from '@/lib/espn';

const BASE = 'https://api.cricapi.com/v1';

// ─── Cross-run file cache (reclaims daily quota) ──────────────────────────────
// The heartbeat runs hourly as a FRESH process, so the per-process module cache is
// cold each run — currentMatches alone would cost ~24 hits/day of pure polling.
// A short file-backed TTL on /tmp survives across runs so the same response is
// reused for a few hours. Best-effort: any fs error falls through to a live fetch.

// /tmp matches the project convention (logs, generation lock) and is shared by the
// launchd heartbeat/poller and the dev server.
function cacheFile(name: string): string {
  return `/tmp/sporthouse-cric-${name}.json`;
}
function fileCacheGet<T>(name: string, ttlMs: number): T | null {
  try {
    const p = cacheFile(name);
    if (Date.now() - statSync(p).mtimeMs > ttlMs) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch { return null; }
}
function fileCacheSet(name: string, data: unknown): void {
  try { writeFileSync(cacheFile(name), JSON.stringify(data)); } catch { /* non-fatal */ }
}

// TTLs — long enough to slash polling, short enough to stay current for previews.
const TTL_CURRENT = 3 * 3600_000;  // currentMatches: fixture discovery
const TTL_SERIES  = 6 * 3600_000;  // series_info: schedules change slowly
const TTL_MATCH   = 30 * 60_000;   // match_info: stable pre-match; bounded for live
const TTL_SQUAD   = 6 * 3600_000;  // match_squad: stable once announced

function apiKey(): string | undefined {
  return process.env.CRICKETDATA_API_KEY?.trim() || undefined;
}

/** True once the key is configured — gate fetchers so they degrade gracefully. */
export function cricketConfigured(): boolean {
  return !!apiKey();
}

// ─── Per-process caches (one process = one heartbeat run) ─────────────────────
let _quotaTripped = false;
let _current: { fetched: boolean; data: CricMatch[] } = { fetched: false, data: [] };
let _currentFailedAt = 0;                 // REL-2: negative-cache timestamp for failures
const CURRENT_NEG_CACHE_MS = 60_000;      // suppress retries for 60s after a failure
const _seriesInfo = new Map<string, CricSeriesInfo | null>();
const _matchInfo  = new Map<string, CricMatch | null>();
const _matchSquad = new Map<string, CricSquadGroup[]>();

// ─── Response shapes (only the fields we read) ────────────────────────────────
export interface CricScore { r?: number; w?: number; o?: number; inning?: string }
export interface CricMatch {
  id: string;
  name?: string;
  matchType?: string;          // 't20' | 'odi' | 'test'
  status?: string;             // e.g. "India won by 6 wkts" / "Match not started"
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  teamInfo?: { name?: string; shortname?: string; img?: string }[];
  score?: CricScore[];
  series_id?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
  matchWinner?: string;
  tossWinner?: string;
  tossChoice?: string;
  hasSquad?: boolean;
}
export interface CricSquadPlayer { id?: string; name?: string; role?: string; battingStyle?: string; bowlingStyle?: string }
export interface CricSquadGroup { teamName?: string; shortname?: string; players?: CricSquadPlayer[] }
export interface CricSeriesInfo {
  info?: { id?: string; name?: string; startdate?: string; enddate?: string; matches?: number; odi?: number; t20?: number; test?: number };
  matchList?: CricMatch[];
}

// ─── Core call (cached at each public wrapper, not here) ──────────────────────
async function call(endpoint: string, params: string): Promise<Record<string, unknown> | null> {
  const key = apiKey();
  if (!key || _quotaTripped) return null;
  try {
    const res = await fetchTimeout(
      `${BASE}/${endpoint}?apikey=${key}&${params}`,
      { next: { revalidate: 1800 }, timeoutMs: 8000 },
    );
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    if (json.status !== 'success') {
      // Daily-quota / limit signals come back as a non-success status string.
      const s = typeof json.status === 'string' ? json.status : '';
      if (/limit|exceed|quota|usage/i.test(s)) {
        _quotaTripped = true;
        console.warn(`[cricketdata] quota signal — suppressing further calls this run: ${s}`);
      }
      return null;
    }
    return json;
  } catch (err) {
    console.warn(`[cricketdata] ${endpoint} failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** All current/live/recent matches — module cache → file cache (3h) → API. */
export async function cricCurrentMatches(): Promise<CricMatch[]> {
  if (_current.fetched) return _current.data;
  const cached = fileCacheGet<CricMatch[]>('current', TTL_CURRENT);
  if (cached) { _current.fetched = true; _current.data = cached; return cached; }
  // REL-2: do NOT mark fetched=true before the call — a single transient failure
  // (timeout / 5xx / quota) used to poison the whole process with [], silently
  // zeroing all cricket fixtures for the run. Only cache a SUCCESSFUL fetch; on
  // failure leave fetched=false (the next run self-heals) but negative-cache for a
  // short window so a generic outage can't trigger a retry storm within one run.
  if (Date.now() - _currentFailedAt < CURRENT_NEG_CACHE_MS) return _current.data;
  const j = await call('currentMatches', 'offset=0');
  if (!j) {
    _currentFailedAt = Date.now();
    console.warn('[cricketdata] currentMatches fetch failed — not caching; will retry');
    return _current.data;
  }
  _current.data = (j.data as CricMatch[]) ?? [];
  _current.fetched = true;
  fileCacheSet('current', _current.data);
  return _current.data;
}

/** Series detail (incl. full matchList with upcoming fixtures) — caches (6h). */
export async function cricSeriesInfo(id: string): Promise<CricSeriesInfo | null> {
  if (_seriesInfo.has(id)) return _seriesInfo.get(id)!;
  const cached = fileCacheGet<CricSeriesInfo>(`series-${id}`, TTL_SERIES);
  if (cached) { _seriesInfo.set(id, cached); return cached; }
  const j = await call('series_info', `id=${encodeURIComponent(id)}`);
  const data = (j?.data as CricSeriesInfo) ?? null;
  _seriesInfo.set(id, data);
  if (j && data) fileCacheSet(`series-${id}`, data);
  return data;
}

/** Single match detail — caches (30m). */
export async function cricMatchInfo(id: string): Promise<CricMatch | null> {
  if (_matchInfo.has(id)) return _matchInfo.get(id)!;
  const cached = fileCacheGet<CricMatch>(`match-${id}`, TTL_MATCH);
  if (cached) { _matchInfo.set(id, cached); return cached; }
  const j = await call('match_info', `id=${encodeURIComponent(id)}`);
  const data = (j?.data as CricMatch) ?? null;
  _matchInfo.set(id, data);
  if (j && data) fileCacheSet(`match-${id}`, data);
  return data;
}

/** Named squads for a match (only populated when match.hasSquad) — caches (6h). */
export async function cricMatchSquad(id: string): Promise<CricSquadGroup[]> {
  if (_matchSquad.has(id)) return _matchSquad.get(id)!;
  const cached = fileCacheGet<CricSquadGroup[]>(`squad-${id}`, TTL_SQUAD);
  if (cached) { _matchSquad.set(id, cached); return cached; }
  const j = await call('match_squad', `id=${encodeURIComponent(id)}`);
  const data = (j?.data as CricSquadGroup[]) ?? [];
  _matchSquad.set(id, data);
  if (j) fileCacheSet(`squad-${id}`, data);
  return data;
}

/** Reset caches — for tests. */
export function clearCricketCache(): void {
  _quotaTripped = false;
  _current = { fetched: false, data: [] };
  _currentFailedAt = 0;
  _seriesInfo.clear();
  _matchInfo.clear();
  _matchSquad.clear();
}
