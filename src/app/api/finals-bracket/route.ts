import { NextRequest, NextResponse } from 'next/server';
import { fetchFinalsBracket } from '@/lib/finals-bracket-data';
import { COMP_RULES } from '@/lib/competition-rules';

/** GET /api/finals-bracket?league=afl — full finals series with live results. */
export async function GET(req: NextRequest) {
  const league = req.nextUrl.searchParams.get('league') ?? '';
  if (!COMP_RULES[league]?.finalsSchedule) {
    return NextResponse.json({ error: 'No finals schedule for league' }, { status: 400 });
  }
  const rounds = await fetchFinalsBracket(league);
  if (!rounds) {
    return NextResponse.json({ error: 'No bracket source for league' }, { status: 404 });
  }
  return NextResponse.json(
    { league, rounds },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
  );
}
