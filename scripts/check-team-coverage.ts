#!/usr/bin/env tsx
/**
 * scripts/check-team-coverage.ts — recurrence guard.
 *
 * Asserts every followable team in teams.ts resolves to a generation-side
 * identity so a preview can actually be built for it. The State-of-Origin bug
 * existed because rep teams were followable but unresolved in the generation
 * maps; this guard fails CI if any supported-league team is unresolved again.
 *
 * Resolution is rep-path-aware (C3): a team passes if it resolves via its
 * league's CLUB identity map OR a rep path (SOO_META). A genuine gap resolves
 * via neither. Mock leagues with no real-data source (nfl/mlb) are reported
 * separately as intentional, not failures.
 *
 * Usage: npx tsx scripts/check-team-coverage.ts   (exit 1 if any gap)
 */

import { TEAMS } from '@/lib/teams';
import {
  NRL_ESPN_NAME, ESPN_TEAM_NAME, SRU_ESPN_NAME, RINT_ESPN_NAME_P,
  NBA_ESPN_NAME, NHL_ESPN_NAME,
} from '@/lib/preview-fetchers';
import { SQUIGGLE_NAME } from '@/lib/afl';
import { WC_ID_TO_ESPN_NAME, WC_ESPN_NAME_TO_ID, WC_TEAM_GROUPS } from '@/lib/world-cup';
import { F1_DRIVER_IDS, F1_CONSTRUCTOR_TEAMS } from '@/lib/f1-data';
import { SOO_META } from '@/lib/soo';

const has = (m: Record<string, unknown>, id: string) => Object.prototype.hasOwnProperty.call(m, id);

// Leagues with NO real-data fetcher yet — followable but intentionally mock.
const UNSUPPORTED_LEAGUES = new Set(['nfl', 'mlb']);

// Cricket resolves dynamically by team NAME via cricketdata.org (no static id map),
// so every cricket team with a name is resolvable at runtime.
const DYNAMIC_LEAGUES = new Set(['cricket_int', 'bbl']);

/** Returns 'club' | 'rep' | 'dynamic' if resolvable, else null (gap). */
function resolve(team: { id: string; league: string; name: string }): string | null {
  const { id, league } = team;
  switch (league) {
    case 'afl':         return has(SQUIGGLE_NAME, id) ? 'club' : null;
    case 'nrl':         return has(NRL_ESPN_NAME, id) ? 'club' : (id in SOO_META ? 'rep' : null);
    case 'epl':         return has(ESPN_TEAM_NAME, id) ? 'club' : null;
    case 'super_rugby': return has(SRU_ESPN_NAME, id) ? 'club' : null;
    case 'rugby_int':   return has(RINT_ESPN_NAME_P, id) ? 'club' : null;
    case 'nba':         return has(NBA_ESPN_NAME, id) ? 'club' : null;
    case 'nhl':         return has(NHL_ESPN_NAME, id) ? 'club' : null;
    case 'world_cup':   return has(WC_ID_TO_ESPN_NAME, id) ? 'club' : null;
    case 'f1':
      return (id === 'f1-championship' || has(F1_DRIVER_IDS, id) ||
              F1_CONSTRUCTOR_TEAMS.some(t => t.id === id)) ? 'club' : null;
    default:
      if (DYNAMIC_LEAGUES.has(league)) return team.name ? 'dynamic' : null;
      return null;
  }
}

const gaps: { id: string; league: string; name: string }[] = [];
const byKind: Record<string, number> = { club: 0, rep: 0, dynamic: 0, unsupported: 0 };

for (const t of TEAMS) {
  if (UNSUPPORTED_LEAGUES.has(t.league)) { byKind.unsupported++; continue; }
  const r = resolve(t);
  if (r) byKind[r]++;
  else gaps.push({ id: t.id, league: t.league, name: t.name });
}

console.log('Team coverage (generation-side resolution):');
console.log(`  ✓ club path:    ${byKind.club}`);
console.log(`  ✓ rep path:     ${byKind.rep}  ${byKind.rep ? '(' + Object.keys(SOO_META).join(', ') + ')' : ''}`);
console.log(`  ✓ dynamic:      ${byKind.dynamic}  (cricket via cricketdata by name)`);
console.log(`  · unsupported:  ${byKind.unsupported}  (mock leagues: ${[...UNSUPPORTED_LEAGUES].join(', ')} — no real-data source, intentional)`);
console.log(`  ✗ GAPS:         ${gaps.length}`);

// ─── REL-4: World Cup ESPN name round-trip + group coverage ──────────────────
// The WC group context is located by name; a missing/changed ESPN name variant
// silently drops a followed team's form/H2H/lineups (and can flip group ordering).
// Assert every WC team id maps to an ESPN name that round-trips back to the same id,
// and that every followable WC team has a group letter.
const wcProblems: string[] = [];
for (const id of Object.keys(WC_TEAM_GROUPS)) {
  const espnName = WC_ID_TO_ESPN_NAME[id];
  if (!espnName) {
    wcProblems.push(`${id}: no WC_ID_TO_ESPN_NAME entry — ESPN form/H2H/lineups will silently drop`);
    continue;
  }
  const back = WC_ESPN_NAME_TO_ID[espnName];
  if (back !== id) {
    wcProblems.push(`${id}: "${espnName}" does not round-trip via WC_ESPN_NAME_TO_ID (got ${back ?? 'undefined'})`);
  }
}
for (const t of TEAMS) {
  if (t.league === 'world_cup' && !(t.id in WC_TEAM_GROUPS)) {
    wcProblems.push(`${t.id}: followable WC team missing a WC_TEAM_GROUPS letter`);
  }
}
console.log(`\nWorld Cup name round-trip + group coverage: ${wcProblems.length === 0 ? '✓ PASS' : `✗ ${wcProblems.length} PROBLEM(S)`}`);
for (const p of wcProblems) console.log(`  ✗ ${p}`);

if (gaps.length > 0) {
  console.log('\nUNRESOLVED followable teams in a SUPPORTED league (fix required):');
  for (const g of gaps) console.log(`  - ${g.id}  [${g.league}]  ${g.name}`);
}

if (gaps.length > 0 || wcProblems.length > 0) process.exit(1);
console.log('\nPASS — every followable team resolves to a generation identity; WC names round-trip.');
