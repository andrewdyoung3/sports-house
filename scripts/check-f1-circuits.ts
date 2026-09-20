#!/usr/bin/env tsx
/**
 * scripts/check-f1-circuits.ts — recurrence guard for F1 circuit coverage.
 *
 * Every round on the live calendar should resolve to BOTH halves of the track
 * panel: geometry (MV_CIRCUIT_KEYS → MultiViewer) and curated facts
 * (F1_CIRCUITS → length/laps/DRS caption). A round that resolves to neither
 * renders a race card with no map and no caption, and nothing in the app
 * complains — which is how six of the 2026 rounds went unnoticed until a user
 * asked why maps were missing.
 *
 * Three distinct causes, and the report separates them because the fixes differ:
 *   ALIAS    — the feed's id differs from ours (vegas → las_vegas). One line in
 *              F1_CIRCUIT_ALIASES.
 *   NO KEY   — we never recorded a MultiViewer key for a circuit that HAS one.
 *              Re-run the discovery below and add it to MV_CIRCUIT_KEYS.
 *   NO DATA  — MultiViewer has no geometry at any key (a new circuit like
 *              Madrid, or a returning one like Sepang). Nothing to do but wait;
 *              the library re-samples missing circuits every few hours.
 *
 * Run after a calendar change, or at the start of a season:
 *   npx tsx scripts/check-f1-circuits.ts          audit the current calendar
 *   npx tsx scripts/check-f1-circuits.ts --discover   also scan for unknown keys
 */

import { F1_CIRCUITS, F1_CIRCUIT_ALIASES, canonicalCircuitId } from '@/lib/f1-data';
import { MV_CIRCUIT_KEYS, fetchTrackGeometry, isProvisional } from '@/lib/f1-track-map';

const DISCOVER = process.argv.includes('--discover');
const YEAR = Number(process.argv.find(a => /^\d{4}$/.test(a))) || new Date().getFullYear();

interface Round { round: string; raceName: string; circuitId: string }

async function calendar(year: number): Promise<Round[]> {
  const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}.json?limit=100`, {
    headers: { 'User-Agent': 'SportsHouseMVP/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`);
  const data = await res.json();
  return (data?.MRData?.RaceTable?.Races ?? []).map((r: Record<string, any>) => ({
    round: String(r.round), raceName: String(r.raceName), circuitId: String(r.Circuit?.circuitId ?? ''),
  }));
}

/** Scan MultiViewer for circuits we hold no key for. Bounded, and opt-in. */
async function discover(year: number): Promise<Map<number, string>> {
  const known = new Set(Object.values(MV_CIRCUIT_KEYS));
  const found = new Map<number, string>();
  const keys = [...Array(80).keys()].map(i => i + 1).concat([...Array(35).keys()].map(i => i + 140));
  const pending = keys.filter(k => !known.has(k));
  const BATCH = 8;
  for (let i = 0; i < pending.length; i += BATCH) {
    await Promise.all(pending.slice(i, i + BATCH).map(async k => {
      try {
        const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${k}/${year}`, {
          headers: { 'User-Agent': 'SportsHouseMVP/1.0' }, signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return;
        const name = (await res.json())?.circuitName;
        if (name) found.set(k, String(name));
      } catch { /* absent */ }
    }));
  }
  return found;
}

async function main(): Promise<void> {
  console.log(`\nF1 circuit coverage — ${YEAR} calendar\n`);
  const rounds = await calendar(YEAR);
  if (rounds.length === 0) { console.log('No rounds returned; is the calendar published?'); return; }

  const gaps: Array<{ round: Round; cid: string; cause: string }> = [];
  let mapped = 0, described = 0, provisional = 0;

  console.log('  rnd  circuit                 map    facts  geometry');
  console.log('  ' + '-'.repeat(66));
  for (const r of rounds) {
    const cid = canonicalCircuitId(r.circuitId);
    const aliased = cid !== r.circuitId;
    const hasKey = cid in MV_CIRCUIT_KEYS;
    const hasFacts = cid in F1_CIRCUITS;
    if (hasKey) mapped++;
    if (hasFacts) described++;

    let geoNote = '—';
    if (hasKey) {
      const geo = await fetchTrackGeometry(cid, YEAR);
      if (!geo) geoNote = 'key set but FETCH FAILED';
      else if (isProvisional(geo, YEAR)) { geoNote = `provisional (${geo.year} layout)`; provisional++; }
      else geoNote = `${geo.year}`;
    }
    const label = aliased ? `${r.circuitId}→${cid}` : cid;
    console.log(`  ${r.round.padStart(3)}  ${label.padEnd(23)} ${(hasKey ? 'yes' : 'NO ').padEnd(6)} ${(hasFacts ? 'yes' : 'NO ').padEnd(6)} ${geoNote}`);

    if (!hasKey || !hasFacts) {
      gaps.push({ round: r, cid, cause: !hasKey ? 'NO KEY or NO DATA' : 'facts only' });
    }
  }

  console.log(`\n  maps ${mapped}/${rounds.length}   facts ${described}/${rounds.length}`
    + (provisional > 0 ? `   provisional ${provisional}` : ''));
  console.log(`  aliases in use: ${Object.keys(F1_CIRCUIT_ALIASES).join(', ') || 'none'}`);

  if (gaps.length === 0) {
    console.log('\n  ✓ every round resolves to a map and a caption\n');
    return;
  }
  console.log('\n  GAPS:');
  for (const g of gaps) {
    console.log(`    round ${g.round.round} — ${g.round.raceName} (${g.cid}): ${g.cause}`);
  }

  if (DISCOVER) {
    console.log('\n  scanning MultiViewer for keys we do not hold…');
    const found = await discover(YEAR);
    if (found.size === 0) console.log('    none found beyond the keys already recorded');
    for (const [k, name] of found) console.log(`    key ${k} = ${name}  ← add to MV_CIRCUIT_KEYS if it matches a gap`);
  } else {
    console.log('\n  re-run with --discover to scan MultiViewer for missing keys');
  }
  console.log();
}

main().catch(err => { console.error('failed:', err instanceof Error ? err.message : err); process.exit(1); });
