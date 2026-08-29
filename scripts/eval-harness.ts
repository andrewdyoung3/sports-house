#!/usr/bin/env tsx
/**
 * scripts/eval-harness.ts — Phase 0 evaluation harness.
 *
 * Loads frozen corpus snapshots and runs the current model N times per
 * fixture, measuring validator violation rates, retry-survival, drop rate,
 * section coverage, and generation timing.
 *
 * The harness uses the corpus entry's own systemPrompt + previewPrompt
 * verbatim — so results measure the prompt as it was at snapshot time, not
 * any live edits made since. Re-snapshot (snapshot-corpus.ts) to pick up
 * prompt changes.
 *
 * Usage:
 *   npx tsx scripts/eval-harness.ts [corpus/<id>.json ...] [options]
 *
 * Options:
 *   --runs <n>          Rounds per fixture (default: 3)
 *   --model <name>      Model override (default: AI_MODEL from ai-model.ts)
 *   --scenario <label>  Only run fixtures with this scenario label
 *   --out <path>        Write JSON report to this path (default: none)
 *   --concurrency <n>   Parallel fixture runs (default: 1; keep low — Ollama is single-threaded)
 *
 * Examples:
 *   npx tsx scripts/eval-harness.ts                              # all corpus entries, 3 runs each
 *   npx tsx scripts/eval-harness.ts corpus/afl-38699.json --runs 5
 *   npx tsx scripts/eval-harness.ts --scenario band-boundary --runs 10
 *   npx tsx scripts/eval-harness.ts --runs 5 --out eval-output/baseline.json
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import OpenAI from 'openai';

// ─── Env loading ──────────────────────────────────────────────────────────────

try {
  const content = readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
} catch { /* env set externally */ }

import { AI_MODEL } from '@/lib/ai-model';
import { collectViolations } from '@/lib/preview-generator';
import type { AIPreview } from '@/types';

// ─── Ollama client ────────────────────────────────────────────────────────────

const ollamaClient = new OpenAI({
  apiKey:  'ollama',
  baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
});

// ─── Corpus entry (matches snapshot-corpus.ts CorpusEntry) ───────────────────

interface CorpusEntry {
  id: string;
  league: string;
  teamName: string;
  opponent: string;
  date: string;
  venue: string;
  isHome: boolean;
  competition?: string;
  completed: boolean;
  scenario: string;
  snapshotAt: string;
  systemPrompt: string;
  previewPrompt: string;
  reviewSystemPrompt?: string;
  reviewPrompt?: string;
  scores?: { team: number; opponent: number };
  contextSummary: {
    teamPosition?: number;
    opponentPosition?: number;
    tableLength: number;
    hasTeamForm: boolean;
    hasOpponentForm: boolean;
    hasHeadToHead: boolean;
    hasTeamLineup: boolean;
    hasOpponentLineup: boolean;
    hasWeather: boolean;
    hasCricketContext: boolean;
    hasSeriesState: boolean;
    teamManager?: string;
    opponentManager?: string;
  };
}

// ─── Harness types ────────────────────────────────────────────────────────────

interface SectionCoverage {
  context: boolean;
  tacticalBattle: boolean;
  playerSpotlight: boolean;
  verdict: boolean;
  keyInsights: boolean;
  mediaWatch: boolean;
}

const SECTIONS = ['context','tacticalBattle','playerSpotlight','verdict','keyInsights','mediaWatch'] as const;
type Section = typeof SECTIONS[number];

interface RoundResult {
  firstPassViolations: string[];
  retryViolations: string[] | null; // null = no retry needed
  sections: SectionCoverage;
  elapsedMs: number;
  parseError: boolean;
}

interface FixtureResult {
  id: string;
  scenario: string;
  league: string;
  teamName: string;
  opponent: string;
  runs: number;
  // Outcome tallies
  passRuns: number;
  dropRuns: number;
  parseErrorRuns: number;
  firstPassViolationRuns: number;
  retrySuccessRuns: number;
  // Violations: firstPass = appeared on first shot; survived = still present after retry
  violationsByValidator: Record<string, { firstPass: number; survived: number }>;
  // Section coverage: count of runs where section was non-empty
  sectionCoverage: Record<Section, number>;
  // Timing
  timingMs: number[];
}

