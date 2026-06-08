/**
 * POST /api/ai-preview
 *
 * Generates a structured match preview using Claude (claude-sonnet-4-6).
 * Written in the voice of a seasoned sports journalist for a high-end
 * Australian/UK sports publication.
 *
 * Accepts all available context (standings, recent form, team news, model tips)
 * and returns four structured sections + key insights — all grounded in real data.
 *
 * Responses are cached per gameId for 6 hours so the same fixture doesn't
 * trigger repeated API calls across users.
 *
 * Requires ANTHROPIC_API_KEY in environment variables.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { unstable_cache } from 'next/cache';
import { appendFileSync } from 'fs';
import type { PreviewContext, GameResult, AIPreview, WeatherData } from '@/types';
import { SYSTEM_PROMPT, buildDataBlock, buildUpdatePrompt, collectPlayerWhitelist } from '@/lib/preview-prompt';
import { AI_MODEL } from '@/lib/ai-model';
import { getSupabaseServer } from '@/lib/supabase/server';

function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-preview] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// ─── Points-claim validator ───────────────────────────────────────────────────

/**
 * Extracts "N points [behind|ahead|adrift|…]" claims from the model output and
 * checks each claimed number against the DERIVED FACTS section of the prompt.
 * Returns a list of violation strings (empty = passed).
 *
 * If the prompt has no DERIVED FACTS section (e.g. F1, cups) returns [] — can't
 * validate so we don't block the response.
 */
function validatePointsClaims(output: AIPreview, prompt: string): string[] {
  const violations: string[] = [];
  const outputText = JSON.stringify(output);

  // ── Rule 1: standings-gap claims must match DERIVED FACTS ─────────────────
  const dfMatch = prompt.match(/DERIVED FACTS[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/);
  if (dfMatch) {
    const derivedNums = new Set(
      [...dfMatch[0].matchAll(/\b(\d+)\b/g)].map(m => m[1]),
    );
    const claimRe = /(\d+)\s+(?:competition\s+)?points?\s+(?:behind|ahead|adrift|clear|above|below|outside|inside)/gi;
    for (const m of outputText.matchAll(claimRe)) {
      if (!derivedNums.has(m[1])) {
        violations.push(`standings gap "${m[0].slice(0, 60)}" — ${m[1]} not in DERIVED FACTS`);
      }
    }
  }

  // ── Rule 2: expert-margin contradiction (fuzzy) ───────────────────────────
  // Rounding 43 to "40+" or "35–45" is good sports writing — only reject clear
  // contradictions that are outside ±25% of the provided expert margin.
  const expertMarginMatch = prompt.match(/average predicted winning margin:\s*(\d+)\s*points/i);
  if (expertMarginMatch) {
    const expertMargin = parseInt(expertMarginMatch[1], 10);
    const tolerance    = expertMargin * 0.25;
    // Match explicit margin figures: single number or a range ("35–40 point margin")
    const marginRe = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:point[s]?\s+(?:margin|win|victory|lead|defeat)|point[s]?\s+is\s+(?:likely|probable|expected))/gi;
    for (const m of outputText.matchAll(marginRe)) {
      const lo  = parseInt(m[1], 10);
      const hi  = m[2] ? parseInt(m[2], 10) : lo;
      const mid = (lo + hi) / 2;
      if (Math.abs(mid - expertMargin) > tolerance) {
        violations.push(`margin claim "${m[0].slice(0, 60)}" (mid=${mid}) — expert margin is ${expertMargin} pts, outside ±25%`);
      }
    }
  }

  return violations;
}

/**
 * Rejects outputs that claim finals/playoffs are imminent when the SEASON STATE
 * phase is early-season or mid-season. The "Rounds until finals: N" figure in
 * DERIVED FACTS is the authoritative proximity indicator — invented time-language
 * ("four weeks away", "finals looming") in these phases is always a hallucination.
 */
function validateFinalsImminence(output: AIPreview, prompt: string): string[] {
  // Only active when a SEASON STATE with a non-run-home, non-finals phase is present
  const phaseMatch = prompt.match(/SEASON STATE:.*?\(phase:\s*([^)]+)\)/i);
  if (!phaseMatch) return [];
  const phase = phaseMatch[1].trim().toLowerCase();
  if (phase === 'run home' || phase.startsWith('run home') || phase.startsWith('finals')) return [];

  const imminenceRe = /finals\s+(?:(?:just\s+)?(?:around\s+the\s+corner|looming|approaching|weeks?\s+away|months?\s+away|not\s+far)|are\s+(?:near|close|imminent))|playoffs?\s+(?:looming|approaching|near|close|imminent|weeks?\s+away)/gi;
  const outputText = JSON.stringify(output);
  const violations: string[] = [];
  for (const m of outputText.matchAll(imminenceRe)) {
    violations.push(`finals-imminence language "${m[0].slice(0, 80)}" in ${phase} phase`);
  }
  return violations;
}

