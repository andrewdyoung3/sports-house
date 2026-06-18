/**
 * SINGLE SOURCE OF TRUTH for per-competition, per-SEASON rules.
 *
 * Cutoffs, points systems, finals structure and finals schedules live HERE — not
 * as literals scattered across preview-prompt.ts (FINALS_SPOTS / EPL_*),
 * competition-structure.ts (STRUCTURE) and competition-context.ts (profile prose).
 *
 * Every entry carries the SEASON it is valid for and the SOURCE it was confirmed
 * from. A format change next season is a config edit + a known re-check HERE — not
 * a code hunt. AFL went 8→top-10-wildcard and Super Rugby 8→6 for 2026; both had
 * gone silently stale under the old hardcoded literals. This file exists so that
 * never happens unnoticed again.
 *
 * RE-CHECK each entry at the start of its competition's season (the `season`
 * field tells you which season the rule was confirmed for).
 */

export type Archetype =
  | 'ladder-finals'    // round-robin table → finals (AFL, NRL, Super Rugby)
  | 'table-no-finals'  // round-robin table, no finals (EPL — CL/relegation)
  | 'group-knockout'   // group tables → knockout (World Cup)
  | 'championship'     // cumulative points championship (F1 — Phase C)
  | 'series'           // best-of-N head-to-head (State of Origin)
  | 'cricket';         // tournament table + NRR / bilateral series (BBL, internationals)

export interface FinalsRound {
  /** Display label: 'Grand Final', 'Semi-Final', 'Qualifying Final', etc. */
  name: string;
  /**
   * Inclusive date window [from, to] (ISO yyyy-mm-dd). The live feed carries NO
   * stage field for these comps — ESPN tags every Super Rugby finals game
   * `seasonType=1` with empty notes — so the finals round is inferred from the
   * fixture DATE against these windows. Windows are padded a day either side.
   */
  from: string;
  to: string;
  /** True for the championship decider — drives GRAND FINAL stakes. */
  decider?: boolean;
}

export interface CompRules {
  archetype: Archetype;
  /** Regular-season rounds (undefined for tournament comps). */
  totalRounds?: number;
  winsPoints?: number;
  /** Conservative max points per game incl. bonus (Super Rugby = 5: 4-win +1 try). */
  maxPpg?: number;
  /** Teams that REACH finals — the qualification line (AFL 10, NRL 8, SRU 6). */
  finalsTeams?: number;
  /** AFL: top-N go DIRECT to finals; (N+1 … finalsTeams) play a wildcard round. */
  directFinalsTeams?: number;
  /** EPL: relegation begins at this position (18 → 18th/19th/20th go down). */
  relegationFrom?: number;
  /** EPL: number of positions that earn Champions League entry. */
  clSpots?: number;
  /** Finals fixtures have no feed stage label — name the round by date window. */
  finalsSchedule?: FinalsRound[];
  /** Season this rule set was confirmed for. */
  season: string;
  /** Authoritative source(s) the rule was confirmed from (see Step-1 research). */
  source: string;
}

export const COMP_RULES: Record<string, CompRules> = {
  // ── LEAGUE LADDER → finals ───────────────────────────────────────────────
  afl: {
    archetype: 'ladder-finals',
    totalRounds: 23, winsPoints: 4, maxPpg: 4,
    // 2026: top-10 WILDCARD. Top 6 → direct to finals (a week's rest); 7th–10th
    // play a Wildcard Round (7v10, 8v9) whose two winners fill the last two of
    // the top 8. Outside the top 10 = out of finals.
    finalsTeams: 10, directFinalsTeams: 6,
    season: '2026',
    source: 'afl.com.au "Wildcard Round introduced from 2026"; Wikipedia 2026 AFL season',
  },
  nrl: {
    archetype: 'ladder-finals',
    totalRounds: 27, winsPoints: 2, maxPpg: 2, finalsTeams: 8,
    season: '2026',
    source: 'NRL top-8 finals — unchanged (Wikipedia 2025 NRL finals series)',
  },
  super_rugby: {
    archetype: 'ladder-finals',
    totalRounds: 14, winsPoints: 4, maxPpg: 5,
    // 2025+: top 6 (was top 8 through 2024). Qualifying finals 1v6/2v5/3v4 →
    // semis → Grand Final. Feed has no stage field, so name the round by date.
    finalsTeams: 6,
    finalsSchedule: [
      { name: 'Qualifying Final', from: '2026-06-03', to: '2026-06-08' },
      { name: 'Semi-Final',       from: '2026-06-10', to: '2026-06-15' },
      { name: 'Grand Final',      from: '2026-06-17', to: '2026-06-23', decider: true },
    ],
    season: '2026',
    source: 'super.rugby + Wikipedia 2026 Super Rugby Pacific (top 6; Grand Final 20 Jun 2026)',
  },

  // ── TABLE, no finals ─────────────────────────────────────────────────────
  epl: {
    archetype: 'table-no-finals',
    totalRounds: 38, winsPoints: 3, maxPpg: 3, relegationFrom: 18,
    // 2025-26: 5 Champions League spots (England earned a 5th via UEFA's European
    // Performance Spot / coefficient). Coefficient-dependent — RE-CHECK each year.
    clSpots: 5,
    season: '2025-26',
    source: 'premierleague.com — 5 CL spots via European Performance Spot',
  },

  // ── GROUP TOURNAMENT (Phase B) ───────────────────────────────────────────
  world_cup: {
    archetype: 'group-knockout',
    winsPoints: 3, maxPpg: 3,
    season: '2026',
    source: 'FIFA 2026 — 12 groups × 4, 3 games each, top 2 + 8 best thirds → R32',
  },

  // ── DEFERRED — config stubs, NO computation yet ──────────────────────────
  // TODO(F1 — Phase C): championship type. GP 25-18-15-12-10-8-6-4-2-1; sprint
  //   8-7-6-5-4-3-2-1; NO fastest-lap point (abolished 2025+); 24 races + 6 sprints.
  //   Source: formula1points.com / Motor Sport / Sky Sports.
  // TODO(cricket — when BBL returns ~Dec): cricket type. BBL 2pts/win, NRR
  //   tiebreaker, top-N finals (re-confirm N at season start); internationals =
  //   series-state (mirror SOO). Source: ESPNcricinfo / Wikipedia BBL playoffs.
  // TODO(nba — next season): ladder-finals. Top 6 direct + play-in 7–10.
  // TODO(nhl — next season): ladder-finals. Division top-3 + 2 wildcards/conference.
};

/**
 * Finals round for a fixture date, or null if the date is not inside a finals
 * window. Used because the feed carries no stage label for these comps.
 */
export function finalsRoundForDate(league: string, isoDate: string | undefined): FinalsRound | null {
  if (!isoDate) return null;
  const sched = COMP_RULES[league]?.finalsSchedule;
  if (!sched) return null;
  const d = isoDate.slice(0, 10);
  return sched.find(r => d >= r.from && d <= r.to) ?? null;
}
