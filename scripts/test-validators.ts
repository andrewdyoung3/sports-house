/**
 * Pure-function unit tests for the preview output validators.
 * No Ollama, no Supabase, no network — fast and deterministic.
 *
 * Covers:
 *   • validatePlayerNames — F1 driver-constructor false positives PASS; invented names rejected.
 *   • validateLadderPosition — rejects wrong positional ordinals, allows non-positional numbers.
 *   • validatePointsClaims — level-on-points figure is emitted and validated.
 *
 * Run: npx tsx scripts/test-validators.ts
 */

import {
  validatePlayerNames,
  validateLadderPosition,
  validatePointsClaims,
} from '@/lib/preview-generator';
import { buildDataBlock } from '@/lib/preview-prompt';
import type { LeagueTableRow, PreviewContext } from '@/types';
import type { AIPreview } from '@/types';

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

// ─── validatePlayerNames — false positives must now PASS ────────────────────────

console.log('validatePlayerNames (should PASS — no violation):');
expect('F1 driver + constructor names (from standings) pass',
  validatePlayerNames(
    preview({ playerSpotlight: 'Max Verstappen hunts Oscar Piastri; Red Bull chase McLaren.' }), F1_PROMPT).length === 0);

// ─── validatePlayerNames — invented names must STILL be rejected ────────────────

console.log('validatePlayerNames (should REJECT — invented):');
expect('invented F1 driver in spotlight is rejected',
  validatePlayerNames(
    preview({ playerSpotlight: 'Rookie Bartholomew Quickly stunned the paddock.' }), F1_PROMPT).length >= 1);

// ─── validateLadderPosition (the 8→7 "occupy 7th" class) ────────────────────────
// Authoritative fact: Brisbane 8th, Geelong 4th. The prose must not state a
// different positional ordinal for either team; positional context only (so
// "4-point lead", "top 10", "fourth straight win", "third quarter" never fire).
{
  const LADDER_PROMPT = [
    'DERIVED FACTS — pre-computed from the table above. Use these numbers verbatim; do NOT recalculate:',
    '  • LADDER POSITION (use this exact ordinal for each team; do not restate it as any other number): Brisbane Lions — 8th of 18; Geelong — 4th of 18.',
    '  • Geelong leads Brisbane Lions by 4 competition points on the table.',
  ].join('\n');

  const fired = (context: string): boolean =>
    validateLadderPosition(preview({ context }), LADDER_PROMPT).length > 0;

  // REJECT — wrong positional ordinal for a fixture team
  expect('rejects "Brisbane Lions, who occupy 7th" (table says 8th)',
    fired('Geelong sit 4th with a lead over Brisbane Lions, who occupy 7th — just inside the wildcard zone.'));
  expect('rejects "Geelong sit 5th" (table says 4th)',
    fired('Geelong sit 5th on the table this week.'));
  expect('rejects word-ordinal mismatch "Brisbane Lions are seventh"',
    fired('Brisbane Lions are seventh on the ladder.'));

  // PASS — correct ordinals (must NOT fire)
  expect('allows correct "Brisbane Lions occupy 8th, Geelong sit 4th"',
    !fired('Geelong sit 4th on the ladder; Brisbane Lions occupy 8th.'));
  expect('allows correct word ordinals "eighth"/"fourth"',
    !fired('Brisbane Lions are eighth in the standings while Geelong are fourth.'));

  // PASS — false-positive traps (non-positional numbers/ordinals; must NOT fire)
  expect('trap: "4-point lead" does not fire',          !fired('Geelong hold a 4-point lead over Brisbane Lions.'));
  expect('trap: "top 10" does not fire',                !fired('Brisbane Lions are scrapping to stay in the top 10.'));
  expect('trap: "fourth straight win" does not fire',   !fired('Brisbane Lions chase a fourth straight win.'));
  expect('trap: "third quarter" does not fire',         !fired('Geelong owned the third quarter last start.'));
  expect('trap: "first half" does not fire',            !fired('Geelong started fast in the first half.'));
  expect('trap: no positional ordinal does not fire',   !fired('A crucial clash in the run home for both clubs.'));

  // No LADDER POSITION fact in the prompt → validator is inert
  expect('inert when no LADDER POSITION fact present',
    validateLadderPosition(preview({ context: 'Brisbane Lions occupy 7th.' }), 'DERIVED FACTS:\n  • nothing here').length === 0);
}

// ─── Level-on-points figure is emitted + sourced (fix a) ────────────────────────
// buildDerivedFacts must emit the SHARED points figure for teams level on points so
// a correct "level on N points" prose validates (and a wrong N is still rejected).
{
  const r = (name: string, position: number, points: number, percentage: number): LeagueTableRow =>
    ({ name, position, played: 15, wins: points / 4, draws: 0, losses: 15 - points / 4, points, percentage });
  // Geelong (4th) and Brisbane (5th) level on 36 pts; percentage splits them.
  const table: LeagueTableRow[] = [
    r('Fremantle', 1, 52, 144), r('Sydney', 2, 48, 135), r('Hawthorn', 3, 40, 113),
    r('Geelong Cats', 4, 36, 120.6), r('Brisbane Lions', 5, 36, 111.0), r('Adelaide', 6, 36, 110),
    r('Melbourne', 7, 36, 104), r('Western Bulldogs', 8, 32, 92), r('Gold Coast', 9, 28, 105),
    r('Collingwood', 10, 28, 99), r('Carlton', 11, 24, 95), r('Richmond', 12, 16, 78),
  ];
  const ctx = {
    leagueTable: table,
    teamStanding: table.find(t => t.name === 'Geelong Cats'),
    opponentStanding: table.find(t => t.name === 'Brisbane Lions'),
    fixtureDate: '2026-07-02T09:30:00Z',
  } as PreviewContext;
  const block = buildDataBlock('afl', 'Geelong Cats', 'Brisbane Lions', ctx, [], [], undefined, false, undefined, 'Kardinia Park', true, 'afl-cats', 'afl-lions', undefined);

  expect('derived fact emits the shared points figure ("level on 36 competition points")',
    /level on 36 competition points/.test(block));

  const sourced = (context: string) => validatePointsClaims(preview({ context }), block);
  expect('correct "level on 36 competition points" validates (now sourced)',
    sourced('Geelong and Brisbane are level on 36 competition points.').length === 0);
  expect('wrong "level on 30 competition points" is still rejected',
    sourced('Geelong and Brisbane are level on 30 competition points.').length > 0);
}

// ─── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
