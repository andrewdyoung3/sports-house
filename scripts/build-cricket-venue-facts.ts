#!/usr/bin/env tsx
/**
 * scripts/build-cricket-venue-facts.ts — OFFLINE precompute of cricket venue
 * profiles from cricsheet.org ball-by-ball archives (freely licensed).
 *
 * Zero API-quota cost: downloads the ODI (men) and BBL match archives, derives
 * per-venue facts (average first-innings score, chase success rate, matches
 * sampled), and writes src/data/cricket-venue-facts.json — checked into the
 * repo and read at runtime by src/lib/cricket-venue-facts.ts.
 *
 * Re-run occasionally (monthly in season) to refresh:
 *   npx tsx scripts/build-cricket-venue-facts.ts
 *
 * Only matches from RECENT_YEARS back are sampled — pitches change character.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';

const WORK = '/tmp/sporthouse-cricsheet';
const OUT  = 'src/data/cricket-venue-facts.json';
const RECENT_YEARS = 8;

const SOURCES: Array<{ key: 'odi' | 't20league'; url: string; dir: string }> = [
  { key: 'odi',       url: 'https://cricsheet.org/downloads/odis_male_json.zip', dir: 'odi' },
  { key: 't20league', url: 'https://cricsheet.org/downloads/bbl_male_json.zip',  dir: 'bbl' },
];

interface VenueAgg {
  venue: string;
  format: string;
  matches: number;
  firstInningsTotal: number;
  firstInningsCount: number;
  chaseWins: number;
  chaseDecided: number;
}

function canonVenue(v: string): string {
  // First comma segment, lowercased — "Kensington Oval, Bridgetown" → "kensington oval"
  return v.split(',')[0].trim().toLowerCase();
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const cutoffYear = new Date().getFullYear() - RECENT_YEARS;
  const agg = new Map<string, VenueAgg>();

  for (const src of SOURCES) {
    const zipPath = `${WORK}/${src.dir}.zip`;
    const dirPath = `${WORK}/${src.dir}`;
    if (!existsSync(dirPath)) {
      console.log(`downloading ${src.url} …`);
      execSync(`curl -sL --max-time 300 -o ${zipPath} "${src.url}"`);
      mkdirSync(dirPath, { recursive: true });
      execSync(`unzip -oq ${zipPath} -d ${dirPath}`);
    }
    const files = readdirSync(dirPath).filter(f => f.endsWith('.json'));
    console.log(`${src.key}: ${files.length} match files`);
    let used = 0;
    for (const f of files) {
      let m: any;
      try { m = JSON.parse(readFileSync(`${dirPath}/${f}`, 'utf8')); } catch { continue; }
      const info = m.info ?? {};
      const date = (info.dates ?? [])[0] ?? '';
      if (!date || parseInt(date.slice(0, 4), 10) < cutoffYear) continue;
      const venueRaw = info.venue as string | undefined;
      if (!venueRaw) continue;
      const innings: any[] = m.innings ?? [];
      if (innings.length < 2) continue;

      // First-innings total
      let firstTotal = 0;
      for (const over of innings[0].overs ?? []) {
        for (const d of over.deliveries ?? []) firstTotal += d.runs?.total ?? 0;
      }
      const outcome = info.outcome ?? {};
      const winner: string | undefined = outcome.winner;
      const battedFirst: string | undefined = innings[0].team;
      const decided = !!winner; // ties/no-results excluded from chase stats

      const key = `${canonVenue(venueRaw)}|${src.key === 'odi' ? 'odi' : 't20'}`;
      const a = agg.get(key) ?? {
        venue: venueRaw.split(',')[0].trim(), format: src.key === 'odi' ? 'odi' : 't20',
        matches: 0, firstInningsTotal: 0, firstInningsCount: 0, chaseWins: 0, chaseDecided: 0,
      };
      a.matches++;
      if (firstTotal > 0) { a.firstInningsTotal += firstTotal; a.firstInningsCount++; }
      if (decided && battedFirst) {
        a.chaseDecided++;
        if (winner !== battedFirst) a.chaseWins++;
      }
      agg.set(key, a);
      used++;
    }
    console.log(`${src.key}: sampled ${used} matches from ${cutoffYear}+`);
  }

  const out: Record<string, { venue: string; format: string; matches: number; avgFirstInnings: number; chaseWinPct: number }> = {};
  for (const [key, a] of agg) {
    if (a.matches < 5) continue; // too small a sample to state as fact
    out[key] = {
      venue: a.venue,
      format: a.format,
      matches: a.matches,
      avgFirstInnings: Math.round(a.firstInningsTotal / Math.max(1, a.firstInningsCount)),
      chaseWinPct: Math.round((a.chaseWins / Math.max(1, a.chaseDecided)) * 100),
    };
  }
  mkdirSync('src/data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}: ${Object.keys(out).length} venue/format profiles`);
}

main().catch(e => { console.error(e); process.exit(1); });
