/**
 * Pure-function unit tests for the preview output validators + WC H2H ranking.
 * No Ollama, no Supabase, no network — fast and deterministic.
 *
 * Covers the two precision fixes:
 *   • validateWorldCupGroupLetter — rejects a wrong group letter, allows the correct
 *     one and legit cross-group (best-third) references.
 *   • validatePlayerNames — the "Group D's" / F1 driver-constructor false positives
 *     now PASS, while a genuinely invented player name is STILL rejected (both
 *     directions, so we don't trade false-positives for false-negatives).
 *   • rankWorldCupGroup + makeWCH2H — the 2026 head-to-head-first tiebreaker reorders
 *     teams level on points (exercised synthetically; the live override can't occur
 *     until matchday 2).
 *
 * Run: npx tsx scripts/test-validators.ts
 */

import {
  validatePlayerNames,
  validateWorldCupGroupLetter,
} from '@/lib/preview-generator';
import { rankWorldCupGroup, makeWCH2H } from '@/lib/preview-prompt';
import type { AIPreview, WorldCupGroupRow } from '@/types';

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(name: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.error(`  ✗ ${name}`); failed++; }
}

/** Build a complete AIPreview from partial fields (validators read several). */
function preview(p: Partial<AIPreview>): AIPreview {
  return {
    context: '', tacticalBattle: '', playerSpotlight: '', verdict: '',
    keyInsights: [], ...p,
  };
}

// ─── Prompt fixtures (only the markers the validators read) ─────────────────────

// World Cup Group D fixture, group stage underway, with a named lineup so
// collectPlayerWhitelist sets hasPlayerData = true (the strictest name-scan path).
const WC_PROMPT = [
  'FIXTURE: Türkiye vs Paraguay',
  'COMPETITION: FIFA World Cup',
  'VENUE: MetLife Stadium',
  '',
  'THIS FIXTURE IS IN GROUP D. Refer to the group only as "Group D" — do NOT name any other group letter.',
  '',
  'GROUP D DERIVED FACTS — computed from the live group table (ranked by points, then goal difference, then goals scored):',
  '  • Türkiye: 3 group points from 1 game (1W-0D-0L, GD +2), currently 1st of 4 in Group D; 2 group games remaining — currently in a qualifying position.',
  '  • Paraguay: 0 group points from 1 game (0W-0D-1L, GD -2), currently 4th of 4 in Group D; 2 group games remaining — currently bottom of the group.',
  '',
  'MOST RECENT STARTING LINEUP:',
  '  Türkiye: Hakan Calhanoglu, Arda Guler, Kenan Yildiz',
  '  Paraguay: Miguel Almiron, Antonio Sanabria',
  '',
  '', // sections are terminated by a blank line — keep the last one terminated too
].join('\n');

// F1 fixture — no LINEUP (hasPlayerData stays false); whitelist is seeded from the
// championship standings (driver + constructor names).
const F1_PROMPT = [
  'COMPETITION: Formula 1',
  '',
  "DRIVERS' CHAMPIONSHIP (after Round 11):",
  '  P1. Oscar Piastri [McLaren] — 234pts, 5 wins',
  '  P2. Lando Norris [McLaren] — 226pts, 4 wins',
  '  P3. Max Verstappen [Red Bull] — 165pts, 2 wins',
  '',
  "CONSTRUCTORS' CHAMPIONSHIP:",
  '  P1. McLaren — 460pts',
  '  P2. Ferrari — 222pts',
  '  P3. Red Bull — 180pts',
  '',
  '', // terminate the last section with a blank line
].join('\n');

// ─── validateWorldCupGroupLetter ───────────────────────────────────────────────

console.log('validateWorldCupGroupLetter:');
expect('correct "Group D" passes',
  validateWorldCupGroupLetter(preview({ context: "Group D's opener is finely poised." }), WC_PROMPT).length === 0);

