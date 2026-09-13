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
  /**
   * One-line structure note ("winner advances to the Grand Final; loser is
   * eliminated") appended to the FIXTURE CONTEXT explanation so the model knows
   * what THIS round means inside the series — not just that it is "a final".
   */
  detail?: string;
  /**
   * Final-eight week one (AFL/NRL): the same weekend holds Qualifying Finals
   * (seeds 1–4, loser gets the double chance) AND Elimination Finals (seeds 5+,
   * loser out). The resolver names the round from both teams' ladder seeds —
   * see finalsRoundDisplay() in competition-structure.ts.
   */
  finalEightWeek1?: boolean;
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
  /** F1: races / sprints on the season calendar (for points-still-available maths). */
  racesTotal?: number;
  sprintsTotal?: number;
  raceWinPoints?: number;
  sprintWinPoints?: number;
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
    // Five-week finals series (wildcard = week one). Wildcard Fri 28–Sat 29 Aug
    // (afl.com.au fixture); Grand Final Sat 26 Sep at the MCG (Wikipedia 2026 AFL
    // season / mcg.org.au). Intermediate weeks follow the weekly cadence between
    // those two confirmed anchors; windows padded a day either side.
    finalsSchedule: [
      { name: 'Wildcard Round',     from: '2026-08-27', to: '2026-08-31',
        detail: '7th hosts 10th and 8th hosts 9th — the two winners take the last two places in the final eight; the losers are eliminated' },
      { name: 'Qualifying/Elimination Final', from: '2026-09-02', to: '2026-09-07', finalEightWeek1: true },
      { name: 'Semi-Final',         from: '2026-09-09',  to: '2026-09-14',
        detail: 'knockout — the qualifying-final losers host the elimination-final winners; the loser is eliminated, the winner advances to a preliminary final' },
      { name: 'Preliminary Final',  from: '2026-09-16', to: '2026-09-20',
        detail: 'knockout — the qualifying-final winners host the semi-final winners; the winner advances to the Grand Final' },
      { name: 'Grand Final',        from: '2026-09-25', to: '2026-09-27', decider: true },
    ],
    season: '2026',
    source: 'afl.com.au "Wildcard Round introduced from 2026" + wildcard fixture (28–29 Aug); Wikipedia 2026 AFL season (GF Sat 26 Sep, five-week finals)',
  },
  nrl: {
    archetype: 'ladder-finals',
    totalRounds: 27, winsPoints: 2, maxPpg: 2, finalsTeams: 8,
    // Four-week final-eight series. Week one Fri 11–Sun 13 Sep (nrl.com finals
    // week-one announcement); Grand Final Sun 4 Oct at Accor Stadium. Windows
    // padded a day either side.
    finalsSchedule: [
      { name: 'Qualifying/Elimination Final', from: '2026-09-10', to: '2026-09-14', finalEightWeek1: true },
      { name: 'Semi-Final',        from: '2026-09-17', to: '2026-09-21',
        detail: 'knockout — the qualifying-final losers host the elimination-final winners; the loser is eliminated, the winner advances to a preliminary final' },
      { name: 'Preliminary Final', from: '2026-09-24', to: '2026-09-28',
        detail: 'knockout — the qualifying-final winners host the semi-final winners; the winner advances to the Grand Final' },
      { name: 'Grand Final',       from: '2026-10-03', to: '2026-10-05', decider: true },
    ],
    season: '2026',
    source: 'NRL top-8 finals — unchanged; nrl.com 2026 finals week one (11–13 Sep); GF Sun 4 Oct 2026, Accor Stadium',
  },
  super_rugby: {
    archetype: 'ladder-finals',
    totalRounds: 14, winsPoints: 4, maxPpg: 5,
    // 2025+: top 6 (was top 8 through 2024). Qualifying finals 1v6/2v5/3v4 →
    // semis → Grand Final. Feed has no stage field, so name the round by date.
    finalsTeams: 6,
    finalsSchedule: [
      { name: 'Qualifying Final', from: '2026-06-03', to: '2026-06-08',
        detail: '1st v 6th, 2nd v 5th, 3rd v 4th (higher seed hosts) — the three winners advance plus the highest-seeded loser as the fourth semi-finalist' },
      { name: 'Semi-Final',       from: '2026-06-10', to: '2026-06-15',
        detail: 'knockout — the loser is eliminated, the winner advances to the Grand Final' },
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

  // ── CHAMPIONSHIP POINTS (Phase C) ────────────────────────────────────────
  f1: {
    archetype: 'championship',
    // 2026: GP 25-18-15-12-10-8-6-4-2-1 (top 10); sprint 8-7-6-5-4-3-2-1 (top 8);
    // NO fastest-lap point (abolished 2025+). 24 races + 6 sprints.
    racesTotal: 24, sprintsTotal: 6, raceWinPoints: 25, sprintWinPoints: 8,
    season: '2026',
    source: 'formula1points.com / Motor Sport / Sky Sports — 24 races, 6 sprints, no fastest-lap point',
  },

  // ── CRICKET (config confirmed; ladder computation still deferred) ─────────
  bbl: {
    archetype: 'cricket',
    // BBL|15 (2025-26): 40-match home-and-away season, 10 games per club, 2 pts
    // a win, NRR tiebreaker. TOP 4 reach finals (the top-5 era ended with
    // BBL|13): The Qualifier (1st v 2nd — winner hosts the Final), The Knockout
    // (3rd v 4th — loser eliminated), The Challenger (Qualifier loser v Knockout
    // winner), The Final. RE-CONFIRM at BBL|16 launch (~Dec 2026).
    totalRounds: 10, winsPoints: 2, maxPpg: 2, finalsTeams: 4,
    season: '2025-26 (BBL|15)',
    source: 'Wikipedia 2025-26 Big Bash League season; theroar.com.au BBL fixtures (four finals, top four, 40 games)',
  },

  // ── DEFERRED — config stubs, NO computation yet ──────────────────────────
  // TODO(cricket_int): series-state (mirror SOO); no season table for bilaterals.
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