/**
 * Capitalized-word patterns that appear in sports text but are NOT person names.
 * When both words of a two-word sequence are in this set the sequence is skipped.
 */
const PLAYER_NAME_SAFE_WORDS = new Set([
  // Sport/competition terms
  'premier', 'league', 'champions', 'europa', 'conference', 'cup', 'final',
  'finals', 'series', 'grand', 'super', 'rugby', 'football', 'soccer',
  'cricket', 'season', 'round', 'phase', 'preliminary', 'semi', 'quarter',
  'trophy', 'stage', 'world', 'national', 'international', 'premiership',
  'championship', 'division', 'competition', 'association', 'pacific',
  'magic', 'regular', 'origin', 'state',
  // Cardinal directions / common in team/venue names
  'north', 'south', 'east', 'west', 'central', 'united', 'city', 'town',
  'park', 'ground', 'stadium', 'arena', 'oval', 'field', 'harbour',
  'harbor', 'bay', 'lake', 'river',
  // Countries / nationalities
  'australian', 'american', 'english', 'british', 'french', 'spanish',
  'irish', 'welsh', 'scottish', 'zealand', 'african', 'european', 'asian',
  // Match context
  'home', 'away', 'neutral', 'match', 'game', 'fixture',
  // Common English words that appear Title-Case at sentence starts — NOT names
  'if', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'when', 'but', 'and',
  'or', 'as', 'by', 'of', 'to', 'that', 'this', 'there', 'their', 'his',
  'her', 'its', 'while', 'although', 'despite', 'with', 'without', 'both',
  'these', 'those', 'what', 'which', 'who', 'whose', 'how', 'whether',
  'once', 'since', 'given', 'despite', 'against', 'throughout', 'across',
  'between', 'within', 'beyond', 'before', 'after', 'during', 'through',
]);

/**
 * Checks the model output for player names that are not in the data block.
 *
 * Strategy:
 *   - When hasPlayerData=false (NO PLAYER DATA sentinel was injected): scan only
 *     playerSpotlight for capitalized two-word sequences that look like person names.
 *   - When hasPlayerData=true: scan the full JSON output and flag any name-like
 *     sequence not present in the whitelist built from LINEUP/SQUAD/INJURY sections.
 *
 * False-positive guards: skips sequences where every word is in PLAYER_NAME_SAFE_WORDS,
 * where the sequence is a substring of the team/opponent names, or where the sequence
 * matches a whitelisted coach name.
 */
