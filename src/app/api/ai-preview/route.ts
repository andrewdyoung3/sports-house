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
import { SYSTEM_PROMPT, buildDataBlock, buildUpdatePrompt } from '@/lib/preview-prompt';
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

// ─── Ollama call ──────────────────────────────────────────────────────────────

// modelOverride is kept for the benchmark script (step 5/6). Remove after benchmarking.
async function callOllama(prompt: string, compact = false, maxTokensOverride?: number, modelOverride?: string): Promise<AIPreview> {
  const doGenerate = async (): Promise<AIPreview> => {
    const client = new OpenAI({
      baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
      apiKey:  'ollama',
      timeout: 15 * 60 * 1000,
    });
    const response = await client.chat.completions.create({
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

  const result     = await doGenerate();
  const violations = validatePointsClaims(result, prompt);
  if (violations.length > 0) {
    aiLog(`validation-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — retrying`);
    try {
      const retry      = await doGenerate();
      const retryViols = validatePointsClaims(retry, prompt);
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
