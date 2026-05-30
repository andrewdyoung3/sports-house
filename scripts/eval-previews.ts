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
 * ⚠️  This calls the REAL Anthropic API (small cost — cents) and requires
 *     ANTHROPIC_API_KEY (read from process.env, falling back to .env.local).
 *
 * Run:
 *   npx tsx scripts/eval-previews.ts             # real run — calls the API
 *   npx tsx scripts/eval-previews.ts --dry-run   # build prompts only, no API calls
 *   EVAL_SAMPLES=2 npx tsx scripts/eval-previews.ts   # 2 samples/model for variance
 *
 * Adding a third (e.g. local) model later: add an entry to MODELS and, if it isn't
 * Anthropic, add a branch in callModel() for its provider.
 */

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreviewPrompt, type PreviewPromptInput } from '@/lib/preview-prompt';
import type { AIPreview, GameResult, LeagueTableRow, TeamStanding } from '@/types';

// ── Env: load ANTHROPIC_API_KEY from .env.local if not already in the environment ──
function loadEnvLocal(): void {
  if (process.env.ANTHROPIC_API_KEY || !existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ── Model registry ────────────────────────────────────────────────────────────
// inputPrice/outputPrice are USD per 1M tokens. APPROXIMATE — confirm against current
// Anthropic pricing before quoting absolute dollars; the ratio is what matters for a
// relative comparison. `provider` is the extension point for a future local model.
interface ModelCfg {
  label: string;
  model: string;
  provider: 'anthropic' | 'local';
  inputPrice: number;
  outputPrice: number;
}
const MODELS: ModelCfg[] = [
  { label: 'sonnet-4-6', model: 'claude-sonnet-4-6', provider: 'anthropic', inputPrice: 3.0, outputPrice: 15.0 },
  { label: 'haiku-4-5',  model: 'claude-haiku-4-5',  provider: 'anthropic', inputPrice: 1.0, outputPrice: 5.0 },
  // Future: { label: 'local-qwen-7b', model: 'qwen2.5:7b', provider: 'local', inputPrice: 0, outputPrice: 0 },
];

// Eval params — fixed for reproducibility. Production leaves temperature at the API
// default; we pin temperature: 0 here so reruns are comparable. max_tokens matches
// production's non-compact default (800).
const SAMPLES    = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 1)); // samples/model/fixture
const MAX_TOKENS = 800;
const TEMPERATURE = 0;

// ── Fixture builders ────────────────────────────────────────────────────────────
let dateCounter = 0;
const ago = (): string => {
  dateCounter += 7;
  return new Date(Date.now() - dateCounter * 86_400_000).toISOString();
};
const res = (
  opponent: string, opponentAbbr: string, isHome: boolean, isWin: boolean,
  teamScore: number, opponentScore: number, extra: Partial<GameResult> = {},
): GameResult => ({ opponent, opponentAbbr, isHome, isWin, teamScore, opponentScore, date: ago(), ...extra });

const standing = (
  name: string, position: number, played: number, wins: number, draws: number, losses: number,
  points: number, extra: Partial<TeamStanding> = {},
): TeamStanding => ({ name, position, played, wins, draws, losses, points, ...extra });

const row = (
  name: string, position: number, played: number, wins: number, draws: number, losses: number, points: number,
): LeagueTableRow => ({ name, position, played, wins, draws, losses, points });

interface Fixture { name: string; note: string; input: PreviewPromptInput }

