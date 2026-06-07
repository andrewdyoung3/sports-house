/**
 * scripts/eval-previews.ts — DEV TOOL.
 *
 * NOT part of the build or app runtime, and NOT imported by any route. It compares
 * the AI match-preview output of multiple models on the EXACT prompt production
 * uses (via `buildPreviewPrompt` from src/lib/preview-prompt.ts), so quality can be
 * judged side-by-side alongside the cost/latency difference.
 *
 * Output: a blind, order-randomized markdown artifact (outputs shown as A/B with no
 * model labels) for unbiased judging, a SEPARATE de-anonymization key file, and a
 * cost/latency summary table.
 *
 * Run modes:
 *   npx tsx scripts/eval-previews.ts                      # Anthropic models, all fixtures
 *   npx tsx scripts/eval-previews.ts --dry-run            # build prompts only, no API calls
 *   npx tsx scripts/eval-previews.ts --local-only         # Ollama only, all fixtures
 *   npx tsx scripts/eval-previews.ts --variant-eval       # 3 prompt variants × 2 fixtures, Ollama
 *   EVAL_SAMPLES=2 npx tsx scripts/eval-previews.ts       # 2 samples/model for variance
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI    from 'openai';
import { execSync }  from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreviewPrompt, SYSTEM_PROMPT, type PreviewPromptInput } from '@/lib/preview-prompt';
import type { AIPreview, GameResult, LeagueTableRow, TeamStanding } from '@/types';

// ── Env: load from .env.local if not already in the environment ──────────────
function loadEnvLocal(): void {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ── Prompt variants ────────────────────────────────────────────────────────────
// Extracted at eval startup by reading the committed (Haiku-era) version from git.
// The Haiku-era SYSTEM_PROMPT is the committed version — no GROUNDING block, no
// STRUCTURE block (both were added in the post-migration grounding sprint).
function getHaikuEraSystemPrompt(): string {
  try {
    const committed = execSync('git show HEAD:src/lib/preview-prompt.ts', { encoding: 'utf8' });
    const m = committed.match(/export const SYSTEM_PROMPT = `([\s\S]+?)`;/);
    return m?.[1] ?? SYSTEM_PROMPT;
  } catch {
    console.warn('[eval] Could not read Haiku-era prompt from git — using current SYSTEM_PROMPT');
    return SYSTEM_PROMPT;
  }
}

// Strip the DERIVED FACTS section from a user data block (for variants a & b).
// The section starts with "DERIVED FACTS —" and ends at the next blank line.
function stripDerivedFacts(userBlock: string): string {
  return userBlock.replace(/^DERIVED FACTS —[\s\S]*?\n\n/m, '').replace(/\n{3,}/g, '\n\n');
}

interface PromptVariant {
  label:              string;
  systemPrompt:       string;
  // If false, strip the leagueTable from context so DERIVED FACTS isn't generated.
  // The data block is built from the input, then post-processed to remove the section.
  stripDerivedFacts:  boolean;
}

// Built lazily so git isn't called unless --variant-eval is active.
let _variants: PromptVariant[] | null = null;
function getVariants(): PromptVariant[] {
  if (_variants) return _variants;
  const HAIKU  = getHaikuEraSystemPrompt();
  _variants = [
    { label: '(a) haiku-era (no grounding, no derived)',   systemPrompt: HAIKU,         stripDerivedFacts: true  },
    { label: '(b) haiku + GROUNDING (no derived facts)',   systemPrompt: SYSTEM_PROMPT, stripDerivedFacts: true  },
    { label: '(c) haiku + GROUNDING + DERIVED FACTS',      systemPrompt: SYSTEM_PROMPT, stripDerivedFacts: false },
  ];
  return _variants;
}

// ── Model registry ────────────────────────────────────────────────────────────
interface ModelCfg {
  label:       string;
  model:       string;
  provider:    'anthropic' | 'ollama';
  inputPrice:  number; // USD per 1M tokens (0 for local)
  outputPrice: number;
  maxTokens?:  number; // override per model (Ollama needs more for thinking budget)
}

const MODELS: ModelCfg[] = [
  { label: 'sonnet-4-6',         model: 'claude-sonnet-4-6',                    provider: 'anthropic', inputPrice: 3.0,  outputPrice: 15.0 },
  { label: 'haiku-4-5',          model: 'claude-haiku-4-5',                     provider: 'anthropic', inputPrice: 1.0,  outputPrice: 5.0  },
  { label: 'instruct-2507-30b',  model: 'qwen3:30b-a3b-instruct-2507-q4_K_M',  provider: 'ollama',    inputPrice: 0,    outputPrice: 0, maxTokens: 4000 },
  { label: 'thinking-2507-30b',  model: 'qwen3:30b-a3b-thinking-2507-q4_K_M',  provider: 'ollama',    inputPrice: 0,    outputPrice: 0, maxTokens: 6000 },
];

const SAMPLES    = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 1));
const MAX_TOKENS = 800; // Anthropic default; Ollama uses model.maxTokens

// ── Fixture builders ────────────────────────────────────────────────────────────
let dateCounter = 0;
const ago = (): string => { dateCounter += 7; return new Date(Date.now() - dateCounter * 86_400_000).toISOString(); };
const res = (opponent: string, opponentAbbr: string, isHome: boolean, isWin: boolean, teamScore: number, opponentScore: number, extra: Partial<GameResult> = {}): GameResult =>
  ({ opponent, opponentAbbr, isHome, isWin, teamScore, opponentScore, date: ago(), ...extra });
const standing = (name: string, position: number, played: number, wins: number, draws: number, losses: number, points: number, extra: Partial<TeamStanding> = {}): TeamStanding =>
  ({ name, position, played, wins, draws, losses, points, ...extra });
const row = (name: string, position: number, played: number, wins: number, draws: number, losses: number, points: number): LeagueTableRow =>
  ({ name, position, played, wins, draws, losses, points });

interface Fixture { name: string; note: string; input: PreviewPromptInput }

// ── VARIANT-EVAL fixtures (the two known benchmark fixtures with live-accurate data) ──
// Data matches what was in the actual benchmark run (Round 13, 2026).
const VARIANT_FIXTURES: Fixture[] = [
  {
    name: 'AFL — Brisbane Lions vs Richmond (Round 13)',
    note: 'Benchmark fixture: Lions 8th (28 pts), Richmond 17th (8 pts). Neutral venue. Expert tip: 23/23 Lions by 43 pts.',
    input: {
      league: 'afl', teamId: 'afl-lions', opponentId: 'afl-tigers',
      teamName: 'Brisbane Lions', opponentName: 'Richmond',
      venue: 'Bellerive Oval', isHome: false,
      teamResults: [
        res('Gold Coast',            'GCS', false, true,  106, 75),
        res('Fremantle',             'FRE', false, false,  78, 103),
        res('Greater Western Sydney','GWS', false, false,  88, 166),
        res('Essendon',              'ESS', true,  false,  90, 100),
        res('North Melbourne',       'NME', true,  true,  130, 60),
      ],
      oppResults: [],
      context: {
        teamStanding:     standing('Brisbane Lions', 8,  13, 7, 0, 6, 28, { percentage: 106.2 }),
        opponentStanding: standing('Richmond',       17, 12, 2, 0, 10, 8),
        teamManager:  'Chris Fagan',
        opponentManager: 'Adem Yze',
        // leagueTable deliberately omitted here — variant runner adds it for variant (c) only
        tips: { favouriteTeam: 'Brisbane Lions', tipsFor: 23, tipsTotal: 23, avgMargin: 43 },
      },
    },
  },
  {
    name: 'NRL — Brisbane Broncos vs Rabbitohs (Round 13)',
    note: 'Benchmark fixture: Broncos 12th (12 pts), Rabbitohs 8th/last finals spot (16 pts). Rabbitohs home (Accor Stadium).',
    input: {
      league: 'nrl', teamId: 'nrl-broncos', opponentId: 'nrl-rabbitohs',
      teamName: 'Brisbane Broncos', opponentName: 'Rabbitohs',
      venue: 'Accor Stadium', isHome: false,
      teamResults: [],
      oppResults:  [],
      context: {
        teamStanding:     standing('Broncos',   12, 13, 5, 0, 8, 12),
        opponentStanding: standing('Rabbitohs', 8,  12, 6, 0, 6, 16),
        teamManager:     'Michael Maguire',
        opponentManager: 'Wayne Bennett',
        // leagueTable omitted here — added for variant (c) only
      },
    },
  },
];

// Full AFL ladder for variant (c) context injection
const AFL_LEAGUE_TABLE: LeagueTableRow[] = [
  row('Fremantle',           1,  13, 12, 0, 1, 48),
  row('Sydney',              2,  13, 11, 0, 2, 44),
  row('Hawthorn',            3,  13,  8, 1, 4, 34),
  row('Geelong',             4,  13,  8, 0, 5, 32),
  row('Western Bulldogs',    5,  13,  8, 0, 5, 32),
  row('Gold Coast',          6,  12,  7, 0, 5, 28),
  row('Adelaide',            7,  12,  7, 0, 5, 28),
  row('Brisbane Lions',      8,  13,  7, 0, 6, 28),
  row('Melbourne',           9,  12,  7, 0, 5, 28),
  row('Port Adelaide',       10, 12,  6, 0, 6, 24),
  row('GWS Giants',          11, 12,  6, 0, 6, 24),
  row('Collingwood',         12, 12,  5, 1, 6, 22),
  row('Carlton',             13, 12,  5, 0, 7, 20),
  row('St Kilda',            14, 12,  5, 0, 7, 20),
  row('West Coast',          15, 12,  4, 0, 8, 16),
  row('North Melbourne',     16, 12,  3, 0, 9, 12),
  row('Richmond',            17, 12,  2, 0, 10, 8),
  row('Essendon',            18, 12,  1, 0, 11, 4),
];

// NRL ladder for variant (c)
const NRL_LEAGUE_TABLE: LeagueTableRow[] = [
  row('Panthers',    1,  13, 12, 0, 1, 26),
  row('Warriors',    2,  12,  9, 0, 3, 22),
  row('Roosters',    3,  12,  8, 0, 4, 20),
  row('Sea Eagles',  4,  13,  8, 0, 5, 18),
  row('Dolphins',    5,  12,  7, 0, 5, 18),
  row('Sharks',      6,  12,  7, 0, 5, 18),
  row('Knights',     7,  13,  8, 0, 5, 18),
  row('Rabbitohs',   8,  12,  6, 0, 6, 16),
  row('Cowboys',     9,  14,  8, 0, 6, 16),
  row('Storm',       10, 12,  6, 0, 6, 16),
  row('Raiders',     11, 12,  5, 0, 7, 14),
  row('Broncos',     12, 13,  5, 0, 8, 12),
  row('Bulldogs',    13, 12,  4, 0, 8, 12),
  row('Titans',      14, 12,  4, 0, 8, 12),
  row('Tigers',      15, 12,  4, 0, 8, 12),
  row('Eels',        16, 12,  4, 0, 8, 10),
  row('Dragons',     17, 13,  1, 0, 12, 4),
];

const LEAGUE_TABLES: Record<string, LeagueTableRow[]> = {
  afl: AFL_LEAGUE_TABLE,
  nrl: NRL_LEAGUE_TABLE,
};

// ── Full eval fixtures (original blind-comparison set) ──────────────────────────
const FIXTURES: Fixture[] = [
  {
    name: 'AFL — mid-season, two mid-table sides',
    note: 'Standard fixture: comparable ladder positions, mixed form.',
    input: {
      league: 'afl', teamId: 'afl-cats', opponentId: 'afl-dockers',
      teamName: 'Geelong Cats', opponentName: 'Fremantle Dockers',
      venue: 'GMHBA Stadium', isHome: true,
      teamResults: [res('Carlton', 'CAR', false, true, 92, 80), res('Sydney', 'SYD', true, false, 71, 95), res('Essendon', 'ESS', true, true, 110, 64)],
      oppResults:  [res('West Coast', 'WCE', true, true, 88, 70), res('Melbourne', 'MEL', false, false, 60, 99), res('Adelaide', 'ADL', true, true, 101, 90)],
      context: {
        teamStanding: standing('Geelong', 7, 10, 6, 0, 4, 24, { percentage: 108 }),
        opponentStanding: standing('Fremantle', 9, 10, 5, 0, 5, 20, { percentage: 99 }),
        teamManager: 'Chris Scott', opponentManager: 'Justin Longmuir',
      },
    },
  },
  {
    name: 'NRL — top vs bottom (mismatch)',
    note: 'Edge: lopsided. Ladder leader hosts the cellar-dweller.',
    input: {
      league: 'nrl', teamId: 'nrl-panthers', opponentId: 'nrl-titans',
      teamName: 'Penrith Panthers', opponentName: 'Gold Coast Titans',
      venue: 'BlueBet Stadium', isHome: true,
      teamResults: [res('Storm', 'MEL', false, true, 28, 18), res('Roosters', 'SYD', true, true, 34, 12), res('Broncos', 'BRI', true, true, 24, 20)],
      oppResults:  [res('Sharks', 'CRO', true, false, 10, 40), res('Eels', 'PAR', false, false, 16, 30), res('Knights', 'NEW', true, false, 18, 22)],
      context: {
        teamStanding: standing('Penrith', 1, 12, 11, 0, 1, 22),
        opponentStanding: standing('Gold Coast', 16, 12, 2, 0, 10, 4),
        teamManager: 'Ivan Cleary',
      },
    },
  },
  {
    name: 'EPL — title-race summit clash',
    note: 'Edge: title race + full table so the clinching logic fires.',
    input: {
      league: 'epl', teamId: 'epl-arsenal', opponentId: 'epl-mancity',
      teamName: 'Arsenal', opponentName: 'Manchester City',
      venue: 'Emirates Stadium', isHome: true,
      teamResults: [res('Liverpool', 'LIV', false, false, 1, 1, { isDraw: true }), res('Chelsea', 'CHE', true, true, 3, 1), res('Spurs', 'TOT', false, true, 2, 0)],
      oppResults:  [res('Newcastle', 'NEW', true, true, 4, 1), res('Aston Villa', 'AVL', false, true, 2, 1), res('Brighton', 'BHA', true, false, 1, 2)],
      context: {
        teamStanding: standing('Arsenal', 1, 36, 27, 4, 5, 85),
        opponentStanding: standing('Manchester City', 2, 36, 24, 6, 6, 78),
        teamManager: 'Mikel Arteta', opponentManager: 'Pep Guardiola',
        leagueTable: [
          row('Arsenal', 1, 36, 27, 4, 5, 85), row('Manchester City', 2, 36, 24, 6, 6, 78),
          row('Liverpool', 3, 36, 23, 7, 6, 76), row('Aston Villa', 4, 36, 20, 6, 10, 66),
          row('Tottenham', 5, 36, 18, 6, 12, 60),
          row('Luton Town', 18, 36, 6, 8, 22, 26), row('Burnley', 19, 36, 5, 9, 22, 24),
          row('Sheffield United', 20, 36, 3, 7, 26, 16),
        ],
      },
    },
  },
  {
    name: 'Test Rugby — Wallabies vs All Blacks',
    note: 'Edge: Test-match gravity; neutral framing of a marquee fixture.',
    input: {
      league: 'rugby_int', teamId: 'rint-wallabies', opponentId: 'rint-allblacks',
      teamName: 'Australia Wallabies', opponentName: 'New Zealand All Blacks',
      venue: 'Stadium Australia', isHome: true, competition: 'The Rugby Championship',
      teamResults: [res('South Africa', 'RSA', false, false, 17, 30), res('Argentina', 'ARG', true, true, 34, 22)],
      oppResults:  [res('Argentina', 'ARG', false, true, 38, 30), res('South Africa', 'RSA', true, false, 20, 24)],
      context: {
        teamStanding: standing('Australia', 3, 4, 1, 0, 3, 5),
        opponentStanding: standing('New Zealand', 1, 4, 3, 0, 1, 14),
      },
    },
  },
];

// ── Model invocation ────────────────────────────────────────────────────────────
interface RunResult { text: string; inputTokens: number; outputTokens: number; latencyMs: number }

async function callModel(cfg: ModelCfg, system: string, user: string): Promise<RunResult> {
  const t0 = Date.now();

  if (cfg.provider === 'ollama') {
    const client = new OpenAI({
      baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
      apiKey:  'ollama',
      timeout: 10 * 60 * 1000,
    });
    const resp = await client.chat.completions.create({
      model:      cfg.model,
      max_tokens: cfg.maxTokens ?? 4000,
      messages:   [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const latencyMs   = Date.now() - t0;
    const raw         = resp.choices[0]?.message?.content ?? '{}';
    const stripped    = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
    return {
      text:         stripped,
      inputTokens:  resp.usage?.prompt_tokens     ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  }

  if (cfg.provider === 'anthropic') {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model:       cfg.model,
      max_tokens:  MAX_TOKENS,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const latencyMs = Date.now() - t0;
    const block = resp.content.find(b => b.type === 'text') as { text?: string } | undefined;
    return { text: block?.text ?? '', inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, latencyMs };
  }

  throw new Error(`Unknown provider: ${cfg.provider}`);
}

const costUsd = (cfg: ModelCfg, inTok: number, outTok: number): number =>
  (inTok / 1e6) * cfg.inputPrice + (outTok / 1e6) * cfg.outputPrice;

function parsePreview(text: string): AIPreview | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd   = cleaned.lastIndexOf('}');
    const candidate = (jsonStart >= 0 && jsonEnd > jsonStart) ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
    return JSON.parse(candidate) as AIPreview;
  } catch { return null; }
}

/** Render an AIPreview JSON payload as readable markdown; fall back to raw text. */
function renderPreview(text: string): string {
  const p = parsePreview(text);
  if (!p?.context) return '```\n' + text.trim() + '\n```';
  const insights = (p.keyInsights ?? []).map(i => `- ${i}`).join('\n');
  return [
    `**Context.** ${p.context}`,
    `**Tactical battle.** ${p.tacticalBattle ?? ''}`,
    `**Player spotlight.** ${p.playerSpotlight ?? ''}`,
    `**Verdict.** ${p.verdict ?? ''}`,
    `**Key insights.**\n${insights}`,
  ].join('\n\n');
}