// ─── Parse helper (mirrors callOllamaValidated's inner doGenerate) ────────────

function parseModelOutput(raw: string): AIPreview {
  const withoutThink = raw.includes('</think>')
    ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '')
    : raw;
  const cleaned = withoutThink
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try {
    return JSON.parse(cleaned) as AIPreview;
  } catch {
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd   = cleaned.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as AIPreview;
    }
    throw new SyntaxError(`Non-JSON model output (len=${raw.length})`);
  }
}

// ─── Single Ollama call ───────────────────────────────────────────────────────

async function singleCall(systemPrompt: string, dataPrompt: string, model: string): Promise<AIPreview> {
  const response = await ollamaClient.chat.completions.create({
    model,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: dataPrompt },
    ],
  });
  const raw = response.choices[0]?.message?.content ?? '{}';
  return parseModelOutput(raw);
}

// ─── Section coverage ─────────────────────────────────────────────────────────

function measureSections(preview: AIPreview): SectionCoverage {
  return {
    context:         typeof preview.context        === 'string'  && preview.context.length > 0,
    tacticalBattle:  typeof preview.tacticalBattle === 'string'  && preview.tacticalBattle.length > 0,
    playerSpotlight: typeof preview.playerSpotlight=== 'string'  && preview.playerSpotlight.length > 0,
    verdict:         typeof preview.verdict        === 'string'  && preview.verdict.length > 0,
    keyInsights:     Array.isArray(preview.keyInsights)          && preview.keyInsights.length > 0,
    mediaWatch:      Array.isArray(preview.mediaWatch)           && preview.mediaWatch.length > 0,
  };
}

// ─── Extract validator name from violation string ─────────────────────────────

// Violations are prefixed "[validatorName]" in production, but the current
// validators return plain strings. We normalise by matching known validator
// names that appear literally in the violation messages, falling back to
// "unknown".
const VALIDATOR_PREFIXES: [RegExp, string][] = [
  [/points?|pts|pct|percentage|proportion|direction|expert/i, 'validatePointsClaims'],
  [/finals.immin|looming|must.win|crunch|title race|relegation battle/i, 'validateFinalsImminence'],
  [/phase|stage|stakes|regular.season|dead.rubber/i, 'validatePhaseStakes'],
  [/ladder|position|place|ranked|th on/i, 'validateLadderPosition'],
  [/f1|champion.+gap|championship.+lead|point.+lead/i, 'validateF1ChampionshipClaims'],
  [/player|squad|whitelist|name/i, 'validatePlayerNames'],
  [/statline|stat.line|tackles|tries|goals|rebounds|assists|carries/i, 'validateInventedStatlines'],
  [/year|\d{4}|since|streak/i, 'validateInventedYears'],
];

function classifyViolation(msg: string): string {
  for (const [re, name] of VALIDATOR_PREFIXES) {
    if (re.test(msg)) return name;
  }
  return 'unknown';
}

// ─── Run one round ────────────────────────────────────────────────────────────

