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
import Anthropic from '@anthropic-ai/sdk';
import { unstable_cache } from 'next/cache';
import type { PreviewContext, GameResult, AIPreview, WeatherData } from '@/types';
import { SYSTEM_PROMPT, buildDataBlock, buildUpdatePrompt } from '@/lib/preview-prompt';
import { AI_MODEL } from '@/lib/ai-model';

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(prompt: string, compact = false, maxTokensOverride?: number): Promise<AIPreview> {
  const client   = new Anthropic();
  const response = await client.messages.create({
    model:      AI_MODEL,
    max_tokens: maxTokensOverride ?? (compact ? 380 : 800),
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw     = (response.content[0] as { type: string; text: string }).text ?? '{}';
  // Strip accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(cleaned) as AIPreview;
}

// Cache per unique (cacheKey, prompt, compact) triple — 6-hour TTL.
// compact previews are cached separately (shorter content, different prompt).
const getCachedPreview = unstable_cache(
  async (_cacheKey: string, prompt: string, compact: boolean, maxTokensOverride?: number): Promise<AIPreview> =>
    callClaude(prompt, compact, maxTokensOverride),
  ['ai-preview-v36'],
  { revalidate: 21600 }, // 6 hours
);

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES  = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int', 'f1']);
const TEAMID_RE        = /^[a-z0-9]+-?[a-z0-9_-]*$/;
const FINGERPRINT_RE   = /^[a-zA-Z0-9_\-:]{1,128}$/;
// Reject control characters and obvious prompt-injection newlines; allow Unicode letters for international names
const NO_NEWLINES_RE   = /[\n\r\0]/;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI preview not configured' }, { status: 503 });
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
    };

    const {
      league, teamId, teamName, opponentName, gameId,
      context, teamResults, oppResults, competition, compact,
      venue, isHome, opponentId,
      previousPreview, newsFingerprint, weather,
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
    const maxTokensOverride = isF1 ? 1200 : undefined;

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

    const preview = await getCachedPreview(cacheKey, prompt, isCompact, maxTokensOverride);
    return NextResponse.json(preview);
  } catch (err) {
    console.error('[/api/ai-preview]', err);
    return NextResponse.json({ error: 'Preview generation failed' }, { status: 500 });
  }
}
