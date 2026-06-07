#!/usr/bin/env node
/**
 * benchmark-models.mjs
 *
 * Head-to-head benchmark: qwen3:30b-a3b-instruct-2507-q4_K_M vs qwen3:32b
 * on the ai-preview route using real fixture + context data.
 *
 * Calls Ollama directly to bypass the route's 5-min timeout.
 *
 * Usage:
 *   source ~/.zshrc && node scripts/benchmark-models.mjs
 */

const SERVER      = 'http://localhost:3001';
const OLLAMA_BASE = 'http://localhost:11434/v1';
const CRON_SECRET = '5b0a25f861799befc0643643236debd3';

const MODELS = [
  { id: 'qwen3:30b-a3b-instruct-2507-q4_K_M',  label: 'instruct-2507 (MoE 30B)',  maxTokens: 4000, timeoutMs: 10 * 60 * 1000 },
  // Step 6: same MoE architecture, thinking mode — expect 3-5 min per preview
  { id: 'qwen3:30b-a3b-thinking-2507-q4_K_M',  label: 'thinking-2507 (MoE 30B)',  maxTokens: 6000, timeoutMs: 10 * 60 * 1000 },
];

const GAMES = [
  { label: 'AFL — Brisbane Lions vs Richmond', league: 'afl', teamId: 'afl-lions' },
  { label: 'NRL — Brisbane Broncos vs Rabbitohs', league: 'nrl', teamId: 'nrl-broncos' },
];

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}, timeoutMs = 30000) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function getFixture(league, teamId) {
  const r = await apiFetch(`${SERVER}/api/fixtures?league=${league}&teamId=${teamId}`, {}, 20000);
  if (!r.ok) throw new Error(`fixtures ${r.status}`);
  const fixtures = await r.json();
  if (!fixtures?.length) throw new Error('no upcoming fixtures');
  return fixtures[0];
}

async function getContext(league, teamId, opponentName, gameId) {
  const p = new URLSearchParams({ league, teamId, opponentName, gameId });
  const r = await apiFetch(`${SERVER}/api/preview?${p}`, {}, 20000);
  if (!r.ok) return {};
  return r.json();
}

async function getAFLForm(sqTeamName) {
  const year = new Date().getFullYear();
  const r = await apiFetch(
    `https://api.squiggle.com.au/?q=games;year=${year}`,
    { headers: { 'User-Agent': 'SportHouseBenchmark/1.0' } },
    15000,
  );
  if (!r.ok) return [];
  const { games = [] } = await r.json();
  return games
    .filter(g => g.complete === 100 && (g.hteam === sqTeamName || g.ateam === sqTeamName))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(g => {
      const isHome = g.hteam === sqTeamName;
      const ts = isHome ? g.hscore : g.ascore;
      const os = isHome ? g.ascore : g.hscore;
      return {
        opponent: isHome ? g.ateam : g.hteam,
        teamScore: Number(ts ?? 0),
        opponentScore: Number(os ?? 0),
        isWin: Number(ts) > Number(os),
        isDraw: Number(ts) === Number(os),
      };
    });
}

async function getNRLForm(espnId, espnTeamName) {
  const now  = new Date();
  const past = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const r = await apiFetch(
    `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/teams/${espnId}/schedule`,
    {},
    15000,
  );
  if (!r.ok) return [];
  const { events = [] } = await r.json();
  return events
    .filter(e => e.competitions?.[0]?.status?.type?.completed === true)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(e => {
      const comp = e.competitions?.[0] ?? {};
      const c    = comp.competitors ?? [];
      const ours   = c.find(x => x.team?.displayName === espnTeamName);
      const theirs = c.find(x => x.team?.displayName !== espnTeamName);
      const ts = parseInt(ours?.score ?? '0');
      const os = parseInt(theirs?.score ?? '0');
      return {
        opponent: theirs?.team?.displayName ?? 'Unknown',
        teamScore: ts,
        opponentScore: os,
        isWin: ts > os,
        isDraw: ts === os,
      };
    });
}

async function getPromptPair(league, teamId, teamName, opponentName, gameId, context, teamResults, oppResults, isHome, venue, opponentId) {
  const body = {
    league, teamId, teamName, opponentName, gameId, context,
    teamResults, oppResults, isHome, venue, opponentId,
    benchmarkReturnPrompt: true,
  };
  const r = await apiFetch(`${SERVER}/api/ai-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify(body),
  }, 20000);
  if (!r.ok) { const t = await r.text(); throw new Error(`getPrompt ${r.status}: ${t}`); }
  const data = await r.json();
  return { system: data.__benchmarkSystem, user: data.__benchmarkPrompt };
}

// ─── Ollama call (direct) ──────────────────────────────────────────────────────

function stripThink(raw) {
  if (raw.includes('</think>')) return raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '');
  return raw;
}

function stripFences(s) {
  return s.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

async function callModelDirect(model, system, user, maxTokens, timeoutMs) {
  const start = Date.now();
  let r;
  try {
    r = await apiFetch(`${OLLAMA_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    }, timeoutMs);
  } catch (e) {
    return { elapsed: ((Date.now() - start) / 1000).toFixed(1), error: `Network error: ${e.message}`, output: null };
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return { elapsed, error: `HTTP ${r.status}: ${text.slice(0, 200)}`, output: null };
  }

  const data = await r.json().catch(e => ({ error: e.message }));
  if (data.error) return { elapsed, error: data.error, output: null };

  const raw     = data.choices?.[0]?.message?.content ?? '{}';
  const cleaned = stripFences(stripThink(raw));
  let output;
  try {
    output = JSON.parse(cleaned);
  } catch {
    return { elapsed, error: `JSON parse failed. Raw (first 500 chars): ${cleaned.slice(0, 500)}`, output: null };
  }
  return { elapsed, error: null, output };
}