// ── Grounding audit (variant eval only) ────────────────────────────────────────
function auditGrounding(text: string, userMsg: string): { valid: boolean; fabricatedNums: string[]; groundedNums: string[] } {
  const p = parsePreview(text);
  if (!p) return { valid: false, fabricatedNums: [], groundedNums: [] };
  const REQUIRED = ['context', 'tacticalBattle', 'playerSpotlight', 'verdict', 'keyInsights'];
  const valid = REQUIRED.every(k => (p as Record<string,unknown>)[k]);
  const outNums   = [...new Set([...JSON.stringify(p).matchAll(/\b(\d{2,})\b/g)].map(m => m[1]))];
  const inNums    = new Set([...userMsg.matchAll(/\b(\d{2,})\b/g)].map(m => m[1]));
  return {
    valid,
    fabricatedNums: outNums.filter(n => !inNums.has(n)),
    groundedNums:   outNums.filter(n =>  inNums.has(n)),
  };
}

// ── Variant eval mode ──────────────────────────────────────────────────────────
async function runVariantEval(dryRun: boolean): Promise<void> {
  const variants = getVariants();
  const ollamaModels = MODELS.filter(m => m.provider === 'ollama');
  const outDir = 'eval-output';
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(outDir, `variant-eval-${stamp}.md`);
  const logPath = '/tmp/sporthouse-ai.log';

  const md: string[] = [
    '# Prompt Variant Comparison — Local Model Grounding Audit',
    '',
    `Generated ${new Date().toISOString()}`,
    `Variants: ${variants.map(v => v.label).join(' | ')}`,
    `Models: ${ollamaModels.map(m => m.label).join(', ')}`,
    '',
    '| Fixture | Model | Variant | Time (s) | Valid JSON | Fab. Nums | Quality |',
    '|---------|-------|---------|----------|------------|-----------|---------|',
  ];

  for (const fx of VARIANT_FIXTURES) {
    const leagueTable = LEAGUE_TABLES[fx.input.league];

    for (const model of ollamaModels) {
      for (const variant of variants) {
        // Build the input — add leagueTable for variant (c), omit for (a)/(b)
        const inputWithTable: PreviewPromptInput = {
          ...fx.input,
          context: {
            ...fx.input.context,
            leagueTable: variant.stripDerivedFacts ? undefined : leagueTable,
          },
        };

        const { system: _sys, user: rawUser } = buildPreviewPrompt(inputWithTable);
        const user   = variant.stripDerivedFacts ? stripDerivedFacts(rawUser) : rawUser;
        const system = variant.systemPrompt;

        const userLines = user.split('\n').length;
        console.log(`\n[${fx.name}] [${model.label}] [${variant.label}]`);
        console.log(`  System: ${system.length} chars | User: ${user.length} chars (${userLines} lines)`);

        if (dryRun) {
          md.push(`| ${fx.name} | ${model.label} | ${variant.label} | -- | -- | -- | dry-run |`);
          continue;
        }

        let result: RunResult;
        try {
          const t0 = Date.now();
          const line = `[${new Date().toISOString()}] [eval] start model=${model.model} variant=${variant.label} fixture=${fx.name}\n`;
          try { appendFileSync(logPath, line); } catch {}

          result = await callModel(model, system, user);

          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          const doneLog = `[${new Date().toISOString()}] [eval] done model=${model.model} variant=${variant.label} elapsed=${elapsed}s\n`;
          try { appendFileSync(logPath, doneLog); } catch {}
        } catch (e) {
          console.error(`  ✗ ERROR: ${(e as Error).message}`);
          md.push(`| ${fx.name} | ${model.label} | ${variant.label} | ERR | -- | -- | ERROR: ${(e as Error).message.slice(0, 40)} |`);
          continue;
        }

        const audit   = auditGrounding(result.text, user);
        const elapsed = (result.latencyMs / 1000).toFixed(1);
        const verdict = !audit.valid
          ? 'INVALID JSON'
          : audit.fabricatedNums.length > 0
            ? `FAIL (fab: ${audit.fabricatedNums.join(', ')})`
            : 'PASS';

        console.log(`  ✓ ${elapsed}s | valid=${audit.valid} | fab=[${audit.fabricatedNums.join(',')}]`);
        console.log(`  Output preview: ${result.text.slice(0, 200)}`);

        md.push(`| ${fx.name.slice(0, 40)} | ${model.label} | ${variant.label} | ${elapsed} | ${audit.valid ? 'YES' : 'NO'} | ${audit.fabricatedNums.length} (${audit.fabricatedNums.slice(0,4).join(',')}) | ${verdict} |`);

        // Full output section in the doc
        md.push('', `<details><summary>${fx.name} | ${model.label} | ${variant.label}</summary>`, '');
        md.push('**User data block (first 30 lines):**', '```');
        md.push(...user.split('\n').slice(0, 30));
        md.push('```', '');
        md.push('**Model output:**', '```json');
        md.push(result.text.slice(0, 2000));
        md.push('```', '', '</details>', '');
      }
    }
  }

  writeFileSync(outPath, md.join('\n'));
  console.log(`\nVariant eval saved to ${outPath}`);
}

