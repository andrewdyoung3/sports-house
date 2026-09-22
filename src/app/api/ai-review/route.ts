/**
 * POST /api/ai-review
 *
 * Serves a structured post-match review for one result, from that team's
 * perspective. Analytical, retrospective tone — explains WHY the result
 * happened and what it means for the team going forward.
 *
 * Read-through store, the results-side twin of /api/ai-preview:
 *   1. Supabase game_reviews (public-readable) — hit → served, no auth needed.
 *   2. Miss, and this deployment cannot generate (no Ollama: Vercel) →
 *      { preparing: true } so the panel shows a placeholder, never a 500.
 *   3. Miss, and it can (the local box, or the poller's cron call) → session
 *      gate, generate via Ollama, validate, upsert to Supabase, serve.
 *
 * The store key is the result's PERSPECTIVE id (makeResultId) — the id the
 * results page renders — while `sourceId` (ESPN/Squiggle event key) drives the
 * enrichment fetches. Results are immutable, so a stored review is final; the
 * REVIEW_REGIME suffix below is how a prompt-regime change invalidates them.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { appendFileSync } from 'fs';
import type { AIReview, MatchStats, LeagueTableRow } from '@/types';
import { REVIEW_SYSTEM_PROMPT, ReviewInput, buildReviewDataBlock } from '@/lib/review-prompt';
import { validateReviewOutput } from '@/lib/review-validators';
import { fetchReviewFormAndH2H, fetchSoccerGoalTimeline, fetchNRLMatchTimeline } from '@/lib/preview-fetchers';
import { buildContributions, buildCricketChart } from '@/lib/review-contributions';
import { cricMatchScorecard } from '@/lib/cricketdata';
import { fetchAflMatchStats } from '@/lib/afl-roster';
import { SQUIGGLE_NAME } from '@/lib/afl';
import { readReview, upsertReview, reviewStoreKey } from '@/lib/review-store';

/** Thrown (not returned) so a failed-validation review is never stored or served. */
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
// gemma3:27b won the 2026-09-16 four-way local A/B (see framework doc): clean
// validator passes, reads lineups like an analyst. ~60-90s/gen — acceptable
// because poll-reviews prewarms recent games; single model across previews +
// reviews avoids 17GB↔18GB model-swap thrash on the 32GB box.
const REVIEW_MODEL = 'gemma3:27b';

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

// ─── Generator ────────────────────────────────────────────────────────────────

// Can this deployment run the model? The local box always can. Vercel only
// if OLLAMA_HOST names a reachable (non-loopback) host — a copied-over
// localhost value would otherwise turn every miss into a connection-refused 500
// instead of the { preparing } placeholder.
const GENERATION_AVAILABLE = !process.env.VERCEL
  || (!!process.env.OLLAMA_HOST && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.OLLAMA_HOST));

