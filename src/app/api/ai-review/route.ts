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
import Anthropic from '@anthropic-ai/sdk';
import { unstable_cache } from 'next/cache';
import type { AIReview } from '@/types';
import { AI_MODEL } from '@/lib/ai-model';
import { getSupabaseServer } from '@/lib/supabase/server';

const anthropic = new Anthropic();

// ─── Sport-specific context ───────────────────────────────────────────────────

const SPORT_CONTEXT: Record<string, string> = {
  afl:         'Australian Rules Football (AFL). Use AFL-specific terminology where relevant: contested possessions, clearances, inside 50s, centre bounces, the forward 50. The table is called "the Ladder".',
  nrl:         'NRL Rugby League (13-man code). Use NRL-specific terminology where relevant: completion rate, ruck speed, middle forwards, edges, kick chase. The table is called "the Ladder".',
  epl:         'English Premier League (association football). Use "pitch", "half" (not period). The table is called "the Table".',
  super_rugby: 'Super Rugby Pacific (15-man rugby union). The table is called "the Table".',
  rugby_int:   'International Rugby Union Test match. Tone should reflect the magnitude of Test rugby.',
};

const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sports analyst writing a brief post-match review. Direct, analytical tone — not narrative or journalistic.

RULES:
• Past tense throughout
• Explain the tactical and structural reasons for the result — not just "they scored more"
• No filler: avoid "credit to both sides", "gave it their all", "never-say-die spirit", etc.
• Only name specific players if their name appears in the provided data
• Verdict must be forward-looking: what does this result mean for the team's season?
• Plain language — say what you mean directly
• No W/L count recitation — the user can see the results themselves
• Do not state uncertainty explicitly ("it's early", "small sample") — just let calibration inform tone
• No hollow superlatives, no vague momentum phrases ("building momentum", "hitting their stride")

KEY MOMENTS should be:
• Specific and grounded — reference the scoreline, positional battle, or pattern that mattered
• Max 12 words each
• Not restatements of the final score

SUMMARY should explain the "why" of the result — tactical/structural factors, not just what the score was. Vary your opening: don't always lead with the winning team and don't reuse the same sentence structure across reviews. Enter from different angles — the decisive tactical factor, the opposition's failure, the key phase of play, the margin of control. Avoid generic openers like "[Team] controlled this match structurally" or "[Team] were dominant throughout".

VERDICT should name one forward-looking implication: a trend, a concern, or an opportunity revealed by this result.

OUTPUT: Return valid JSON only, no markdown fences:
{
  "summary": "2–3 sentences",
  "keyMoments": ["factor 1", "factor 2", "factor 3"],
  "verdict": "1–2 sentences"
}`;

// ─── Data block builder ───────────────────────────────────────────────────────

interface ReviewInput {
  league:        string;
  teamName:      string;
  opponent:      string;
  teamScore:     number;
  opponentScore: number;
  isHome:        boolean;
  date:          string;
  competition?:  string;
  teamPosition?:     number;
  teamPlayed?:       number;
  opponentPosition?: number;
  opponentPlayed?:   number;
}

function buildDataBlock(input: ReviewInput): string {
  const {
    league, teamName, opponent, teamScore, opponentScore,
    isHome, date, competition,
    teamPosition, teamPlayed, opponentPosition, opponentPlayed,
  } = input;

  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  const homeAway    = isHome ? 'Home' : 'Away';
  const result      = teamScore > opponentScore ? 'WIN' : teamScore < opponentScore ? 'LOSS' : 'DRAW';
  const comp        = competition ?? 'Regular season';
  const dateStr     = new Date(date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  let block = `SPORT CONTEXT\n${sportCtx}\n\nMATCH DATA\nLeague: ${leagueLabel}\nCompetition: ${comp}\nDate: ${dateStr}\n${homeAway}: ${teamName} vs ${opponent}\nScore: ${teamName} ${teamScore} – ${opponentScore} ${opponent}\nResult: ${result}\n`;

  if (teamPosition !== undefined || opponentPosition !== undefined) {
    block += '\nCURRENT STANDINGS\n';
    if (teamPosition !== undefined) {
      block += `${teamName}: ${teamPosition}${teamPlayed !== undefined ? ` (${teamPlayed} played)` : ''}\n`;
    }
    if (opponentPosition !== undefined) {
      block += `${opponent}: ${opponentPosition}${opponentPlayed !== undefined ? ` (${opponentPlayed} played)` : ''}\n`;
    }
  }

  return block;
}

// ─── Cached generator ─────────────────────────────────────────────────────────

const generateReview = unstable_cache(
  async (cacheKey: string, dataBlock: string): Promise<AIReview | null> => {
    try {
      const msg = await anthropic.messages.create({
        model:      AI_MODEL,
        max_tokens: 400,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: dataBlock }],
      });

      const text = msg.content.find(b => b.type === 'text')?.text ?? '';
      // Strip markdown fences if present
      const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed  = JSON.parse(cleaned) as AIReview;

      if (!parsed.summary || !Array.isArray(parsed.keyMoments) || !parsed.verdict) return null;
      return parsed;
    } catch (err) {
      console.error('[/api/ai-review] generation error', err);
      return null;
    }
  },
  // Cache key array — results are immutable so we cache by game key forever
  ['ai-review-v2'],
  { revalidate: false },
);

// ─── Input validation ─────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);
const SAFE_STR = /^[\w\s'.&\-,()]+$/;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth gate (FIRST — before body read, cache lookup, or any Claude call): require ANY
  // valid Supabase session (anonymous included). getUser() revalidates the JWT against
  // Supabase Auth. Fail closed — null client / no user / error → 401, so a session-less
  // caller can never trigger paid work.
  const sb = getSupabaseServer();
  const { data: { user } } = (await sb?.auth.getUser()) ?? { data: { user: null } };
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const {
      league, teamName, opponent, teamScore, opponentScore,
      isHome, date, competition, gameId,
      teamPosition, teamPlayed, opponentPosition, opponentPlayed,
    } = body as ReviewInput & { gameId?: string };

    // Basic validation
    if (!ALLOWED_LEAGUES.has(league)) {
      return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
    }
    if (!teamName || !SAFE_STR.test(teamName) || !opponent || !SAFE_STR.test(opponent)) {
      return NextResponse.json({ error: 'Invalid team names' }, { status: 400 });
    }

    const input: ReviewInput = {
      league, teamName, opponent,
      teamScore:     Number(teamScore),
      opponentScore: Number(opponentScore),
      isHome:        Boolean(isHome),
      date:          String(date),
      competition:   competition ? String(competition) : undefined,
      teamPosition:     teamPosition     !== undefined ? Number(teamPosition)     : undefined,
      teamPlayed:       teamPlayed       !== undefined ? Number(teamPlayed)       : undefined,
      opponentPosition: opponentPosition !== undefined ? Number(opponentPosition) : undefined,
      opponentPlayed:   opponentPlayed   !== undefined ? Number(opponentPlayed)   : undefined,
    };

    const dataBlock = buildDataBlock(input);
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
