/**
 * GET /api/league-fixtures?league=afl
 *
 * Returns ALL upcoming fixtures for a given league — one entry per game.
 * Fetchers live in src/lib/league-fixtures.ts; this route wraps a few of them
 * with unstable_cache for server-side data deduplication under high traffic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import type { UpcomingGame } from '@/types';
import {
  fetchAFLFixtures,
  fetchNRLFixtures,
  fetchEPLFixtures,
  fetchSRUFixtures,
  fetchRINTFixtures,
  fetchNBAFixtures,
  fetchF1Fixtures,
  fetchBBLFixtures,
  fetchCricketIntFixtures,
} from '@/lib/league-fixtures';

// Server-side data cache (deduplicates concurrent requests to ESPN during busy periods).
const fetchNRLLeague  = unstable_cache(fetchNRLFixtures,  ['lf-nrl'], { revalidate: 3600 });
const fetchSRULeague  = unstable_cache(fetchSRUFixtures,  ['lf-sru'], { revalidate: 3600 });
const fetchNBALeague  = unstable_cache(fetchNBAFixtures,  ['lf-nba'], { revalidate: 300  });

const ALLOWED = new Set([
  'afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'nba', 'nhl',
  'f1', 'bbl', 'cricket_int',
]);

export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  if (!ALLOWED.has(league)) {
    return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
  }
  try {
    let fixtures: UpcomingGame[] = [];
    if      (league === 'afl')         fixtures = await fetchAFLFixtures();
    else if (league === 'epl')         fixtures = await fetchEPLFixtures();
    else if (league === 'nrl')         fixtures = await fetchNRLLeague();
    else if (league === 'super_rugby') fixtures = await fetchSRULeague();
    else if (league === 'rugby_int')   fixtures = await fetchRINTFixtures();
    else if (league === 'nba')         fixtures = await fetchNBALeague();
    else if (league === 'nhl')         fixtures = [];
    else if (league === 'f1')          fixtures = await fetchF1Fixtures();
    else if (league === 'bbl')         fixtures = await fetchBBLFixtures();
    else if (league === 'cricket_int') fixtures = await fetchCricketIntFixtures();
    return NextResponse.json(fixtures, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[/api/league-fixtures]', err);
    return NextResponse.json([]);
  }
}