expect('wrong "Group F" is rejected',
  validateWorldCupGroupLetter(preview({ context: 'This Group F clash could decide top spot.' }), WC_PROMPT).length === 1);

expect('wrong letter in best-third (cross-group) clause is allowed',
  validateWorldCupGroupLetter(
    preview({ context: 'One of the best third-placed teams could yet come from Group B.' }), WC_PROMPT).length === 0);

expect('wrong letter in keyInsights is rejected',
  validateWorldCupGroupLetter(preview({ keyInsights: ['Top of Group E with a game in hand.'] }), WC_PROMPT).length === 1);

expect('no anchor in prompt → no-op (no false positives off-WC)',
  validateWorldCupGroupLetter(preview({ context: 'A tight Group F battle.' }), 'COMPETITION: EPL').length === 0);

// ─── validatePlayerNames — false positives must now PASS ────────────────────────

console.log('validatePlayerNames (should PASS — no violation):');
expect('"Group D\'s" possessive does not trip the name validator',
  validatePlayerNames(
    preview({ context: "Group D's race is wide open.", playerSpotlight: 'Arda Guler pulls the strings.' }),
    WC_PROMPT).length === 0);

expect('whitelisted WC lineup players pass',
  validatePlayerNames(
    preview({ playerSpotlight: 'Hakan Calhanoglu and Miguel Almiron set the tempo.' }), WC_PROMPT).length === 0);

expect('F1 driver + constructor names (from standings) pass',
  validatePlayerNames(
    preview({ playerSpotlight: 'Max Verstappen hunts Oscar Piastri; Red Bull chase McLaren.' }), F1_PROMPT).length === 0);

// ─── validatePlayerNames — invented names must STILL be rejected ────────────────

console.log('validatePlayerNames (should REJECT — invented):');
expect('invented player in WC output is rejected',
  validatePlayerNames(
    preview({ playerSpotlight: 'Newcomer Jaxon Fielding ran the midfield.' }), WC_PROMPT).length >= 1);

expect('invented F1 driver in spotlight is rejected',
  validatePlayerNames(
    preview({ playerSpotlight: 'Rookie Bartholomew Quickly stunned the paddock.' }), F1_PROMPT).length >= 1);

// ─── rankWorldCupGroup + makeWCH2H — 2026 H2H-first tiebreaker ───────────────────

console.log('rankWorldCupGroup + makeWCH2H:');
function wcRow(teamName: string, points: number, gd: number, played = 2): WorldCupGroupRow {
  return {
    teamName, position: 0, played,
    wins: 0, draws: 0, losses: 0,
    goalsFor: Math.max(gd, 0) + 2, goalsAgainst: 2, goalDifference: gd, points,
  };
}

// Türkiye & Paraguay both on 4 pts; Paraguay has the better overall GD (+3 vs +1),
// but Türkiye beat Paraguay head-to-head → 2026 rule ranks Türkiye above.
const tieRows: WorldCupGroupRow[] = [
  wcRow('USA', 6, 4),
  wcRow('Türkiye', 4, 1),
  wcRow('Paraguay', 4, 3),
  wcRow('Australia', 0, -8),
];
const h2h = makeWCH2H([{ teamA: 'Türkiye', teamB: 'Paraguay', goalsA: 1, goalsB: 0 }]);

const withH2H    = rankWorldCupGroup(tieRows, h2h).map(r => r.teamName);
const withoutH2H = rankWorldCupGroup(tieRows, undefined).map(r => r.teamName);

expect('H2H tiebreaker ranks Türkiye above Paraguay (despite worse overall GD)',
  withH2H.indexOf('Türkiye') < withH2H.indexOf('Paraguay'));
expect('without H2H, overall GD ranks Paraguay above Türkiye (baseline)',
  withoutH2H.indexOf('Paraguay') < withoutH2H.indexOf('Türkiye'));
expect('points order is respected outside the tie cluster (USA top, Australia bottom)',
  withH2H[0] === 'USA' && withH2H[3] === 'Australia');

// ─── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