function validatePlayerNames(output: AIPreview, prompt: string): string[] {
  const { whitelist, hasPlayerData } = collectPlayerWhitelist(prompt);

  // Team names extracted from FIXTURE line — words in these are OK to appear capitalised
  const fixtureM = prompt.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  const teamName     = fixtureM?.[1]?.trim() ?? '';
  const opponentName = fixtureM?.[2]?.trim() ?? '';

  // Merge safe word set with all words from team/opponent names and competition
  const compM = prompt.match(/^COMPETITION:\s*(.+)$/m);
  const competition = compM?.[1]?.trim() ?? '';

  const excluded = new Set(PLAYER_NAME_SAFE_WORDS);
  for (const w of `${teamName} ${opponentName} ${competition}`.toLowerCase().split(/\s+/)) {
    if (w) excluded.add(w);
  }
  // Whitelist items are also OK by definition
  for (const name of whitelist) {
    for (const w of name.split(/\s+/)) excluded.add(w);
  }

  // Expand whitelist to individual words (length ≥ 3) so "Postecoglou" matches
  // "Ange Postecoglou" in the whitelist even when the model writes "Postecoglou's".
  const whitelistWords = new Set<string>();
  for (const entry of whitelist) {
    for (const w of entry.split(/\s+/)) {
      if (w.length >= 3) whitelistWords.add(w);
    }
  }

  // Text to scan: only playerSpotlight when no data, full output when data present
  const textToScan = hasPlayerData
    ? JSON.stringify(output)
    : (output.playerSpotlight ?? '');

  const violations: string[] = [];
  const seen = new Set<string>();

  // Match sequences of 2+ consecutive Title-Case words (handles most person names).
  // Possessives ('s) are included in the character class so "Neale's" stays one token.
  const nameRe = /\b([A-Z][a-zÀ-ÿ'\-]{1,}(?:\s+[A-Z][a-zÀ-ÿ'\-]{1,})+)\b/g;
  for (const m of textToScan.matchAll(nameRe)) {
    const candidate = m[1];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    // Strip possessives for comparison purposes
    const stripped = candidate.replace(/'s\b/gi, '').trim();
    const lower    = stripped.toLowerCase();
    const words    = lower.split(/\s+/);

    // Skip if all words are safe/excluded terms (non-person vocabulary)
    if (words.every(w => excluded.has(w))) continue;
    // Skip if it's a substring of either team name
    if (teamName.toLowerCase().includes(lower) || opponentName.toLowerCase().includes(lower)) continue;
    // Skip if it's in the competition name
    if (competition.toLowerCase().includes(lower)) continue;
    // Skip if the full stripped phrase is in the whitelist
    if (whitelist.has(lower)) continue;
    // Skip if a whitelisted entry contains this phrase or vice versa (handles surnames alone)
    if ([...whitelist].some(entry => entry.includes(lower) || lower.includes(entry))) continue;
    const nonSafeWords = words.filter(w => !excluded.has(w));

    if (!hasPlayerData) {
      // No-data case: need 2+ non-safe words to constitute a person name.
      // "If Spurs" has 1 non-safe word (team nickname) → skip; "Bukayo Saka" has 2 → flag.
      if (nonSafeWords.length < 2) continue;
    } else {
      // Has-data case: all non-safe words must appear in the whitelist (by individual word).
      if (nonSafeWords.every(w => whitelistWords.has(w))) continue;
    }

    violations.push(hasPlayerData
      ? `player name "${candidate}" not in provided lineup/squad/injury data`
      : `player name "${candidate}" invented — no player data was provided for this fixture`
    );
  }

  return violations;
}

// ─── Ollama client ────────────────────────────────────────────────────────────

const ollamaClient = new OpenAI({
  baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
  apiKey:  'ollama',
  timeout: 15 * 60 * 1000,
});

// ─── Ollama call ──────────────────────────────────────────────────────────────

// modelOverride is kept for the benchmark script (step 5/6). Remove after benchmarking.
async function callOllama(prompt: string, compact = false, maxTokensOverride?: number, modelOverride?: string): Promise<AIPreview> {
  const doGenerate = async (): Promise<AIPreview> => {
    const response = await ollamaClient.chat.completions.create({
      model:      modelOverride ?? AI_MODEL,
      // Qwen3 thinking consumes 1k–3k tokens before output — budget must cover both.
      max_tokens: maxTokensOverride ?? (compact ? 2500 : 4000),
      messages:   [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    });
    const raw          = response.choices[0]?.message?.content ?? '{}';
    // Defensively strip <think>…</think> if present (thinking models).
    const withoutThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
    const cleaned      = withoutThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned) as AIPreview;
    } catch {
      // First parse failed — log raw output and try to extract the JSON object
      aiLog(`parse-fail raw_len=${raw.length} first300=${JSON.stringify(cleaned.slice(0, 300))}`);
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd   = cleaned.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as AIPreview;
      }
      throw new SyntaxError(`Non-JSON model output (len=${raw.length}): ${cleaned.slice(0, 120)}`);
    }
  };

  const model  = modelOverride ?? AI_MODEL;
  const t0     = Date.now();
  aiLog(`start model=${model} compact=${compact}`);

  let result: AIPreview;
  try {
    result = await doGenerate();
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    // Total parse failure (no extractable JSON) — retry the model call once.
    aiLog(`total-parse-fail elapsed=${Date.now() - t0}ms — retrying model call`);
    result = await doGenerate(); // throws again → propagates to outer catch → 500
  }

  const allViolations = (v: AIPreview) => [
    ...validatePointsClaims(v, prompt),
    ...validateFinalsImminence(v, prompt),
    ...validatePlayerNames(v, prompt),
  ];
  const violations = allViolations(result);
  if (violations.length > 0) {
    aiLog(`validation-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — retrying`);
    try {
      const retry      = await doGenerate();
      const retryViols = allViolations(retry);
      if (retryViols.length === 0) {
        aiLog(`retry-ok elapsed=${Date.now() - t0}ms`);
        return retry;
      }
      aiLog(`retry-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(retryViols)} — returning first attempt`);
    } catch (e) {
      aiLog(`retry-error elapsed=${Date.now() - t0}ms err=${e}`);
    }
  } else {
    aiLog(`done elapsed=${Date.now() - t0}ms`);
  }
  return result;
}