async function runOneRound(
  systemPrompt: string,
  dataPrompt: string,
  model: string,
): Promise<RoundResult> {
  const t0 = Date.now();
  let parseError = false;
  let firstPassPreview: AIPreview;
  let firstPassViolations: string[];

  // First attempt
  try {
    firstPassPreview = await singleCall(systemPrompt, dataPrompt, model);
  } catch (e) {
    // Parse error on first attempt — retry the call once (same as callOllamaValidated)
    try {
      firstPassPreview = await singleCall(systemPrompt, dataPrompt, model);
    } catch {
      parseError = true;
      return {
        firstPassViolations: ['PARSE_ERROR'],
        retryViolations: null,
        sections: { context: false, tacticalBattle: false, playerSpotlight: false, verdict: false, keyInsights: false, mediaWatch: false },
        elapsedMs: Date.now() - t0,
        parseError: true,
      };
    }
  }

  firstPassViolations = collectViolations(firstPassPreview, dataPrompt);

  // No violations on first pass
  if (firstPassViolations.length === 0) {
    return {
      firstPassViolations: [],
      retryViolations: null,
      sections: measureSections(firstPassPreview),
      elapsedMs: Date.now() - t0,
      parseError,
    };
  }

  // Retry pass
  let retryViolations: string[];
  try {
    const retryPreview = await singleCall(systemPrompt, dataPrompt, model);
    retryViolations = collectViolations(retryPreview, dataPrompt);
    return {
      firstPassViolations,
      retryViolations,
      sections: measureSections(retryPreview),
      elapsedMs: Date.now() - t0,
      parseError,
    };
  } catch {
    // Retry also parse-failed
    return {
      firstPassViolations,
      retryViolations: firstPassViolations, // treat as survived
      sections: measureSections(firstPassPreview),
      elapsedMs: Date.now() - t0,
      parseError: true,
    };
  }
}

// ─── Aggregate rounds into FixtureResult ──────────────────────────────────────

function aggregateRounds(entry: CorpusEntry, rounds: RoundResult[]): FixtureResult {
  const violMap: Record<string, { firstPass: number; survived: number }> = {};
  const coverage: Record<Section, number> = { context: 0, tacticalBattle: 0, playerSpotlight: 0, verdict: 0, keyInsights: 0, mediaWatch: 0 };

  let passRuns = 0, dropRuns = 0, parseErrorRuns = 0, firstPassViolationRuns = 0, retrySuccessRuns = 0;

  for (const r of rounds) {
    if (r.parseError && r.retryViolations === null && r.firstPassViolations.includes('PARSE_ERROR')) {
      parseErrorRuns++;
      dropRuns++;
      continue;
    }

    const hadViol = r.firstPassViolations.length > 0;
    const retried = r.retryViolations !== null;
    const survived = retried ? r.retryViolations!.length > 0 : false;

    if (hadViol) firstPassViolationRuns++;
    if (hadViol && retried && !survived) retrySuccessRuns++;
    if (survived) dropRuns++;
    else passRuns++;

    // Record first-pass violations
    for (const v of r.firstPassViolations) {
      const key = classifyViolation(v);
      if (!violMap[key]) violMap[key] = { firstPass: 0, survived: 0 };
      violMap[key].firstPass++;
    }
    // Record survived violations
    for (const v of (r.retryViolations ?? [])) {
      const key = classifyViolation(v);
      if (!violMap[key]) violMap[key] = { firstPass: 0, survived: 0 };
      violMap[key].survived++;
    }

    // Section coverage
    for (const s of SECTIONS) {
      if (r.sections[s]) coverage[s]++;
    }
  }

  return {
    id:       entry.id,
    scenario: entry.scenario,
    league:   entry.league,
    teamName: entry.teamName,
    opponent: entry.opponent,
    runs:     rounds.length,
    passRuns, dropRuns, parseErrorRuns, firstPassViolationRuns, retrySuccessRuns,
    violationsByValidator: violMap,
    sectionCoverage: coverage,
    timingMs: rounds.map(r => r.elapsedMs),
  };
}

