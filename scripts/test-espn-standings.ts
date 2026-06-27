#!/usr/bin/env tsx
/**
 * COR-1 regression tests for ESPN standings rank resolution.
 * Pure functions — no network, no Ollama. Run: npx tsx scripts/test-espn-standings.ts
 *
 * Guards the bug where league-table positions were taken from the ESPN `entries`
 * array order instead of the per-entry `rank` stat. ESPN does not guarantee rank
 * order (ties, conference splits, alphabetical), so out-of-order entries must still
 * resolve to correct positions.
 */

import { entryRank, sortByEntryRank, espnEntries } from '@/lib/espn-standings';

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.error(`  ✗ ${name}`); failed++; }
}

const mk = (name: string, rank?: number) => ({
  team: { displayName: name },
  stats: rank === undefined ? [] : [{ name: 'rank', value: rank }],
});

console.log('\n── entryRank ──────────────────────────────────────────────');

assert('uses the rank stat when present', entryRank(mk('A', 3), 0) === 3);
assert('falls back to 1-based index when rank absent', entryRank(mk('A'), 4) === 5);
assert('falls back when rank is 0/invalid', entryRank({ stats: [{ name: 'rank', value: 0 }] }, 2) === 3);
assert('handles missing stats array', entryRank({}, 6) === 7);

console.log('\n── sortByEntryRank ────────────────────────────────────────');

// Feed deliberately OUT of rank order (alphabetical), ranks scrambled.
const outOfOrder = [
  mk('Carlton', 3),
  mk('Adelaide', 1),
  mk('Brisbane', 2),
  mk('Dockers', 4),
];
const sorted = sortByEntryRank(outOfOrder);
assert('reorders by rank stat', sorted.map(e => e.team.displayName).join(',') === 'Adelaide,Brisbane,Carlton,Dockers');
assert('position from rank after sort matches rank', sorted.every((e, i) => entryRank(e, i) === i + 1));

// When ranks are absent everywhere, original feed order is preserved (stable fallback).
const noRanks = [mk('X'), mk('Y'), mk('Z')];
assert('preserves feed order when no ranks', sortByEntryRank(noRanks).map(e => e.team.displayName).join(',') === 'X,Y,Z');

// Realistic out-of-order: 1st place returned LAST in the array (the actual ESPN hazard).
const leaderLast = [mk('Eighth', 8), mk('Second', 2), mk('Leader', 1)];
const s2 = sortByEntryRank(leaderLast);
assert('leader returned last still resolves to position 1', s2[0].team.displayName === 'Leader' && entryRank(s2[0], 0) === 1);

console.log('\n── espnEntries (shape resolution) ─────────────────────────');

assert('reads children[0].standings.entries', espnEntries({ children: [{ standings: { entries: [mk('A', 1)] } }] }).length === 1);
assert('falls back to flat standings.entries', espnEntries({ standings: { entries: [mk('A'), mk('B')] } }).length === 2);
assert('children take precedence over flat', espnEntries({ children: [{ standings: { entries: [mk('A')] } }], standings: { entries: [mk('B'), mk('C')] } }).length === 1);
assert('empty/garbage shape → []', espnEntries({}).length === 0 && espnEntries(null).length === 0);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
