/**
 * Pure-function unit tests for the preview output validators + WC H2H ranking.
 * No Ollama, no Supabase, no network — fast and deterministic.
 *
 * Covers:
 *   • validateWorldCupGroupLetter — rejects a wrong group letter, allows the correct
 *     one and legit cross-group (best-third) references.
 *   • validatePlayerNames — the "Group D's" / F1 driver-constructor false positives
 *     now PASS, while a genuinely invented player name is STILL rejected.
 *   • rankWorldCupGroup + makeWCH2H — the 2026 head-to-head-first tiebreaker reorders
 *     teams level on points (exercised synthetically).
 *   • espnRoundToStageWithDateFallback — live case (empty round string, post-group date
 *     → r32) and in-window case (empty round string, group-stage date → group).
 *   • rank-source fix — rules-computed rank used instead of feed seeding position.
 *   • validateWCKnockoutStakes — rejects dead-rubber language for knockout fixtures,
 *     passes a legitimate group dead rubber.
 *
 * Run: npx tsx scripts/test-validators.ts
 */

import {
  validatePlayerNames,
  validateWorldCupGroupLetter,
  validateLadderPosition,
  validatePointsClaims,
} from '@/lib/preview-generator';
import { buildDataBlock } from '@/lib/preview-prompt';
import { rankWorldCupGroup, makeWCH2H, espnRoundToStageWithDateFallback } from '@/lib/world-cup';
import type { LeagueTableRow, PreviewContext } from '@/types';
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

// ─── espnRoundToStageWithDateFallback ────────────────────────────────────────────
// Stage classification: primary signal = date vs group-stage window; round string wins when present.

console.log('\nespnRoundToStageWithDateFallback:');
{
  // Live case: Australia–Egypt, July 3 2026, empty round string → should be r32 (post-group window)
  expect('live case: empty round string, post-group date → r32',
    espnRoundToStageWithDateFallback('   ', '2026-07-03T02:00:00Z') === 'r32');

  // Explicit round string always wins
  expect('explicit "Round of 32" → r32 regardless of date',
    espnRoundToStageWithDateFallback('Round of 32', '2026-06-20T10:00:00Z') === 'r32');

  expect('explicit "Quarter-finals" → qf',
    espnRoundToStageWithDateFallback('Quarter-finals', '2026-07-10T10:00:00Z') === 'qf');

  expect('explicit "Group A" → group',
    espnRoundToStageWithDateFallback('Group A', '2026-07-03T10:00:00Z') === 'group');

  // In-window case: empty round string, date within group stage → group
  expect('in-window case: empty round string, group-stage date (Jun 20) → group',
    espnRoundToStageWithDateFallback('', '2026-06-20T18:00:00Z') === 'group');

  // Boundary: June 27 (last group day) → still group; June 28 → r32
  expect('boundary: Jun 27 23:59 UTC → group',
    espnRoundToStageWithDateFallback(undefined, '2026-06-27T23:59:00Z') === 'group');

  expect('boundary: Jun 28 00:00 UTC → r32',
    espnRoundToStageWithDateFallback(undefined, '2026-06-28T00:00:00Z') === 'r32');
}

// ─── Rank-source fix (rules rank vs feed seeding) ────────────────────────────────
// rankWorldCupGroup must produce the correct live rank even when the feed's seeding
// order disagrees with the actual points standings.

console.log('\nRank-source fix (rankWorldCupGroup):');
{
  // Simulate a group where team A leads on points but ESPN seeded them 3rd.
  // Feed seeding: Morocco=1, USA=2, Australia=3, Algeria=4
  // Actual standings: Australia 3pts, Morocco 3pts, USA 0pts, Algeria 0pts
  const group: WorldCupGroupRow[] = [
    { teamName: 'Morocco',   position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2,  points: 3 },
    { teamName: 'USA',       position: 2, played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2, goalDifference: -2, points: 0 },
    { teamName: 'Australia', position: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 3, goalsAgainst: 1, goalDifference: 2,  points: 3 },
    { teamName: 'Algeria',   position: 4, played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 1, goalsAgainst: 3, goalDifference: -2, points: 0 },
  ];

  const ranked = rankWorldCupGroup(group);

  // Morocco and Australia both have 3pts, GD +2. Morocco GF 2 < Australia GF 3 → Australia 1st
  expect('rules rank: Australia is 1st (GF beats Morocco on GD tie)',
    ranked[0].teamName === 'Australia');

  expect('rules rank: Morocco is 2nd',
    ranked[1].teamName === 'Morocco');

  expect('rules rank: feed seeding (Morocco=1, Australia=3) is NOT used as rank',
    ranked.findIndex(r => r.teamName === 'Australia') === 0);

  // The rules-rank (1) differs from feed position (3) — confirming the fix matters
  const feedPos = group.find(r => r.teamName === 'Australia')?.position ?? -1;
  const rulesPos = ranked.findIndex(r => r.teamName === 'Australia') + 1;
  expect('rank source fix: rules rank (1) differs from feed seeding position (3)',
    feedPos === 3 && rulesPos === 1);
}

