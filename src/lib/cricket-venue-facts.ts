/**
 * Venue profiles precomputed OFFLINE from cricsheet.org ball-by-ball archives
 * (scripts/build-cricket-venue-facts.ts → src/data/cricket-venue-facts.json,
 * checked in). Zero API-quota cost at runtime.
 *
 * Facts are per venue+format over recent seasons with a minimum sample size —
 * "average first-innings ODI score here is 271; the chasing side wins 54%" is
 * exactly the pitch context the smartest fan mentions and models hallucinate.
 */

import facts from '@/data/cricket-venue-facts.json';

interface VenueFact {
  venue: string;
  format: string;
  matches: number;
  avgFirstInnings: number;
  chaseWinPct: number;
}

const FACTS = facts as Record<string, VenueFact>;

function canonVenue(v: string): string {
  return v.split(',')[0].trim().toLowerCase();
}

/**
 * Derived venue lines for the data block, or undefined when the ground is not
 * in the sample (never guess a pitch profile).
 */
export function venueProfileLines(venue: string | undefined, format: string | undefined): string[] | undefined {
  if (!venue) return undefined;
  const fmt = (format ?? '').toLowerCase() === 'odi' ? 'odi' : 't20';
  const f = FACTS[`${canonVenue(venue)}|${fmt}`];
  if (!f) return undefined;
  const chaseNote =
    f.chaseWinPct >= 58 ? `the CHASING side wins ${f.chaseWinPct}% of decided games here — a chase-friendly ground` :
    f.chaseWinPct <= 42 ? `the side batting FIRST wins ${100 - f.chaseWinPct}% of decided games here — defending totals travels well` :
    `chasing sides win ${f.chaseWinPct}% of decided games here — no strong toss bias`;
  return [
    `Average first-innings ${fmt.toUpperCase()} score at ${f.venue}: ${f.avgFirstInnings} (from ${f.matches} matches over recent seasons — cricsheet.org archives).`,
    `Chase record: ${chaseNote}.`,
  ];
}
