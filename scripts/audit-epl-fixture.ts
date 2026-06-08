/**
 * scripts/audit-epl-fixture.ts — EPL off-season coverage audit.
 *
 * Builds a synthetic EPL near-final-round preview for two fixtures:
 *   1. Mid-table fixture (no relegation/European stakes) — audit for "playoff" language
 *   2. Relegation-zone fixture — audit for correct relegation language
 *
 * Audits specifically for:
 *   - Any "playoff" reference (EPL has none)
 *   - Correct relegation-zone language (18th–20th, NOT "bottom 4")
 *   - Correct European-qualification language (top 4 = UCL, 5th = UEL, 6th = UECL)
 *
 * Run:
 *   npx tsx scripts/audit-epl-fixture.ts
 */

import OpenAI from 'openai';
import { buildPreviewPrompt, SYSTEM_PROMPT } from '@/lib/preview-prompt';
import type { LeagueTableRow, TeamStanding } from '@/types';

function row(
  name: string, position: number, played: number,
  wins: number, draws: number, losses: number, points: number,
): LeagueTableRow {
  return { name, position, played, wins, draws, losses, points };
}

// Synthetic EPL table — round 34 of 38, final stretch
// Based loosely on a 2024-25 style standing for realism
const EPL_TABLE: LeagueTableRow[] = [
  row('Arsenal',          1,  34, 25, 5, 4, 80),
  row('Manchester City',  2,  34, 23, 6, 5, 75),
  row('Liverpool',        3,  34, 22, 6, 6, 72),
  row('Chelsea',          4,  34, 20, 7, 7, 67),
  row('Tottenham',        5,  34, 18, 6, 10, 60),
  row('Newcastle',        6,  34, 16, 7, 11, 55),
  row('Aston Villa',      7,  34, 15, 8, 11, 53),
  row('Brighton',         8,  34, 14, 7, 13, 49),
  row('West Ham',         9,  34, 13, 7, 14, 46),
  row('Brentford',        10, 34, 13, 6, 15, 45),
  row('Crystal Palace',   11, 34, 12, 6, 16, 42),
  row('Fulham',           12, 34, 11, 7, 16, 40),
  row('Wolverhampton',    13, 34, 10, 7, 17, 37),
  row('Everton',          14, 34, 9,  8, 17, 35),
  row('Nottm Forest',     15, 34, 9,  6, 19, 33),
  row('Bournemouth',      16, 34, 8,  7, 19, 31),
  row('Burnley',          17, 34, 7,  6, 21, 27),
  row('Sheffield Utd',    18, 34, 5,  5, 24, 20),
  row('Luton Town',       19, 34, 4,  5, 25, 17),
  row('Ipswich',          20, 34, 3,  4, 27, 13),
];

function standing(
  name: string, position: number, played: number,
  wins: number, draws: number, losses: number, points: number,
): TeamStanding {
  return { name, position, played, wins, draws, losses, points };
}

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey:  'ollama',
  timeout: 10 * 60 * 1000,
});

async function runFixture(label: string, prompt: string): Promise<{ raw: string; passed: boolean }> {
  console.log(`\n=== CALLING MODEL: ${label} ===`);
  const t0 = Date.now();
  const response = await client.chat.completions.create({
    model:      'qwen3:30b-a3b-instruct-2507-q4_K_M',
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
  });
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const raw = response.choices[0]?.message?.content ?? '';
  const withoutThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
  return { raw: withoutThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim(), passed: true };
}

