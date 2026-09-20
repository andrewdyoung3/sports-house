#!/usr/bin/env tsx
/**
 * scripts/test-f1-circuits.ts — offline guards for F1 circuit resolution.
 *
 * The live-calendar audit lives in scripts/check-f1-circuits.ts (network). These
 * are the table-level invariants that must hold without a network call.
 *
 * Origin: six of 23 rounds on the 2026 calendar rendered no track map. Three
 * were pure id mismatches between the feed and our tables (vegas/villeneuve,
 * plus a missing Austria key) and cost those rounds both the map AND the
 * caption, silently.
 */

import { F1_CIRCUITS, F1_CIRCUIT_ALIASES, canonicalCircuitId } from '@/lib/f1-data';
import { MV_CIRCUIT_KEYS, isProvisional } from '@/lib/f1-track-map';
import type { TrackGeometry } from '@/lib/f1-track-map';

let passed = 0, failed = 0;
function expect(name: string, cond: boolean): void {
  if (cond) { passed++; return; }
  failed++; console.log(`  ✗ ${name}`);
}

console.log('\n── feed ids normalise to our ids ──');
{
  expect('vegas → las_vegas',           canonicalCircuitId('vegas') === 'las_vegas');
  expect('villeneuve → gilles_villeneuve', canonicalCircuitId('villeneuve') === 'gilles_villeneuve');
  expect('an unaliased id is unchanged', canonicalCircuitId('monza') === 'monza');
  expect('undefined is safe',            canonicalCircuitId(undefined) === '');
  expect('normalising twice is stable',
    canonicalCircuitId(canonicalCircuitId('vegas')) === 'las_vegas');
}

console.log('── every alias target actually resolves ──');
{
  // An alias pointing at an id we hold neither a key nor facts for would be a
  // silent no-op — the exact failure the aliases exist to fix.
  for (const [from, to] of Object.entries(F1_CIRCUIT_ALIASES)) {
    expect(`alias ${from}→${to} has a MultiViewer key`, to in MV_CIRCUIT_KEYS);
    expect(`alias ${from}→${to} has circuit facts`,     to in F1_CIRCUITS);
    expect(`alias ${from}→${to} does not alias to itself`, from !== to);
    expect(`alias source ${from} is not also a real id`, !(from in MV_CIRCUIT_KEYS) && !(from in F1_CIRCUITS));
  }
}

console.log('── circuit key table integrity ──');
{
  const keys = Object.values(MV_CIRCUIT_KEYS);
  expect('no duplicate MultiViewer keys', new Set(keys).size === keys.length);
  expect('every key is a positive integer', keys.every(k => Number.isInteger(k) && k > 0));
  expect('Austria (red_bull_ring) has a key — it was missing entirely',
    MV_CIRCUIT_KEYS.red_bull_ring === 19);
  expect('Las Vegas keeps its key under the canonical id',
    MV_CIRCUIT_KEYS.las_vegas === 152);
}

console.log('── provisional detection ──');
{
  const geo = (year: number) => ({ year } as TrackGeometry);
  expect('an earlier season\'s layout is provisional', isProvisional(geo(2025), 2026));
  expect('a much earlier layout is provisional',       isProvisional(geo(2017), 2026));
  expect('the race season\'s own layout is not',       !isProvisional(geo(2026), 2026));
  // A later layout than the race would be odd but is still not this year's.
  // A LATER layout is not a stand-in — F1 publishes ahead of the calendar.
  expect('a later layout is NOT flagged',              !isProvisional(geo(2027), 2026));
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
