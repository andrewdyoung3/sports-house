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
import { validateReviewOutput } from '@/lib/review-validators';
import { fetchReviewFormAndH2H, fetchSoccerGoalTimeline, fetchNRLMatchTimeline } from '@/lib/preview-fetchers';
import { buildContributions, buildCricketChart } from '@/lib/review-contributions';
import { cricMatchScorecard } from '@/lib/cricketdata';
import { fetchAflMatchStats } from '@/lib/afl-roster';

/** Thrown (not returned) so unstable_cache never stores a failed-validation review. */
class ReviewValidationError extends Error {
  constructor(violations: string[]) {
    super(`review validation: ${violations.join(' | ')}`);
    this.name = 'ReviewValidationError';
  }
}
import { getSupabaseServer } from '@/lib/supabase/server';
import { enforceRateLimit, secretsMatch } from '@/lib/request-guards';

// SEC-1: require a *non-anonymous* session for this expensive LLM route. Off by
// default so the app can stay publicly usable (anonymous sessions allowed); flip
// REQUIRE_AUTH_FOR_AI_REVIEW=true to lock it to signed-in users. Product decision.
const REQUIRE_AUTH = process.env.REQUIRE_AUTH_FOR_AI_REVIEW === 'true';

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

    // Inner: one model call → cleaned + parsed AIReview. Throws SyntaxError on total failure.
    // Feedback retry: blind retries reproduce failures, so the retry names them.
    const generate = async (feedback?: string[]): Promise<AIReview> => {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user',   content: dataBlock },
      ];
      if (feedback?.length) {
        messages.push({
          role: 'user',
          content:
            'Your previous attempt was REJECTED by automated fact/style checks:\n' +
            feedback.map(f => `- ${f}`).join('\n') +
            '\nRegenerate the complete JSON response. Fix each rejection precisely while keeping every claim consistent with the data block. Do not repeat the rejected phrasing.',
        });
      }
      const msg = await ollama.chat.completions.create({
        model:      REVIEW_MODEL,
        max_tokens: 3000,
        messages,
      });
      const text = msg.choices[0]?.message?.content ?? '';
      const withoutThink = text.includes('</think>') ? text.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : text;
      const cleaned = withoutThink.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      try {
        return JSON.parse(cleaned) as AIReview;
      } catch {
        aiLog(`parse-fail cacheKey=${cacheKey} raw_len=${text.length} first300=${JSON.stringify(cleaned.slice(0, 300))}`);
        const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
        if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1)) as AIReview;
        throw new SyntaxError(`Non-JSON review output: ${cleaned.slice(0, 120)}`);
      }
    };

    try {
      let parsed: AIReview;
      try {
        parsed = await generate();
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        // Total parse failure — retry the model call once.
        aiLog(`total-parse-fail cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms — retrying model call`);
        parsed = await generate(); // throws → caught below → returns null → 500
      }

      if (!parsed.summary || !Array.isArray(parsed.keyMoments) || !parsed.verdict) return null;

      // Validation pass (ported from the preview pipeline): violations → one
      // retry → still violating → REFUSE via throw, so the cache stores nothing.
      let violations = validateReviewOutput(parsed, dataBlock);
      if (violations.length > 0) {
        aiLog(`validation-fail cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — retrying with feedback`);
        const retry = await generate(violations);
        if (retry.summary && Array.isArray(retry.keyMoments) && retry.verdict) {
          const retryViolations = validateReviewOutput(retry, dataBlock);
          if (retryViolations.length === 0) {
            aiLog(`done  cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms (clean on retry)`);
            return retry;
          }
          violations = retryViolations;
        }
        aiLog(`refuse cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — both attempts violate, will not serve`);
        throw new ReviewValidationError(violations);
      }

      aiLog(`done  cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms`);
      return parsed;
    } catch (err) {
      if (err instanceof ReviewValidationError) throw err; // must NOT be cached as null
      aiLog(`error cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms err=${err}`);
      console.error('[/api/ai-review] generation error', err);
      return null;
    }
  },
  // v6: date-window-first finals classification (2026-09-13) — invalidates
  // reviews built while NRL finals were misclassified as regular season
  // (played counts games, totalRounds counts rounds; byes broke the >=).
  // v7: editorial register regime (2026-09-16) — crutch ban, overlap guard,
  // register mechanics; invalidates pre-regime reviews.
  ['ai-review-v8'],
  { revalidate: false },
);

