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

/** Format a UTC Date shifted to AEST (UTC+10) as a display string. */
export function aestDisplay(d: Date): string {
  const h   = d.getUTCHours();
  const m   = d.getUTCMinutes().toString().padStart(2, '0');
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ap} AEST`;
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
