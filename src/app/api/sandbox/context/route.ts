import { NextRequest, NextResponse } from 'next/server';
import { buildBlocks, SYSTEM_PROMPT } from '@/lib/preview-prompt';
import { buildPreviewContext } from '@/lib/preview-context';
import { TEAMS } from '@/lib/teams';
import { fetchLeagueFixtures } from '@/lib/league-fixtures';
import type { PreviewContext } from '@/types';

export const dynamic = 'force-dynamic';

const PREFIX_TO_LEAGUE: Record<string, string> = {
  afl:  'afl',
  nrl:  'nrl',
  epl:  'epl',
  sru:  'super_rugby',
  wc:   'world_cup',
  nba:  'nba',
  f1:   'f1',
  rint: 'rugby_int',
  bbl:  'bbl',
  cint: 'cricket_int',
};

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const gameId = req.nextUrl.searchParams.get('gameId')?.trim();
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 });

  const prefix = gameId.split('-')[0];
  const league = PREFIX_TO_LEAGUE[prefix];
  if (!league) return NextResponse.json({ error: 'unknown gameId prefix' }, { status: 400 });

  try {
    const fixtures = await fetchLeagueFixtures(league, 30);
    const now = Date.now();
    const fixture = fixtures.find(
      f => f.id === gameId && new Date(f.date).getTime() <= now + 60 * 86400_000,
    );
    if (!fixture) return NextResponse.json({ error: 'fixture not found' }, { status: 404 });

    const teamEntry = TEAMS.find(t => t.id === fixture.teamId);
    const teamName  = teamEntry?.name ?? fixture.teamId;

    // Canonical context — the exact same builder production's generation path uses.
    const ctx = await buildPreviewContext(league, fixture, teamName);

    // Decompose the prompt buildDataBlock would produce, into per-block text + footer.
    // Same positional args production passes in generateAndStorePreview.
    const { blocks, footer } = buildBlocks(
      league, teamName, fixture.opponent, ctx as PreviewContext, [], [],
      fixture.competition, false, undefined, fixture.venue, fixture.isHome,
      fixture.teamId, fixture.opponentId, fixture.seriesSummary,
    );

    return NextResponse.json({
      gameLabel: `${teamName} vs ${fixture.opponent}`,
      league,
      blocks,
      systemPrompt: SYSTEM_PROMPT,
      footer,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