// Cache per unique (cacheKey, prompt, compact) triple — 6-hour TTL.
// compact previews are cached separately (shorter content, different prompt).
const getCachedPreview = unstable_cache(
  async (_cacheKey: string, prompt: string, compact: boolean, maxTokensOverride?: number): Promise<AIPreview> =>
    callOllama(prompt, compact, maxTokensOverride),
  ['ai-preview-v38'],
  { revalidate: 21600 }, // 6 hours
);

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES  = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1']);
const TEAMID_RE        = /^[a-z0-9]+-?[a-z0-9_-]*$/;
const FINGERPRINT_RE   = /^[a-zA-Z0-9_\-:]{1,128}$/;
// Reject control characters and obvious prompt-injection newlines; allow Unicode letters for international names
const NO_NEWLINES_RE   = /[\n\r\0]/;

export async function POST(req: NextRequest) {
  // Auth gate (FIRST — before body read, env check, cache lookup, or any model call).
  // Cron warm-cache calls bypass Supabase auth via a shared secret header.
  // All other callers require a valid Supabase session (anonymous included).
  const cronSecret = req.headers.get('x-cron-secret');
  const isCron = cronSecret && cronSecret === process.env.CRON_SECRET;
  if (!isCron) {
    const sb = getSupabaseServer();
    const { data: { user } } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
  }

  try {
    const body = await req.json() as {
      league:          string;
      teamId:          string;
      teamName:        string;
      opponentName:    string;
      gameId:          string;
      context:         PreviewContext;
      teamResults:     GameResult[];
      oppResults:      GameResult[];
      competition?:    string;
      compact?:        boolean;
      venue?:          string;
      isHome?:         boolean;
      opponentId?:     string;
      previousPreview?: AIPreview;
      newsFingerprint?: string;
      weather?:        WeatherData;
      // BENCHMARK ONLY — remove after benchmarking
      benchmarkModelOverride?: string;
      benchmarkReturnPrompt?: boolean;
    };

    const {
      league, teamId, teamName, opponentName, gameId,
      context, teamResults, oppResults, competition, compact,
      venue, isHome, opponentId,
      previousPreview, newsFingerprint, weather,
      benchmarkModelOverride, benchmarkReturnPrompt,
    } = body;

    if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    // Guard against prompt injection and token amplification in user-supplied strings
    const strFields: [string, number][] = [
      [teamName ?? '',     100],
      [opponentName ?? '', 100],
      [gameId ?? '',        80],
      [competition ?? '',  120],
    ];
    for (const [val, maxLen] of strFields) {
      if (val.length > maxLen || NO_NEWLINES_RE.test(val)) {
        return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
      }
    }
    if (newsFingerprint && !FINGERPRINT_RE.test(newsFingerprint)) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    let prompt: string;
    let cacheKey: string;

    const isCompact = compact === true;
    // F1 previews have 4 rich sections covering a full grid — allow more output tokens.
    const isF1 = league === 'f1';
    const maxTokensOverride = isF1 ? 5000 : undefined;

    if (previousPreview && newsFingerprint) {
      // Update mode — news has changed since last generation.
      const teamNews = context.teamNews ?? [];
      const oppNews  = context.opponentNews ?? [];
      prompt   = buildUpdatePrompt(previousPreview, teamName, opponentName, teamNews, oppNews, context);
      cacheKey = `update:${gameId}:${newsFingerprint}${isCompact ? ':c' : ''}`;
    } else {
      // Full generation mode.
      prompt   = buildDataBlock(league, teamName, opponentName, context ?? {}, teamResults ?? [], oppResults ?? [], competition, isCompact, weather, venue, isHome, teamId, opponentId);
      cacheKey = isCompact ? `${gameId}:compact` : gameId;
    }

    // BENCHMARK ONLY: return prompt pair without LLM call (cron only)
    if (benchmarkReturnPrompt && isCron) {
      return NextResponse.json({ __benchmarkSystem: SYSTEM_PROMPT, __benchmarkPrompt: prompt });
    }
    // BENCHMARK ONLY: bypass cache and use model override when specified
    const preview = benchmarkModelOverride && isCron
      ? await callOllama(prompt, isCompact, maxTokensOverride, benchmarkModelOverride)
      : await getCachedPreview(cacheKey, prompt, isCompact, maxTokensOverride);
    return NextResponse.json(preview);
  } catch (err) {
    console.error('[/api/ai-preview]', err);
    return NextResponse.json({ error: 'Preview generation failed' }, { status: 500 });
  }
}
