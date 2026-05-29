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
