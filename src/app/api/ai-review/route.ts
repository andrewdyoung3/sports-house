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
import { REVIEW_SYSTEM_PROMPT, ReviewInput, buildReviewDataBlock, LEAGUE_LABELS } from '@/lib/review-prompt';
import { validateReviewOutput, normalizeVerdicts } from '@/lib/review-validators';
import { makeResultId } from '@/lib/result-match-key';
import { fetchReviewFormAndH2H, fetchNRLMatchTimeline } from '@/lib/preview-fetchers';
import { fetchESPNMatchReport, fetchESPNSeasonResults, deriveSeasonFacts, SOCCER_CUP_SLUGS } from '@/lib/match-report';
import { buildContributions, buildCricketChart, buildKeyFactors } from '@/lib/review-contributions';
import { cricMatchScorecard, cricMatchInfo } from '@/lib/cricketdata';
import { TEAMS } from '@/lib/teams';
import { fetchAflMatchStats, fetchAflQuarterScores } from '@/lib/afl-roster';
import { SQUIGGLE_NAME } from '@/lib/afl';
import { readReview, upsertReview, reviewStoreKey } from '@/lib/review-store';

/** Violations that concern phrasing, not facts — never worth a refusal on their own. */
const isStyleViolation = (v: string): boolean =>
  /^(?:register crutch|tautology|summary and a verdict substantially repeat)/.test(v);

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
  eventId?: string,
): Promise<MatchStats | null> {
  if (league === 'afl') return null; // AFL has no usable ESPN player stats
  try {
    const params = new URLSearchParams({
      league, teamId, date,
      teamScore:     String(teamScore),
      opponentScore: String(opponentScore),
      ...(competition ? { competition } : {}),
      ...(eventId ? { eventId } : {}),
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

// Refusal backoff: a match the validators keep refusing would otherwise be
// retried by the poller every minute at ~2–3 min of model time per attempt
// (Dolphins v Roosters refused three ticks running, 2026-09-25). After
// REFUSAL_LIMIT refusals the key rests for REFUSAL_REST_MS; process-local,
// which is where the generator lives.
const REFUSAL_LIMIT   = 3;
/** Feedback retries per generation before a refusal. */
const FEEDBACK_ROUNDS = 2;
const REFUSAL_REST_MS = 6 * 60 * 60 * 1000;
const refusals = new Map<string, { count: number; restUntil: number }>();
class ReviewRestingError extends Error {
  constructor(public readonly until: number) { super('review resting after repeated refusals'); this.name = 'ReviewRestingError'; }
}

// One model call at a time in this process, whoever asks (poller ticks, the
// panel, a manual call). Three concurrent gemma3:27b runs on one GPU each blew
// the 15-minute client timeout (2026-09-26); serialised they take 2–4 min.
let generationQueue: Promise<unknown> = Promise.resolve();
function serialised<T>(job: () => Promise<T>): Promise<T> {
  const run = generationQueue.then(job, job);
  generationQueue = run.catch(() => undefined);
  return run;
}

function generateReview(cacheKey: string, dataBlock: string): Promise<AIReview | null> {
  const running = inflight.get(cacheKey);
  if (running) return running;
  const r = refusals.get(cacheKey);
  if (r && r.restUntil > Date.now()) return Promise.reject(new ReviewRestingError(r.restUntil));
  const p = serialised(() => generateReviewUncached(cacheKey, dataBlock))
    .then(out => { refusals.delete(cacheKey); return out; })
    .catch(err => {
      if (err instanceof ReviewValidationError) {
        const cur = refusals.get(cacheKey) ?? { count: 0, restUntil: 0 };
        cur.count++;
        if (cur.count >= REFUSAL_LIMIT) { cur.restUntil = Date.now() + REFUSAL_REST_MS; aiLog(`resting cacheKey=${cacheKey} after ${cur.count} refusals until ${new Date(cur.restUntil).toISOString()}`); }
        refusals.set(cacheKey, cur);
      }
      throw err;
    })
    .finally(() => inflight.delete(cacheKey));
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

    const wellFormed = (r: AIReview) => !!r.summary && Array.isArray(r.keyMoments) && (!!r.verdicts || !!r.verdict);
    if (!wellFormed(parsed)) return null;

    // Validation pass (ported from the preview pipeline): violations → up to
    // FEEDBACK_ROUNDS retries, each naming the violations → still violating →
    // REFUSE via throw, so the cache stores nothing. Two rounds since
    // 2026-09-26: the first retry reliably fixes what it is told and just as
    // reliably introduces one new miscount; the second lands it.
    let violations = validateReviewOutput(parsed, dataBlock);
    // Best candidate across rounds = fewest FACTUAL violations. Style-only
    // residue (a register crutch, a tautology, summary/verdict overlap) is
    // accepted and logged at the end: every factual binder passed, and
    // refusing a true review over a phrase was costing the poller three
    // minutes a tick (AFL finals, 2026-09-26). A candidate is judged on its
    // own violations even when a later retry comes back malformed.
    const factual = (vs: string[]) => vs.filter(v => !isStyleViolation(v));
    let best: { review: AIReview; violations: string[] } = { review: parsed, violations };
    for (let round = 1; factual(best.violations).length > 0 && round <= FEEDBACK_ROUNDS; round++) {
      aiLog(`validation-fail cacheKey=${cacheKey} round=${round} elapsed=${Date.now() - t0}ms violations=${JSON.stringify(best.violations)} — retrying with feedback`);
      const retry = await generate(best.violations);
      if (!wellFormed(retry)) { aiLog(`malformed retry cacheKey=${cacheKey} round=${round}`); continue; }
      const retryViolations = validateReviewOutput(retry, dataBlock);
      if (retryViolations.length === 0) {
        aiLog(`done  cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms (clean on retry ${round})`);
        return retry;
      }
      if (factual(retryViolations).length <= factual(best.violations).length) best = { review: retry, violations: retryViolations };
    }
    if (factual(best.violations).length > 0) {
      aiLog(`refuse cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms violations=${JSON.stringify(best.violations)} — all attempts violate, will not serve`);
      throw new ReviewValidationError(best.violations);
    }
    if (best.violations.length > 0) {
      aiLog(`done  cacheKey=${cacheKey} elapsed=${Date.now() - t0}ms (accepted with style notes: ${JSON.stringify(best.violations)})`);
      return best.review;
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

// ─── Mirror key (the opponent's perspective id) ───────────────────────────────

/** Our team id for a source's opponent label ("Roosters", "Hawthorn", "Brighton & Hove Albion"). */
function resolveTeamId(league: string, name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const pool = TEAMS.filter(t => t.league === league);
  return pool.find(t => t.name.toLowerCase() === n || t.shortName.toLowerCase() === n)?.id
      ?? pool.find(t => t.name.toLowerCase().includes(n) || n.includes(t.shortName.toLowerCase()))?.id;
}

/**
 * The id the results page renders for the SAME match from the opponent's
 * row — found from the opponent's own results feed by source event id, so
 * it is exactly what that row will request. One neutral generation is then
 * stored under both keys.
 */
async function resolveMirrorKey(league: string, opponentTeamId: string, eventKey: string, day: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${BASE}/api/results?league=${league}&teamId=${opponentTeamId}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const data = await res.json() as unknown;
    const list = (Array.isArray(data) ? data : (data as { results?: unknown[] })?.results ?? []) as Array<{ sourceId?: string; date: string; opponent: string }>;
    const hit = list.find(r => r.sourceId === eventKey) ?? list.find(r => String(r.date).slice(0, 10) === day);
    return hit ? makeResultId(opponentTeamId, hit) : undefined;
  } catch { return undefined; }
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
    const eventTail  = typeof eventKey === 'string' ? eventKey.split('-').pop() : undefined;
    // ESPN event id — every ESPN league's sourceId ends in it.
    const espnEventId = !isCricket && league !== 'afl' && eventTail && /^\d+$/.test(eventTail) ? eventTail : undefined;
    const cricketUuid = isCricket && typeof eventKey === 'string' && !/^\d+$/.test(eventKey.replace(/^(cint|bbl)-/, ''))
      ? eventKey.replace(/^(cint|bbl)-/, '') : undefined;
    // Squiggle's form/H2H arrays are matched by exact name, and ours differ
    // ("Hawthorn Hawks" vs Squiggle's "Hawthorn"; "GWS Giants" vs "Greater
    // Western Sydney"), so AFL form was silently empty for every caller that
    // sent the app's team name. The opponent already arrives as Squiggle's name.
    const sourceTeamName = league === 'afl' && teamId ? (SQUIGGLE_NAME[String(teamId)] ?? teamName) : teamName;

    // ESPN competition paths for the event. The summary only resolves under the
    // event's own competition, so international rugby tries its candidates.
    const leagueSportPath =
      league === 'epl'         ? `soccer/${soccerSlug ?? 'eng.1'}` :
      league === 'nrl'         ? 'rugby-league/3' :
      league === 'super_rugby' ? 'rugby/242041' :
      undefined;
    const sportPaths = league === 'rugby_int'
      ? ['rugby/289234', 'rugby/244293', 'rugby/180659', 'rugby/267979']
      : leagueSportPath ? [leagueSportPath] : [];
    const fetchReport = async () => {
      if (!espnEventId) return undefined;
      for (const sp of sportPaths) {
        const r = await fetchESPNMatchReport(sp, espnEventId, teamName, opponent);
        if (r) return { report: r, sportPath: sp };
      }
      return undefined;
    };

    const [standings, ms, formExtras, reportHit, cricScorecard, nrlTimeline, cricInfo, aflQuarters] = await Promise.all([
      isCricket ? Promise.resolve([]) : fetchStandings(league),
      // AFL: CFS playerStats (ESPN has no AFL player stats); others: ESPN match-stats.
      league === 'afl'
        ? fetchAflMatchStats(teamName, opponent, String(date))
        : (!isCricket && teamId) ? fetchMatchStats(league, teamId, String(date), tScore, oScore, competition ? String(competition) : undefined, espnEventId) : Promise.resolve(null),
      fetchReviewFormAndH2H(league, eventKey ? String(eventKey) : undefined, sourceTeamName, opponent, String(date)),
      fetchReport(),
      cricketUuid ? cricMatchScorecard(cricketUuid) : Promise.resolve(null),
      league === 'nrl' ? fetchNRLMatchTimeline(teamName, opponent) : Promise.resolve(undefined),
      cricketUuid ? cricMatchInfo(cricketUuid) : Promise.resolve(null),
      league === 'afl' ? fetchAflQuarterScores(teamName, opponent, String(date)) : Promise.resolve(null),
    ]);
    const report = reportHit?.report;
    const cricketChart = isCricket ? buildCricketChart(cricScorecard) : undefined;

    // Team-level stats: the report's (labelled for the factor builder) win over
    // the match-stats route's; player rows still come from match-stats / CFS.
    let matchStats: MatchStats | null = ms;
    const sourceTeamStats = report?.teamStats ?? nrlTimeline?.teamStats;
    // Per-player lines: the report's (ESPN rosters) or nrl.com's; else the
    // match-stats route's rows (rugby union), else none.
    const sourcePerformers = report?.performers ?? nrlTimeline?.performers;
    if (sourceTeamStats || sourcePerformers) {
      matchStats = {
        team:     { teamName,           aggStats: sourceTeamStats?.team     ?? ms?.team?.aggStats     ?? [], players: sourcePerformers?.team     ?? ms?.team?.players     ?? [] },
        opponent: { teamName: opponent, aggStats: sourceTeamStats?.opponent ?? ms?.opponent?.aggStats ?? [], players: sourcePerformers?.opponent ?? ms?.opponent?.players ?? [] },
      };
    }

    // Season results → computed facts. Soccer: league + cup schedules; rugby:
    // league schedule (ESPN returns none post-season, harmlessly); AFL: Squiggle.
    let teamSeason = formExtras.teamSeasonResults ?? [];
    let oppSeason  = formExtras.opponentSeasonResults ?? [];
    if (report && reportHit && league !== 'afl') {
      const primary = leagueSportPath ?? reportHit.sportPath;
      const extra   = league === 'epl' ? SOCCER_CUP_SLUGS.map(s => `soccer/${s}`).filter(p => p !== primary) : [];
      [teamSeason, oppSeason] = await Promise.all([
        report.teamEspnId ? fetchESPNSeasonResults(primary, extra, report.teamEspnId, String(date)) : Promise.resolve([]),
        report.oppEspnId  ? fetchESPNSeasonResults(primary, extra, report.oppEspnId,  String(date)) : Promise.resolve([]),
      ]);
    }
    // Completeness guard: ESPN's recent-games window spans every competition,
    // so a window game missing from the season set means a cup we do not
    // fetch (a Conference League qualifier, say). All-competitions claims
    // would then be wrong by that game — keep league-only facts in that case.
    const leagueOnlyIfIncomplete = (season: typeof teamSeason, window?: typeof formExtras.teamRecentForm) => {
      if (!window?.length || season.length === 0) return season;
      const days = new Set(season.map(r => r.date.slice(0, 10)));
      const complete = window.every(g => days.has(String(g.date).slice(0, 10)));
      return complete ? season : season.filter(r => r.isLeague);
    };
    teamSeason = leagueOnlyIfIncomplete(teamSeason, formExtras.teamRecentForm);
    oppSeason  = leagueOnlyIfIncomplete(oppSeason,  formExtras.opponentRecentForm);

    const scoreUnit   = league === 'epl' ? 'goal' : 'point';
    const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
    const seasonFacts = [
      ...deriveSeasonFacts(teamName, teamSeason, { teamScore: tScore, opponentScore: oScore }, leagueLabel, scoreUnit),
      ...deriveSeasonFacts(opponent, oppSeason,  { teamScore: oScore, opponentScore: tScore }, leagueLabel, scoreUnit),
    ];

    // Short club names for prose; every individual the data names, for the whitelist.
    const shortFor = (id: string | undefined, name: string): string =>
      TEAMS.find(t => t.id === id)?.shortName
      ?? TEAMS.find(t => t.league === league && t.name === name)?.shortName
      ?? name;
    const teamShort     = shortFor(teamId ? String(teamId) : undefined, teamName);
    const opponentShort = shortFor(opponentId ? String(opponentId) : undefined, opponent);
    const namedPlayers = new Set<string>(report?.playerNames ?? []);
    for (const side of [matchStats?.team, matchStats?.opponent]) for (const p of side?.players ?? []) if (p.name) namedPlayers.add(p.name.replace(/ \(sub\)$/, ''));
    for (const t of nrlTimeline?.tries ?? []) namedPlayers.add(t.name);
    for (const l of nrlTimeline?.scoringTimeline ?? []) {
      // "11' Try Roosters — Daniel Tupou — Roosters 10, Sharks 0"; an unnamed
      // score has one dash only and names no one.
      const m = l.match(/^\d+' (?:Try|Penalty Goal|Field Goal)(?: [^—]+)? — (.+?) — /);
      if (m) namedPlayers.add(m[1].trim());
    }
    for (const l of nrlTimeline?.topPerformerLines ?? []) {
      for (const m of l.matchAll(/(?::|\|)\s*([^\d|:]+?)\s+\d+/g)) namedPlayers.add(m[1].trim());
    }
    const sameClub = (a?: string, b?: string) => !!a && !!b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));
    const sourceHome = report?.homeTeam ?? aflQuarters?.homeName;
    const homeTeamName = sameClub(sourceHome, teamName) ? teamName : sameClub(sourceHome, opponent) ? opponent : undefined;

    // The opponent's perspective key for the same match: the neutral review is
    // stored under both, so a user following both clubs costs one generation.
    const opponentTeamId = (opponentId ? String(opponentId) : undefined) ?? resolveTeamId(league, opponent);
    const mirrorKey = (opponentTeamId && opponentTeamId !== teamId && typeof eventKey === 'string')
      ? await resolveMirrorKey(league, opponentTeamId, eventKey, String(date).slice(0, 10))
      : undefined;
    // Generation is keyed by the MATCH so the two perspectives never run twice.
    const genKey = typeof eventKey === 'string' && eventKey ? `event:${eventKey}` : reviewKey;

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
      scoringTimeline:    report?.scoringTimeline ?? nrlTimeline?.scoringTimeline,
      matchEvents:        report?.events?.length ? report.events : nrlTimeline?.scoringTimeline ?? aflQuarters?.events,
      seasonFacts:        seasonFacts.length ? seasonFacts : undefined,
      playerNames:        namedPlayers.size ? [...namedPlayers] : undefined,
      venue:              report?.venue ?? nrlTimeline?.venue ?? formExtras.venue ?? cricInfo?.venue ?? undefined,
      attendance:         report?.attendance ?? nrlTimeline?.attendance,
      homeTeamName,
      teamShort, opponentShort,
      cricketFormat, cricketResult, cricketInnings,
      cricketChart:       cricketChart?.length ? cricketChart : undefined,
    };

    const dataBlock = buildReviewDataBlock(input);

    // Standard key-contribution strip and key factors — deterministic, derived
    // server-side. Stored WITH the review so the deployed site, which cannot
    // run these fetchers' upstream at generation time, serves the same strip.
    const contributions = buildContributions(league, matchStats, report?.scoringTimeline ?? nrlTimeline?.scoringTimeline, cricketChart, { assists: report?.assists, tries: nrlTimeline?.tries });
    if (nrlTimeline?.topPerformerLines) contributions.push(...nrlTimeline.topPerformerLines);
    const derivedFactors = buildKeyFactors({
      league, teamName, opponent, teamShort, opponentShort,
      teamScore: tScore, opponentScore: oScore,
      report, matchEvents: input.matchEvents, matchStats, seasonFacts,
    });

    // Cron-only inspection: the exact block the model would see, no generation.
    if (isCron && (body as { debugBlock?: boolean }).debugBlock === true) {
      return NextResponse.json({ dataBlock, seasonFacts, contributions, keyFactors: derivedFactors, playerNames: [...namedPlayers], mirrorKey, genKey });
    }

    const review = await generateReview(genKey, dataBlock);
    if (!review) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    // Key moments are the model's — validated like everything else (names,
    // minutes, counts, order) — so they read as moments, not stat lines; the
    // derived factors are the fallback when it gives fewer than two.
    const modelMoments = (review.keyMoments ?? []).filter(m => typeof m === 'string' && m.trim().length > 0);
    const keyMoments = modelMoments.length >= 2 ? modelMoments : derivedFactors;
    // One verdict per club: this key gets its club's, the mirror key the other's.
    const verdicts = normalizeVerdicts(review, dataBlock);
    const { verdicts: _drop, ...body_ } = review;
    void _drop;
    const forClub = (club: string): AIReview => ({
      ...body_,
      keyMoments,
      verdict: verdicts?.[club] ?? review.verdict ?? '',
      ...(contributions.length > 0 ? { contributions } : {}),
    });
    const payload = forClub(teamName);

    await upsertReview(reviewStoreKey(reviewKey), payload, REVIEW_MODEL, aiLog);
    if (mirrorKey && mirrorKey !== reviewKey) {
      await upsertReview(reviewStoreKey(mirrorKey), forClub(opponent), REVIEW_MODEL, aiLog);
      aiLog(`mirrored gameId=${reviewKey} → ${mirrorKey}`);
    }
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ReviewValidationError) {
      // Both attempts contradicted the derived facts — never serve or cache it.
      return NextResponse.json({ error: 'Generation failed validation' }, { status: 500 });
    }
    if (err instanceof ReviewRestingError) {
      return NextResponse.json({ error: 'Resting after repeated refusals', retryAfter: new Date(err.until).toISOString() }, { status: 429 });
    }
    console.error('[/api/ai-review]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