// ── Curated fixtures: AFL / NRL / EPL / Super Rugby / Test Rugby / F1 / cricket ──
// plus edge cases: derby, mismatch, finals, title clinch, relegation, early-season
// (no form), neutral venue, Test-match magnitude.
const FIXTURES: Fixture[] = [
  {
    name: 'AFL — mid-season, two mid-table sides',
    note: 'Standard fixture: comparable ladder positions, mixed form.',
    input: {
      league: 'afl', teamId: 'afl-cats', opponentId: 'afl-dockers',
      teamName: 'Geelong Cats', opponentName: 'Fremantle Dockers',
      venue: 'GMHBA Stadium', isHome: true, competition: 'AFL',
      teamResults: [res('Carlton', 'CAR', false, true, 92, 80), res('Sydney', 'SYD', true, false, 71, 95), res('Essendon', 'ESS', true, true, 110, 64)],
      oppResults: [res('West Coast', 'WCE', true, true, 88, 70), res('Melbourne', 'MEL', false, false, 60, 99), res('Adelaide', 'ADL', true, true, 101, 90)],
      context: {
        teamStanding: standing('Geelong', 7, 10, 6, 0, 4, 24, { percentage: 108 }),
        opponentStanding: standing('Fremantle', 9, 10, 5, 0, 5, 20, { percentage: 99 }),
        teamManager: 'Chris Scott', opponentManager: 'Justin Longmuir',
      },
    },
  },
  {
    name: 'AFL — derby (same-city rivals)',
    note: 'Edge: derby. Two Melbourne clubs, recent head-to-head edge.',
    input: {
      league: 'afl', teamId: 'afl-pies', opponentId: 'afl-blues',
      teamName: 'Collingwood Magpies', opponentName: 'Carlton Blues',
      venue: 'MCG', isHome: true, competition: 'AFL',
      teamResults: [res('Carlton', 'CAR', false, true, 89, 84), res('Richmond', 'RIC', true, true, 120, 75)],
      oppResults: [res('Collingwood', 'COL', true, false, 84, 89), res('Brisbane', 'BRI', false, true, 96, 90)],
      context: {
        teamStanding: standing('Collingwood', 3, 10, 8, 0, 2, 32, { percentage: 121 }),
        opponentStanding: standing('Carlton', 6, 10, 6, 0, 4, 24, { percentage: 110 }),
        teamManager: 'Craig McRae', opponentManager: 'Michael Voss',
      },
    },
  },
  {
    name: 'NRL — top vs bottom (mismatch)',
    note: 'Edge: lopsided. Ladder leader hosts the cellar-dweller.',
    input: {
      league: 'nrl', teamId: 'nrl-panthers', opponentId: 'nrl-titans',
      teamName: 'Penrith Panthers', opponentName: 'Gold Coast Titans',
      venue: 'BlueBet Stadium', isHome: true, competition: 'NRL',
      teamResults: [res('Storm', 'MEL', false, true, 28, 18), res('Roosters', 'SYD', true, true, 34, 12), res('Broncos', 'BRI', true, true, 24, 20)],
      oppResults: [res('Sharks', 'CRO', true, false, 10, 40), res('Eels', 'PAR', false, false, 16, 30), res('Knights', 'NEW', true, false, 18, 22)],
      context: {
        teamStanding: standing('Penrith', 1, 12, 11, 0, 1, 22),
        opponentStanding: standing('Gold Coast', 16, 12, 2, 0, 10, 4),
        teamManager: 'Ivan Cleary',
      },
    },
  },
  {
    name: 'NRL — finals (do-or-die)',
    note: 'Edge: finals stakes. Knockout, no margin for error.',
    input: {
      league: 'nrl', teamId: 'nrl-storm', opponentId: 'nrl-roosters',
      teamName: 'Melbourne Storm', opponentName: 'Sydney Roosters',
      venue: 'AAMI Park', isHome: true, competition: 'NRL Finals Week 1',
      teamResults: [res('Panthers', 'PEN', true, false, 18, 28), res('Sharks', 'CRO', false, true, 26, 14), res('Cowboys', 'NQC', true, true, 32, 6)],
      oppResults: [res('Rabbitohs', 'SOU', true, true, 30, 12), res('Sea Eagles', 'MAN', false, true, 22, 20), res('Broncos', 'BRI', true, false, 16, 24)],
      context: {
        teamStanding: standing('Melbourne', 2, 24, 17, 0, 7, 34),
        opponentStanding: standing('Sydney Roosters', 6, 24, 14, 0, 10, 28),
        teamManager: 'Craig Bellamy', opponentManager: 'Trent Robinson',
      },
    },
  },
  {
    name: 'EPL — title-race summit clash (with clinch maths)',
    note: 'Edge: title race + a full table so the clinching logic fires.',
    input: {
      league: 'epl', teamId: 'epl-arsenal', opponentId: 'epl-mancity',
      teamName: 'Arsenal', opponentName: 'Manchester City',
      venue: 'Emirates Stadium', isHome: true, competition: 'Premier League',
      teamResults: [res('Liverpool', 'LIV', false, false, 1, 1, { isDraw: true }), res('Chelsea', 'CHE', true, true, 3, 1), res('Spurs', 'TOT', false, true, 2, 0)],
      oppResults: [res('Newcastle', 'NEW', true, true, 4, 1), res('Aston Villa', 'AVL', false, true, 2, 1), res('Brighton', 'BHA', true, false, 1, 2)],
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
    name: 'EPL — relegation six-pointer',
    note: 'Edge: relegation scrap at the foot of the table.',
    input: {
      league: 'epl', teamId: 'epl-burnley', opponentId: 'epl-luton',
      teamName: 'Burnley', opponentName: 'Luton Town',
      venue: 'Turf Moor', isHome: true, competition: 'Premier League',
      teamResults: [res('Everton', 'EVE', false, false, 0, 2), res('Fulham', 'FUL', true, false, 1, 1, { isDraw: true }), res('Wolves', 'WOL', false, false, 1, 3)],
      oppResults: [res('Brentford', 'BRE', true, true, 2, 1), res('Crystal Palace', 'CRY', false, false, 0, 1), res('West Ham', 'WHU', true, false, 1, 2)],
      context: {
        teamStanding: standing('Burnley', 19, 35, 5, 9, 21, 24),
        opponentStanding: standing('Luton Town', 18, 35, 6, 7, 22, 25),
        teamManager: 'Vincent Kompany', opponentManager: 'Rob Edwards',
      },
    },
  },
  {
    name: 'EPL — early season, no form yet',
    note: 'Edge: small sample. Round 2, almost no results — the prompt must avoid hedging.',
    input: {
      league: 'epl', teamId: 'epl-chelsea', opponentId: 'epl-newcastle',
      teamName: 'Chelsea', opponentName: 'Newcastle United',
      venue: 'Stamford Bridge', isHome: true, competition: 'Premier League',
      teamResults: [res('Manchester City', 'MCI', false, false, 0, 2)],
      oppResults: [res('Southampton', 'SOU', true, true, 1, 0)],
      context: {
        teamStanding: standing('Chelsea', 14, 1, 0, 0, 1, 0),
        opponentStanding: standing('Newcastle United', 6, 1, 1, 0, 0, 3),
        teamManager: 'Enzo Maresca', opponentManager: 'Eddie Howe',
      },
    },
  },
  {
    name: 'Super Rugby — mid-table clash',
    note: 'Rugby union vocabulary; trans-Tasman fixture.',
    input: {
      league: 'super_rugby', teamId: 'sru-reds', opponentId: 'sru-crusaders',
      teamName: 'Queensland Reds', opponentName: 'Crusaders',
      venue: 'Suncorp Stadium', isHome: true, competition: 'Super Rugby Pacific',
      teamResults: [res('Brumbies', 'BRU', false, false, 19, 24), res('Waratahs', 'WAR', true, true, 33, 21)],
      oppResults: [res('Chiefs', 'CHI', true, true, 28, 17), res('Blues', 'BLU', false, false, 15, 20)],
      context: {
        teamStanding: standing('Queensland Reds', 6, 11, 6, 0, 5, 29),
        opponentStanding: standing('Crusaders', 4, 11, 7, 0, 4, 34),
      },
    },
  },
  {
    name: 'Test Rugby — international (magnitude)',
    note: 'Edge: Test-match gravity; neutral framing of a marquee fixture.',
    input: {
      league: 'rugby_int', teamId: 'rint-wallabies', opponentId: 'rint-allblacks',
      teamName: 'Australia Wallabies', opponentName: 'New Zealand All Blacks',
      venue: 'Stadium Australia', isHome: true, competition: 'The Rugby Championship',
      teamResults: [res('South Africa', 'RSA', false, false, 17, 30), res('Argentina', 'ARG', true, true, 34, 22)],
      oppResults: [res('Argentina', 'ARG', false, true, 38, 30), res('South Africa', 'RSA', true, false, 20, 24)],
      context: {
        teamStanding: standing('Australia', 3, 4, 1, 0, 3, 5),
        opponentStanding: standing('New Zealand', 1, 4, 3, 0, 1, 14),
      },
    },
  },
  {
    name: 'F1 — race weekend (driver POV)',
    note: 'Edge: completely different data model (buildF1DataBlock + 2026 regs).',
    input: {
      league: 'f1', teamId: 'f1_ver', opponentId: undefined,
      teamName: 'Max Verstappen', opponentName: 'Japanese Grand Prix',
      venue: 'Suzuka Circuit', competition: 'Race',
      teamResults: [res('Bahrain GP', 'BHR', false, true, 0, 0, { f1Position: 'P1' }), res('Saudi GP', 'SAU', false, false, 0, 0, { f1Position: 'P4' })],
      oppResults: [],
      context: {
        f1FollowedType: 'driver', f1FollowedName: 'Max Verstappen', f1FollowedConstructorName: 'Red Bull',
        f1SessionType: 'Race', f1RaceName: 'Japanese Grand Prix', f1CircuitName: 'Suzuka Circuit', f1RoundNumber: 4,
        f1DriverStandings: [
          { position: 1, driverName: 'Lando Norris', constructorName: 'McLaren', points: 77, wins: 2, ergastDriverId: 'norris' },
          { position: 2, driverName: 'Max Verstappen', constructorName: 'Red Bull', points: 69, wins: 1, ergastDriverId: 'max_verstappen' },
          { position: 3, driverName: 'Charles Leclerc', constructorName: 'Ferrari', points: 61, wins: 1, ergastDriverId: 'leclerc' },
        ],
        f1ConstructorStandings: [
          { position: 1, constructorName: 'McLaren', points: 140, wins: 2 },
          { position: 2, constructorName: 'Ferrari', points: 112, wins: 1 },
          { position: 3, constructorName: 'Red Bull', points: 101, wins: 1 },
        ],
        f1RecentRaceResults: [
          { round: 3, raceName: 'Saudi Arabian Grand Prix', results: [
            { position: 1, driverName: 'Lando Norris', constructorName: 'McLaren', ergastDriverId: 'norris' },
            { position: 2, driverName: 'Charles Leclerc', constructorName: 'Ferrari', ergastDriverId: 'leclerc' },
            { position: 3, driverName: 'Oscar Piastri', constructorName: 'McLaren', ergastDriverId: 'piastri' },
          ] },
        ],
      },
    },
  },
  {
    name: 'NRL — State of Origin (neutral-venue edge)',
    note: 'Edge: representative series game flagged at a neutral venue.',
    input: {
      league: 'nrl', teamId: 'nrl-maroons', opponentId: 'nrl-blues',
      teamName: 'Queensland Maroons', opponentName: 'NSW Blues',
      venue: 'Optus Stadium', isHome: false, competition: 'State of Origin — Game 1',
      teamResults: [res('NSW Blues', 'NSW', true, false, 10, 18)],
      oppResults: [res('Queensland Maroons', 'QLD', false, true, 18, 10)],
      context: {},
    },
  },
  {
    name: 'Cricket (BBL) — NOT a production AI-preview league',
    note: 'Edge: unsupported league. Exercises the generic path (no SPORT_CONTEXT entry); production never previews cricket.',
    input: {
      league: 'bbl', teamId: 'bbl-heat', opponentId: 'bbl-sixers',
      teamName: 'Brisbane Heat', opponentName: 'Sydney Sixers',
      venue: 'The Gabba', isHome: true, competition: 'Big Bash League',
      teamResults: [res('Sydney Sixers', 'SIX', false, true, 0, 0, { cricketFormat: 't20', cricketResult: 'Won by 7 wickets' })],
      oppResults: [res('Brisbane Heat', 'HEA', true, false, 0, 0, { cricketFormat: 't20', cricketResult: 'Lost by 7 wickets' })],
      context: {},
    },
  },
];

// ── Model invocation ────────────────────────────────────────────────────────────
interface RunResult { text: string; inputTokens: number; outputTokens: number; latencyMs: number }

async function callModel(cfg: ModelCfg, system: string, user: string): Promise<RunResult> {
  if (cfg.provider !== 'anthropic') {
    // Extension point: a local model (Ollama/MLX) would be invoked here.
    throw new Error(`provider '${cfg.provider}' not implemented in this eval`);
  }
  const client = new Anthropic();
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const latencyMs = Date.now() - t0;
  const block = resp.content.find(b => b.type === 'text') as { text?: string } | undefined;
  return { text: block?.text ?? '', inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, latencyMs };
}

const costUsd = (cfg: ModelCfg, inTok: number, outTok: number): number =>
  (inTok / 1e6) * cfg.inputPrice + (outTok / 1e6) * cfg.outputPrice;

/** Render an AIPreview JSON payload as readable markdown; fall back to raw text. */
function renderPreview(text: string): string {
  let p: AIPreview | null = null;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    p = JSON.parse(cleaned) as AIPreview;
  } catch { /* fall through to raw */ }
  if (!p || !p.context) return '```\n' + text.trim() + '\n```';
  const insights = (p.keyInsights ?? []).map(i => `- ${i}`).join('\n');
  return [
    `**Context.** ${p.context}`,
    `**Tactical battle.** ${p.tacticalBattle ?? ''}`,
    `**Player spotlight.** ${p.playerSpotlight ?? ''}`,
    `**Verdict.** ${p.verdict ?? ''}`,
    `**Key insights.**\n${insights}`,
  ].join('\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface Totals { inTok: number; outTok: number; cost: number; latency: number; n: number }

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  loadEnvLocal();
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY not set (env or .env.local). Use --dry-run to build prompts only.');
    process.exit(1);
  }

  // Seeded RNG so the A/B ordering is reproducible across runs.
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
  for (const m of MODELS) totals[m.label] = { inTok: 0, outTok: 0, cost: 0, latency: 0, n: 0 };

  md.push(
    '# AI Match-Preview — Blind Model Comparison',
    '',
    `Generated ${new Date().toISOString()} · models: ${MODELS.map(m => m.label).join(' vs ')} · ` +
    `samples/model=${SAMPLES} · temperature=${TEMPERATURE} · max_tokens=${MAX_TOKENS}`,
    '',
    'Each fixture below shows two previews as **Option A / Option B**, anonymized and ' +
    'order-randomized so you can judge quality without knowing which model produced which. ' +
    `The mapping lives in a separate key file: \`${keyPath}\` — read it only after judging.`,
    '', '---', '',
  );

  for (const fx of FIXTURES) {
    const { system, user } = buildPreviewPrompt(fx.input);
    md.push(`## ${fx.name}`, '', `*${fx.note}*`, '');

    if (dryRun) {
      md.push(`_dry-run: prompt assembled OK — system ${system.length} chars, user ${user.length} chars; no model call._`, '', '---', '');
      console.log(`[dry-run] ${fx.name}: system ${system.length} / user ${user.length} chars`);
      continue;
    }

    const display: Record<string, string> = {};
    for (const m of MODELS) {
      for (let s = 0; s < SAMPLES; s++) {
        let r: RunResult;
        try {
          r = await callModel(m, system, user);
        } catch (err) {
          console.error(`  ✗ ${m.label} failed on "${fx.name}":`, (err as Error).message);
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

    // Randomize which model is shown as A vs B for this fixture.
    const ordered = rnd() < 0.5 ? [MODELS[0], MODELS[1]] : [MODELS[1], MODELS[0]];
    md.push('### Option A', '', renderPreview(display[ordered[0].label]), '');
    md.push('### Option B', '', renderPreview(display[ordered[1].label]), '');
    key.push({ fixture: fx.name, A: ordered[0].label, B: ordered[1].label });
    md.push('---', '');
  }

  // ── Summary table ──
  md.push('## Cost / latency summary', '');
  md.push('| Model | calls | input tok | output tok | total cost (USD)¹ | avg latency |');
  md.push('|---|---:|---:|---:|---:|---:|');
  for (const m of MODELS) {
    const t = totals[m.label];
    md.push(
      `| ${m.label} (\`${m.model}\`) | ${t.n} | ${t.inTok.toLocaleString()} | ${t.outTok.toLocaleString()} | ` +
      `$${t.cost.toFixed(4)} | ${t.n ? Math.round(t.latency / t.n) : 0} ms |`,
    );
  }
  md.push('', '¹ Prices are approximate ($/1M tokens, see MODELS in the script) — confirm against current Anthropic pricing.', '');

  if (!dryRun) {
    writeFileSync(keyPath, JSON.stringify(key, null, 2) + '\n');
  }
  writeFileSync(artifactPath, md.join('\n'));

  console.log('\n── Summary ──');
  for (const m of MODELS) {
    const t = totals[m.label];
    console.log(`${m.label.padEnd(12)} calls=${t.n}  in=${t.inTok}  out=${t.outTok}  cost=$${t.cost.toFixed(4)}  avgLatency=${t.n ? Math.round(t.latency / t.n) : 0}ms`);
  }
  console.log(`\nArtifact: ${artifactPath}`);
  if (!dryRun) console.log(`Key:      ${keyPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
