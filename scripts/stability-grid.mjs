/**
 * Stability grid: 5 fixtures × 3 runs each = 15 calls.
 * Uses the OpenAI-compatible Ollama endpoint (same path as production).
 * Reports: elapsed time, JSON validity, fabrication count.
 *
 * Usage: node scripts/stability-grid.mjs
 */

import { writeFileSync, appendFileSync } from 'node:fs';

const BASE       = 'http://localhost:3001';
const CRON       = '5b0a25f861799befc0643643236debd3';
const RUNS_PER   = 3;
const LOG_FILE   = '/tmp/stability-grid.log';
// Use OpenAI-compatible endpoint (same as production)
const OLLAMA_BASE = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1');
// Use instruct-2507 as confirmed production default
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:30b-a3b-instruct-2507-q4_K_M';

writeFileSync(LOG_FILE, `=== stability-grid ${new Date().toISOString()} model=${MODEL} ===\n`);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

const FIXTURES = [
  { league: 'afl', teamId: 'afl-pies',      teamName: 'Collingwood Magpies',    opponent: 'Melbourne',          gameId: 'afl-38607' },
  { league: 'afl', teamId: 'afl-dogs',      teamName: 'Western Bulldogs',       opponent: 'Adelaide Crows',     gameId: 'afl-38608' },
  { league: 'afl', teamId: 'afl-cats',      teamName: 'Geelong Cats',           opponent: 'Gold Coast Suns',    gameId: 'afl-38609' },
  { league: 'nrl', teamId: 'nrl-bulldogs',  teamName: 'Canterbury Bulldogs',    opponent: 'Parramatta Eels',    gameId: 'nrl-603361' },
  { league: 'nrl', teamId: 'nrl-rabbitohs', teamName: 'South Sydney Rabbitohs', opponent: 'Brisbane Broncos',   gameId: 'nrl-603362' },
];