// ─── Input validation ─────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'cricket_int', 'bbl']);
const SAFE_STR = /^[\w\s'.&\-,()]+$/;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth gate — cron poller bypasses Supabase auth via a timing-safe shared-secret
  // check (SEC-3); all other callers require a valid session.
  const isCron = secretsMatch(req.headers.get('x-cron-secret'), process.env.CRON_SECRET);
  if (!isCron) {
    // SEC-2: rate-limit the expensive LLM route for non-cron callers.
    const limited = enforceRateLimit(req, 'ai-review', 30);
    if (limited) return limited;

    const sb = getSupabaseServer();
    // SEC-1: fail CLOSED when Supabase is unconfigured — never implicitly open the
    // LLM endpoint. (Previously a missing client silently fell through to a 401.)
    if (!sb) {
      return NextResponse.json({ error: 'Auth unavailable' }, { status: 503 });
    }
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (REQUIRE_AUTH && user.is_anonymous) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 });
    }
  }

  try {
    const body = await req.json();

    const {
      league, teamName, opponent, teamScore, opponentScore,
      isHome, date, competition, gameId, teamId, opponentId,
      cricketFormat, cricketResult, cricketInnings,
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

    // Fetch standings + match-stats + pre-match form/H2H in parallel to enrich
    // the review data block (form/H2H from the same sources the preview mines).
    const isCricket  = league === 'cricket_int' || league === 'bbl';
    const soccerSlug = typeof gameId === 'string' ? gameId.match(/^soccer-([\w.]+)-\d+$/)?.[1] : undefined;
    const soccerEventId = league === 'epl' && typeof gameId === 'string' ? gameId.split('-').pop() : undefined;
    const cricketUuid = isCricket && typeof gameId === 'string' && !/^\d+$/.test(gameId.replace(/^(cint|bbl)-/, ''))
      ? gameId.replace(/^(cint|bbl)-/, '') : undefined;
    const [standings, matchStats, formExtras, goalTimeline, cricScorecard, nrlTimeline] = await Promise.all([
      isCricket ? Promise.resolve([]) : fetchStandings(league),
      // AFL: CFS playerStats (ESPN has no AFL player stats); others: ESPN match-stats.
      league === 'afl'
        ? fetchAflMatchStats(teamName, opponent, String(date))
        : (!isCricket && teamId) ? fetchMatchStats(league, teamId, String(date), tScore, oScore, competition ? String(competition) : undefined) : Promise.resolve(null),
      fetchReviewFormAndH2H(league, gameId ? String(gameId) : undefined, teamName, opponent, String(date)),
      soccerEventId ? fetchSoccerGoalTimeline(soccerSlug ?? 'eng.1', soccerEventId) : Promise.resolve(undefined),
      cricketUuid ? cricMatchScorecard(cricketUuid) : Promise.resolve(null),
      league === 'nrl' ? fetchNRLMatchTimeline(teamName, opponent) : Promise.resolve(undefined),
    ]);
    const cricketChart = isCricket ? buildCricketChart(cricScorecard) : undefined;

    // Cricket without a real result/innings would generate from placeholder
    // 0-0 scores — a hallucination factory (observed: an invented "0-0 draw").
    // Refuse instead; the panel's plain fallback line covers the gap.
    if (isCricket && !cricketResult && (!cricketInnings || cricketInnings.length === 0)) {
      return NextResponse.json({ error: 'Cricket review requires result/innings data' }, { status: 422 });
    }

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
      teamRecentForm:     formExtras.teamRecentForm,
      opponentRecentForm: formExtras.opponentRecentForm,
      headToHead:         formExtras.headToHead,
      scoringTimeline:    goalTimeline ?? nrlTimeline?.scoringTimeline,
      cricketFormat, cricketResult, cricketInnings,
      cricketChart:       cricketChart?.length ? cricketChart : undefined,
    };

    const dataBlock = buildReviewDataBlock(input);
    // Use gameId as cache discriminator if provided, otherwise derive from match data
    const cacheKey  = gameId ?? `${league}-${teamName}-${opponent}-${date.slice(0, 10)}`;

    const review = await generateReview(cacheKey, dataBlock);
    if (!review) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    // Standard key-contribution strip — deterministic, derived server-side.
    const contributions = buildContributions(league, matchStats, goalTimeline, cricketChart);
    if (nrlTimeline?.topPerformerLines) contributions.push(...nrlTimeline.topPerformerLines);
    return NextResponse.json(contributions.length > 0 ? { ...review, contributions } : review);
  } catch (err) {
    if (err instanceof ReviewValidationError) {
      // Both attempts contradicted the derived facts — never serve or cache it.
      return NextResponse.json({ error: 'Generation failed validation' }, { status: 500 });
    }
    console.error('[/api/ai-review]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
