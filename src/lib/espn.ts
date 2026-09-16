/**
 * Shared helpers for the sports API routes.
 *
 * These were previously copy-pasted across src/app/api/** route files. They are
 * consolidated here verbatim — no behavior change. Fetch/timeout, ESPN date-range
 * formatting, AEST display formatting, unknown-team fallback, and cricket format
 * parsing all live here.
 */

/** Fetch with a hard timeout (default 8 s). Throws on timeout or network error. */
export async function fetchTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse ESPN cricket eventType string → 'test' | 'odi' | 't20' */
export function parseCricketFormat(eventType: string): 'test' | 'odi' | 't20' {
  const t = (eventType ?? '').toLowerCase();
  if (t.includes('twenty') || t === 't20' || t.includes('t20')) return 't20';
  if (t.includes('one day') || t.includes('odi') || t.includes('list a')) return 'odi';
  if (t.includes('test') || t.includes('first class') || t.includes('first-class')) return 'test';
  return 't20';
}

/** Format date range string YYYYMMDD-YYYYMMDD for ESPN API */
export function espnDateRange(daysBack: number, daysForward: number): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 86400000);
  const end   = new Date(now.getTime() + daysForward * 86400000);
  return `${fmt(start)}-${fmt(end)}`;
}

/** Sydney UTC offset in whole hours for a given instant: 10 (AEST) or 11 (AEDT). */
function sydneyOffsetHours(utc: Date): number {
  const local = new Date(utc.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const asUtc = new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - asUtc.getTime()) / 3_600_000);
}

/**
 * Format a UTC instant as Sydney local time, DST-aware (COR-2).
 * `d` is the raw UTC instant (NOT pre-shifted). Daylight saving (Oct–Apr) is
 * honoured, so summer fixtures correctly read AEDT (UTC+11) rather than AEST.
 * Name retained for call-site stability; output is AEST or AEDT as appropriate.
 */
export function aestDisplay(d: Date): string {
  const offset = sydneyOffsetHours(d);
  const local  = new Date(d.getTime() + offset * 3_600_000);
  const h   = local.getUTCHours();
  const m   = local.getUTCMinutes().toString().padStart(2, '0');
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ap} ${offset === 11 ? 'AEDT' : 'AEST'}`;
}

/** Fallback for unknown opponents: grey + initials. */
export function unknownTeam(name: string): { color: string; abbr: string } {
  const words = name.trim().split(/\s+/);
  const abbr  = words.length >= 2
    ? words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
    : name.slice(0, 3).toUpperCase();
  return { color: '#6B7280', abbr };
}

// ─── ESPN response shapes (typing pilot — see /api/match-stats) ──────────────────
// Minimal, DEFENSIVE models of ONLY the fields our code reads from ESPN's untyped
// JSON. Every field is optional: ESPN is an external upstream and any field may be
// absent, so consumers keep using `?.` / `?? `. These type the parse boundary for
// compile-time checking — they are NOT runtime validation. Pilot scope is the
// match-stats route; the scoreboard/summary shapes are reusable for a later rollout
// to the other ESPN routes.

/** Team reference as it appears in scoreboard competitors and boxscore entries. */
export interface EspnTeamRef {
  id?: string | number;
  displayName?: string;
}

// ── Scoreboard search (…/scoreboard) ──
export interface EspnCompetitor {
  team?: EspnTeamRef;
  score?: string | number;
}
export interface EspnCompetition {
  competitors?: EspnCompetitor[];
}
export interface EspnEvent {
  id?: string | number;
  competitions?: EspnCompetition[];
}
export interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

// ── Event summary (…/summary) ──
/** Team-level aggregate statistic. */
export interface EspnTeamStatistic {
  name?: string;
  abbreviation?: string;
  displayValue?: string;
}
export interface EspnBoxscoreTeam {
  team?: EspnTeamRef;
  statistics?: EspnTeamStatistic[];
}
export interface EspnAthlete {
  displayName?: string;
  shortName?: string;
  position?: { abbreviation?: string };
}
export interface EspnAthleteStatLine {
  athlete?: EspnAthlete;
  stats?: string[];
}
/** A group of athlete stat lines; `keys`/`names` index the columns in `stats`. */
export interface EspnPlayerStatGroup {
  keys?: string[];
  names?: string[];
  athletes?: EspnAthleteStatLine[];
}
export interface EspnBoxscorePlayers {
  team?: EspnTeamRef;
  statistics?: EspnPlayerStatGroup[];
}
export interface EspnBoxscore {
  teams?: EspnBoxscoreTeam[];
  players?: EspnBoxscorePlayers[];
}
export interface EspnSummaryResponse {
  boxscore?: EspnBoxscore;
}

/**
 * ESPN soccer scoreboards stopped honouring dates=START-END ranges (observed
 * 2026-09-16: any range → 0 events, while single-date and month forms still
 * work — upstream change, not ours). Expand a window into per-MONTH `dates=`
 * values (YYYYMM) covering it; callers keep their own date filtering.
 */
export function espnMonthParams(startMs: number, endMs: number): string[] {
  const months: string[] = [];
  const d = new Date(startMs);
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= endMs && months.length < 8) {
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Drop-in scoreboard fetcher for the 2026-09-16 ESPN change: dates=START-END
 * range queries now return 0 events on EVERY sport feed, while single-date and
 * month (YYYYMM) forms still work. When the resolved URL carries an 8digit-8digit
 * range, this fans out per month, merges events by id, and returns a
 * Response-shaped object ({ok, json}) whose payload keeps the first month's
 * non-events fields. Month spillover is harmless — every call site already
 * bounds results with its own date/state filters. Non-range URLs pass through.
 */
export async function fetchESPNScoreboard(
  url: string,
  init?: Parameters<typeof fetchTimeout>[1],
): Promise<{ ok: boolean; status?: number; json: () => Promise<any> }> {
  const m = url.match(/([?&])dates=(\d{8})-(\d{8})/);
  if (!m) return fetchTimeout(url, init);
  const iso = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`;
  const months = espnMonthParams(Date.parse(iso(m[2])), Date.parse(iso(m[3])));
  let base: any = null;
  const events = new Map<string, any>();
  await Promise.all(months.map(async mo => {
    try {
      const res = await fetchTimeout(url.replace(m[0], `${m[1]}dates=${mo}`), init);
      if (!res.ok) return;
      const j = await res.json();
      if (!base) base = j;
      for (const ev of (j?.events ?? []) as any[]) {
        const id = String(ev?.id ?? '');
        if (id && !events.has(id)) events.set(id, ev);
      }
    } catch { /* skip month */ }
  }));
  if (!base) return { ok: false, status: 502, json: async () => ({}) };
  return { ok: true, json: async () => ({ ...base, events: [...events.values()] }) };
}