// Fetch context from /api/preview
async function fetchContext(league, teamId, opponentName, gameId) {
  try {
    const url = `${BASE}/api/preview?league=${league}&teamId=${encodeURIComponent(teamId)}&opponentName=${encodeURIComponent(opponentName)}&gameId=${encodeURIComponent(gameId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

// Get prompt from benchmark endpoint
async function getPromptPair(fixture, context) {
  const res = await fetch(`${BASE}/api/ai-preview`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON },
    body: JSON.stringify({
      benchmarkReturnPrompt: true,
      league: fixture.league, teamId: fixture.teamId,
      teamName: fixture.teamName, opponentName: fixture.opponent,
      gameId: `${fixture.gameId}-prompt`, context, teamResults: [], oppResults: [],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  return { system: data.__benchmarkSystem ?? '', user: data.__benchmarkPrompt ?? '' };
}

// Call Ollama via OpenAI-compatible API
async function callOllama(system, userPrompt) {
  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Parse model JSON output
function parseOutput(raw) {
  const noThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
  const cleaned = noThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

// Count fabricated points-gap claims (not in DERIVED FACTS)
function countFabrications(output, prompt) {
  const txt    = JSON.stringify(output);
  const dfIdx  = prompt.indexOf('DERIVED FACTS');
  if (dfIdx === -1) return { count: 0, details: [] };
  const dfNums = new Set([...prompt.slice(dfIdx, dfIdx + 1000).matchAll(/\b(\d+)\b/g)].map(m => m[1]));

  const details = [];
  const re = /(\d+)\s+(?:competition\s+)?points?\s+(?:behind|ahead|adrift|clear|above|below|outside|inside)/gi;
  for (const m of txt.matchAll(re)) {
    if (!dfNums.has(m[1])) details.push(m[0].slice(0, 80));
  }
  // Expert margin
  const emMatch = prompt.match(/average predicted winning margin:\s*(\d+)\s*points/i);
  if (emMatch) {
    const expert = parseInt(emMatch[1], 10);
    const tolerance = expert * 0.25;
    const mre = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:point[s]?\s+(?:margin|win|victory|lead|defeat))/gi;
    for (const m of txt.matchAll(mre)) {
      const lo = parseInt(m[1], 10);
      const hi = m[2] ? parseInt(m[2], 10) : lo;
      if (Math.abs((lo + hi) / 2 - expert) > tolerance) details.push(`margin "${m[0].slice(0, 60)}" (expert=${expert})`);
    }
  }
  return { count: details.length, details };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const grid = [];

for (const fixture of FIXTURES) {
  log(`\n=== ${fixture.gameId}: ${fixture.teamName} vs ${fixture.opponent} ===`);

  // Fetch real context + prompt once per fixture
  const context = await fetchContext(fixture.league, fixture.teamId, fixture.opponent, fixture.gameId);
  const ctxFields = Object.keys(context).filter(k => context[k] && (Array.isArray(context[k]) ? context[k].length > 0 : true));
  log(`  Context fields: ${ctxFields.join(', ') || 'none'}`);

  let system = '', userPrompt = '';
  try {
    ({ system, user: userPrompt } = await getPromptPair(fixture, context));
    log(`  Prompt: ${userPrompt.length} chars | hasCompetitionProfile=${userPrompt.includes('COMPETITION PROFILE')} | hasDerivedFacts=${userPrompt.includes('DERIVED FACTS')}`);
  } catch (e) {
    log(`  Prompt fetch failed: ${e.message}`);
    for (let r = 1; r <= RUNS_PER; r++) grid.push({ ...fixture, run: r, elapsed: 0, valid: false, fabrications: 0, error: 'prompt-fetch-fail' });
    continue;
  }

  for (let run = 1; run <= RUNS_PER; run++) {
    const t0 = Date.now();
    let valid = false, fabrications = 0, fabDetails = [], error = null, output = null;

    try {
      const raw = await callOllama(system, userPrompt);
      output = parseOutput(raw);
      valid  = output !== null && typeof output.context === 'string';
      if (valid) ({ count: fabrications, details: fabDetails } = countFabrications(output, userPrompt));
    } catch (e) {
      error = e.message.slice(0, 80);
    }

    const elapsed = Date.now() - t0;
    const status  = error ? 'ERROR' : !valid ? 'INVALID' : fabrications > 0 ? `FAB×${fabrications}` : 'OK';
    log(`  run ${run}: ${status}  ${elapsed}ms`);
    if (fabDetails.length > 0) fabDetails.forEach(d => log(`    !! FABRICATION: "${d}"`));
    if (!valid && !error) log(`    RAW OUTPUT: ${JSON.stringify(output).slice(0, 300)}`);

    grid.push({ fixture: fixture.gameId, league: fixture.league, run, elapsed, valid, fabrications, error });
  }
}

// ─── Summary grid ─────────────────────────────────────────────────────────────

log('\n\n=== 15-RUN STABILITY GRID ===');
log('fixture            | lg  | run | ms      | valid | fab');
log('───────────────────|─────|─────|─────────|───────|────');
for (const r of grid) {
  const status = r.error ? 'ERR' : r.fabrications > 0 ? `×${r.fabrications}` : '0';
  log(`${r.fixture.padEnd(18)} | ${r.league.padEnd(3)} | ${r.run}   | ${String(r.elapsed).padStart(7)} | ${(r.valid?'yes':'NO').padEnd(5)} | ${status}`);
}

const valid  = grid.filter(r => r.valid).length;
const fabs   = grid.filter(r => r.fabrications > 0).length;
const errors = grid.filter(r => r.error).length;
const avgMs  = grid.filter(r => !r.error && r.elapsed > 0).reduce((s, r) => s + r.elapsed, 0)
             / (grid.filter(r => !r.error && r.elapsed > 0).length || 1);

log(`\nSummary: ${grid.length} runs | valid=${valid} | fabs=${fabs} | errors=${errors} | avg=${Math.round(avgMs)}ms`);
