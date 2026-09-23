/**
 * fixture-stage.ts — which fixtures are KEY matches (finals, cup knockouts,
 * series deciders), resolved from each feed's own stage signal.
 *
 * Both fixture builders (the per-team /api/fixtures route and the per-league
 * lib/league-fixtures.ts) call these, so a Grand Final is tagged the same way
 * whichever path rendered it. Every resolver is fail-safe: no recognisable
 * signal → undefined → the row renders as an ordinary fixture. Nothing here
 * guesses from team names or ladder position.
 *
 * Sources, per league:
 *   AFL   Squiggle `is_final` code (+ `is_grand_final`), roundname as fallback.
 *   NRL   ESPN `season.type === 2` ("2026 FINAL NRL") gates it; the round name
 *         comes from COMP_RULES' dated finals windows (the feed has no name).
 *   SRU   ESPN tags finals `seasonType=1` with empty notes — date windows only.
 *   Cups  ESPN per-event `season.slug` ("quarterfinals", "final"…).
 *   SOO   Game 3 with the series level 1–1.
 */

import { finalsRoundDisplay } from '@/lib/competition-structure';
import type { SeriesTally } from '@/lib/soo';

export interface FixtureStage {
  /** Display label — "Grand Final", "Preliminary Final", "Quarter-final", "Series Decider". */
  name: string;
  /** The competition (or series) is decided by this match. */
  decider: boolean;
}

// ─── AFL — Squiggle ───────────────────────────────────────────────────────────

/**
 * Squiggle `is_final` codes, verified against the 2026 season: week-one codes
 * were checked against the round-24 ladder (3 = seeds 1–4 → Qualifying, 2 =
 * seeds 5–8 → Elimination); 4/5/6 match roundname "Semi-Finals" /
 * "Preliminary Finals" / "Grand Final"; 7 = the 2026 Wildcard Round.
 */
const SQUIGGLE_FINAL_CODE: Record<number, string> = {
  7: 'Wildcard Round',
  2: 'Elimination Final',
  3: 'Qualifying Final',
  4: 'Semi-Final',
  5: 'Preliminary Final',
  6: 'Grand Final',
};

export function squiggleStage(g: {
  is_final?: number | string;
  is_grand_final?: number | string;
  roundname?: string;
  date?: string;
}): FixtureStage | undefined {
  if (Number(g.is_grand_final) === 1) return { name: 'Grand Final', decider: true };
  const code = Number(g.is_final);
  if (!code) return undefined;
  const known = SQUIGGLE_FINAL_CODE[code];
  if (known) return { name: known, decider: false };
  // Unknown code (a future format change): the feed's own round name, singular.
  const fromName = g.roundname?.replace(/s$/, '');
  if (fromName) return { name: fromName, decider: /grand final/i.test(fromName) };
  const byDate = finalsRoundDisplay('afl', g.date?.replace(' ', 'T'));
  return byDate ? { name: byDate.name, decider: byDate.decider } : undefined;
}

// ─── NRL / Super Rugby — ESPN + COMP_RULES windows ────────────────────────────

/**
 * NRL: ESPN marks every finals event `season.type === 2`; when the type is
 * present and says otherwise, no window can override it (a feed is more
 * trustworthy than a padded calendar). Super Rugby's feed never marks finals,
 * so there the windows are the only source.
 */
export function espnFinalsStage(
  league: 'nrl' | 'super_rugby',
  e: { date?: string; season?: { type?: number }; week?: { number?: number } },
): FixtureStage | undefined {
  if (league === 'nrl' && e.season?.type !== undefined && e.season.type !== 2) return undefined;
  const byDate = finalsRoundDisplay(league, e.date);
  if (byDate) return { name: byDate.name, decider: byDate.decider };
  if (league === 'nrl' && e.season?.type === 2 && e.week?.number) {
    return { name: `Finals Week ${e.week.number}`, decider: false };
  }
  return undefined;
}

// ─── Cup competitions — ESPN season slug ──────────────────────────────────────

/**
 * ESPN soccer carries the round on each event as `season.slug` (the round name
 * lower-cased and hyphenated: "third-round", "league-phase", "quarterfinals",
 * "final"). Only the business end is a key match; early rounds return nothing.
 */
const CUP_STAGES: Array<{ re: RegExp; name: string; decider: boolean }> = [
  { re: /^final$/,                      name: 'Final',         decider: true  },
  { re: /^semi-?finals?$/,              name: 'Semi-final',    decider: false },
  { re: /^quarter-?finals?$/,           name: 'Quarter-final', decider: false },
  { re: /^round-of-16$/,                name: 'Round of 16',   decider: false },
];

export function espnCupStage(e: { season?: { slug?: string; name?: string } }): FixtureStage | undefined {
  const raw = (e.season?.slug ?? e.season?.name ?? '').toLowerCase().trim().replace(/\s+/g, '-');
  if (!raw) return undefined;
  const hit = CUP_STAGES.find(s => s.re.test(raw));
  return hit ? { name: hit.name, decider: hit.decider } : undefined;
}

// ─── State of Origin — series decider ─────────────────────────────────────────

/** Game 3 with the series level: whoever wins takes the shield. */
export function sooStage(gameNumber: number, tally: SeriesTally): FixtureStage | undefined {
  if (gameNumber === 3 && tally.selfWins === 1 && tally.oppWins === 1) {
    return { name: 'Series Decider', decider: true };
  }
  return undefined;
}