// ── Blind comparison mode (original) ──────────────────────────────────────────
interface Totals { inTok: number; outTok: number; cost: number; latency: number; n: number }

async function runBlindComparison(dryRun: boolean, localOnly: boolean): Promise<void> {
  loadEnvLocal();
  const models = localOnly ? MODELS.filter(m => m.provider === 'ollama') : MODELS;

  if (!dryRun && !localOnly && !process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY not set. Use --dry-run or --local-only.');
    process.exit(1);
  }

  let seed = 20260530;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const outDir = 'eval-output';
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const artifactPath = join(outDir, `preview-eval-${stamp}.md`);
  const keyPath = join(outDir, `preview-eval-${stamp}.key.json`);

  const md: string[] = [];
  const key: Array<{ fixture: string; A: string; B: string }> = [];
  const totals: Record<string, Totals> = {};
  for (const m of models) totals[m.label] = { inTok: 0, outTok: 0, cost: 0, latency: 0, n: 0 };

  md.push('# AI Match-Preview — Blind Model Comparison', '',
    `Generated ${new Date().toISOString()} · models: ${models.map(m => m.label).join(' vs ')} · ` +
    `samples/model=${SAMPLES}`, '', '---', '');

  for (const fx of FIXTURES) {
    const { system, user } = buildPreviewPrompt(fx.input);
    md.push(`## ${fx.name}`, '', `*${fx.note}*`, '');

    if (dryRun) {
      md.push(`_dry-run: system ${system.length} chars, user ${user.length} chars_`, '', '---', '');
      console.log(`[dry-run] ${fx.name}: system ${system.length} / user ${user.length} chars`);
      continue;
    }

    const display: Record<string, string> = {};
    for (const m of models) {
      for (let s = 0; s < SAMPLES; s++) {
        let r: RunResult;
        try { r = await callModel(m, system, user); }
        catch (err) {
          r = { text: `[ERROR: ${(err as Error).message}]`, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
        }
        const t = totals[m.label];
        t.inTok += r.inputTokens; t.outTok += r.outputTokens;
        t.cost += costUsd(m, r.inputTokens, r.outputTokens);
        t.latency += r.latencyMs; t.n += 1;
        if (s === 0) display[m.label] = r.text;
      }
      console.log(`  ✓ ${m.label} · ${fx.name}`);
    }

    if (models.length >= 2) {
      const ordered = rnd() < 0.5 ? [models[0], models[1]] : [models[1], models[0]];
      md.push('### Option A', '', renderPreview(display[ordered[0].label]), '');
      md.push('### Option B', '', renderPreview(display[ordered[1].label]), '');
      key.push({ fixture: fx.name, A: ordered[0].label, B: ordered[1].label });
    } else {
      md.push('### Output', '', renderPreview(display[models[0].label]), '');
    }
    md.push('---', '');
  }

  md.push('## Cost / latency summary', '');
  md.push('| Model | calls | input tok | output tok | cost (USD) | avg latency |');
  md.push('|---|---:|---:|---:|---:|---:|');
  for (const m of models) {
    const t = totals[m.label];
    md.push(`| ${m.label} | ${t.n} | ${t.inTok.toLocaleString()} | ${t.outTok.toLocaleString()} | $${t.cost.toFixed(4)} | ${t.n ? Math.round(t.latency / t.n) : 0} ms |`);
  }

  if (!dryRun) writeFileSync(keyPath, JSON.stringify(key, null, 2) + '\n');
  writeFileSync(artifactPath, md.join('\n'));
  console.log(`\nArtifact: ${artifactPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnvLocal();
  const dryRun     = process.argv.includes('--dry-run');
  const variantEval = process.argv.includes('--variant-eval');
  const localOnly  = process.argv.includes('--local-only');

  if (variantEval) {
    await runVariantEval(dryRun);
  } else {
    await runBlindComparison(dryRun, localOnly);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