// One generation per key at a time: the panel and the poller can ask for the
// same result within seconds of each other, and a second model run for the
// same match is a minute wasted. Validation failures propagate to every waiter.
const inflight = new Map<string, Promise<AIReview | null>>();
function generateReview(cacheKey: string, dataBlock: string): Promise<AIReview | null> {
  const running = inflight.get(cacheKey);
  if (running) return running;
  const p = generateReviewUncached(cacheKey, dataBlock).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

async function generateReviewUncached(cacheKey: string, dataBlock: string): Promise<AIReview | null> {
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
}

// ─── Input validation ─────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'cricket_int', 'bbl']);
const SAFE_STR = /^[\w\s'.&\-,()]+$/;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth gate — cron poller bypasses Supabase auth via a timing-safe shared-secret
  // check (SEC-3); all other callers require a valid session.
  const isCron = secretsMatch(req.headers.get('x-cron-secret'), process.env.CRON_SECRET);
  if (!isCron) {
    // SEC-2: abuse ceiling for non-cron callers — applies to the store read as
    // well as generation, so the limiter is ahead of the body parse.
    const limited = enforceRateLimit(req, 'ai-review', 30);
    if (limited) return limited;
  }

  try {
    const body = await req.json();

    const {
      league, teamName, opponent, teamScore, opponentScore,
      isHome, date, competition, gameId, sourceId, teamId, opponentId,
      cricketFormat, cricketResult, cricketInnings,
    } = body as ReviewInput & { gameId?: string; sourceId?: string };

    // Basic validation
    if (!ALLOWED_LEAGUES.has(league)) {
      return NextResponse.json({ error: 'Invalid league' }, { status: 400 });
    }
    if (!teamName || !SAFE_STR.test(teamName) || !opponent || !SAFE_STR.test(opponent)) {
      return NextResponse.json({ error: 'Invalid team names' }, { status: 400 });
    }
    if (gameId !== undefined && (typeof gameId !== 'string' || gameId.length > 80 || /[\n\r\0]/.test(gameId))) {
      return NextResponse.json({ error: 'Invalid gameId' }, { status: 400 });
    }

    // Perspective id = store key; falls back to the match facts when the caller
    // has no id (the eval harness). sourceId = event key for the enrichers;
    // older callers put the event key in gameId, so it still works as one.
    const reviewKey = gameId ?? `${league}-${teamName}-${opponent}-${String(date).slice(0, 10)}`;
    const eventKey  = typeof sourceId === 'string' && sourceId ? sourceId : gameId;

    // ── 1. Store read — public, like previews ────────────────────────────────
    const stored = await readReview(reviewStoreKey(reviewKey));
    if (stored) {
      aiLog(`store-hit gameId=${reviewKey}`);
      return NextResponse.json({ ...stored.payload, _serverUpdatedAt: stored.updatedAt });
    }

    // ── 2. Cannot generate here → placeholder, not an error ──────────────────
    if (!GENERATION_AVAILABLE) {
      aiLog(`store-miss gameId=${reviewKey} — no generator on this deployment`);
      return NextResponse.json({ preparing: true });
    }

    // ── 3. Generation: session-gated for non-cron callers ────────────────────
    if (!isCron) {
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

    const tScore = Number(teamScore);
    const oScore = Number(opponentScore);

    // Fetch standings + match-stats + pre-match form/H2H in parallel to enrich
    // the review data block (form/H2H from the same sources the preview mines).
    const isCricket  = league === 'cricket_int' || league === 'bbl';
    const soccerSlug = typeof eventKey === 'string' ? eventKey.match(/^soccer-([\w.]+)-\d+$/)?.[1] : undefined;
    const soccerEventTail = league === 'epl' && typeof eventKey === 'string' ? eventKey.split('-').pop() : undefined;
    const soccerEventId = soccerEventTail && /^\d+$/.test(soccerEventTail) ? soccerEventTail : undefined;
    const cricketUuid = isCricket && typeof eventKey === 'string' && !/^\d+$/.test(eventKey.replace(/^(cint|bbl)-/, ''))
      ? eventKey.replace(/^(cint|bbl)-/, '') : undefined;
    // Squiggle's form/H2H arrays are matched by exact name, and ours differ
    // ("Hawthorn Hawks" vs Squiggle's "Hawthorn"; "GWS Giants" vs "Greater
    // Western Sydney"), so AFL form was silently empty for every caller that
    // sent the app's team name. The opponent already arrives as Squiggle's name.
    const sourceTeamName = league === 'afl' && teamId ? (SQUIGGLE_NAME[String(teamId)] ?? teamName) : teamName;
    const [standings, matchStats, formExtras, goalTimeline, cricScorecard, nrlTimeline] = await Promise.all([
      isCricket ? Promise.resolve([]) : fetchStandings(league),
      // AFL: CFS playerStats (ESPN has no AFL player stats); others: ESPN match-stats.
      league === 'afl'
        ? fetchAflMatchStats(teamName, opponent, String(date))
        : (!isCricket && teamId) ? fetchMatchStats(league, teamId, String(date), tScore, oScore, competition ? String(competition) : undefined) : Promise.resolve(null),
      fetchReviewFormAndH2H(league, eventKey ? String(eventKey) : undefined, sourceTeamName, opponent, String(date)),
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

    const review = await generateReview(reviewKey, dataBlock);
    if (!review) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    // Standard key-contribution strip — deterministic, derived server-side.
    // Stored WITH the review so the deployed site, which cannot run these
    // fetchers' upstream at generation time, serves the same strip.
    const contributions = buildContributions(league, matchStats, goalTimeline, cricketChart);
    if (nrlTimeline?.topPerformerLines) contributions.push(...nrlTimeline.topPerformerLines);
    const payload: AIReview = contributions.length > 0 ? { ...review, contributions } : review;

    await upsertReview(reviewStoreKey(reviewKey), payload, REVIEW_MODEL, aiLog);
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ReviewValidationError) {
      // Both attempts contradicted the derived facts — never serve or cache it.
      return NextResponse.json({ error: 'Generation failed validation' }, { status: 500 });
    }
    console.error('[/api/ai-review]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