// ─── Print helpers ────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return '  —';
  return `${Math.round(100 * n / d).toString().padStart(3)}%`;
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function p95(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function printFixtureResult(r: FixtureResult, verbose: boolean) {
  const header = `${r.id} | ${r.teamName} vs ${r.opponent} | ${r.scenario}`;
  console.log(`\n─── ${header} ${'─'.repeat(Math.max(0, 72 - header.length))}`);
  console.log(`  league: ${r.league}   runs: ${r.runs}   pass: ${r.passRuns}/${r.runs}   drop: ${r.dropRuns}/${r.runs}${r.parseErrorRuns ? `   parse-err: ${r.parseErrorRuns}` : ''}`);

  if (r.firstPassViolationRuns > 0) {
    console.log(`  first-pass violations: ${r.firstPassViolationRuns}/${r.runs} runs (${pct(r.firstPassViolationRuns, r.runs).trim()} triggered retry)`);
    console.log(`  retry success:         ${r.retrySuccessRuns}/${r.firstPassViolationRuns} retries recovered  |  ${r.dropRuns} dropped`);
  } else {
    console.log(`  first-pass violations: none`);
  }

  const violKeys = Object.keys(r.violationsByValidator);
  if (violKeys.length > 0) {
    console.log(`  violations by validator:`);
    for (const k of violKeys.sort()) {
      const { firstPass, survived } = r.violationsByValidator[k];
      const survivedNote = survived > 0 ? `  ← ${survived} survived retry` : '';
      console.log(`    ${k.padEnd(32)} ${firstPass}× first-pass${survivedNote}`);
    }
  }

  if (verbose) {
    console.log(`  section coverage (${r.runs} runs):`);
    for (const s of SECTIONS) {
      const count = r.sectionCoverage[s];
      console.log(`    ${s.padEnd(20)} ${count}/${r.runs}  ${pct(count, r.runs)}`);
    }
  }

  const ms = r.timingMs;
  if (ms.length > 0) {
    console.log(`  timing: mean ${fmt(mean(ms))}  p95 ${fmt(p95(ms))}`);
  }
}

function printSummary(results: FixtureResult[], model: string) {
  const totalRuns  = results.reduce((a, r) => a + r.runs, 0);
  const totalPass  = results.reduce((a, r) => a + r.passRuns, 0);
  const totalDrop  = results.reduce((a, r) => a + r.dropRuns, 0);
  const totalFirst = results.reduce((a, r) => a + r.firstPassViolationRuns, 0);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  SUMMARY — model: ${model}`);
  console.log(`  fixtures: ${results.length}   total runs: ${totalRuns}`);
  console.log(`  pass rate:  ${pct(totalPass, totalRuns).trim()} (${totalPass}/${totalRuns})`);
  console.log(`  drop rate:  ${pct(totalDrop, totalRuns).trim()} (${totalDrop}/${totalRuns})`);
  console.log(`  first-pass violation rate: ${pct(totalFirst, totalRuns).trim()} (${totalFirst}/${totalRuns})`);

  // Aggregate violations across all fixtures
  const globalViol: Record<string, { firstPass: number; survived: number }> = {};
  for (const r of results) {
    for (const [k, { firstPass, survived }] of Object.entries(r.violationsByValidator)) {
      if (!globalViol[k]) globalViol[k] = { firstPass: 0, survived: 0 };
      globalViol[k].firstPass += firstPass;
      globalViol[k].survived  += survived;
    }
  }

  const violKeys = Object.keys(globalViol);
  if (violKeys.length > 0) {
    console.log(`\n  violations by validator (all fixtures):`);
    const sorted = violKeys.sort((a, b) => globalViol[b].firstPass - globalViol[a].firstPass);
    for (const k of sorted) {
      const { firstPass, survived } = globalViol[k];
      // How many fixtures saw this validator fire?
      const fixtureCount = results.filter(r => r.violationsByValidator[k]).length;
      const survivedNote = survived > 0 ? `  (${survived} survived retry)` : '';
      console.log(`    ${k.padEnd(32)} ${String(firstPass).padStart(3)}× across ${fixtureCount}/${results.length} fixtures${survivedNote}`);
    }
  } else {
    console.log(`\n  no violations recorded`);
  }

  // Global section coverage
  const coverageTotal: Record<Section, number> = { context: 0, tacticalBattle: 0, playerSpotlight: 0, verdict: 0, keyInsights: 0, mediaWatch: 0 };
  for (const r of results) {
    for (const s of SECTIONS) {
      coverageTotal[s] += r.sectionCoverage[s];
    }
  }
  console.log(`\n  section coverage (${totalRuns} total runs):`);
  for (const s of SECTIONS) {
    console.log(`    ${s.padEnd(20)} ${coverageTotal[s]}/${totalRuns}  ${pct(coverageTotal[s], totalRuns)}`);
  }

  // Timing
  const allMs = results.flatMap(r => r.timingMs);
  if (allMs.length > 0) {
    console.log(`\n  timing: mean ${fmt(mean(allMs))}  p95 ${fmt(p95(allMs))}`);
  }
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(): {
  files:       string[];
  runs:        number;
  model:       string;
  outPath:     string | null;
  scenario:    string | null;
  concurrency: number;
  verbose:     boolean;
} {
  const argv = process.argv.slice(2);
  const files: string[] = [];
  let runs        = 3;
  let model       = AI_MODEL;
  let outPath: string | null = null;
  let scenario: string | null = null;
  let concurrency = 1;
  let verbose     = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--runs'        && argv[i+1]) { runs        = parseInt(argv[++i], 10); }
    else if (a === '--model'       && argv[i+1]) { model       = argv[++i]; }
    else if (a === '--out'         && argv[i+1]) { outPath     = argv[++i]; }
    else if (a === '--scenario'    && argv[i+1]) { scenario    = argv[++i]; }
    else if (a === '--concurrency' && argv[i+1]) { concurrency = parseInt(argv[++i], 10); }
    else if (a === '--verbose') { verbose = true; }
    else if (!a.startsWith('-')) { files.push(a); }
  }

  return { files, runs, model, outPath, scenario, concurrency, verbose };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { files, runs, model, outPath, scenario, concurrency, verbose } = parseArgs();

  // Resolve corpus files
  const corpusDir = join(process.cwd(), 'corpus');
  let targets: string[];
  if (files.length > 0) {
    targets = files;
  } else {
    if (!existsSync(corpusDir)) {
      console.error('No corpus/ directory found. Run snapshot-corpus.ts first.');
      process.exit(1);
    }
    targets = readdirSync(corpusDir)
      .filter(f => f.endsWith('.json'))
      .map(f => join(corpusDir, f));
  }

  // Load and filter entries
  const entries: CorpusEntry[] = [];
  for (const f of targets) {
    try {
      const entry = JSON.parse(readFileSync(f, 'utf8')) as CorpusEntry;
      if (scenario && entry.scenario !== scenario) continue;
      entries.push(entry);
    } catch (err) {
      console.error(`  skip ${f} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (entries.length === 0) {
    console.error('No matching corpus entries found.');
    process.exit(1);
  }

  console.log(`eval-harness  model=${model}  runs=${runs}  fixtures=${entries.length}  concurrency=${concurrency}`);
  console.log(`${'─'.repeat(72)}`);

  // Run fixtures (serial or parallel up to concurrency)
  const results: FixtureResult[] = [];

  async function runEntry(entry: CorpusEntry): Promise<FixtureResult> {
    console.log(`\nrunning  ${entry.id}  (${entry.teamName} vs ${entry.opponent})`);
    const rounds: RoundResult[] = [];
    for (let i = 0; i < runs; i++) {
      process.stdout.write(`  run ${i + 1}/${runs}…`);
      const r = await runOneRound(entry.systemPrompt, entry.previewPrompt, model);
      const outcome = r.parseError ? 'PARSE_ERR'
        : r.firstPassViolations.length === 0  ? 'PASS'
        : r.retryViolations === null           ? 'PASS-FIRST'
        : r.retryViolations.length === 0       ? 'RETRY-OK'
        : 'DROP';
      process.stdout.write(`  ${outcome}  (${fmt(r.elapsedMs)})\n`);
      rounds.push(r);
    }
    return aggregateRounds(entry, rounds);
  }

  // Process in chunks of `concurrency`
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(runEntry));
    results.push(...batchResults);
    for (const r of batchResults) {
      printFixtureResult(r, verbose);
    }
  }

  printSummary(results, model);

  // Optional JSON output
  if (outPath) {
    const dir = dirname(outPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, JSON.stringify({ model, runs, results }, null, 2));
    console.log(`\n  report written → ${outPath}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
