/**
 * GET /api/preview?league=afl&teamId=afl-lions&opponentName=Geelong&gameId=afl-1234
 *
 * Returns PreviewContext for the game expand panel. All per-league data fetching
 * lives in @/lib/preview-fetchers (shared with the generation path); this route
 * is a thin HTTP wrapper that dispatches by league and overlays manager names.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PreviewContext, WorldCupStage } from '@/types';
import { SQUIGGLE_NAME } from '@/lib/afl';
import { WC_ID_TO_ESPN_NAME } from '@/lib/world-cup';
import { lookupManager } from '@/lib/managers';
import {
  fetchAFLPreview, fetchNRLPreview, fetchEPLPreview, fetchSRUPreview,
  fetchRINTPreview, fetchNBAPreview, fetchNHLPreview, fetchF1Preview,
  fetchWorldCupPreview, ESPN_TEAM_NAME, NRL_ESPN_NAME, SRU_ESPN_NAME,
  RINT_ESPN_NAME_P,
} from '@/lib/preview-fetchers';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' };

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'nba', 'nhl', 'f1', 'world_cup']);
const TEAMID_RE = /^[a-z0-9]+-?[a-z0-9_-]*$/;

export async function GET(req: NextRequest) {
  const league       = req.nextUrl.searchParams.get('league') ?? '';
  const teamId       = req.nextUrl.searchParams.get('teamId') ?? '';
  const opponentName = req.nextUrl.searchParams.get('opponentName') ?? '';
  const gameId       = req.nextUrl.searchParams.get('gameId') ?? '';
  const competition  = req.nextUrl.searchParams.get('competition') || undefined;

  if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  // Fixture ids embed the ESPN event id as the final segment — used by the shared
  // extractor for recent form / head-to-head / lineups.
  const eventId = gameId.split('-').pop() || undefined;

  try {
    let ctx: PreviewContext = {};
    if      (league === 'afl')         ctx = await fetchAFLPreview(teamId, opponentName, gameId);
    else if (league === 'nrl')         ctx = await fetchNRLPreview(teamId, opponentName, eventId);
    else if (league === 'epl')         ctx = await fetchEPLPreview(teamId, opponentName, competition, eventId);
    else if (league === 'super_rugby') ctx = await fetchSRUPreview(teamId, opponentName, eventId);
    else if (league === 'rugby_int')   ctx = await fetchRINTPreview(teamId, opponentName, eventId);
    else if (league === 'nba')         ctx = await fetchNBAPreview(teamId, opponentName, eventId);
    else if (league === 'nhl')         ctx = await fetchNHLPreview(teamId, opponentName, eventId);
    else if (league === 'f1') {
      const raceName    = req.nextUrl.searchParams.get('raceName') ?? '';
      const circuitName = req.nextUrl.searchParams.get('circuitName') ?? '';
      const sessionType = req.nextUrl.searchParams.get('sessionType') ?? 'Race';
      const roundNumber = parseInt(req.nextUrl.searchParams.get('roundNumber') ?? '0') || undefined;
      ctx = await fetchF1Preview(teamId, raceName, circuitName, sessionType, roundNumber);
    }
    else if (league === 'world_cup') {
      const wcStage = (req.nextUrl.searchParams.get('worldCupStage') || undefined) as WorldCupStage | undefined;
      const wcGroup = req.nextUrl.searchParams.get('worldCupGroup') || undefined;
      ctx = await fetchWorldCupPreview(teamId, opponentName, wcStage, wcGroup, eventId);
    }

    // Resolve opponent team ID from display name for the manager lookup.
    // We search ESPN_TEAM_NAME / NRL_ESPN_NAME / SQUIGGLE_NAME / SRU_ESPN_NAME / RINT_ESPN_NAME_P
    // by comparing the value against opponentName.
    const nameMaps: Record<string, string>[] = [
      ESPN_TEAM_NAME, NRL_ESPN_NAME, SQUIGGLE_NAME, SRU_ESPN_NAME, RINT_ESPN_NAME_P, WC_ID_TO_ESPN_NAME,
    ];
    let oppTeamId: string | undefined;
    for (const map of nameMaps) {
      const entry = Object.entries(map).find(([, v]) =>
        v.toLowerCase() === opponentName.toLowerCase(),
      );
      if (entry) { oppTeamId = entry[0]; break; }
    }

    ctx.teamManager     = lookupManager(teamId);
    ctx.opponentManager = oppTeamId ? lookupManager(oppTeamId) : undefined;

    return NextResponse.json(ctx, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[/api/preview]', err);
    return NextResponse.json({});
  }
}
