/**
 * Unit tests for resolveCompetitionContext().
 * Pure function — no I/O, no mocks needed.
 * Run: npx tsx scripts/test-competition-structure.ts
 */

import { resolveCompetitionContext } from '@/lib/competition-structure';
import type { LeagueTableRow } from '@/types';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    console.error(`      expected: ${expected}`);
    console.error(`      actual:   ${actual}`);
    failed++;
  }
}

// ─── Table builders ───────────────────────────────────────────────────────────

function makeRow(
  name: string,
  position: number,
  played: number,
  points: number,
  wins = 0,
  percentage?: number,
): LeagueTableRow {
  return { name, position, played, points, wins, draws: 0, losses: played - wins, percentage };
}

/**
 * AFL ladder: 23 rounds, top-8 finals, 4 pts/win.
 * Builds a minimal 10-team table for edge-case testing.
 */
function aflTable(
  teamPts: number,
  teamPlayed: number,
  teamPos: number,
  eighthPts: number,
  eighthPlayed: number,
  ninthPts: number,
  ninthPlayed: number,
): LeagueTableRow[] {
  // We only need the team row, 8th, and 9th rows to exercise the predicates.
  // Fill the rest with placeholder rows that won't be found by name.
  return [
    makeRow('Sydney Swans',      1, teamPlayed, teamPts + 20),  // 1st — not fixture team
    makeRow('Collingwood',       2, 20, 52),
    makeRow('Brisbane Lions',    3, 20, 48),
    makeRow('Carlton',           4, 20, 44),
    makeRow('GWS Giants',        5, 20, 40),
    makeRow('Geelong Cats',      6, 20, 36),
    makeRow('Hawthorn',          7, 20, 32),
    makeRow('Port Adelaide',     8, eighthPlayed, eighthPts),
    makeRow('Gold Coast Suns',   9, ninthPlayed, ninthPts),
    makeRow('Richmond Tigers', teamPos, teamPlayed, teamPts),   // fixture team
  ];
}

/**
 * EPL table: 38 rounds, no finals. 3 pts/win.
 * Minimal table for relegation / title / top-4 tests.
 */