function auditOutput(label: string, output: string, fixtures: {
  expectNoPlayoffs: boolean;
  expectRelegation?: boolean;
  expectEuropean?: boolean;
}): boolean {
  const text = output.toLowerCase();
  let passed = true;

  console.log(`\nAUDIT [${label}]:`);

  // 1. No "playoff" language
  const playoffRef = /\bplay-?off[s]?\b/.test(text);
  console.log(`  No "playoff" language: ${playoffRef ? 'FAIL ✗  "playoff" found!' : 'PASS ✓'}`);
  if (playoffRef) {
    passed = false;
    // Extract context
    const m = text.match(/.{0,60}play-?off[s]?.{0,60}/i);
    if (m) console.log(`    Context: "...${m[0]}..."`);
  }

  // 2. Relegation language check — should say "relegated" or "relegation" not "bottom 4"
  if (fixtures.expectRelegation) {
    const hasRelgation = /\brelegat/.test(text);
    const hasBottom4   = /\bbottom\s+4\b/.test(text);
    const hasBottom3   = /\bbottom\s+(?:three|3)\b/.test(text);
    console.log(`  Correct relegation zone reference (not "bottom 4"): ${hasBottom4 ? 'FAIL ✗  "bottom 4" found (EPL has 3 relegation spots)!' : hasRelgation ? 'PASS ✓' : 'WARN — no relegation language found'}`);
    if (hasBottom4) { passed = false; }
    if (hasBottom3) console.log(`  "bottom three" mentioned: correct ✓`);
  }

  // 3. European qualification language
  if (fixtures.expectEuropean) {
    const hasChampionsLeague = /\bchampions league\b/.test(text);
    const hasEuropaLeague    = /\beuropa league\b|\buefa europa\b/.test(text);
    const hasTopFour         = /\btop.?four\b|\btop\s+4\b/.test(text);
    console.log(`  European qualification language present: ${(hasChampionsLeague || hasEuropaLeague || hasTopFour) ? 'PASS ✓' : 'WARN — no European qualification language found'}`);
    if (hasChampionsLeague) console.log(`    Champions League mentioned ✓`);
    if (hasEuropaLeague)    console.log(`    Europa League mentioned ✓`);
  }

  // 4. No "finals" language (EPL has no finals)
  const hasFinalsRef = /\bfinals?\s+(?:series|spot|race|place|push|contention|bid|hope|chance|berth)\b/.test(text);
  console.log(`  No "finals" qualification language: ${hasFinalsRef ? 'FAIL ✗  finals language found!' : 'PASS ✓'}`);
  if (hasFinalsRef) {
    passed = false;
    const m = text.match(/.{0,50}finals?.{0,50}/i);
    if (m) console.log(`    Context: "...${m[0]}..."`);
  }

  console.log(`  Result: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);
  return passed;
}

async function main(): Promise<void> {
  let allPassed = true;

  // ── Fixture 1: Mid-table (no stakes) — check for "playoff" ──────────────
  const { user: prompt1 } = buildPreviewPrompt({
    league:       'epl',
    teamId:       'epl-brentford',
    teamName:     'Brentford',
    opponentName: 'Fulham',
    venue:        'Gtech Community Stadium',
    isHome:       true,
    teamResults:  [],
    oppResults:   [],
    context: {
      teamStanding:     standing('Brentford', 10, 34, 13, 6, 15, 45),
      opponentStanding: standing('Fulham',    12, 34, 11, 7, 16, 40),
      leagueTable:      EPL_TABLE,
    },
  });

  console.log('\n=== DATA BLOCK (Brentford v Fulham) ===');
  console.log(prompt1.slice(0, 1500) + '...\n[truncated]');

  const r1 = await runFixture('Brentford v Fulham (mid-table, round 35)', prompt1);
  console.log('\n--- OUTPUT ---');
  console.log(r1.raw);
  const p1 = auditOutput('Brentford v Fulham', r1.raw, { expectNoPlayoffs: true, expectEuropean: false });
  if (!p1) allPassed = false;

  // ── Fixture 2: Relegation zone — check for correct relegation language ──
  const { user: prompt2 } = buildPreviewPrompt({
    league:       'epl',
    teamId:       'epl-sheffield-utd',
    teamName:     'Sheffield United',
    opponentName: 'Luton Town',
    venue:        'Bramall Lane',
    isHome:       true,
    teamResults:  [],
    oppResults:   [],
    context: {
      teamStanding:     standing('Sheffield United', 18, 34, 5, 5, 24, 20),
      opponentStanding: standing('Luton Town',       19, 34, 4, 5, 25, 17),
      leagueTable:      EPL_TABLE,
    },
  });

  const r2 = await runFixture('Sheffield Utd v Luton (relegation zone, round 35)', prompt2);
  console.log('\n--- OUTPUT ---');
  console.log(r2.raw);
  const p2 = auditOutput('Sheffield Utd v Luton', r2.raw, {
    expectNoPlayoffs: true,
    expectRelegation: true,
    expectEuropean:   false,
  });
  if (!p2) allPassed = false;

  // ── Fixture 3: European qualification race ──────────────────────────────
  const { user: prompt3 } = buildPreviewPrompt({
    league:       'epl',
    teamId:       'epl-tottenham',
    teamName:     'Tottenham',
    opponentName: 'Newcastle',
    venue:        'Tottenham Hotspur Stadium',
    isHome:       true,
    teamResults:  [],
    oppResults:   [],
    context: {
      teamStanding:     standing('Tottenham', 5, 34, 18, 6, 10, 60),
      opponentStanding: standing('Newcastle', 6, 34, 16, 7, 11, 55),
      leagueTable:      EPL_TABLE,
    },
  });

  const r3 = await runFixture('Tottenham v Newcastle (Euro race, round 35)', prompt3);
  console.log('\n--- OUTPUT ---');
  console.log(r3.raw);
  const p3 = auditOutput('Tottenham v Newcastle', r3.raw, {
    expectNoPlayoffs: true,
    expectRelegation: false,
    expectEuropean:   true,
  });
  if (!p3) allPassed = false;

  console.log('\n============================');
  console.log(`EPL AUDIT OVERALL: ${allPassed ? 'ALL PASSED ✓' : 'FAILURES DETECTED ✗'}`);
  if (!allPassed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
