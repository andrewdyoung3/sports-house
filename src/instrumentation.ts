/**
 * Next.js instrumentation hook — runs once at server startup before any
 * requests are handled.
 *
 * Pre-warms the Next.js fetch data cache for all results-route upstream URLs.
 * The fetch options (next: { revalidate: 3600 }) mirror the results route
 * exactly, so both share the same cache entries.
 *
 *  - First startup after >1 hour gap → stale/missing cache → upstream fetched
 *    fresh → results page shows current data on first load.
 *  - Restart within the hour → cache still valid → no upstream call needed.
 *
 * A 15-second overall timeout ensures a slow/unreachable upstream API never
 * blocks the server from starting.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const now  = new Date();
  const year = now.getFullYear();

  function fmt(d: Date) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function rangeBack(days: number) {
    return `${fmt(new Date(now.getTime() - days * 86400000))}-${fmt(now)}`;
  }

  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

  // Each entry: [url, headers?]
  // All calls use next: { revalidate: 3600 } — must match results/route.ts exactly.
  function warm(url: string, headers?: Record<string, string>) {
    return fetch(url, { headers, next: { revalidate: 3600 } } as RequestInit).catch(() => {});
  }

  const calls = [
    // AFL — Squiggle full-year feed
    warm(`https://api.squiggle.com.au/?q=games;year=${year}`, { 'User-Agent': 'SportsHouseMVP/1.0' }),
    // NRL — 120-day lookback
    warm(`${ESPN}/rugby-league/3/scoreboard?dates=${rangeBack(120)}&limit=200`),
    // EPL — 5 competition feeds, 120-day lookback
    ...['eng.1', 'eng.fa', 'eng.league_cup', 'uefa.champions', 'uefa.europa'].map(
      slug => warm(`${ESPN}/soccer/${slug}/scoreboard?dates=${rangeBack(120)}&limit=200`),
    ),
    // Super Rugby — 120-day lookback
    warm(`${ESPN}/rugby/242041/scoreboard?dates=${rangeBack(120)}&limit=200`),
    // International Rugby — 3 competition IDs, 365-day lookback
    ...['289234', '244293', '180659'].map(
      id => warm(`${ESPN}/rugby/${id}/scoreboard?dates=${rangeBack(365)}&limit=200`),
    ),
    // Formula 1 — Ergast current-season results
    warm('https://api.jolpi.ca/ergast/f1/current/results.json?limit=100'),
    // BBL — 200-day lookback
    warm(`${ESPN}/cricket/8044/scoreboard?dates=${rangeBack(200)}&limit=200`),
    // International Cricket — known active series scoreboards
    ...[8604, 8037, 24231, 1530201, 24203].map(
      id => warm(`${ESPN}/cricket/${id}/scoreboard`),
    ),
  ];

  const warmup = Promise.allSettled(calls);

  // Cap total warmup time at 15 s so a down API never blocks server startup.
  await Promise.race([
    warmup,
    new Promise<void>(resolve => setTimeout(resolve, 15_000)),
  ]);
}