function eplTable(
  teamPts: number,
  teamPos: number,
  teamPlayed: number,
): LeagueTableRow[] {
  // Build a plausible 20-team table around the team under test.
  const rows: LeagueTableRow[] = [];
  // Leader
  rows.push(makeRow('Manchester City', 1, teamPlayed, 80));
  rows.push(makeRow('Arsenal',         2, teamPlayed, 75));
  rows.push(makeRow('Liverpool',       3, teamPlayed, 70));
  rows.push(makeRow('Chelsea',         4, teamPlayed, 65)); // 4th — CL cutoff
  rows.push(makeRow('Tottenham',       5, teamPlayed, 60));
  // Mid-table
  for (let p = 6; p <= 16; p++) {
    rows.push(makeRow(`Mid ${p}`, p, teamPlayed, 50 - (p - 5) * 3));
  }
  rows.push(makeRow('Brentford',       17, teamPlayed, 35)); // safe line
  rows.push(makeRow('Luton',           18, teamPlayed, 30)); // relegation zone
  rows.push(makeRow('Sheffield Utd',   19, teamPlayed, 20));
  rows.push(makeRow('Burnley',         20, teamPlayed, 10));

  // Insert the fixture team at the right position
  const existing = rows.findIndex(r => r.position === teamPos);
  if (existing >= 0) {
    rows[existing] = makeRow('Test Club', teamPos, teamPlayed, teamPts);
  } else {
    rows.push(makeRow('Test Club', teamPos, teamPlayed, teamPts));
  }
  return rows.sort((a, b) => a.position - b.position);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n── AFL: ladder-finals ──────────────────────────────────────────');

// Round 21 of 23 (run-home). Team in 9th, 1 pt outside top 8. → FINALS RACE
{
  const table = aflTable(27, 21, 9, 28, 21, 27, 21);
  const r = resolveCompetitionContext('afl', table, 'Richmond Tigers', 'Adelaide Crows', 21);
  test('9th, 1pt outside, run home → FINALS RACE', r.stakes, 'FINALS RACE');
  test('phase is run home', r.phase, 'run home');
}

// Round 10 of 23 (mid-season). Same ladder position. → STANDARD (not in run-home yet)
{
  const table = aflTable(27, 10, 9, 28, 10, 27, 10);
  const r = resolveCompetitionContext('afl', table, 'Richmond Tigers', 'Adelaide Crows', 10);
  test('mid-season, near cutoff → STANDARD (no label outside run home)', r.stakes, 'STANDARD');
  test('phase is mid-season', r.phase, 'mid-season');
}

// Round 21 of 23 (2 rounds left). 2026 AFL: top-10 finals (Wildcard Round added),
// so the first team OUTSIDE the cutoff is 11th. Team in 1st; 11th can't catch even
// winning out → FINALS LOCKED. (finalsTeams=10 per COMP_RULES.afl, season 2026.)
{
  const cleanTable: LeagueTableRow[] = [
    makeRow('Sydney Swans',     1, 21, 80),
    makeRow('Collingwood',      2, 21, 60),
    makeRow('Brisbane Lions',   3, 21, 56),
    makeRow('Carlton',          4, 21, 52),
    makeRow('GWS Giants',       5, 21, 48),
    makeRow('Geelong Cats',     6, 21, 44),
    makeRow('Hawthorn',         7, 21, 40),
    makeRow('Port Adelaide',    8, 21, 36),
    makeRow('Gold Coast Suns',  9, 21, 32),
    makeRow('Essendon',        10, 21, 28),
    makeRow('Adelaide Crows',  11, 21, 20), // 11th: max = 20 + 2*4 = 28 < 80 → 1st locked
    makeRow('Richmond Tigers', 12, 21, 8),
  ];
  const r2 = resolveCompetitionContext('afl', cleanTable, 'Sydney Swans', 'Adelaide Crows', 21);
  test('1st, 11th can\'t catch → FINALS LOCKED', r2.stakes, 'FINALS LOCKED');
}

// Round 22 of 23 (1 round left). Team in 12th, max can't reach the 10th-place
// finals cutoff → ELIMINATED. (2026: top-10 finals.)
{
  const table: LeagueTableRow[] = [
    makeRow('Sydney Swans',     1, 22, 80),
    makeRow('Collingwood',      2, 22, 60),
    makeRow('Brisbane Lions',   3, 22, 56),
    makeRow('Carlton',          4, 22, 52),
    makeRow('GWS Giants',       5, 22, 48),
    makeRow('Geelong Cats',     6, 22, 44),
    makeRow('Hawthorn',         7, 22, 40),
    makeRow('Port Adelaide',    8, 22, 36),
    makeRow('Gold Coast Suns',  9, 22, 32),
    makeRow('Essendon',        10, 22, 30), // 10th = finals cutoff
    makeRow('Adelaide Crows',  11, 22, 14),
    makeRow('Richmond Tigers', 12, 22, 8),  // max = 8 + 1*4 = 12 < 30 → eliminated
  ];
  const r = resolveCompetitionContext('afl', table, 'Richmond Tigers', 'GWS Giants', 22);
  test('12th, max 12 pts < 30 pts 10th → ELIMINATED', r.stakes, 'ELIMINATED');
}

// Both top-2 teams locked into the top-10 (1 round left). → DEAD RUBBER. (2026: top-10.)
{
  const table: LeagueTableRow[] = [
    makeRow('Sydney Swans',   1, 22, 80),
    makeRow('Collingwood',    2, 22, 76),
    makeRow('Brisbane Lions', 3, 22, 56),
    makeRow('Carlton',        4, 22, 52),
    makeRow('GWS Giants',     5, 22, 48),
    makeRow('Geelong Cats',   6, 22, 44),
    makeRow('Hawthorn',       7, 22, 40),
    makeRow('Port Adelaide',  8, 22, 36),
    makeRow('Gold Coast',     9, 22, 32),
    makeRow('Essendon',      10, 22, 28),
    makeRow('Adelaide',      11, 22, 20), // 11th max = 20 + 1*4 = 24 < 76 → 1st & 2nd both locked
    makeRow('Richmond',      12, 22, 8),
  ];
  const r = resolveCompetitionContext('afl', table, 'Sydney Swans', 'Collingwood', 22);
  test('1st and 2nd both locked → DEAD RUBBER', r.stakes, 'DEAD RUBBER');
}

// Both teams (11th and 12th) eliminated from the top-10. → DEAD RUBBER. (2026: top-10.)
{
  const table: LeagueTableRow[] = [
    makeRow('Sydney Swans',   1, 22, 80),
    makeRow('Collingwood',    2, 22, 76),
    makeRow('Brisbane Lions', 3, 22, 56),
    makeRow('Carlton',        4, 22, 52),
    makeRow('GWS Giants',     5, 22, 48),
    makeRow('Geelong Cats',   6, 22, 44),
    makeRow('Hawthorn',       7, 22, 40),
    makeRow('Port Adelaide',  8, 22, 36),
    makeRow('Gold Coast',      9, 22, 32),
    makeRow('Essendon',       10, 22, 30), // 10th = finals cutoff
    makeRow('Adelaide Crows', 11, 22, 4),  // max = 4 + 1*4 = 8 < 30 → eliminated
    makeRow('Richmond Tigers',12, 22, 0),  // max = 0 + 1*4 = 4 < 30 → eliminated
  ];
  // Use full club names — 'Adelaide' alone substring-collides with 'Port Adelaide'.
  const r = resolveCompetitionContext('afl', table, 'Adelaide Crows', 'Richmond Tigers', 22);
  test('11th and 12th both eliminated → DEAD RUBBER', r.stakes, 'DEAD RUBBER');
}

// Early season, team in 5th. → STANDARD (early season, no stakes)
{
  const table: LeagueTableRow[] = Array.from({ length: 10 }, (_, i) =>
    makeRow(`Team ${i + 1}`, i + 1, 5, (10 - i) * 4),
  );
  const r = resolveCompetitionContext('afl', table, 'Team 5', 'Team 6', 5);
  test('early season → STANDARD', r.stakes, 'STANDARD');
  test('early season → phase', r.phase, 'early season');
}

// No table provided → STANDARD
{
  const r = resolveCompetitionContext('afl', [], 'Richmond Tigers', 'Carlton', 15);
  test('empty table → STANDARD', r.stakes, 'STANDARD');
}

// Unknown league → STANDARD
{
  const r = resolveCompetitionContext('cricket_int', [], 'Australia', 'Bangladesh', undefined);
  test('unknown league → STANDARD', r.stakes, 'STANDARD');
}

console.log('\n── EPL: table, no finals ────────────────────────────────────────');

// Round 36 of 38, team at 18th (29 pts), 17th has 35 pts, max = 29 + 2*3 = 35. Tied → not relegated.
// Let's test relegation battle instead: 16th, 3 pts outside zone, run home.
{
  const table = eplTable(32, 16, 34);
  // 17th has 35 pts — Test Club at 16th with 32 pts is below 17th... let me fix:
  // 17th has 35 pts, 18th has 30. Test Club at 16th with 32 pts is 3 pts above 18th but below 17th.
  // This is confusing. Let me build a custom table.
  const customTable: LeagueTableRow[] = [
    makeRow('Man City',    1, 34, 85),
    makeRow('Arsenal',     2, 34, 78),
    makeRow('Liverpool',   3, 34, 72),
    makeRow('Chelsea',     4, 34, 66),
    makeRow('Tottenham',   5, 34, 58),
    makeRow('Man Utd',     6, 34, 52),
    makeRow('Newcastle',   7, 34, 48),
    makeRow('Brighton',    8, 34, 44),
    makeRow('Aston Villa', 9, 34, 40),
    makeRow('West Ham',   10, 34, 38),
    makeRow('Wolves',     11, 34, 36),
    makeRow('Crystal Pal',12, 34, 34),
    makeRow('Everton',    13, 34, 32),
    makeRow('Fulham',     14, 34, 30),
    makeRow('Brentford',  15, 34, 28),
    makeRow('Test Club',  16, 34, 26),  // 4 pts above relegation zone (17th = 22 pts)
    makeRow('Nott Forest',17, 34, 22),  // safety line
    makeRow('Luton',      18, 34, 20),  // relegation
    makeRow('Sheff Utd',  19, 34, 14),
    makeRow('Burnley',    20, 34, 10),
  ];
  const r = resolveCompetitionContext('epl', customTable, 'Test Club', 'Man City', 34);
  test('EPL 16th, 4pts above zone, run home → RELEGATION BATTLE', r.stakes, 'RELEGATION BATTLE');
}

// Confirmed relegated: team at 20th, 10 pts, 17th has 35 pts. max = 10 + 4*3 = 22 < 35. → RELEGATED
{
  const customTable: LeagueTableRow[] = [
    makeRow('Man City',    1, 34, 85),
    makeRow('Arsenal',     2, 34, 78),
    makeRow('Liverpool',   3, 34, 72),
    makeRow('Chelsea',     4, 34, 66),
    makeRow('Tottenham',   5, 34, 58),
    makeRow('Man Utd',     6, 34, 52),
    makeRow('Newcastle',   7, 34, 48),
    makeRow('Brighton',    8, 34, 44),
    makeRow('Aston Villa', 9, 34, 40),
    makeRow('West Ham',   10, 34, 38),
    makeRow('Wolves',     11, 34, 36),
    makeRow('Crystal Pal',12, 34, 34),
    makeRow('Everton',    13, 34, 32),
    makeRow('Fulham',     14, 34, 30),
    makeRow('Brentford',  15, 34, 28),
    makeRow('Nott Forest',16, 34, 26),
    makeRow('Luton',      17, 34, 35), // safety line: 35 pts
    makeRow('Sheff Utd',  18, 34, 28),
    makeRow('Burnley',    19, 34, 20),
    makeRow('Burnley B',  20, 34, 10), // max = 10 + 4*3 = 22 < 35 → RELEGATED
  ];
  // Replace one with 'Test Club'
  customTable[19] = makeRow('Test Club', 20, 34, 10);
  const r = resolveCompetitionContext('epl', customTable, 'Test Club', 'Man City', 34);
  test('EPL 20th, mathematically relegated → RELEGATED', r.stakes, 'RELEGATED');
}

// Both teams confirmed safe, lower-mid-table, late season → DEAD RUBBER.
// 2025-26 EPL: 5 Champions League places (COMP_RULES.epl.clSpots=5), so both teams
// must be clear of the top-5 race (posGap > 3 AND > 3 wins off 5th) as well as
// relegation-safe for the result to be a genuine dead rubber.
{
  const customTable: LeagueTableRow[] = [
    makeRow('Man City',    1, 36, 85),
    makeRow('Arsenal',     2, 36, 78),
    makeRow('Liverpool',   3, 36, 72),
    makeRow('Chelsea',     4, 36, 64),
    makeRow('Tottenham',   5, 36, 58),  // 5th — Champions League cutoff
    makeRow('Man Utd',     6, 36, 52),
    makeRow('Newcastle',   7, 36, 50),
    makeRow('Brighton',    8, 36, 48),
    makeRow('Team A',      9, 36, 46),  // 9th: posGap |9-5|=4>3, 12 pts off 5th (>9) → not top-5 race
    makeRow('Team B',     10, 36, 44),  // 10th: posGap 5>3, 14 pts off 5th → not top-5 race
    makeRow('Mid 11',     11, 36, 40),
    makeRow('Mid 12',     12, 36, 38),
    makeRow('Mid 13',     13, 36, 36),
    makeRow('Mid 14',     14, 36, 34),
    makeRow('Mid 15',     15, 36, 32),
    makeRow('Mid 16',     16, 36, 30),
    makeRow('Mid 17',     17, 36, 28),
    makeRow('Luton',      18, 36, 18),  // 18th: max = 18 + 2*3 = 24 < 44 → A & B both safe
    makeRow('Sheff Utd',  19, 36, 14),
    makeRow('Burnley',    20, 36, 10),
  ];
  const r = resolveCompetitionContext('epl', customTable, 'Team A', 'Team B', 36);
  test('EPL both lower-mid confirmed safe, run home → DEAD RUBBER', r.stakes, 'DEAD RUBBER');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
