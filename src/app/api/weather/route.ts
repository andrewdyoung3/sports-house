/**
 * GET /api/weather?venue=...&date=...
 *
 * Returns weather conditions at kickoff time for a given venue. Thin HTTP wrapper
 * over the shared fetchVenueWeather in @/lib/weather — the SAME function the AI
 * generation path (buildPreviewContext) uses, so display and previews never drift.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchVenueWeather } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const venue = searchParams.get('venue');
  const date  = searchParams.get('date');

  if (!venue || !date) {
    return NextResponse.json({ error: 'venue and date required' }, { status: 400 });
  }
  if (venue.length > 120) {
    return NextResponse.json({ error: 'venue name too long' }, { status: 400 });
  }
  if (isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  try {
    const weather = await fetchVenueWeather(venue, date);
    if (!weather) {
      return NextResponse.json({ error: 'weather unavailable for venue/date' }, { status: 404 });
    }
    return NextResponse.json(weather, {
      headers: { 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[/api/weather]', err);
    return NextResponse.json({ error: 'Weather fetch failed' }, { status: 500 });
  }
}
