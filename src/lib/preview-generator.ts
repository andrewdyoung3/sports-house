/**
 * Ollama-backed match-preview generation — shared between the API route (read-only
 * session path) and the standalone `scripts/generate-previews.ts` generator.
 *
 * All Ollama calls, validation, and Supabase upserts live here so the route and
 * the script can never drift.
 *
 * NOT safe to import in client components — uses Node-only modules (fs, OpenAI).
 */

import { appendFileSync } from 'fs';
import OpenAI from 'openai';
import type { AIPreview, UpcomingGame, PreviewContext } from '@/types';
import { SYSTEM_PROMPT, buildDataBlock, collectPlayerWhitelist } from '@/lib/preview-prompt';
import { AI_MODEL } from '@/lib/ai-model';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildPreviewContext } from '@/lib/preview-context';

// ─── Logger ───────────────────────────────────────────────────────────────────

export function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-preview] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// ─── Points-claim validator ───────────────────────────────────────────────────

function validatePointsClaims(output: AIPreview, prompt: string): string[] {
  const violations: string[] = [];
  const outputText = JSON.stringify(output);

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

  const expertMarginMatch = prompt.match(/average predicted winning margin:\s*(\d+)\s*points/i);
  if (expertMarginMatch) {
    const expertMargin = parseInt(expertMarginMatch[1], 10);
    const tolerance    = expertMargin * 0.25;
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

function validateFinalsImminence(output: AIPreview, prompt: string): string[] {
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
 * Catches invented per-player statlines. When the data block contains NO KEY
 * PERFORMERS section, the model has no grounded per-player numbers, so any stat
 * like "two tries", "18 tackles", "3 turnovers" attached in the factual fields is
 * fabricated. Scans only the factual fields (mediaWatch is attributed editorial
 * and may legitimately echo a real headline's numbers). Excludes "points"/"goals"
 * — those collide with competition points and team scorelines.
 */
function validateInventedStatlines(output: AIPreview, prompt: string): string[] {
  if (/^KEY PERFORMERS/m.test(prompt)) return []; // grounded stats may be present
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const statRe = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(tries|try|assists?|tackles?|turnovers?|line[\s-]?breaks?|tackle[\s-]?busts?|carries|offloads?|rebounds?|steals?|blocks?|interceptions?)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(statRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`invented player statline "${m[0]}" — no KEY PERFORMERS data provided for this fixture`);
  }
  return violations;
}

/**
 * Catches invented calendar years. The data block deliberately omits past years
 * (form/H2H carry no dates), so any year in the factual fields that does NOT appear
 * in the prompt (e.g. competition labels like "World Cup 2026") is fabricated —
 * the classic "winless in 2024" failure. Scans factual fields only.
 */
function validateInventedYears(output: AIPreview, prompt: string): string[] {
  const promptYears = new Set([...prompt.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m => m[0]));
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    if (promptYears.has(m[0]) || seen.has(m[0])) continue;
    seen.add(m[0]);
    violations.push(`invented year "${m[0]}" — not present in the data block`);
  }
  return violations;
}

const PLAYER_NAME_SAFE_WORDS = new Set([
  'premier', 'league', 'champions', 'europa', 'conference', 'cup', 'final',
  'finals', 'series', 'grand', 'super', 'rugby', 'football', 'soccer',
  'cricket', 'season', 'round', 'phase', 'preliminary', 'semi', 'quarter',
  'trophy', 'stage', 'world', 'national', 'international', 'premiership',
  'championship', 'division', 'competition', 'association', 'pacific',
  'magic', 'regular', 'origin', 'state',
  'north', 'south', 'east', 'west', 'central', 'united', 'city', 'town',
  'park', 'ground', 'stadium', 'arena', 'oval', 'field', 'harbour',
  'harbor', 'bay', 'lake', 'river',
  'australian', 'american', 'english', 'british', 'french', 'spanish',
  'irish', 'welsh', 'scottish', 'zealand', 'african', 'european', 'asian',
  'home', 'away', 'neutral', 'match', 'game', 'fixture',
  'if', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'when', 'but', 'and',
  'or', 'as', 'by', 'of', 'to', 'that', 'this', 'there', 'their', 'his',
  'her', 'its', 'while', 'although', 'despite', 'with', 'without', 'both',
  'these', 'those', 'what', 'which', 'who', 'whose', 'how', 'whether',
  'once', 'since', 'given', 'despite', 'against', 'throughout', 'across',
  'between', 'within', 'beyond', 'before', 'after', 'during', 'through',
]);

export function validatePlayerNames(output: AIPreview, prompt: string): string[] {
  const { whitelist, hasPlayerData } = collectPlayerWhitelist(prompt);

  const fixtureM = prompt.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  const teamName     = fixtureM?.[1]?.trim() ?? '';
  const opponentName = fixtureM?.[2]?.trim() ?? '';

  const compM = prompt.match(/^COMPETITION:\s*(.+)$/m);
  const competition = compM?.[1]?.trim() ?? '';

  // The VENUE line carries a stadium name (e.g. "McDonald Jones Stadium") that the
  // model legitimately references; its words must not be flagged as player names.
  const venueM = prompt.match(/^VENUE:\s*([^—\n]+)/m);
  const venueName = venueM?.[1]?.trim() ?? '';

  // Expand a name token into the forms the validator's matcher may produce.
  // The name regex breaks internal-capital surnames (e.g. "O'Brien" → "Brien"),
  // so also surface the substring after an apostrophe.
  const expandWord = (w: string): string[] => {
    const out = [w];
    if (w.includes("'") || w.includes('’')) {
      const tail = w.split(/['’]/).pop();
      if (tail && tail.length > 1) out.push(tail);
    }
    return out;
  };

  const excluded = new Set(PLAYER_NAME_SAFE_WORDS);
  for (const w of `${teamName} ${opponentName} ${competition} ${venueName}`.toLowerCase().split(/\s+/)) {
    if (w) for (const e of expandWord(w)) excluded.add(e);
  }
  for (const name of whitelist) {
    for (const w of name.split(/\s+/)) for (const e of expandWord(w)) excluded.add(e);
  }

  const whitelistWords = new Set<string>();
  for (const entry of whitelist) {
    for (const w of entry.split(/\s+/)) {
      for (const e of expandWord(w)) if (e.length >= 3) whitelistWords.add(e);
    }
  }

  // When player data is present we scan the whole output. Otherwise we scan the
  // factual playerSpotlight PLUS the attributed mediaWatch — names invented in
  // either are caught, while real names from the fetched headlines pass because
  // collectPlayerWhitelist added them to the whitelist.
  const textToScan = hasPlayerData
    ? JSON.stringify(output)
    : `${output.playerSpotlight ?? ''} ${(output.mediaWatch ?? []).join(' ')}`;

  const violations: string[] = [];
  const seen = new Set<string>();

  const nameRe = /\b([A-Z][a-zÀ-ÿ'\-]{1,}(?:\s+[A-Z][a-zÀ-ÿ'\-]{1,})+)\b/g;
  for (const m of textToScan.matchAll(nameRe)) {
    const candidate = m[1];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const stripped = candidate.replace(/'s\b/gi, '').trim();
    const lower    = stripped.toLowerCase();
    const words    = lower.split(/\s+/);

    if (words.every(w => excluded.has(w))) continue;
    if (teamName.toLowerCase().includes(lower) || opponentName.toLowerCase().includes(lower)) continue;
    if (competition.toLowerCase().includes(lower)) continue;
    if (whitelist.has(lower)) continue;
    if ([...whitelist].some(entry => entry.includes(lower) || lower.includes(entry))) continue;
    const nonSafeWords = words.filter(w => !excluded.has(w));

    if (!hasPlayerData) {
      if (nonSafeWords.length < 2) continue;
    } else {
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

export async function callOllama(
  prompt: string,
  compact = false,
  maxTokensOverride?: number,
  modelOverride?: string,
): Promise<AIPreview> {
  const doGenerate = async (): Promise<AIPreview> => {
    const response = await ollamaClient.chat.completions.create({
      model:      modelOverride ?? AI_MODEL,
      // Non-compact ceiling is 6000 (headroom for richer future prompts; current
      // previews land well under 1000 tokens so this never costs anything today).
      // compact (2500) is unreachable on the main preview path — generateAndStorePreview
      // always passes compact=false — and is left untouched.
      max_tokens: maxTokensOverride ?? (compact ? 2500 : 6000),
      messages:   [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    });
    const raw          = response.choices[0]?.message?.content ?? '{}';
    const withoutThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
    const cleaned      = withoutThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned) as AIPreview;
    } catch {
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
    aiLog(`total-parse-fail elapsed=${Date.now() - t0}ms — retrying model call`);
    result = await doGenerate();
  }

  const allViolations = (v: AIPreview) => [
    ...validatePointsClaims(v, prompt),
    ...validateFinalsImminence(v, prompt),
    ...validatePlayerNames(v, prompt),
    ...validateInventedStatlines(v, prompt),
    ...validateInventedYears(v, prompt),
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

// ─── Supabase helpers ─────────────────────────────────────────────────────────

export function isValidPreview(v: unknown): v is AIPreview {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.context          === 'string' && p.context.length > 0 &&
    typeof p.tacticalBattle   === 'string' && p.tacticalBattle.length > 0 &&
    typeof p.playerSpotlight  === 'string' && p.playerSpotlight.length > 0 &&
    typeof p.verdict          === 'string' && p.verdict.length > 0 &&
    Array.isArray(p.keyInsights) && (p.keyInsights as unknown[]).length > 0
  );
}

export async function upsertPreview(
  gameId: string,
  payload: AIPreview,
  model: string,
  newsFingerprint: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) { aiLog('upsert-skip: admin client not configured'); return; }
  const { error } = await admin.from('game_previews').upsert(
    { game_id: gameId, payload, model, news_fingerprint: newsFingerprint, updated_at: new Date().toISOString() },
    { onConflict: 'game_id' },
  );
  if (error) aiLog(`upsert-fail gameId=${gameId} err=${error.message}`);
  else        aiLog(`upsert-ok   gameId=${gameId} model=${model}`);
}

// ─── High-level orchestrator ──────────────────────────────────────────────────

/**
 * Generates a match preview for the given fixture (using Ollama) and upserts
 * the result to Supabase. Designed to be called server-side or from the
 * standalone generator script — never from the browser.
 *
 * Builds a rich context (standings, WC group, managers) via buildPreviewContext,
 * then merges any caller-provided enrichment (form/news/lineups from the API
 * route). All entry points — heartbeat, poller, regen — converge here.
 */
export async function generateAndStorePreview(
  league: string,
  fixture: UpcomingGame,
  teamName: string,
  previewContext?: Partial<PreviewContext>,
): Promise<{ ok: boolean; error?: string }> {
  const isF1      = league === 'f1';
  // Non-F1 falls through to callOllama's 6000 default. F1 previews are longer
  // (driver + constructor + championship detail); keep them at the same ceiling.
  const maxTokens = isF1 ? 6000 : undefined;

  try {
    // Build the canonical base context (standings + WC group + managers).
    // Results are cached per league — safe for batch heartbeat runs.
    const baseCtx = await buildPreviewContext(league, fixture, teamName);
    // Merge: baseCtx provides structure; previewContext adds form/news/lineups.
    const ctx = { ...baseCtx, ...previewContext } as PreviewContext;

    const prompt = buildDataBlock(
      league,
      teamName,
      fixture.opponent,
      ctx,
      [],
      [],
      fixture.competition,
      false,
      undefined,
      fixture.venue,
      fixture.isHome,
      fixture.teamId,
      fixture.opponentId,
      fixture.seriesSummary,
    );

    const preview = await callOllama(prompt, false, maxTokens);

    if (isValidPreview(preview)) {
      await upsertPreview(fixture.id, preview, AI_MODEL, null);
      // Representative games (State of Origin) key per perspective on the display
      // side — upsert the SAME payload under the mirror key(s) so both resolve.
      for (const mirrorId of fixture.mirrorGameIds ?? []) {
        await upsertPreview(mirrorId, preview, AI_MODEL, null);
      }
      return { ok: true };
    }

    aiLog(`invalid-preview gameId=${fixture.id}`);
    return { ok: false, error: 'invalid preview shape' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    aiLog(`generate-fail gameId=${fixture.id} err=${msg}`);
    return { ok: false, error: msg };
  }
}
