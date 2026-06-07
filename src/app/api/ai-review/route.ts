/**
 * POST /api/ai-review
 *
 * Generates a structured post-match review using Claude (claude-sonnet-4-6).
 * Analytical, retrospective tone — explains WHY the result happened and what
 * it means for the team going forward.
 *
 * Results are immutable, so responses are cached indefinitely per game key.
 *
 * Requires ANTHROPIC_API_KEY in environment variables.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { unstable_cache } from 'next/cache';
import { appendFileSync } from 'fs';
import type { AIReview, MatchStats, LeagueTableRow } from '@/types';
import { REVIEW_SYSTEM_PROMPT, ReviewInput, buildReviewDataBlock } from '@/lib/review-prompt';
import { getSupabaseServer } from '@/lib/supabase/server';

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';

// Fetch current standings to enrich the review with table context.
async function fetchStandings(league: string): Promise<LeagueTableRow[]> {
  try {
    const res = await fetch(`${BASE}/api/standings?league=${league}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as LeagueTableRow[] : [];
  } catch { return []; }
}

// Fetch match stats from the ESPN-backed endpoint (EPL, NRL, SRU).
// Returns null for AFL (no ESPN player stats) or on error.
async function fetchMatchStats(
  league: string,
  teamId: string,
  date: string,
  teamScore: number,
  opponentScore: number,
  competition?: string,
): Promise<MatchStats | null> {
  if (league === 'afl') return null; // AFL has no usable ESPN player stats
  try {
    const params = new URLSearchParams({
      league, teamId, date,
      teamScore:     String(teamScore),
      opponentScore: String(opponentScore),
      ...(competition ? { competition } : {}),
    });
    const res = await fetch(`${BASE}/api/match-stats?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json() as MatchStats;
  } catch { return null; }
}

// Pinned to instruct-2507 — reviews are speed-critical (5-10 min post-match target).
// ai-preview uses AI_MODEL (configurable) for quality testing; reviews stay on the
// fast non-thinking model regardless of what ai-preview is pointed at.
const REVIEW_MODEL = 'qwen3:30b-a3b-instruct-2507-q4_K_M';

const ollama = new OpenAI({
  baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
  apiKey:  'ollama',
  timeout: 15 * 60 * 1000, // 15 minutes
});

function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-review] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// Prompt assembly and data-block builder live in @/lib/review-prompt (shared with eval harness)

// ─── Cached generator ─────────────────────────────────────────────────────────

const generateReview = unstable_cache(
  async (cacheKey: string, dataBlock: string): Promise<AIReview | null> => {
    const t0 = Date.now();
    aiLog(`start cacheKey=${cacheKey} model=${REVIEW_MODEL}`);
    try {
      const msg = await ollama.chat.completions.create({
        model:      REVIEW_MODEL,
        max_tokens: 3000,
        messages:   [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user',   content: dataBlock },
        ],
      });

      const text = msg.choices[0]?.message?.content ?? '';
      const withoutThink = text.includes('</think>') ? text.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : text;
      const cleaned = withoutThink.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      let parsed: AIReview;
      try {
        parsed = JSON.parse(cleaned) as AIReview;
      } catch {
        aiLog(`parse-fail cacheKey=${cacheKey} raw_len=${text.length} first300=${JSON.stringify(cleaned.slice(0, 300))}`);
        const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
        if (s >= 0 && e > s) { parsed = JSON.parse(cleaned.slice(s, e + 1)) as AIReview; }
        else throw new SyntaxError(`Non-JSON review output: ${cleaned.slice(0, 120)}`);
      }

      if (!parsed.summary || !Array.isArray(parsed.keyMoments) || !parsed.verdict) return null;
      aiLog(`done  cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms`);
      return parsed;
    } catch (err) {
      aiLog(`error cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms err=${err}`);
      console.error('[/api/ai-review] generation error', err);
      return null;
    }
  },
  ['ai-review-v4'],
  { revalidate: false },
);

// ─── Input validation ─────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);
const SAFE_STR = /^[\w\s'.&\-,()]+$/;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth gate — cron poller bypasses Supabase auth via shared secret; all other
  // callers require a valid session (anonymous included).
  const cronSecret = req.headers.get('x-cron-secret');
  const isCron     = cronSecret && cronSecret === process.env.CRON_SECRET;
  if (!isCron) {
    const sb = getSupabaseServer();
    const { data: { user } } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
  }

  try {
    const body = await req.json();

    const {
      league, teamName, opponent, teamScore, opponentScore,
      isHome, date, competition, gameId, teamId, opponentId,
    } = body as ReviewInput & { gameId?: string };

    // Basic validation
    if (!ALLOWED_LEAGUES.has(league)) {
      return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
    }
    if (!teamName || !SAFE_STR.test(teamName) || !opponent || !SAFE_STR.test(opponent)) {
      return NextResponse.json({ error: 'Invalid team names' }, { status: 400 });
    }

    const tScore = Number(teamScore);
    const oScore = Number(opponentScore);

    // Fetch standings + match-stats in parallel to enrich the review data block
    const [standings, matchStats] = await Promise.all([
      fetchStandings(league),
      teamId ? fetchMatchStats(league, teamId, String(date), tScore, oScore, competition ? String(competition) : undefined) : Promise.resolve(null),
    ]);

    // Resolve team standings from the table
    let teamPosition: number | undefined, teamPlayed: number | undefined, teamPoints: number | undefined, teamPercentage: number | undefined;
    let opponentPosition: number | undefined, opponentPlayed: number | undefined, opponentPoints: number | undefined, opponentPercentage: number | undefined;

    if (standings.length > 0) {
      const tRow = standings.find(r =>
        r.name?.toLowerCase().includes(teamName.toLowerCase().split(' ')[0]) ||
        teamName.toLowerCase().includes((r.name ?? '').toLowerCase().split(' ')[0]),
      );
      const oRow = standings.find(r =>
        r.name?.toLowerCase().includes(opponent.toLowerCase().split(' ')[0]) ||
        opponent.toLowerCase().includes((r.name ?? '').toLowerCase().split(' ')[0]),
      );
      // AFL: standings route omits 'points' — compute from wins/draws (4/win, 2/draw)
      const computePts = (r: LeagueTableRow) =>
        r.points > 0 ? r.points : r.wins * 4 + r.draws * 2;
      if (tRow) { teamPosition = tRow.position; teamPlayed = tRow.played; teamPoints = computePts(tRow); teamPercentage = tRow.percentage; }
      if (oRow) { opponentPosition = oRow.position; opponentPlayed = oRow.played; opponentPoints = computePts(oRow); opponentPercentage = oRow.percentage; }
    }

    const input: ReviewInput = {
      league, teamName, opponent,
      teamScore:     tScore,
      opponentScore: oScore,
      isHome:        Boolean(isHome),
      date:          String(date),
      competition:   competition ? String(competition) : undefined,
      teamId:        teamId ? String(teamId) : undefined,
      opponentId:    opponentId ? String(opponentId) : undefined,
      teamPosition, teamPlayed, teamPoints, teamPercentage,
      opponentPosition, opponentPlayed, opponentPoints, opponentPercentage,
      leagueTable: standings.length > 0 ? standings : undefined,
      matchStats:  matchStats ?? undefined,
    };

    const dataBlock = buildReviewDataBlock(input);
    // Use gameId as cache discriminator if provided, otherwise derive from match data
    const cacheKey  = gameId ?? `${league}-${teamName}-${opponent}-${date.slice(0, 10)}`;

    const review = await generateReview(cacheKey, dataBlock);
    if (!review) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    return NextResponse.json(review);
  } catch (err) {
    console.error('[/api/ai-review]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
