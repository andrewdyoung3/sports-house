/**
 * POST /api/warm-team
 * Body: { teamId: string; league: string }
 *
 * Fire-and-forget: pre-generates AI previews for the team's next round of
 * upcoming fixtures (next 24 h). Returns 202 immediately so the client never
 * waits. Generation runs in the background on the server event loop.
 *
 * Requires a valid Supabase session (anonymous sessions are fine). This
 * prevents open abuse while still working for first-time visitors.
 *
 * Called by the client in user-prefs.ts whenever a new team is followed.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { UpcomingGame } from '@/types';
import { TEAMS } from '@/lib/teams';
import { getSupabaseServer } from '@/lib/supabase/server';

// In-memory set to prevent duplicate concurrent warm runs for the same team.
const inProgress = new Set<string>();

async function generatePreviews(
  teamId: string,
  league: string,
  base: string,
  cronSecret: string,
): Promise<void> {
  if (inProgress.has(teamId)) return;
  inProgress.add(teamId);
  try {
    const fixtureRes = await fetch(`${base}/api/league-fixtures?league=${league}`, {
      cache: 'no-store',
    });
    if (!fixtureRes.ok) return;

    const allFixtures = await fixtureRes.json() as UpcomingGame[];
    if (!Array.isArray(allFixtures)) return;

    const now    = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const teamFixtures = allFixtures.filter(f => {
      const d = new Date(f.date);
      if (d < now || d > cutoff) return false;
      if (league === 'f1') return true; // any F1 follower → all F1 fixtures
      return f.teamId === teamId || f.opponentId === teamId;
    });

    const teamEntry = TEAMS.find(t => t.id === teamId);
    for (const fixture of teamFixtures) {
      try {
        await fetch(`${base}/api/ai-preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': cronSecret,
          },
          body: JSON.stringify({
            league,
            teamId:       fixture.teamId,
            teamName:     teamEntry?.name ?? fixture.teamId,
            opponentName: fixture.opponent,
            gameId:       fixture.id,
            context:      {},
            teamResults:  [],
            oppResults:   [],
            competition:  fixture.competition,
            isHome:       fixture.isHome,
            opponentId:   fixture.opponentId,
          }),
        });
      } catch { /* non-fatal — partial generation is fine */ }
    }
  } finally {
    inProgress.delete(teamId);
  }
}

export async function POST(req: NextRequest) {
  // ── Auth gate ───────────────────────────────────────────────────────────────
  const sb = getSupabaseServer();
  if (sb) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ ok: true, status: 'no-op' });

  // ── Parse body ──────────────────────────────────────────────────────────────
  let teamId: string, league: string;
  try {
    const body = await req.json() as { teamId?: unknown; league?: unknown };
    if (typeof body.teamId !== 'string' || typeof body.league !== 'string') {
      return NextResponse.json({ error: 'teamId and league required' }, { status: 400 });
    }
    teamId = body.teamId;
    league = body.league;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';

  // ── Fire and forget ─────────────────────────────────────────────────────────
  void generatePreviews(teamId, league, base, cronSecret);

  return NextResponse.json({ ok: true, status: 'warming' }, { status: 202 });
}