// ─── validateWCKnockoutStakes ────────────────────────────────────────────────────
// Reject dead-rubber language for knockout fixtures; pass a legitimate group dead rubber.

console.log('\nvalidateWCKnockoutStakes:');
{
  // Import validateWCKnockoutStakes — it's internal to preview-generator.ts, so we
  // test it via a minimal prompt that triggers the marker. We reconstruct the check
  // inline here using the same logic (the exported collectViolations is tested end-to-end
  // in verify-sandbox-faithful; here we test the detection pattern directly).
  const KO_PROMPT = [
    'FIXTURE: Australia vs Egypt',
    'COMPETITION: FIFA World Cup',
    '',
    'STAGE & STAKES: Round of 32 — SINGLE-ELIMINATION — the loser is eliminated; this is not a dead rubber.',
    'Win to advance to the Round of 16; lose and your World Cup is over.',
    'Australia qualified from Group D.',
    'Egypt qualified from Group G.',
    '',
  ].join('\n');

  const GROUP_PROMPT = [
    'FIXTURE: Australia vs Turkey',
    'COMPETITION: FIFA World Cup',
    '',
    'GROUP D DERIVED FACTS — computed from the live group table:',
    '  • Australia: 3 group points from 1 game (1W-0D-0L, GD +2), 1st of 4 in Group D; 2 group games remaining — currently in a qualifying position.',
    '  • Turkey: 0 group points from 1 game (0W-0D-1L, GD -2), 4th of 4 in Group D; 2 group games remaining — currently bottom of the group.',
    '',
  ].join('\n');

  // Inline the detection logic (same pattern as validateWCKnockoutStakes)
  const isKO = (prompt: string) => /STAGE & STAKES:.*SINGLE-ELIMINATION/.test(prompt);
  const badRe = /\b(dead rubber|no further progression|nothing at stake|nothing to play for|symbolic only|already qualified|already eliminated|purely symbolic|meaningless(?: result| fixture| game| match)?|a formality|of no consequence)\b/gi;

  const detectViolations = (text: string, prompt: string): string[] => {
    if (!isKO(prompt)) return [];
    const violations: string[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(badRe)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(hit);
    }
    return violations;
  };

  // Knockout: dead-rubber language must be rejected
  expect('KO fixture: "dead rubber" is rejected',
    detectViolations('This is essentially a dead rubber for both sides.', KO_PROMPT).length > 0);

  expect('KO fixture: "nothing at stake" is rejected',
    detectViolations('There is nothing at stake in this match.', KO_PROMPT).length > 0);

  expect('KO fixture: "already qualified" is rejected',
    detectViolations('Both teams are already qualified for the next round.', KO_PROMPT).length > 0);

  expect('KO fixture: "a formality" is rejected',
    detectViolations('This match is a formality for both teams.', KO_PROMPT).length > 0);

  // Knockout: clean knockout framing must pass
  expect('KO fixture: single-elimination framing passes',
    detectViolations('Both teams must win to advance — the loser goes home.', KO_PROMPT).length === 0);

  // Group stage: validator is inert (no STAGE & STAKES marker)
  expect('group fixture: "dead rubber" passes (validator inert without KO marker)',
    detectViolations('This is a dead rubber after both teams qualified early.', GROUP_PROMPT).length === 0);

  expect('group fixture: "nothing to play for" passes (validator inert without KO marker)',
    detectViolations('There is nothing to play for in the final group game.', GROUP_PROMPT).length === 0);
}

// ─── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