// ─── Grounding audit ──────────────────────────────────────────────────────────

function extractNumbers(text) {
  return [...new Set([...text.matchAll(/\b(\d{2,}(?:\.\d+)?%?)\b/g)].map(m => m[1]))];
}

function auditGrounding(output, promptUser, context) {
  if (!output) return { valid: false, hasAllFields: false, fabricatedStats: [], groundedStats: [] };

  const REQUIRED = ['context', 'tacticalBattle', 'playerSpotlight', 'verdict', 'keyInsights'];
  const hasAllFields = REQUIRED.every(k => output[k]);

  const outputText  = JSON.stringify(output);
  const promptNums  = new Set(extractNumbers(promptUser));
  const outputNums  = extractNumbers(outputText);

  // Numbers 10+ not present in the prompt are potentially fabricated
  const fabricatedStats = outputNums.filter(n => !promptNums.has(n) && parseFloat(n) >= 10);
  const groundedStats   = outputNums.filter(n =>  promptNums.has(n));

  return { valid: true, hasAllFields, fabricatedStats: [...new Set(fabricatedStats)], groundedStats: [...new Set(groundedStats)] };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  Model Benchmark: ai-preview — instruct-2507 vs qwen3:32b');
  console.log(`  ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  const AFL_SQ_NAME   = 'Brisbane Lions';
  const NRL_ESPN_ID   = '289195';
  const NRL_ESPN_NAME = 'Broncos';

  const results = [];

  for (const game of GAMES) {
    console.log(`\n── ${game.label} ${'─'.repeat(Math.max(0, 60 - game.label.length))}`);

    // ── Gather fixture ───────────────────────────────────────────────────────
    let fix;
    try {
      fix = await getFixture(game.league, game.teamId);
    } catch (e) {
      console.log(`  SKIP: ${e.message}`);
      continue;
    }

    const teamName = game.league === 'afl' ? 'Brisbane Lions' : 'Brisbane Broncos';
    console.log(`  Fixture:  ${teamName} vs ${fix.opponent}`);
    console.log(`  Date:     ${fix.date}`);
    console.log(`  Venue:    ${fix.venue || '(TBA)'}`);

    // ── Gather context ────────────────────────────────────────────────────────
    process.stdout.write('  Context:  fetching... ');
    const context = await getContext(game.league, game.teamId, fix.opponent, fix.id);
    const hasStandings = !!(context.teamStanding || context.leagueTable?.length);
    const hasNews      = !!(context.teamNews?.length || context.opponentNews?.length);
    console.log(`standings=${hasStandings} news=${hasNews} manager=${!!context.teamManager}`);

    // ── Gather recent form ────────────────────────────────────────────────────
    process.stdout.write('  Form:     fetching... ');
    let teamResults = [];
    try {
      if (game.league === 'afl') teamResults = await getAFLForm(AFL_SQ_NAME);
      if (game.league === 'nrl') teamResults = await getNRLForm(NRL_ESPN_ID, NRL_ESPN_NAME);
    } catch (e) { /* silently skip */ }
    console.log(`${teamResults.length} recent results`);

    // ── Get prompt pair ───────────────────────────────────────────────────────
    process.stdout.write('  Prompt:   building... ');
    let promptPair;
    try {
      promptPair = await getPromptPair(
        game.league, game.teamId, teamName, fix.opponent, fix.id,
        context, teamResults, [], fix.isHome, fix.venue, fix.opponentId,
      );
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      continue;
    }

    const promptLines = promptPair.user.split('\n').length;
    console.log(`${promptLines} lines`);

    // ── Print data block ─────────────────────────────────────────────────────
    console.log('\n  ══ INPUT DATA BLOCK ══');
    for (const line of promptPair.user.split('\n')) {
      console.log(`  │ ${line}`);
    }
    console.log('  ══ END DATA BLOCK ══\n');

    // ── Run each model ────────────────────────────────────────────────────────
    for (const model of MODELS) {
      console.log(`\n  ┌─ ${model.label} (${'─'.repeat(Math.max(0, 50 - model.label.length))})`);
      console.log(`  │  max_tokens=${model.maxTokens}  timeout=${model.timeoutMs / 60000}min`);
      process.stdout.write(`  │  Generating...`);

      const { elapsed, error, output } = await callModelDirect(
        model.id, promptPair.system, promptPair.user, model.maxTokens, model.timeoutMs,
      );

      console.log(` done in ${elapsed}s`);

      if (error) {
        console.log(`  │  ERROR: ${error}`);
        results.push({ game: game.label, model: model.label, elapsed, error, audit: null, output: null });
        continue;
      }

      const audit = auditGrounding(output, promptPair.user, context);

      // Structured output
      console.log(`  │  Valid JSON (all fields): ${audit.hasAllFields ? '✓ YES' : '✗ NO — missing fields'}`);
      if (audit.fabricatedStats.length > 0) {
        console.log(`  │  ⚠ FABRICATED STATS (not in input): ${audit.fabricatedStats.join(', ')}`);
      } else {
        console.log(`  │  ✓ No invented stats found in output (numbers ≥10)`);
      }
      console.log(`  │  Grounded numbers (from input): ${audit.groundedStats.join(', ') || 'none'}`);

      console.log(`  │`);
      console.log(`  │  context:        ${output.context}`);
      console.log(`  │  tacticalBattle: ${output.tacticalBattle}`);
      console.log(`  │  playerSpotlight:${output.playerSpotlight}`);
      console.log(`  │  verdict:        ${output.verdict}`);
      console.log(`  │  keyInsights:`);
      for (const ins of (output.keyInsights ?? [])) console.log(`  │    • ${ins}`);
      console.log(`  └${'─'.repeat(55)}`);

      results.push({ game: game.label, model: model.label, elapsed, error: null, audit, output });
    }
  }

  // ─── Summary table ────────────────────────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════════════════════════════════════');
  console.log('  COMPARISON TABLE');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  const colDefs = ['Game', 'Model', 'Time(s)', 'Valid JSON', 'Fab. Stats', 'Verdict'];
  const rows = results.map(r => [
    r.game.replace(/^\w{3} — /, ''),
    r.model,
    r.elapsed ?? '?',
    r.error ? 'ERROR' : (r.audit?.hasAllFields ? 'YES' : 'NO'),
    r.error ? '-'  : (r.audit?.fabricatedStats?.length ?? '?').toString(),
    r.error ? `FAIL: ${r.error.slice(0, 40)}`
            : (r.audit?.fabricatedStats?.length > 0 ? 'FAIL (fabrication)' : 'PASS'),
  ]);

  const widths = [colDefs, ...rows].reduce((acc, row) =>
    row.map((c, i) => Math.max(acc[i] ?? 0, String(c).length)), []);

  const pad = (s, n) => String(s).padEnd(n);
  const bar = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const top = widths.map(w => '─'.repeat(w + 2)).join('┬');
  const bot = widths.map(w => '─'.repeat(w + 2)).join('┴');

  console.log('  ┌' + top + '┐');
  console.log('  │ ' + colDefs.map((h, i) => pad(h, widths[i])).join(' │ ') + ' │');
  console.log('  ├' + bar + '┤');
  for (const row of rows) {
    console.log('  │ ' + row.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │');
  }
  console.log('  └' + bot + '┘');

  // ─── Decision ─────────────────────────────────────────────────────────────
  console.log('\n  DECISION ANALYSIS:');

  const fails = results.filter(r => r.audit?.fabricatedStats?.length > 0);
  if (fails.length > 0) {
    console.log('\n  ⚠ FABRICATION DETECTED:');
    for (const f of fails) {
      console.log(`    ${f.model} on ${f.game}: invented numbers → ${f.audit.fabricatedStats.join(', ')}`);
    }
    console.log('\n  RECOMMENDATION: Implement post-generation validator that rejects outputs');
    console.log('  containing numbers ≥10 not present in the input data block.');
  }

  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    console.log('\n  ⚠ ERRORS/TIMEOUTS:');
    for (const e of errors) {
      console.log(`    ${e.model} on ${e.game}: ${e.error?.slice(0, 80)}`);
    }
  }

  const passing = results.filter(r => !r.error && r.audit?.fabricatedStats?.length === 0);
  if (passing.length >= 2) {
    const byGame = {};
    for (const r of passing) {
      if (!byGame[r.game]) byGame[r.game] = [];
      byGame[r.game].push(r);
    }
    for (const [game, group] of Object.entries(byGame)) {
      const sorted = group.sort((a, b) => Number(a.elapsed) - Number(b.elapsed));
      console.log(`\n  ${game}: faster=${sorted[0].model} (${sorted[0].elapsed}s) vs ${sorted[1]?.model ?? 'other'} (${sorted[1]?.elapsed ?? '?'}s)`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════════════════\n');

  // Save JSON results
  const fs = await import('fs');
  fs.writeFileSync(
    '/Users/andreasjenkins/Documents/SportHouse/scripts/benchmark-results.json',
    JSON.stringify(results, null, 2),
  );
  console.log('  Results saved to scripts/benchmark-results.json\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
