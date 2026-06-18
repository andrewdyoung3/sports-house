/**
 * Shared match-preview prompt assembly — the EXACT system prompt + user-message
 * construction used by POST /api/ai-preview. Extracted verbatim from that route so
 * both the route and dev tooling (scripts/eval-previews.ts) build identical prompts.
 *
 * Pure prompt building: no network calls, no Anthropic SDK, not wired into runtime.
 */

import type { PreviewContext, GameResult, AIPreview, WeatherData, LeagueTableRow, WorldCupGroupRow } from '@/types';
import { TEAMS } from '@/lib/teams';
import { getCompetitionProfile } from '@/lib/competition-context';
import { wcStageLabel, wcKnockoutStake } from '@/lib/world-cup';
import { resolveCompetitionContext } from '@/lib/competition-structure';
import { COMP_RULES, finalsRoundForDate } from '@/lib/competition-rules';

// ─── Block types ──────────────────────────────────────────────────────────────

export type BlockId =
  | 'matchFacts'        // FIXTURE + VENUE + COMPETITION + WC tournament stage + cup stage (always-on anchor)
  | 'fixtureContext'    // DOMESTIC COMPETITION STATUS + FIXTURE CONTEXT block
  | 'competitionProfile' // COMPETITION PROFILE text
  | 'sportContext'      // SPORT vocab + SEASON STATE + HEAD COACHES (with trailing blank)
  | 'worldCupGroup'     // GROUP X STANDINGS (WC only)
  | 'standings'         // cup group standings + LEAGUE TABLE + COMPETITION STATUS + DERIVED FACTS
  | 'recentForm'        // RECENT FORM
  | 'headToHead'        // HEAD-TO-HEAD — recent meetings between the two sides
  | 'personnel'         // LINEUP + SQUAD SUBMISSION + INJURY REPORT + KEY PERFORMERS
  | 'mediaWatch'        // FROM THE MEDIA — attributed news headlines + model tips (editorial)
  | 'weather';          // WEATHER AT KICKOFF

export const BLOCK_ORDER: readonly BlockId[] = [
  'matchFacts', 'fixtureContext', 'competitionProfile', 'sportContext',
  'worldCupGroup', 'standings', 'recentForm', 'headToHead', 'personnel', 'mediaWatch', 'weather',
] as const;

export const ALL_BLOCKS: ReadonlySet<BlockId> = new Set(BLOCK_ORDER);

export const BLOCK_LABELS: Record<BlockId, string> = {
  matchFacts:          'Fixture & venue',
  fixtureContext:      'Fixture context (stakes / phase)',
  competitionProfile:  'Competition profile',
  sportContext:        'Sport vocab + season state + coaches',
  worldCupGroup:       'World Cup group standings',
  standings:           'League table & derived facts',
  recentForm:          'Recent form',
  headToHead:          'Head-to-head meetings',
  personnel:           'Lineups, squads & injuries',
  mediaWatch:          'From the media (news, tips, angles)',
  weather:             'Weather at kickoff',
};

export interface BlockResult {
  id: BlockId;
  label: string;
  /** The lines this block contributes to the full prompt, joined by '\n'. May be empty if no data. */
  text: string;
}

// ─── Team home-venue lookup ───────────────────────────────────────────────────
// Built once at module load; maps teamId → registered home venue string.
const TEAM_HOME_VENUE: Record<string, string> = {};
for (const t of TEAMS) {
  if (t.venue) TEAM_HOME_VENUE[t.id] = t.venue;
}

/**
 * Classifies the actual game venue relative to the two teams' registered home
 * grounds and emits a plain-English VENUE line for the Claude data block.
 *
 * Three possible outcomes:
 *   HOME         — the fixture is at the followed team's registered home venue.
 *   OPPONENT_HOME — the fixture is at the opponent's registered home venue.
 *   NEUTRAL      — the venue belongs to neither team (e.g. a third city,
 *                   a neutral-site final, or a shared/temporary ground).
 *
 * This is computed from real data and is authoritative — Claude must not
 * override it based on training-knowledge assumptions.
 */
function classifyVenue(
  venue: string | undefined,
  teamName: string,
  opponentName: string,
  teamId: string,
  opponentId: string | undefined,
  isHome: boolean | undefined,
): string {
  if (!venue) return '';

  const teamHome = TEAM_HOME_VENUE[teamId]     ?? '';
  const oppHome  = TEAM_HOME_VENUE[opponentId ?? ''] ?? '';

  // isHome=true is the authoritative flag when set by the data source
  if (isHome === true || (teamHome && venue === teamHome)) {
    return `VENUE: ${venue} — ${teamName.toUpperCase()} HOME GROUND (${teamName} have home advantage)`;
  }
  if (oppHome && venue === oppHome) {
    return `VENUE: ${venue} — ${opponentName.toUpperCase()} HOME GROUND (${opponentName} have home advantage; ${teamName} are the away side)`;
  }
  // Venue matches neither team's registered home — treat as neutral
  return `VENUE: ${venue} — NEUTRAL GROUND (not ${teamName}'s home, not ${opponentName}'s home; no inherent crowd advantage for either side)`;
}

// ─── Sport-specific context ───────────────────────────────────────────────────

/**
 * Tells Claude which tactical vocabulary and idioms to use for each sport.
 * The more precise the sport context, the better the tactical analysis.
 */
const SPORT_CONTEXT: Record<string, string> = {
  afl: `Australian Rules Football (AFL). Use AFL-specific terminology: contested possessions, inside 50s, clearances, handball chains, marking contests, the corridor, centre bounces, the forward 50, wet-weather conditions, finals series, the wooden spoon, "premiership window", premiership quarter. The table is called "the Ladder".`,
  nrl: `NRL Rugby League (13-man code). Use NRL-specific terminology: completion rate, ruck speed, dummy-half, middle forwards, edges, kick chase, set restarts, ball-in-hand, field-goal, drop goal, dummy run, "short side", Magic Round, finals, finals race. The table is called "the Ladder".`,
  epl: `English Premier League (association football). Use EPL-specific terminology: pressing triggers, high block/low block, inverted wingers, full-backs overlapping, false nine, set-piece delivery, high line, offside trap, the run-in, relegation scrap, top-four race, Europa spot. The table is called "the Table". Use "pitch" not "ground". Use "half" not "period".`,
  super_rugby: `Super Rugby Pacific (15-man rugby union code). Use rugby union terminology: scrum dominance, lineout, breakdown, ruck, maul, gainline, high ball, box kick, garryowen, carrying game, wide channels, jackal, the carrying game, phases. The table is called "the Table".`,
  rugby_int: `International Rugby Union Test match (15-man code) — the pinnacle of the game. Use rugby union terminology: set-piece, scrum, lineout, breakdown, maul, territorial kicking, box kick, garryowen, gainline, the contact area, Test rugby, the jersey, Test debut. This is a Test match — tone should reflect the magnitude. The table is called "the Table".`,
  world_cup: `FIFA World Cup 2026 (international association football). Use football/soccer terminology: pressing, compactness, high line, transitions, set pieces, dead-ball situations, penalty shootout, extra time, group stage, knockout rounds, elimination, goal difference. The World Cup is the pinnacle of international football; each national team represents its entire nation — the stakes carry cultural as well as sporting weight. Write in the voice of a football analyst: discuss systems, pressing triggers, defensive shape, attacking patterns, wide-play vs central build-up. Use "pitch" not "ground" or "field". Use "half" not "period". Use "manager" or "head coach" for national team coaches.`,
  f1: `Formula 1 — 2026 season. This season operates under completely new technical regulations that have reset the competitive order. You MUST incorporate the following 2026-specific context into every preview:

ACTIVE AERODYNAMICS (replaces DRS): Traditional DRS has been abolished. All cars run active aerodynamics that continuously transition between High Downforce mode (cornering) and Low Drag mode (straights). Unlike DRS — which was driver-activated in fixed zones — active aero operates algorithmically. Overtaking is less zone-predictable; opportunities depend more on raw pace differential and corner exit speed. On circuits where DRS was previously decisive (long straights, tight hairpins), the racing dynamics have changed significantly.

MANUAL OVERRIDE (MO) SYSTEM: Drivers have a push-to-pass electrical boost button. The MGU-K now contributes approximately 350kW — nearly triple the 2022–2025 level. Drivers have limited MO activations per lap, making energy management critical. Teams with superior electrical deployment software gain an advantage. Crucially: smooth, efficient cornering matters more than late braking — drivers who recover more energy through slow-speed sections have more MO to deploy on straights. This rewards a different driving style than the DRS era.

NEW POWER UNITS (2026 spec): Approximately 50/50 split between ICE and electrical power. Manufacturers: Mercedes, Ferrari, Honda (Red Bull Powertrains), Renault (Alpine), Audi (powering their new F1 entry, formerly Kick Sauber). Higher electrical contribution means software and energy deployment are major differentiators. Teams with earlier-developed PU packages likely have advantages over Audi in its debut season.

PERFORMANCE IMPLICATIONS: The reset creates uncertainty — teams that excelled under 2022–2025 ground-effect aero may not retain their positions. Active aero compliance, MO energy efficiency, and PU deployment strategy are the new differentiating factors. Use this context when discussing team performance trajectories and constructor competitiveness.

Championship points: 25/18/15/12/10/8/6/4/2/1 for positions 1–10, plus 1 point for fastest lap. The standings are called "the Championship". Use F1 terminology: active aero, Manual Override (MO), undercut, overcut, pit window, soft/medium/hard compounds, safety car, VSC, parc fermé, setup, downforce, tyre deg. Do NOT reference DRS as a current system — it does not exist in 2026.`,
  cricket_int: `International Cricket. Match the analysis to the FORMAT given (T20: powerplay, death overs, pinch-hitting, matchups; ODI: building partnerships, the middle overs, death bowling; Test: new-ball spells, sessions, declarations, follow-on, batting/bowling collapses, the fourth-innings chase). Use cricket terminology: top order, middle order, the tail, powerplay, spin vs pace, swing/seam, reverse swing, the new ball, run rate, required rate, strike rate, economy, partnerships, the toss (bat/bowl decision), pitch/wicket conditions (green, dry, turning, flat deck). Refer to the standings as a "series" or "tournament" — there is no week-to-week ladder for a bilateral series. Use "side" or "team".`,
  bbl: `Big Bash League (BBL) — Australian domestic men's T20 franchise cricket. T20-specific: the powerplay, pinch-hitting up top, the death overs, matchup bowling, spin in the middle overs, big hitting, the run chase, net run rate for the table. Use cricket terminology: top order, finisher, the tail, strike rate, economy, the toss, pitch conditions. The competition has a league table then finals. Use "side" or "team".`,
};

const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
  f1:          'Formula 1',
  world_cup:   'FIFA World Cup 2026',
  bbl:         'Big Bash League',
  cricket_int: 'International Cricket',
};

/** Total regular-season rounds for each league — used to compute season phase. */
const LEAGUE_TOTAL_ROUNDS: Record<string, number> = {
  nrl:         27,
  afl:         23,
  epl:         38,
  super_rugby: 14,
};

// ─── Competition rules ────────────────────────────────────────────────────────
//
// Each entry documents how competition points are earned and what the key
// thresholds are (title, finals, relegation). This is the single source of
// truth used for mathematical clinching/elimination analysis.

/**
 * Maximum points a team can earn per game in each league.
 *
 * For Super Rugby Pacific we use 5 (4 for a win + 1 try bonus) rather than 4
 * so that we only flag clinching when it's certain even with bonus points.
 * AFL uses 4 (bonus points don't exist in AFL).
 * NRL uses 2 (win), 1 (draw), 0 (loss) — no bonus points.
 * EPL uses 3 (win), 1 (draw), 0 (loss) — no bonus points.
 */
const MAX_PTS_PER_GAME: Record<string, number> = {
  epl:         3,  // Win=3, Draw=1, Loss=0
  nrl:         2,  // Win=2, Draw=1, Loss=0
  afl:         4,  // Win=4, Draw=2, Loss=0 (percentage breaks ties)
  super_rugby: 5,  // Win=4, Draw=2, Loss=0 + try bonus (+1) + losing bonus (+1)
                   // Conservative: assume opponents can earn max 5/game
};

/**
 * Positions that earn finals / playoff qualification — derived from the single
 * per-season config so cutoffs can't go stale silently (AFL 10, NRL 8, SRU 6).
 */
const FINALS_SPOTS: Record<string, number> = Object.fromEntries(
  Object.entries(COMP_RULES)
    .filter(([, r]) => r.archetype === 'ladder-finals' && r.finalsTeams)
    .map(([lg, r]) => [lg, r.finalsTeams!]),
);

/** EPL relegation / CL cutoffs — from config (re-checked per season). */
const EPL_RELEGATION_FROM = COMP_RULES.epl?.relegationFrom ?? 18;
const EPL_UCL_SPOTS       = COMP_RULES.epl?.clSpots ?? 4;

/**
 * Derives mathematically confirmed competition outcomes from the full standings.
 * Returns plain-English fact strings injected verbatim into the Claude data block.
 *
 * Conservative — only flags certainties:
 * • A title is "clinched" only when even max points for 2nd can't reach 1st.
 * • Relegation is "confirmed" only when even max points can't reach safety.
 * • Finals are "locked" only when 9th can't mathematically overtake 8th.
 */
function computeCompetitionStatus(
  league: string,
  table: LeagueTableRow[],
): string[] {
  const maxPpg = MAX_PTS_PER_GAME[league];
  const totalRounds = LEAGUE_TOTAL_ROUNDS[league];
  if (!maxPpg || !totalRounds || table.length === 0) return [];

  const sorted = [...table].sort((a, b) => b.points - a.points);
  const notes: string[] = [];
  const rem = (t: LeagueTableRow) => Math.max(0, totalRounds - t.played);

  // ── Title / minor premiership ─────────────────────────────────────────────
  if (sorted.length >= 2) {
    const leader = sorted[0];
    const second = sorted[1];
    // Even if leader loses all remaining AND second wins all remaining with max pts:
    if (leader.points > second.points + rem(second) * maxPpg) {
      const titleLabel: Record<string, string> = {
        epl:         'Premier League title',
        nrl:         'NRL minor premiership (1st on ladder)',
        afl:         'AFL minor premiership (1st on ladder)',
        super_rugby: 'Super Rugby Pacific minor premiership',
      };
      notes.push(
        `TITLE/MINOR PREMIERSHIP CLINCHED: ${leader.name} have mathematically won the ${titleLabel[league] ?? 'league title'}. ` +
        `Even if ${leader.name} lose every remaining game and ${second.name} win every remaining game with maximum available points, ` +
        `${second.name} cannot reach ${leader.name}'s current tally of ${leader.points} points.`
      );
    }
  }

  // ── EPL: Champions League spots ───────────────────────────────────────────
  if (league === 'epl' && sorted.length >= EPL_UCL_SPOTS + 1) {
    const fifth = sorted[EPL_UCL_SPOTS]; // 5th place
    const maxFifthPts = fifth.points + rem(fifth) * maxPpg;
    const clinched = sorted.slice(0, EPL_UCL_SPOTS).filter(t => t.points > maxFifthPts);
    if (clinched.length === EPL_UCL_SPOTS) {
      notes.push(
        `ALL FOUR CHAMPIONS LEAGUE SPOTS CLINCHED: The top four are mathematically confirmed. ` +
        `Fifth place (${fifth.name}, ${fifth.points} pts, max achievable: ${maxFifthPts} pts) ` +
        `cannot break into the top four regardless of remaining results.`
      );
    } else if (clinched.length > 0) {
      const names = clinched.map(t => t.name).join(', ');
      notes.push(
        `CHAMPIONS LEAGUE SPOT CLINCHED: ${names} have mathematically secured top-four finishes — ` +
        `fifth place cannot reach their current points totals.`
      );
    }
  }

  // ── EPL: relegation ───────────────────────────────────────────────────────
  if (league === 'epl' && sorted.length >= EPL_RELEGATION_FROM) {
    const seventeenth = sorted[EPL_RELEGATION_FROM - 2]; // 17th place (safe)
    const relegated: string[] = [];
    for (const team of sorted.slice(EPL_RELEGATION_FROM - 1)) { // 18th+
      if (team.points + rem(team) * maxPpg < seventeenth.points) {
        relegated.push(team.name);
      }
    }
    if (relegated.length > 0) {
      notes.push(
        `RELEGATED: ${relegated.join(', ')} are mathematically relegated — ` +
        `they cannot reach the safety line (17th place, ${seventeenth.name}, ${seventeenth.points} pts) ` +
        `even by winning every remaining game.`
      );
    }
  }

  // ── NRL / AFL / Super Rugby: finals clinched / eliminated ─────────────────
  const finalsSpots = FINALS_SPOTS[league];
  if (finalsSpots && sorted.length > finalsSpots) {
    const eighth = sorted[finalsSpots - 1];
    const ninth  = sorted[finalsSpots];

    // Finals locked: 9th can't reach 8th
    if (eighth.points > ninth.points + rem(ninth) * maxPpg) {
      const finalsLabel: Record<string, string> = {
        nrl:         'NRL finals series',
        afl:         'AFL finals series',
        super_rugby: 'Super Rugby Pacific finals',
      };
      notes.push(
        `FINALS SPOTS LOCKED: All eight finalists are mathematically confirmed. ` +
        `${ninth.name} in ninth (${ninth.points} pts, max achievable: ${ninth.points + rem(ninth) * maxPpg} pts) ` +
        `cannot overtake ${eighth.name} in eighth (${eighth.points} pts) to reach the ${finalsLabel[league] ?? 'finals'}.`
      );
    }

    // Individually eliminated teams outside the top 8
    const eliminated = sorted.slice(finalsSpots).filter(t =>
      t.points + rem(t) * maxPpg < eighth.points,
    );
    if (eliminated.length > 0 && eighth.points <= ninth.points + rem(ninth) * maxPpg) {
      // Finals not fully locked but some teams are out — report individually
      const names = eliminated.map(t => t.name).join(', ');
      notes.push(
        `FINALS ELIMINATED: ${names} cannot mathematically reach the top eight — ` +
        `even winning every remaining game they cannot reach ${eighth.name}'s current ${eighth.points} points.`
      );
    }
  }

  return notes;
}

/**
 * Builds a condensed league table string for the Claude data block.
 * Shows the most strategically relevant rows: title/top-4 contenders, relegation
 * zone, and both fixture teams if not already in those ranges.
 */
function buildTableSection(
  league: string,
  table: LeagueTableRow[],
  teamName: string,
  opponentName: string,
  totalRounds: number,
): string[] {
  if (table.length === 0) return [];
  const sorted = [...table].sort((a, b) => a.position - b.position);
  const lines: string[] = [];

  // Determine which rows to always show
  const alwaysShow = new Set<number>();

  if (league === 'epl') {
    // Top 5 (title + CL spots) and bottom 4 (relegation)
    sorted.slice(0, 5).forEach(t => alwaysShow.add(t.position));
    sorted.slice(-4).forEach(t => alwaysShow.add(t.position));
  } else if (league === 'nrl' || league === 'afl') {
    // Top 9 (finals bubble) and bottom 2
    sorted.slice(0, 9).forEach(t => alwaysShow.add(t.position));
    sorted.slice(-2).forEach(t => alwaysShow.add(t.position));
  } else {
    // Super Rugby and others: show all (≤12 teams)
    sorted.forEach(t => alwaysShow.add(t.position));
  }

  // Always include both fixture teams (fuzzy match handles ESPN short-name vs full-name)
  sorted.filter(t => rowMatchesTeam(t.name, teamName) || rowMatchesTeam(t.name, opponentName))
    .forEach(t => alwaysShow.add(t.position));

  const isAFL = league === 'afl';
  lines.push(`LEAGUE TABLE (${totalRounds} rounds total — ${totalRounds} games each):`);
  if (isAFL) {
    lines.push(`  [AFL: Percentage (pts scored ÷ pts conceded × 100) is the official ladder tiebreaker when teams are level on competition points]`);
  }

  let lastPos = 0;
  for (const t of sorted) {
    if (!alwaysShow.has(t.position)) continue;
    if (lastPos > 0 && t.position > lastPos + 1) {
      lines.push('  ...');
    }
    const remaining = Math.max(0, totalRounds - t.played);
    const marker = (rowMatchesTeam(t.name, teamName) || rowMatchesTeam(t.name, opponentName)) ? ' ◄' : '';
    const pctNote = (isAFL && t.percentage !== undefined) ? `  ${t.percentage.toFixed(1)}%` : '';
    lines.push(
      `  ${String(t.position).padStart(2)}. ${t.name.padEnd(28)} ` +
      `${t.played}P  ${t.wins}W ${t.draws}D ${t.losses}L  ` +
      `${t.points} pts${pctNote}  (${remaining} remaining)${marker}`,
    );
    lastPos = t.position;
  }

  return lines;
}

// ─── Name matching ────────────────────────────────────────────────────────────

/**
 * Fuzzy-matches a table row name against a fixture team name.
 * Handles cases where ESPN uses a short name ("Broncos") while the app uses
 * the full name ("Brisbane Broncos"), or vice versa.
 */
function rowMatchesTeam(rowName: string, teamName: string): boolean {
  const r = rowName.toLowerCase();
  const t = teamName.toLowerCase();
  return r === t || t.includes(r) || r.includes(t);
}

// ─── Derived facts ────────────────────────────────────────────────────────────

/**
 * Pre-computes standings arithmetic from the live table and emits it as a
 * DERIVED FACTS block the model must quote verbatim — no recalculation needed.
 *
 * Guards: if all points are zero (data corruption) or we can't find either
 * fixture team in the table, returns [] so nothing is emitted.
 */
function buildDerivedFacts(
  league: string,
  table: LeagueTableRow[],
  teamName: string,
  opponentName: string,
  played?: number,
  totalRounds?: number,
): string[] {
  if (table.length === 0) return [];
  const sorted = [...table].sort((a, b) => a.position - b.position);

  // Zero-points guard: if every row is 0 the data is corrupt — emit nothing
  if (sorted.every(r => r.points === 0)) return [];

  const teamRow = sorted.find(r => rowMatchesTeam(r.name, teamName));
  const oppRow  = sorted.find(r => rowMatchesTeam(r.name, opponentName));
  if (!teamRow && !oppRow) return [];

  const facts: string[] = [
    'DERIVED FACTS — pre-computed from the table above. Use these numbers verbatim; do NOT recalculate:',
  ];

  // ── Head-to-head gap ──────────────────────────────────────────────────────
  if (teamRow && oppRow && (teamRow.points > 0 || oppRow.points > 0)) {
    const diff = (teamRow.points) - (oppRow.points);
    if (diff > 0) {
      facts.push(`  • ${teamName} leads ${opponentName} by ${diff} competition point${diff === 1 ? '' : 's'} on the table.`);
    } else if (diff < 0) {
      facts.push(`  • ${opponentName} leads ${teamName} by ${Math.abs(diff)} competition point${Math.abs(diff) === 1 ? '' : 's'} on the table.`);
    } else {
      // Level on competition points — for AFL, percentage is the tiebreaker
      if (league === 'afl' && teamRow.percentage !== undefined && oppRow.percentage !== undefined) {
        const tPct = teamRow.percentage;
        const oPct = oppRow.percentage;
        if (tPct > oPct) {
          facts.push(`  • ${teamName} and ${opponentName} are level on competition points. ${teamName} hold the higher ladder position on percentage (${tPct.toFixed(1)}% vs ${oPct.toFixed(1)}%) — AFL official tiebreaker.`);
        } else if (oPct > tPct) {
          facts.push(`  • ${teamName} and ${opponentName} are level on competition points. ${opponentName} hold the higher ladder position on percentage (${oPct.toFixed(1)}% vs ${tPct.toFixed(1)}%) — AFL official tiebreaker.`);
        } else {
          facts.push(`  • ${teamName} and ${opponentName} are level on both competition points and percentage.`);
        }
      } else {
        facts.push(`  • ${teamName} and ${opponentName} are level on competition points.`);
      }
    }
  }

  // ── AFL: top-10 Wildcard tiers (top-6 direct / 7–10 wildcard / outside-10) ──
  // AFL 2026 has THREE finals tiers, not one cutoff — handled separately below.
  const aflDirect = COMP_RULES.afl?.directFinalsTeams;
  if (league === 'afl' && aflDirect && FINALS_SPOTS.afl && sorted.length > FINALS_SPOTS.afl) {
    const finalsN = FINALS_SPOTS.afl;                 // 10 — finals qualification line
    const directRow = sorted[aflDirect - 1];          // 6th — direct cutoff
    const wildcardRow = sorted[finalsN - 1];          // 10th — finals cutoff
    const seventhRow  = sorted[aflDirect];            // 7th — top of wildcard zone
    for (const [name, row] of [[teamName, teamRow], [opponentName, oppRow]] as [string, LeagueTableRow | undefined][]) {
      if (!row || row.points === 0) continue;
      const pos = row.position;
      if (pos <= aflDirect) {
        const gap = row.points - (seventhRow?.points ?? 0);
        facts.push(`  • ${name} are ${ordinalSuffix(pos)} — inside the top ${aflDirect} (direct to finals, with the week-one bye), ${gap} point${gap === 1 ? '' : 's'} clear of the wildcard zone (7th is ${seventhRow?.name ?? 'n/a'}).`);
      } else if (pos <= finalsN) {
        const insideTen = row.points - (wildcardRow?.points ?? 0);
        const outsideSix = (directRow?.points ?? 0) - row.points;
        facts.push(`  • ${name} are ${ordinalSuffix(pos)} — in the wildcard zone (7th–10th, would play a wildcard final): ${outsideSix} point${outsideSix === 1 ? '' : 's'} outside the top-${aflDirect} direct line and ${insideTen} inside the top-${finalsN} finals cutoff.`);
      } else {
        const gap = (wildcardRow?.points ?? 0) - row.points;
        facts.push(`  • ${name} are ${ordinalSuffix(pos)} — outside the top ${finalsN} (out of finals), ${gap} point${gap === 1 ? '' : 's'} behind the wildcard cutoff (${ordinalSuffix(finalsN)} is ${wildcardRow?.name ?? 'n/a'} with ${wildcardRow?.points ?? 0} pts).`);
      }
    }
  }

  // ── Finals cutoff gap (NRL top 8 / Super Rugby top 6) ────────────────────
  const finalsSpot = (league === 'afl') ? undefined : FINALS_SPOTS[league];
  if (finalsSpot && sorted.length > finalsSpot) {
    const cutoff    = sorted[finalsSpot - 1]; // Nth place (cutoff)
    const cutoffPts = cutoff.points;
    if (cutoffPts > 0) {
      // For AFL: find all teams tied on the cutoff points (percentage decides ordering)
      const teamsOnCutoffPts = (league === 'afl')
        ? sorted.filter(r => r.points === cutoffPts)
        : [];

      for (const [name, row] of [
        [teamName, teamRow],
        [opponentName, oppRow],
      ] as [string, LeagueTableRow | undefined][]) {
        if (!row || row.points === 0) continue;
        // Team IS the cutoff row — they hold the last finals spot
        if (row.name === cutoff.name) {
          if (league === 'afl' && teamsOnCutoffPts.length > 1 && row.percentage !== undefined) {
            facts.push(
              `  • ${name} are in ${ordinalSuffix(finalsSpot)} place — the last finals position (${cutoffPts} pts, ${row.percentage.toFixed(1)}% percentage). ` +
              `${teamsOnCutoffPts.length} teams are tied on ${cutoffPts} pts at the cutoff; percentage determines their ladder order.`
            );
          } else {
            facts.push(`  • ${name} are in ${ordinalSuffix(finalsSpot)} place — the last finals position (${cutoffPts} pts).`);
          }
          continue;
        }
        const gap = row.points - cutoffPts;
        if (gap > 0) {
          facts.push(`  • ${name} is ${gap} point${gap === 1 ? '' : 's'} inside the finals places (${ordinalSuffix(finalsSpot)} is ${cutoff.name} with ${cutoffPts} pts).`);
        } else if (gap < 0) {
          facts.push(`  • ${name} is ${Math.abs(gap)} point${Math.abs(gap) === 1 ? '' : 's'} outside the finals places (${ordinalSuffix(finalsSpot)} is ${cutoff.name} with ${cutoffPts} pts).`);
        } else {
          // Level on points with cutoff — AFL needs percentage context
          if (league === 'afl' && row.percentage !== undefined && cutoff.percentage !== undefined) {
            const n = teamsOnCutoffPts.length;
            const rank = teamsOnCutoffPts
              .slice()
              .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
              .findIndex(r => rowMatchesTeam(r.name, name)) + 1;
            if (row.percentage > cutoff.percentage) {
              facts.push(`  • ${name} are level on points with the finals cutoff (${cutoffPts} pts) but sit inside top 8 on percentage (${row.percentage.toFixed(1)}% vs ${cutoff.name}'s ${cutoff.percentage.toFixed(1)}%) — ${n} teams on ${cutoffPts} pts; percentage determines their order.`);
            } else if (row.percentage < cutoff.percentage) {
              facts.push(`  • ${name} are level on points with the finals cutoff (${cutoffPts} pts) but sit outside top 8 on percentage (${row.percentage.toFixed(1)}% vs ${cutoff.name}'s ${cutoff.percentage.toFixed(1)}%) — ${n > 1 ? `${ordinalSuffix(rank)} of ${n} teams on ${cutoffPts} pts` : 'percentage decides who makes finals'}.`);
            } else {
              facts.push(`  • ${name} are level with the finals cutoff on both points (${cutoffPts} pts) and percentage (${row.percentage.toFixed(1)}%).`);
            }
          } else {
            facts.push(`  • ${name} is level on points with the finals cutoff (${ordinalSuffix(finalsSpot)}, ${cutoff.name}, ${cutoffPts} pts).`);
          }
        }
      }
    }
  }

  // ── EPL: gap to top-4 Champions League places ────────────────────────────
  if (league === 'epl' && sorted.length >= EPL_UCL_SPOTS + 1) {
    const fourthRow = sorted[EPL_UCL_SPOTS - 1];
    const fifthRow  = sorted[EPL_UCL_SPOTS];
    const fourthPts = fourthRow?.points ?? 0;
    if (fourthPts > 0) {
      for (const [name, row] of [
        [teamName, teamRow],
        [opponentName, oppRow],
      ] as [string, LeagueTableRow | undefined][]) {
        if (!row || row.points === 0) continue;
        if (row.position <= EPL_UCL_SPOTS) {
          const margin = row.points - (fifthRow?.points ?? 0);
          facts.push(`  • ${name} are in the top four, ${margin} point${margin === 1 ? '' : 's'} clear of 5th place.`);
        } else {
          const gap = fourthPts - row.points;
          facts.push(`  • ${name} are ${gap} point${gap === 1 ? '' : 's'} behind the top four (4th is ${fourthRow.name} with ${fourthPts} pts).`);
        }
      }
    }
  }

  // ── EPL: gap to relegation zone ──────────────────────────────────────────
  if (league === 'epl' && sorted.length >= EPL_RELEGATION_FROM) {
    const safetyRow = sorted[EPL_RELEGATION_FROM - 2]; // 17th
    const safetyPts = safetyRow?.points ?? 0;
    if (safetyPts > 0) {
      for (const [name, row] of [
        [teamName, teamRow],
        [opponentName, oppRow],
      ] as [string, LeagueTableRow | undefined][]) {
        if (!row || row.points === 0) continue;
        const gap = row.points - safetyPts;
        if (gap > 0) {
          facts.push(`  • ${name} are ${gap} point${gap === 1 ? '' : 's'} above the relegation zone (17th is ${safetyRow.name} with ${safetyPts} pts).`);
        } else if (gap < 0) {
          facts.push(`  • ${name} are in the relegation zone, ${Math.abs(gap)} point${Math.abs(gap) === 1 ? '' : 's'} from safety (17th is ${safetyRow.name} with ${safetyPts} pts).`);
        } else {
          facts.push(`  • ${name} are level with the relegation cutoff (17th, ${safetyRow.name}, ${safetyPts} pts).`);
        }
      }
    }
  }

  // ── Rounds until finals (finals-based leagues only) ─────────────────────
  const hasFinals = !!FINALS_SPOTS[league];
  if (hasFinals && played !== undefined && totalRounds !== undefined && played < totalRounds) {
    const roundsLeft = totalRounds - played;
    facts.push(`  • Rounds until finals: ${roundsLeft} (regular season has ${totalRounds} rounds total).`);
  }

  // Only the header with no facts → skip
  if (facts.length <= 1) return [];
  return facts;
}

/**
 * GROUP TOURNAMENT derived facts (World Cup). The live feed's `position` is the
 * DRAW/seeding order, NOT the live group rank — it lists 0-pt teams above 3-pt
 * teams — so we recompute the standing from the rules (points → goal difference →
 * goals scored). Emits each fixture team's GROUP record bound verbatim plus a
 * conservative stake. The context field must use THIS group record, never the
 * all-competitions RECENT FORM line (the source of the WC group-record error).
 *
 * Returns `ranked` (corrected standing for display) and `lines` (the facts block).
 */
function buildWorldCupGroupFacts(
  rows: WorldCupGroupRow[],
  group: string,
  teamName: string,
  opponentName: string,
): { ranked: WorldCupGroupRow[]; lines: string[] } {
  const ranked = [...rows].sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    a.teamName.localeCompare(b.teamName),
  );
  const rankOf = (name: string) => ranked.findIndex(r => r.teamName === name) + 1;

  const lines: string[] = [
    `GROUP ${group} DERIVED FACTS — computed from the live group table (ranked by points, then goal difference, then goals scored). Use these GROUP records verbatim; do NOT use the all-competitions RECENT FORM line for any group-standing or qualification claim:`,
  ];

  for (const name of [teamName, opponentName]) {
    const row = ranked.find(r => r.teamName === name);
    if (!row) continue;
    const rank      = rankOf(name);
    const remaining = Math.max(0, 3 - row.played);
    const gd        = row.goalDifference >= 0 ? `+${row.goalDifference}` : `${row.goalDifference}`;
    const rec       = `${row.wins}W-${row.draws}D-${row.losses}L`;
    const maxPts    = row.points + 3 * remaining;
    const others    = ranked.filter(r => r.teamName !== name);
    // Conservative: only claim a strong stake when mathematically provable.
    const canReachOrExceed = others.filter(r => (r.points + 3 * Math.max(0, 3 - r.played)) >= row.points).length;
    const alreadyBeyondMax = others.filter(r => r.points > maxPts).length;

    let stake: string;
    if (row.played >= 3 && rank <= 2) {
      stake = 'group complete — finished in the automatic top 2, through to the Round of 32';
    } else if (rank <= 2 && remaining > 0 && canReachOrExceed <= 1) {
      stake = 'have mathematically secured a top-2 finish — through to the Round of 32';
    } else if (alreadyBeyondMax >= 2) {
      stake = `can no longer finish in the automatic top 2 (already beyond their maximum of ${maxPts} pts); only a best-third-place path remains`;
    } else if (rank <= 2) {
      stake = 'currently in the automatic top-2 places (top 2 of the group advance)';
    } else if (rank === 3) {
      stake = 'currently 3rd — in contention for a best-third-place spot (the 8 best third-placed teams across the 12 groups also advance), NOT yet through';
    } else {
      stake = 'currently bottom of the group';
    }

    lines.push(
      `  • ${name}: ${row.points} group point${row.points === 1 ? '' : 's'} from ${row.played} game${row.played === 1 ? '' : 's'} ` +
      `(${rec}, GD ${gd}), currently ${ordinalSuffix(rank)} of ${ranked.length} in Group ${group}; ` +
      `${remaining} group game${remaining === 1 ? '' : 's'} remaining — ${stake}.`,
    );
  }

  // 2026 tiebreaker note — only when two teams are level on points (it reverses 2022).
  const pts = ranked.map(r => r.points);
  if (pts.some((p, i) => pts.indexOf(p) !== i)) {
    lines.push(
      '  • Tiebreaker (2026 rule): teams level on points are separated FIRST by head-to-head record ' +
      '(H2H points → H2H goal difference → H2H goals), THEN overall goal difference, then overall goals scored ' +
      '(this reverses the pre-2026 overall-goal-difference-first order).',
    );
  }
  lines.push(
    `  • Qualification: the top 2 of Group ${group} advance automatically; the 8 best third-placed teams ` +
    'across all 12 groups also advance (32 of 48 reach the Round of 32).',
  );

  return { ranked, lines };
}

// ─── Player-name whitelist ────────────────────────────────────────────────────
//
// Parses a rendered data-block prompt string and returns:
//   whitelist    — lowercase names of all players explicitly injected into the block
//   hasPlayerData — whether any lineup/squad/injury section was present at all
//
// Used by validatePlayerNames in route.ts to catch invented player names.

export function collectPlayerWhitelist(prompt: string): {
  whitelist: Set<string>;
  hasPlayerData: boolean;
} {
  const whitelist = new Set<string>();
  let hasPlayerData = false;

  // Helper: parse a comma-separated player list from section text.
  // Handles: "  TeamName: P1, P2, ..." and "  → label: P1, P2" lines.
  // Strips parenthetical suffixes like "(26 players)", "(doubtful)".
  function addNamesFromLine(line: string): void {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) return;
    for (const raw of line.slice(colonIdx + 1).split(',')) {
      const name = raw.replace(/\([^)]*\)/g, '').trim();
      if (name && name.length > 1) whitelist.add(name.toLowerCase());
    }
  }

  // Locate a section by its header prefix and extract up to the next blank line.
  function extractSection(header: RegExp): string | null {
    const m = prompt.match(new RegExp(header.source + '[^\\n]*\\n((?:[^\\n]+\\n)*?)\\n', 'i'));
    return m ? m[1] : null;
  }

  const lineupText = extractSection(/MOST RECENT STARTING LINEUP/);
  if (lineupText) {
    hasPlayerData = true;
    for (const line of lineupText.split('\n')) addNamesFromLine(line);
  }

  const squadText = extractSection(/SQUAD SUBMISSION/);
  if (squadText) {
    hasPlayerData = true;
    for (const line of squadText.split('\n')) addNamesFromLine(line);
  }

  // Cricket named squad (cricketdata.org) — the only player-name source for cricket.
  const cricketSquadText = extractSection(/ANNOUNCED SQUAD/);
  if (cricketSquadText) {
    hasPlayerData = true;
    for (const line of cricketSquadText.split('\n')) addNamesFromLine(line);
  }

  const injuryText = extractSection(/INJURY REPORT/);
  if (injuryText) {
    hasPlayerData = true;
    for (const line of injuryText.split('\n')) addNamesFromLine(line);
  }

  // KEY PERFORMERS — "Name 28 pts/5 reb/3 ast, Name2 19 pts/..." (stats are not
  // parenthesised, so take the text before the first digit as the player name).
  const keyPerfText = extractSection(/KEY PERFORMERS/);
  if (keyPerfText) {
    hasPlayerData = true;
    for (const line of keyPerfText.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      for (const raw of line.slice(colonIdx + 1).split(',')) {
        const m = raw.match(/^\s*([^\d]+?)\s+\d/);
        const name = (m ? m[1] : raw).trim();
        if (name && name.length > 1) whitelist.add(name.toLowerCase());
      }
    }
  }

  // FROM THE MEDIA — attributed news/tips. Names here come from REAL fetched
  // headlines, so they are allowed in the output (mediaWatch). Free text, so we
  // scan for capitalised multi-word names rather than a comma list. This does NOT
  // set hasPlayerData — media is editorial, not a confirmed lineup.
  const mediaText = extractSection(/FROM THE MEDIA/);
  if (mediaText) {
    const nameRe = /\b[A-ZÀ-Þ][a-zà-ÿ'’\-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’\-]+)+\b/g;
    for (const m of mediaText.matchAll(nameRe)) whitelist.add(m[0].toLowerCase());
  }

  // RECENT FORM / HEAD-TO-HEAD — these blocks list OTHER team names (past
  // opponents, e.g. "United States", "South Africa"). They are legitimate grounded
  // references, so whitelist multi-word team names here to avoid the player-name
  // validator flagging them. Does NOT set hasPlayerData — these are teams.
  const formText = extractSection(/RECENT FORM/);
  const h2hText  = extractSection(/HEAD-TO-HEAD/);
  const teamNameRe = /\b[A-ZÀ-Þ][a-zà-ÿ'’\-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’\-]+)+\b/g;
  for (const section of [formText, h2hText]) {
    if (!section) continue;
    for (const m of section.matchAll(teamNameRe)) whitelist.add(m[0].toLowerCase());
  }

  // Also whitelist coach names from HEAD COACHES line (they may be named in output)
  const coachM = prompt.match(/HEAD COACHES:\s*(.+)/);
  if (coachM) {
    for (const part of coachM[1].split('|')) {
      const c = part.indexOf(':');
      if (c >= 0) {
        const name = part.slice(c + 1).trim();
        if (name) whitelist.add(name.toLowerCase());
      }
    }
  }

  return { whitelist, hasPlayerData };
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a sharp sports analyst writing match previews for knowledgeable fans who want real insight, not broadcast colour commentary. Your tone is conversational but analytically precise — the most switched-on person in the room who happens to be great at explaining things clearly. You think in data and tactics, but you write in plain English. Never sound like you're presenting a stats deck or a coaching briefing. Sound like a smart friend who really knows the sport.

LANGUAGE RULES — strictly enforced:
• "Pitch/Ground" not "Field" (use "pitch" for football/soccer, "ground" for rugby/AFL)
• "Fixture" not "Game" or "Match" when referring to the scheduled contest
• "Ladder/Table" not "Standings"
• "Form" not "Performance Trends"
• "attack/defence" not "offense/defense"
• "half/quarter" not "period"
• Numbers as words under ten; numerals for 10 and above
• No statistical jargon — forbidden phrases: "noise", "signal", "early-season noise", "settled signal", "small sample", "sample size", "variance", "regression to the mean", "statistically meaningful", "data point". The underlying reasoning is sound; express it in plain English. Not "the ladder is noise" — say "four rounds doesn't tell you much about where this side will finish". Not "small-sample form" — say "only three games in". The insight stays; the jargon goes.
• British/Australian idioms where natural but not theatrical: "finals series", "the run-in", "relegation scrap", "top-four race", "wooden spoon", "premiership window"
• Avoid purple prose: no "theatre of sport", "story arcs", "compelling narratives", "backs against the wall drama". State the situation plainly.
• AFL scoring language: "score" and "scoring" in AFL refer to goals and behinds kicked in a game — never use them to mean ladder points or wins. "Yet to score" means the team hasn't kicked a goal; it does NOT mean winless. Use "yet to record a win", "winless so far", or better still don't recite it at all (the user can see the ladder).

VENUE AWARENESS — read the label, do not infer:
• The VENUE field in the data block is pre-computed against each team's registered home ground and will carry one of three explicit labels:
  — "{Team} HOME GROUND" → that team has genuine home advantage; crowd and fortress references are appropriate.
  — "NEUTRAL GROUND" → neither team's home; do NOT assert crowd advantage for either side.
• Never override this label using training-knowledge assumptions about where a team "usually" plays or where a series game is "traditionally" held. The label is authoritative.
• In series competitions (State of Origin, international Tests, cup finals), any game in the series may be designated home, away, or neutral regardless of game number — Game 1 is as likely to be neutral as Game 3. Use only the VENUE label provided.

DATA INTEGRITY — non-negotiable:
• Use ONLY the data provided. Do NOT invent statistics, player names, scorelines, or results not mentioned.
• Player names: only name a specific player if they appear in the MOST RECENT STARTING LINEUP or TEAM NEWS data. Do not name players drawn from your own training knowledge — this produces confident-sounding claims that may be outdated or simply wrong (e.g. a player transferred, dropped, or injured since your training cutoff). But the players who ARE listed are yours to reason about freely — naming them and reading their matchups is required, not risky (see GROUNDING).
• Coach/manager names: only name a coach or manager if their name appears in the HEAD COACHES line of the data block. Do not use training knowledge to supply a coaching name — coaching staff changes frequently, and inventing or misidentifying a name is worse than omitting it entirely. When HEAD COACHES is absent from the data, ALL tactical observations must use team-level attribution ("Australia press high and exploit channels", "their compact defensive block") — never a named individual. Using a coaching name not in HEAD COACHES is a grounding violation.
• If team news mentions injuries or absences, state their structural impact on the side — who covers that role, how it changes the setup.
• If a section has insufficient data to say something specific, write less — compress the section rather than filling it with generic observations. A short precise sentence is better than two vague ones.
• Do not fabricate head-to-head records or historical facts. If no head-to-head data is provided, omit historical comparison entirely.

INFORMATION ECONOMY — no redundant data:
• The user already sees W/D/L form icons, ladder positions, exact scores, points totals, and win/loss records displayed in the app. Repeating any of this is redundant and wastes the available space.
• The core rule: never state a number (wins, losses, draws, points, scorelines, positions) that the user can already read on screen. Every sentence must add something the data display cannot show — interpretation, cause, consequence, structural pattern.
• RECITE vs INTERPRET — the line that reconciles this with STATISTICAL ANGLE: RESTATING a visible number is banned; INTERPRETING one is required where the figure carries the analysis. "They sit on 147.9%" recites (banned). "Their 147.9% is the best in the league by a distance — they win by margins, not by grinding out tight ones" interprets (this IS the statistical angle). A figure may appear in your prose only when it is the SUBJECT of a conclusion, never as a standalone readout. The test before writing any number: am I restating what's on screen, or drawing a conclusion FROM it?
• INTERPRET ≠ INVENT — the number you interpret MUST already be present in the data block (a ladder figure, a percentage, a DERIVED FACT, the model tip). "Interpret a number" is NEVER licence to manufacture one to sound analytical. Concretely forbidden because they are NOT in the data: invented percentages ("a 73% retention rate", "2.13% advantage in inside 50s"), made-up possession/clearance/efficiency rates, fabricated "X of their last Y" splits ("lost three of their last four when leading at the half"). If no number in the data is worth interpreting, write the angle qualitatively or omit it — the statistical angle is optional, fabricating one is not allowed.
• This applies broadly. All of the following are forbidden regardless of phrasing:
  - Win/loss tallies in any form: "won four of their last five", "a record of five wins and two losses", "they've won three straight", "lost just once in eight"
  - Exact scorelines from past results: "beat Arsenal 2–1 last week", "a 3–0 win over City"
  - Points/position recitation: "sitting 6th with 31 points", "third on the table", "ranked 2nd"
  - Form string recitation: "their W-W-L-W-L run", "back-to-back wins"
• What to write instead — interpret, don't recite:
  - Not "won four of their last five" → "their attack has been consistent; the defensive question is whether it holds against better opposition"
  - Not "sitting third with 38 points" → "well placed for a top-four push but the gap is tightening"
  - Not "beat City 3–0 last month" → "their most recent head-to-head exposed City's high line against pace"
• Directional cues without counts are acceptable where they set up an analytical point: "arriving on the back of successive defeats", "unbeaten at home this season". These are acceptable only if they lead somewhere — not as standalone observations.
• FORM RESULT RECENCY — the form data shows results in sequence (most recent first) but contains NO round numbers or dates. Do not use time-anchored language ("last round", "last week", "last month", "recently", "just last week") for any specific result unless you are certain it was the most recent game (first in the sequence). For results in positions 2–5, use neutral phrases: "in their loss to the Sharks", "when they faced City", "against the Broncos earlier this season". Calling a third-game-ago result "last round" is factually wrong — the form data does not tell you when that game was played.
• RESULT ORDERING — when describing results in chronological narrative order ("they lost to X before beating Y"), you MUST reflect the array sequence accurately: the first item in the form list is the MOST RECENT game; later items happened EARLIER. So if results are [win vs A, loss vs B], chronologically the loss to B came first and the win over A came second. Getting this backwards produces factually wrong statements — double-check the sequence before using any "before/after/following/then" language.
• Forbidden vague momentum phrases — these assert something without saying anything: "building momentum", "hitting their stride", "finding their form", "growing in confidence", "on the rise", "firing on all cylinders", "clicking into gear". If form is genuinely positive, state the specific structural reason — what is working and why it matters for this fixture.
• For standings: state the stakes and what they mean structurally — not the coordinates that produced them. Point gaps and DERIVED FACTS exist to inform your REASONING; translate them into stakes ("effectively safe", "a converted try covers the gap", "still within touching distance of the eight") rather than quoting the raw figure ("leads by four points", "a 14-point buffer"). Quote an exact gap only when that single number is itself the decisive point of a sentence — and then it must match DERIVED FACTS verbatim.
• POSITION vs POINTS — understand the model, then use it correctly:
  HOW IT WORKS: Each result earns competition points (e.g. 2 pts for a win, 1 for a draw, 0 for a loss in most leagues). The total of those points determines a team's ordinal position on the ladder/table — 1st = most points, last = fewest. Position and points are two different things derived from the same underlying results; never conflate them.
  TALKING ABOUT THE POINTS TOTAL — acceptable phrases: "league points", "points on the table", "points tally", "competition points". Example: "Brisbane sit on 10 points" or "12 points from eight games".
  TALKING ABOUT THE ORDINAL RANK — acceptable phrases: "league position", "ladder position", "Xth on the ladder", "Xth on the table", "sitting in Xth". Example: "Brisbane sit 13th on the ladder".
  FORBIDDEN: "ladder points" — this phrase conflates the two concepts and is meaningless. Never use it. Never write "13 ladder points" when you mean 13th place. Never write "6 table points" when you mean 6th on the table.
• Defensive/offensive records: never cite a raw total in isolation ("52 points conceded", "14 goals scored"). A raw number is meaningless without context. Instead, express the record as a league rank — "the tightest defence in the competition", "conceding the fewest points of any side", "the second-highest scoring attack". If the data doesn't tell you where they rank, describe the quality directionally ("among the better defensive sides") rather than quoting a figure. The analytical question is always: where do they sit relative to the rest of the league?

INFORMATION BREADTH — use the whole data block, not just the ladder:
• The data block may carry several independent signals: recent form, head-to-head history, confirmed/likely lineups and injuries, key performers, league position and stakes, weather, and media. A strong preview is built on the MOST DECISIVE two-to-four of these for THIS specific fixture — it does not lean on the same one (usually the table) in every section.
• Vary the angle across the sections. If "context" is built on stakes/standings, then "tacticalBattle", "playerSpotlight" and "verdict" should each pull from a DIFFERENT signal — a personnel change or return, a head-to-head pattern, a stylistic mismatch, a weather factor, a key performer's role. Three sections that all restate the ladder position is a weak preview.
• keyInsights must each cover a DIFFERENT dimension wherever the data allows (e.g. one personnel/availability, one tactical matchup, one form or head-to-head trend) — never three rephrasings of the same point, and never three points all derived from the table.
• GRACEFUL OMISSION — if a signal is absent for this fixture (no head-to-head, no lineup, no weather, no media), simply say nothing about it and lean harder on the signals that ARE present. NEVER announce the absence ("no head-to-head data is available", "lineup unconfirmed", "weather unknown"), and NEVER invent the missing piece to fill the gap. Missing data narrows the available angles; it does not lower the bar for specificity on the angles you do have.
• RELEVANCE OVER COMPLETENESS — do not mechanically tour every available signal. Bring in a signal only when it changes how you read this fixture. An unremarkable, neutral data point is better left out entirely (see NO FILLER). Breadth means choosing the most telling signals, not listing all of them.

SCORING MARGIN CALIBRATION — interpret margins relative to the sport's scoring range:
• NRL Rugby League: scores routinely reach 30–50 pts per side. ≤10 pts margin = competitive; 11–20 pts = clear defeat; 21–30 pts = comfortable; 31+ pts = heavy/hammering. A 32–40 loss is an 8-point margin — that is a competitive defeat, NOT a heavy loss.
• AFL: scores routinely reach 60–130 pts per side. ≤15 pts = close; 15–30 pts = clear; 30–60 pts = comfortable; 60+ pts = heavy/flogging. The SCORE is not the margin — only the difference counts.
• EPL / Football (soccer): 1-goal margin = close; 2 goals = comfortable; 3+ goals = convincing/heavy.
• Super Rugby Pacific / Rugby Union Tests: ≤10 pts margin = competitive; 11–20 pts = clear; 21–30 pts = comfortable; 31+ pts = heavy.
• APPLY THIS ALWAYS: Before using words like "heavy", "comprehensive", "comfortable", "thrashing", "outscored heavily" — calculate the actual margin (not the raw score) and compare it to the sport's scale above. Never call a sub-10-point NRL defeat "heavy". Never call a sub-30-point AFL defeat "heavy".

CALIBRATING HOW MUCH WEIGHT TO GIVE THE DATA:
• The data block includes a SEASON PHASE field (e.g. "Round 4 of 27 — first third"). Use it to calibrate how strongly you can speak about trajectory, finals, or finishing places.
• Short form sample (≤3 results): Only discuss form momentum if there is a clear, specific pattern worth noting. If there isn't, omit it entirely — don't explain the absence, just move on.
• Genuinely striking early patterns ARE worth calling out: three straight wins by big margins, three straight heavy losses. State the pattern directly; don't qualify it to death.
• Uneven played counts: if one team has played significantly more games, mention it if it affects how you read the relative form.
• Weight the quality of opposition. Beating a bottom-half side in Round 2 tells you much less than beating a top-four rival.
• If a team's form tells a different story from their ladder position — strong play but mid-table, or flat form but high up — point that out. That tension is usually more interesting than the number itself.

SEASON STRUCTURE — authoritative source, non-negotiable:
• The COMPETITION PROFILE in the data block is the authoritative description of how this competition works: format, finals structure, qualification cutoffs, and key concepts. All statements about season structure, finals, qualification, relegation, or how the championship is decided MUST come from the COMPETITION PROFILE — never from your training knowledge about the competition.
• The SEASON STATE line tells you exactly where we are in the season. Use it — do not infer the season stage from the round number or team records alone.
• FINALS PROXIMITY — ABSOLUTE RULE: Do NOT describe finals, playoffs, or the end of the regular season as "near", "approaching", "weeks away", "looming", or any equivalent language unless the SEASON STATE phase is "run home" or "finals series". In early-season and mid-season phases, finals are not near — the DERIVED FACTS "Rounds until finals: N" is the authoritative figure; use it instead of invented time-based language.
• If COMPETITION PROFILE says "NO finals" (e.g. Premier League), do NOT write about a team's finals chances. If it says "Top 8 qualify," do NOT claim a different cutoff. If it says "NO relegation," do NOT reference relegation. Any claim about competition structure that contradicts the COMPETITION PROFILE is an error.
• Short competitions (Six Nations, Rugby Championship, Test series — under 6 rounds) are consequential from the first game — every result matters for the series outcome. The standard thirds/early-season framework does not apply; treat every fixture as meaningful from the outset.

• FIXTURE CONTEXT — when the data block contains a FIXTURE CONTEXT section, the Stakes label is authoritative (computed from live standings, not estimated). Do NOT describe the game's significance in a way that contradicts the Stakes label: if Stakes is FINALS RACE, do not say finals are assured; if ELIMINATED, do not imply survival is possible; if DEAD RUBBER, do not invent stakes.

COMPETITION STATUS — non-negotiable mathematical facts:
When the data block contains a "COMPETITION STATUS" section, those facts are mathematically certain — computed from the live points table and games remaining. They OVERRIDE any framing you might otherwise apply based on the seasonal-dynamics rules below. Do NOT soften, hedge, or contradict them.

• TITLE/MINOR PREMIERSHIP CLINCHED: The competition is already decided. Do NOT write as if the title is still winnable — it is not. Do NOT say "Arsenal know the title is within reach", "anything other than a win leaves the door open", "this result matters for the title race", or any similar phrase. The champion has won. Pivot the narrative entirely to what IS now at stake in this specific fixture: chasing a record points tally, extending an unbeaten run, a final league appearance, cup preparation, individual accolades (Golden Boot, Player of the Season), or what the opponent is still fighting for. The champion's narrative is consolidation and record-setting — not pursuit.

• CHAMPIONS LEAGUE / TOP-4 / FINALS SPOT CLINCHED: The achievement is secured. Focus on what still differentiates within the locked-in band — seeding advantages, goal difference, head-to-head records, or the opponent's remaining stakes.

• RELEGATED / FINALS ELIMINATED: The outcome is final regardless of this result. Frame the fixture around the opponent's stakes (they likely still have something to play for), dignity, damage limitation, avoiding a worst-ever statistical record, or preparation for next season.

• FULL LEAGUE TABLE in data block: Use it to accurately assess the points gaps between teams and games remaining. A team 15 points clear with 2 games left is in a categorically different position to a team 15 points clear with 10 games left. Always check the "remaining" column.

SEASONAL DYNAMICS — what trajectory language is permitted at each stage:
The SEASON PHASE line in the data block tells you exactly where we are. Apply the rules for the relevant third. These rules cover all standard league competitions (AFL, NRL, EPL, Super Rugby Pacific).

FIRST THIRD of the season:
— The table is too unsettled for projections about where teams will finish. FORBIDDEN language: "a loss here puts pressure on their finals calculations", "fighting for a top-eight spot", "in a relegation battle", "needs to string wins together to stay in contention", any phrasing that treats current position as predictive of final placement.
— EXCEPTION — genuine outliers only: a team with a substantial points lead or deficit relative to the entire field may be named with cautious language. For positive outliers: "setting themselves up for a strong finals campaign", "among the early frontrunners". For struggling outliers: "already starting to fall away from the pack". Reserve this ONLY for teams where the points gap is large enough to be meaningful — one or two positions of difference is not an outlier.
— Points totals matter as much as ladder position. A team on top with 8 points when second has 6 is not a meaningful gap. A team on top with 14 points when the field averages 4–6 is a genuine outlier.
— Spend the analytical space on what holds up regardless of season stage: structural matchup, coaching system, player availability, tactical disparity.
— If you note the stage of the season, do it once, briefly, as natural context — never as a formulaic opener or repeated hedge.

SECOND THIRD of the season:
— The table is starting to take shape. Measured trajectory talk is appropriate. You may note that a team is "building a genuine case for the finals", "in the mix for the top eight", "drifting toward the bottom of the table" — but only when grounded in both their position AND the points gaps around them.
— Points gaps are critical: if three points separate positions 5th through 10th, the table is compressed and language should be tentative ("in contention, but the field is tightly bunched"). If the gap between 8th and 9th is significant, name it.
— Do not call any result "season-defining" or "must-win" unless the points mathematics genuinely support it (e.g. a team already well behind the pack).

FINAL THIRD of the season:
— The table is largely crystallising. Strong, specific trajectory statements are appropriate. You may say a team "faces a genuine relegation fight", "is in contention for the final finals spot", "needs results from their remaining fixtures to reach the finals".
— Tie points totals, games remaining, and head-to-head records (if available) to ground these statements. A team five points behind the cutoff with six games remaining is in a different position to one five points behind with two games left.
— Be precise about the actual scenario rather than vague urgency. "Three wins from their last four would likely get them home" is better than "desperate for points".

ACROSS ALL THIRDS — the underlying principle:
— Never rely on ladder position alone. Always consider: the points total, the points gap to the relevant threshold (finals cutoff, relegation zone, top four, etc.), and games remaining. A team in 9th with the same points as 5th needs different language to a team in 9th ten points adrift.
— Short competition formats (Six Nations, Rugby Championship — 5–6 rounds total): every game is meaningful from Round 1. The thirds framework does not apply — treat every fixture as consequential from the outset.
— Super Rugby Pacific (14 rounds): the shorter format compresses the timeline. Apply thirds logic but with tighter thresholds — patterns become meaningful faster.

HISTORICAL ACCURACY — year-specific claims are the risk, not historical context:
• You may draw on your knowledge of genuine rivalries, historical patterns, and competition history where it adds analytical value. A Brisbane–Sydney AFL fixture, a Liverpool–Manchester United league match, or an All Blacks–Springboks Test all carry genuine historical weight — use it.
• The constraint is specificity without verification: NEVER cite a specific year, season, scoreline, or result unless the data block explicitly states it. Year-specific claims are a known hallucination failure mode.
• Forbidden patterns: "their 2024 Grand Final rematch", "last season's title fight (2025)", "the 2023 decider", "they met in the 2024 semi-final" — any claim that pins history to a specific date you cannot verify.
• Acceptable: "two clubs with a genuine finals rivalry", "a fixture that has defined the competition in recent seasons", "these sides have met at the business end before" — general historical framing grounded in knowledge you are confident about.
• HEAD-TO-HEAD DATA — when the data block contains a HEAD-TO-HEAD section, use it for the matchup TREND only: which side has tended to come out on top, whether recent meetings have been tight or one-sided, any home/away pattern. Do NOT recite the raw win-draw-loss record (a bare tally adds no insight), do NOT list past scorelines, and NEVER attach a year or date to any meeting — the data deliberately omits them. You may characterise the single most recent meeting qualitatively ("their last meeting was a tight, low-scoring affair") but only when you tie it to something tactical about THIS fixture. If there is no HEAD-TO-HEAD section, omit historical comparison entirely.
• NEVER state or imply a calendar year or season-year anywhere in the output (e.g. "winless in 2024", "since the 2025 season"). You do not know the current date. Describe timeframes only in relative, data-grounded terms ("winless so far this season", "across their recent run").
• Do NOT infer what "last season" means — you don't know the current date unless it is stated in the data.

COMPETITION CONTEXT — critical:
• The COMPETITION field tells you what is actually being played. The PRIMARY LEAGUE field (when present) is background only.
• For cup or European fixtures (e.g. Champions League, FA Cup, EFL Cup, Europa League, Rugby Championship, Six Nations), the "context" section must focus on the teams' form and journey in THAT competition — not their domestic league table position. A team's EPL standing is irrelevant to a Champions League preview.
• COMPETITION STAGE — mandatory disclosure: when a COMPETITION STAGE is provided in the data, you MUST state the round clearly in the opening sentence of the "context" section. For cup and European competitions, this is the single most important contextual fact — a fan needs to know immediately whether this is a group stage match, a quarter-final, or the final. State it plainly and early: "This is the FA Cup Fifth Round", "Arsenal face Chelsea in the quarter-final", "A place in the final is at stake". Do not bury the round deep in the section or omit it.
• When standings are labelled as "primary league context only", treat them as a footnote — do not lead with or centre the narrative on league position.
• The recent form covers all competitions. Acknowledge this naturally ("across all fronts", "in recent weeks") rather than implying it is competition-specific.
• TWO-LEGGED KNOCKOUT TIES: UEFA knockout rounds (Champions League, Europa League, Conference League) and most domestic cups are played over two legs on aggregate. A single leg is not a standalone elimination — both teams can progress from the first leg regardless of its result. Do not describe a first-leg draw or loss as existential ("need a result to keep hopes alive") unless the aggregate position actually eliminates a path to progress. State the tie situation plainly: "level on aggregate after the first leg" or "facing a deficit going into the second leg". If you do not have first-leg score data, acknowledge the two-legged format without fabricating the aggregate position.

• UEFA CHAMPIONS LEAGUE STRUCTURE (2024–25 format onwards) — know this precisely:
  LEAGUE PHASE ("Swiss Model"): 36 clubs (increased from 32) in a single table — no groups. Each club plays 8 matches against 8 different opponents drawn from four seeded pots (2 opponents per pot), 4 home and 4 away. Standard points (3W/1D).
  — 1st–8th: qualify directly for the Round of 16 (seeded; play second leg at home).
  — 9th–24th: enter two-legged knockout play-offs. Teams 9th–16th are seeded and host the second leg against teams 17th–24th. Winners advance to the Round of 16.
  — 25th–36th: eliminated entirely — they do NOT drop into the Europa League (old format dropped 3rd-place finishers into UEL; that no longer applies).
  KNOCKOUT PHASE: Play-offs (if applicable), Round of 16, quarter-finals, and semi-finals are all two-legged ties (home & away; no away goals rule — level on aggregate goes to extra time then penalties). The final is a single match at a neutral venue (2025/26 final: 30 May 2026, Puskás Aréna, Budapest).
  KEY IMPLICATION: a team finishing 9th has a meaningfully harder road than one finishing 8th — one gets a bye to the Round of 16, the other must win an extra two-legged tie first.

• PHASE TRANSITION — ABSOLUTE RULE, NO EXCEPTIONS: Once the knockout phase begins, the league phase does not exist for the purpose of this preview. This means:
  — DO NOT mention where either team finished in the league phase (not "9th", not "16th", not "top eight", nothing).
  — DO NOT reference league phase points, records, or unbeaten runs.
  — DO NOT apply UCL league phase qualification logic (e.g. "they need a result to stay in the top 24") — that logic only applies during the league phase, which is over.
  — DO NOT use your own training knowledge about where teams sat in the UCL table. That table is finished and irrelevant.
  — The ONLY things that matter in a knockout preview are: (1) the aggregate score and what result is needed to progress, (2) recent form across all competitions, (3) the tactical matchup.
  A knockout tie is binary — win and you're through, lose and you're out (on aggregate). Frame the stakes in exactly those terms.

• KNOCKOUT STAKES — state what progression actually means: For a second-leg knockout tie, the "context" section should cover: (1) the aggregate position and what result is needed to progress, (2) who the winner is likely to face in the next round if that information is available or reasonably known. This forward-looking context is analytically useful — a team playing a quarter-final against a weakened opponent faces a different strategic situation than one facing the tournament favourite. (This section applies only to two-legged knockout ties — not to finals. For finals, see CUP/COMPETITION FINAL below.)

• CUP/COMPETITION FINAL: When the data block shows COMPETITION STAGE as "THE FINAL", the rules are categorically different from any other fixture:
  — This is a single match, winner-takes-all. Do NOT use aggregate-score framing, "needing a result to stay alive", or two-leg language — none of it applies.
  — Open the "context" section by naming the competition and stating clearly that this is the final. Do not treat it as another knockout-round summary. The reader needs to feel immediately that this is the destination, not a step along the way.
  — HISTORICAL GROUNDING: Draw on your training knowledge of the clubs' records in this specific competition. How many times has each side reached this stage? Have they ever won it? A club in their first final, a club chasing a first title, a club completing an unprecedented run — these facts carry analytical weight and are reliable from training knowledge (without pinning a specific year or scoreline). Use them.
  — MULTI-TROPHY SIGNIFICANCE: If the data block shows that this team has already mathematically won another major competition (via any COMPETITION STATUS or DOMESTIC COMPETITION STATUS note), recognise that winning this final would mean winning multiple major trophies in the same season. This is rare in sport regardless of which competitions are involved. Lead the "context" section with it — it is the single most compelling narrative frame when it applies. Name what has already been won, name what is now at stake, and state plainly what winning tonight would mean.
  — Tone: the magnitude of a final is real — state it plainly without purple prose. "This is the Champions League Final" is enough; you do not need metaphors. The context, stakes, and tactical analysis should all reflect that everything the season has built toward culminates here.

COACHING ANALYSIS — when HEAD COACHES are provided:
• MANDATORY: When HEAD COACHES are provided in the data block, both coaches must be named by surname in the tacticalBattle field. Frame the tactical contest as a clash between two specific systems — "Postecoglou's high press against Dyche's compact mid-block", "Bellamy's defensive structure against Griffin's ball-in-hand attack". The name must connect to the system; do not drop names without analytical content.
• Sport-specific title conventions: In football/soccer use "manager". In AFL/NRL/rugby use "coach". For F1 the team principal is the relevant figure (covered in F1 section separately). Use the appropriate title naturally in the text — do not over-label.
• Use your knowledge of each coach's system and tendencies to inform the tactical analysis. This is especially important in football/soccer, where a manager's philosophy directly shapes how their side sets up — press triggers, defensive shape, width, set-piece approach, squad rotation habits.
• Examples of the kind of coach-specific insight that is analytically useful:
  - Sean Dyche (Everton): compact mid-block, physicality in duels, set-piece threat, direct in transition — this defines how Everton defend and how they create. A technically gifted opponent may exploit their lack of press variation.
  - Pep Guardiola (Man City): positional play, high line, full-backs inverting, overloads in wide zones — opponents that can sustain counter-pressure and exploit the space in behind can threaten.
  - Ange Postecoglou (Spurs): high press regardless of context, aggressive offside line, vertical attacking play — this produces both goals and goals conceded; the line between brilliant and chaotic is thin.
  - Mikel Arteta (Arsenal): structured build-up, inverted wide players, high pressing triggers, set-piece investment — opponents with direct runners who bypass the press can expose the high line.
  - Arne Slot (Liverpool): similar positional principles to Klopp but more structured transitions, press is more organised and less frantic — still expects high line and ball-dominant play.
• For AFL/NRL/rugby coaches, apply the same principle: identify their structural tendencies (e.g. defensive schemes, kick-to-run balance, risk appetite in attack) where these are well-established and relevant.
• Do NOT invent coaching tendencies you are not confident about. If you don't have reliable knowledge of a coach's system, refer to the team's play style based on results data instead.
• ABSENT HEAD COACHES — hard constraint: when HEAD COACHES is not in the data block, do NOT name any coach, manager, or team official anywhere in the output. Attribute all tactical observations to the team. This constraint has no exceptions — any coaching name not present in HEAD COACHES is forbidden regardless of confidence.
• Keep coach references analytical, not biographical. "Dyche's side will be compact and physical from the first whistle" is useful. "Dyche, who was appointed in January 2023..." is not.

LINEUP AND AVAILABILITY ANALYSIS:
• PLAYER NAMING RULE: Only name a specific player if they appear in one of: MOST RECENT STARTING LINEUP, TEAM NEWS, SQUAD SUBMISSION FOR THIS GAME, INJURY REPORT, or KEY PERFORMERS. Do not name players from your own training knowledge who are not referenced in the data — this produces confident-sounding claims that may be outdated (transferred, retired, dropped).
• PLAYER-TEAM ATTRIBUTION: A named player belongs ONLY to the team whose lineup/squad/injury/key-performer list contains them. Never attribute a player to the opponent, and never to a third team that appears only as a PAST OPPONENT in the RECENT FORM or HEAD-TO-HEAD data. Check which side's list a name came from before describing them.
• MOST RECENT STARTING LINEUP (when provided): Use as the baseline for predicting selection, adjusted for availability data. Focus on players in structurally important roles — the first-choice goalkeeper, the main ball-carrier, the primary playmaker, the key defensive pairing. Do not list every player; name only those whose presence or absence materially changes how the team sets up.
• SQUAD SUBMISSION (AFL — when SQUAD SUBMISSION FOR THIS GAME is provided): The "Absent vs last lineup" list shows players who were in the last game but are NOT in the 26-man submission — they are definitively unavailable. Assess each absent player's structural role and what the team loses. The "possible returns/inclusions" list shows players in the squad who weren't in the last lineup. Cross-reference with team news — if news confirms a player is returning from injury, state the positional and structural impact of their return. Player returns are analytically significant, especially when they restore a role that has been structurally weaker without them.
• INJURY REPORT (NRL/EPL/SRU — when INJURY REPORT is provided): "Out" = confirmed unavailable. "Doubtful" = significant doubt, likely to miss. Only name an injured player if they hold an important structural role (regular starter, key specialist). Do not list every injury; filter to the ones that materially affect the team's attacking or defensive capability. For key absences, explain who fills that role and whether it represents a genuine structural downgrade.
• Player returns are as analytically significant as absences. When a key player returns from injury, name them, state what they bring structurally, and explain how their inclusion changes the team's tactical options — whether that's restored aerial presence, additional ball-carrying load, or a reassembled combination that was broken during their absence.
• Integration: weave availability naturally into tacticalBattle (if it shifts the system), playerSpotlight (if a key absence or return is the pivotal storyline), and verdict (if availability is a genuine swing factor). Do NOT create a standalone injury-list paragraph — availability is context for tactical analysis, not a topic in itself.
• Do not speculate about absences with no data evidence. If a player is in the last lineup and not in the injury report, assume they will start.

WRITING STYLE:
• Present tense throughout — this is a preview, not a report.
• Write like an analyst, not a journalist. Prioritise clarity and precision over drama.
• Use the simplest language that accurately conveys the point. Complex or formal phrasing is only justified when it captures a distinction that plain language cannot. "The arithmetic still permits progress" → "either team can still progress". "The calculus of this fixture" → "what this result means". Default to plain words.
• Each section should be self-contained and direct. Avoid transitions that exist only for flow ("however", "meanwhile", "that said" used decoratively).
• Vary sentence length for readability, but never sacrifice precision for style.
• Avoid all clichés: "both sides will be looking to", "key battle will be in", "it promises to be", "all to play for", "must-win fixture", "clash of titans".
• NO FILLER — this is the hardest constraint. Every sentence must carry a specific, grounded observation. If you cannot say something specific and grounded, say nothing. A preview with two sharp sentences per section is better than one padded to three. "They will need to perform well" — filler. "Arteta's high line will be tested by their pace in behind" — grounded. When in doubt, cut.

WEATHER ANALYSIS — when WEATHER AT KICKOFF is provided in the data block:
• Integrate weather ONLY when conditions are genuinely notable:
  — Precipitation: >0.5mm in the kickoff hour, or >40% chance → worth considering
  — Wind: >25 km/h → significant for kicking sports; >40 km/h → dominant tactical factor
  — Temperature: <5°C or >32°C → affects handling and player endurance
  — Clear, mild weather: do NOT mention — it is neutral and adds nothing
• Sport-specific impacts — apply these, but ALWAYS connect to THESE specific teams:
  — AFL: Wind forces teams to kick against it; corridor play and handball chains become more important downwind. Rain makes marking contests messier and favours ground-level football. Teams with strong runners and tight defensive structures often benefit.
  — NRL: Rain slows the ball out wide — teams with powerful middle forwards who can grind through the ruck gain a structural edge over teams that rely on wide edges and fast play-the-ball. Wind >30 km/h means the kicking game (bomb, kick chase, field goals) becomes decisive; the team kicking with the wind has a clear territorial advantage.
  — Rugby Union (Super Rugby / Tests): Rain reduces ball speed through the hands; driving lineouts, pick-and-go sequences and tight forwards become more potent. Wet balls favour physically dominant packs. Wind >25 km/h makes the box kick and garryowen unpredictable and rewards teams that can manage territory rather than run the ball wide.
  — EPL/Football: Rain can slow a high-tempo, short-passing game and make the pitch heavy for direct runners. Strong crosswinds make aerial duels and long balls unpredictable; less impactful than in the ball-carrying codes. Heat (>30°C) favours the fitter, better-conditioned side in the second half.
• CRITICAL: Never state generic principles. Always say WHY weather favours or hurts THESE specific teams based on their known style and structure. "Rain will challenge [Team]'s wide-edge attacking game" is analytical. "Rain could affect the game" is filler and is forbidden.
• Integration: weave weather naturally into tacticalBattle and/or verdict. Do NOT create a standalone weather paragraph — weather is context for the tactical analysis, not a topic in itself.

F1 RACE PREVIEW — SECTION GUIDE (applies when the data block begins with "FORMULA 1"):
• "context": Championship situation — where the followed entity sits and what this race weekend means for their season. Reference the 2026 regulation changes when they're directly relevant to this circuit (e.g. active aero behaviour at Monza's straights vs Monaco's corners, MO deployment strategy).
• "tacticalBattle" (labelled "Field Form" in F1): Describe the current form and trajectory of the broader field — who has been quick over recent rounds, which constructors are performing above/below expectation under the new regs, key rivalries developing in the championship. Cover the whole grid at a high level; the followed driver/constructor gets extra depth but should not crowd out the field picture.
• "playerSpotlight" (labelled "Focus: {followed name}" in F1): At least 80% of this section must be directly about the FOLLOWED ENTITY named in the data block — their specific strengths/weaknesses at this circuit, how their car handles active aero and MO deployment, their championship trajectory, what this race means for them. Brief mention of rivals is only permitted when directly relevant to the followed entity's own situation (e.g. a points gap to their nearest rival). Do NOT lead with or centre on any other driver.
• "verdict": Key things to watch in this race weekend — specific overtaking opportunities, strategic scenarios (undercut/overcut windows, safety car beneficiaries, tyre strategy), weather factors, and what would constitute a successful weekend for the followed entity.

GROUNDING — construct grounded, specific reads; never fabricate facts:
• WHAT YOU SHOULD DO (this is the core of a good preview, not an afterthought): Reason about the players and teams THAT APPEAR IN THE DATA using your general understanding of the sport — their usual roles, playing styles, and how two named players' roles clash. Naming a concrete contest between listed participants ("the halfback duel: <A> vs <B>", "<X> at fullback against <Y>'s kicking game", "<striker>'s pace at <centre-back>'s recovery") is exactly what KEY MATCHUP wants and is NOT a grounding violation. A qualitative read of how one listed player matches up against another listed player is ANALYSIS, not fabrication — provided you invent no numbers and name no one outside the data.
• THE PLAIN-ENGLISH LINE: Inventing FACTS is forbidden; reasoning about the named participants is REQUIRED. Do not retreat to abstract positional groups ("the middle forwards", "their midfield engine", "the back three") when the lineup hands you actual names to build the contest around — that under-uses the data and produces identical boilerplate for every fixture. Pick the names and read the clash.
• COUCH SPECULATION: any read that extends beyond what the data literally states must be couched as a tendency ("tends to", "on recent evidence", "likely", "usually") — never asserted as established fact. A couched, specific read is far better than a hedge-free generic one.
• HARD BANS — unchanged, no exceptions:
  - Only cite statistics, percentages, rankings, or records explicitly present in the data block below. Never invent numbers. If a stat is not in the data, do not state it.
  - Do NOT attach a specific per-player statline to any player unless those exact figures appear in a KEY PERFORMERS line. This covers both raw counts (tackle counts, turnovers, goals, metres, points, assists) AND narrative-stat claims ("hasn't missed a tackle in two games", "has scored in every match", "averaging 30 touches"). Describing a listed player's ROLE and STYLE qualitatively is required and fine; attaching ANY number or quantified streak to them without KEY PERFORMERS data is a grounding violation — the most common one. If there is no KEY PERFORMERS data, reason about the player purely in qualitative terms.
  - Only name individual players whose names appear in the provided STARTING LINEUP, SQUAD, TEAM NEWS, INJURY REPORT or KEY PERFORMERS sections. If no player data is provided, name no player — describe roles and patterns instead.
  - Only name a coach/manager present in the HEAD COACHES line (see DATA INTEGRITY).
• Tactical observations and situational framing drawn from the data are encouraged. Invented statistics presented as fact are not.
• DERIVED FACTS — when the data block contains a DERIVED FACTS section, every points gap, standings margin, or competition arithmetic figure MUST be taken verbatim from that section. Do NOT compute your own ladder arithmetic. Do NOT round, rephrase, or approximate derived figures. If a gap you want to discuss is not listed in DERIVED FACTS, describe the situation qualitatively (e.g. "well clear of the finals") rather than quoting any number.
• GROUP TOURNAMENT (World Cup) — the GROUP DERIVED FACTS block gives each team's GROUP record (points, played, W-D-L, goal difference, current group position) and stake. Any group-standing or qualification claim in ANY field MUST come from there, verbatim. NEVER describe a team's group record using the all-competitions RECENT FORM line (e.g. a team that has played one group game has NOT "won one and drawn one" — that conflates their tournament form with the group). The group position in GROUP DERIVED FACTS is the live rank; do not re-derive it.
• DERIVED FACTS BINDS THE "context" FIELD TOO — this is where standings errors slip in. Any points total, gap, or inside/outside-the-finals (top-eight) claim in the context field must come VERBATIM from DERIVED FACTS — including the DIRECTION. If DERIVED FACTS says a side is "N points inside the finals places", they are INSIDE — never write "outside". Never source a standings number from anywhere else: not the LEAGUE TABLE rows, not the SEASON STATE round number, not your own arithmetic. THE ROUND-NUMBER TRAP: "Round 13 of 27" is the ROUND, not a points total — never write "level on 13 points" off the round number. If DERIVED FACTS does not give the figure or direction you want, state it qualitatively ("both sides level and inside the eight") rather than inventing a number or a direction.
• EXPERT MODEL PREDICTIONS margin — when a predicted winning margin is provided, you may round it or express it as a range consistent with that figure (e.g. "around 40" or "40+" for a 43-point tip). Do NOT cite a margin that contradicts the prediction — if the tip says 43 points, do not write "15 points" or "a close finish".

STRUCTURE — four elements required in every preview, distributed naturally across the sections:
• KEY MATCHUP: Name the single most decisive tactical or personnel contest — the specific duel where the fixture will be decided. Build it from ACTUAL NAMED PARTICIPANTS in the data wherever a lineup/squad is supplied (a real halfback-vs-halfback or striker-vs-defender read), not abstract positional groups. One concrete clash, not a general overview.
• RECENT FORM: What each side's last few results reveal structurally — pattern and cause, not scorelines. Connect it directly to this fixture.
• STATISTICAL ANGLE: One meaningful number or comparative record that frames the game (ranked in the league where possible), used by INTERPRETATION not recitation — state the conclusion the figure supports, not the figure as a scoreboard readout (see RECITE vs INTERPRET under INFORMATION ECONOMY). The number must be one that ACTUALLY APPEARS in the data block — never invent a statistic to interpret. Only include it if it adds genuine analytical weight; if the data carries no number worth interpreting, omit this element rather than fabricating one.
• REASONED PREDICTION: The most probable outcome with specific reasoning. Name the decisive factor. No hedged non-answers.

These four elements must appear across the response — they do not need to be labelled separately.

FROM THE MEDIA — the "mediaWatch" field (attributed editorial, strict rules):
• "mediaWatch" is an array of short talking points (0–4 items) sourced ONLY from the FROM THE MEDIA block in the data — the fetched news headlines and the model tip. It is rendered to readers under a "From the media" heading, clearly separated from your own analysis.
• Everything in mediaWatch must be ATTRIBUTED as reporting or opinion, never stated as fact: "Reports suggest…", "[Side] are reportedly…", "The tipsters lean toward…", "Local press flag…", "Expected to start as per last week…". Never present a media item as your own factual claim.
• Sources must be REAL. Paraphrase the gist of an actual provided headline or the actual tip figures. Do NOT fabricate quotes, invent outlet names, or attribute words to a named outlet that it did not say. If the data names no outlet, attribute generically ("reports", "the tipsters") — do not invent one.
• This is the ONLY place news, tips, and expected-lineup ("likely XI per last match") framing may appear. Do NOT let news headlines or the model tip leak into "context", "tacticalBattle", "playerSpotlight", "verdict", or "keyInsights" as if they were established fact — those fields use only the structured data (standings, derived facts, lineups, injuries).
• If the data block contains no FROM THE MEDIA block, OMIT the mediaWatch field entirely (do not output an empty array, do not invent talking points).
• Player names appearing in a real provided headline MAY be named in mediaWatch (with attribution) even if they are not in the lineup/squad data — they came from a real source. Do not introduce names that appear nowhere in the data.

OUTPUT — respond ONLY with a valid JSON object. No markdown code fences. No extra text before or after the JSON:
{
  "context": "1–3 sentences. Specific situational setup: where each side sits in this competition and what concretely is at stake in this fixture. No generic importance statements — only state stakes that are factually grounded in the data (e.g. finals position, relegation gap, cup progression). Any points total, gap, or inside/outside-the-finals claim here MUST come verbatim from DERIVED FACTS, direction included — never from the round number, the raw table, or your own arithmetic (see DERIVED FACTS BINDS THE context FIELD). If the fixture has no distinctive stakes, state the form and position plainly and move on.",
  "tacticalBattle": "2–3 sentences. When HEAD COACHES are provided in the data block, open by naming both coaches by surname and framing the contest as a clash of their systems (e.g. 'Postecoglou's high press faces Dyche's compact mid-block'). When HEAD COACHES is absent, describe the contest using team-level attribution only — no coaching names. Then name the specific structural contest where this fixture will be decided. Use sport-specific terminology. Do not describe tactics generically.",
  "playerSpotlight": "REQUIRED — never return an empty string. FOR F1: lead with the FOLLOWED ENTITY's full name (the driver or constructor marked '◄ FOLLOWED' in the data block). At least 80% of this section must be directly about that followed driver/constructor — their form, this circuit's characteristics relative to their strengths, championship situation. Only mention other drivers when it directly contextualises the followed entity's own position. FOR ALL OTHER SPORTS: if player data appears in the data block (lineup/squad/injury report/team news), name the single most analytically compelling player from that data and connect them to the specific gamestate. If the data block contains a NO PLAYER DATA notice, describe the decisive tactical unit or positional role instead — never invent or assume a player name from training knowledge, even if you are confident about the squad.",
  "verdict": "2–3 sentences. The most probable outcome based on the available data, with the specific reasoning. If there is a genuine swing factor grounded in the data (an injury, a set-piece disparity, a form gap), name it. Do not add a generic hedge — if the outcome is uncertain, state why it is uncertain specifically.",
  "keyInsights": [
    "Specific analytical point grounded in the data (max ~12 words)",
    "Specific analytical point grounded in the data (max ~12 words)",
    "Specific analytical point grounded in the data (max ~12 words)"
  ],
  "mediaWatch": [
    "Attributed talking point sourced from the FROM THE MEDIA block — e.g. 'Reports suggest…', 'The tipsters lean toward…', 'Expected to line up as per last week…' (max ~20 words)",
    "Another attributed angle, only if the data supports it"
  ]
}`;

// ─── Data block construction ──────────────────────────────────────────────────

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formString(results: GameResult[]): string {
  return results.map(r => r.isDraw ? 'D' : r.isWin ? 'W' : 'L').join('-');
}

function formDetail(results: GameResult[], limit = 3): string {
  return results.slice(0, limit).map(r => {
    const verb = r.isDraw ? 'drew with' : r.isWin ? 'def.' : 'lost to';
    return `${verb} ${r.opponent} ${r.teamScore}–${r.opponentScore}`;
  }).join('; ');
}

// ─── F1 data block ────────────────────────────────────────────────────────────

function buildF1DataBlock(context: PreviewContext): string {
  const lines: string[] = [];

  lines.push(`FORMULA 1 — ${context.f1RaceName ?? 'Race'} (${context.f1SessionType ?? 'Race'})`);
  if (context.f1CircuitName) lines.push(`Circuit: ${context.f1CircuitName}`);
  if (context.f1RoundNumber) lines.push(`Season Round: ${context.f1RoundNumber} · 2026 F1 World Championship`);
  lines.push('');

  if (context.f1FollowedName) {
    const typeLabel = context.f1FollowedType === 'driver'
      ? `Driver · ${context.f1FollowedConstructorName ?? ''}`
      : 'Constructor';
    lines.push(`FOLLOWED ENTITY: ${context.f1FollowedName} (${typeLabel})`);
    lines.push('');
  }

  if (context.f1DriverStandings && context.f1DriverStandings.length > 0) {
    const roundLabel = context.f1RecentRaceResults && context.f1RecentRaceResults.length > 0
      ? ` (after Round ${context.f1RecentRaceResults[context.f1RecentRaceResults.length - 1].round})`
      : '';
    lines.push(`DRIVERS' CHAMPIONSHIP${roundLabel}:`);
    context.f1DriverStandings.slice(0, 15).forEach(d => {
      const winsNote = d.wins > 0 ? `, ${d.wins} win${d.wins > 1 ? 's' : ''}` : '';
      const followedMarker = d.driverName === context.f1FollowedName ? ' ◄ FOLLOWED' : '';
      lines.push(`  P${d.position}. ${d.driverName} [${d.constructorName}] — ${d.points}pts${winsNote}${followedMarker}`);
    });
    lines.push('');
  }

  if (context.f1ConstructorStandings && context.f1ConstructorStandings.length > 0) {
    lines.push("CONSTRUCTORS' CHAMPIONSHIP:");
    context.f1ConstructorStandings.forEach(c => {
      const followedMarker = c.constructorName === context.f1FollowedConstructorName ? ' ◄ FOLLOWED' : '';
      const winsNote = c.wins > 0 ? `, ${c.wins} win${c.wins > 1 ? 's' : ''}` : '';
      lines.push(`  P${c.position}. ${c.constructorName} — ${c.points}pts${winsNote}${followedMarker}`);
    });
    lines.push('');
  }

  if (context.f1RecentRaceResults && context.f1RecentRaceResults.length > 0) {
    lines.push('RECENT RACE RESULTS:');
    // Show most recent first
    const sorted = [...context.f1RecentRaceResults].sort((a, b) => b.round - a.round);
    sorted.forEach(race => {
      lines.push(`  Round ${race.round} — ${race.raceName}:`);
      const top5 = race.results.slice(0, 5).map(r =>
        `P${r.position}: ${r.driverName.split(' ').pop()} (${r.constructorName.split(' ').slice(-1)[0]})`
      ).join(', ');
      lines.push(`    Top 5: ${top5}`);
      // Highlight followed entity
      if (context.f1FollowedName && context.f1FollowedType === 'driver') {
        const followedResult = race.results.find(r => r.driverName === context.f1FollowedName);
        if (followedResult) {
          lines.push(`    ${context.f1FollowedName}: P${followedResult.position}`);
        } else {
          lines.push(`    ${context.f1FollowedName}: outside top 10`);
        }
      } else if (context.f1FollowedConstructorName) {
        const constructorResults = race.results.filter(r =>
          r.constructorName === context.f1FollowedConstructorName ||
          r.constructorName.includes(context.f1FollowedConstructorName ?? '')
        );
        if (constructorResults.length > 0) {
          const positions = constructorResults.map(r => `P${r.position} (${r.driverName.split(' ').pop()})`).join(', ');
          lines.push(`    ${context.f1FollowedConstructorName}: ${positions}`);
        }
      }
    });
    lines.push('');
  }

  if (context.f1QualifyingGrid && context.f1QualifyingGrid.length > 0) {
    lines.push('STARTING GRID (post-qualifying — race day order):');
    context.f1QualifyingGrid.forEach(entry => {
      const followedMarker = entry.driverName === context.f1FollowedName ? ' ◄ FOLLOWED' : '';
      const time = entry.q3 ?? entry.q2 ?? entry.q1 ?? '';
      const constructor = entry.constructorName.split(' ').slice(-1)[0];
      lines.push(`  P${entry.position}: ${entry.driverName} (${constructor})${time ? ` ${time}` : ''}${followedMarker}`);
    });
    lines.push('');
  }

  lines.push(`Generate the race preview using only the data provided above. Do not invent statistics, driver names not mentioned, or historical records not given.`);
  return lines.join('\n');
}

// ─── Cricket data block ───────────────────────────────────────────────────────

function buildCricketDataBlock(
  league: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  venue?: string,
): string {
  const c = context.cricketContext ?? {};
  const lines: string[] = [];

  lines.push(`FIXTURE: ${teamName} vs ${opponentName}`);
  const venueStr = c.venue || venue;
  if (venueStr) lines.push(`VENUE: ${venueStr} (cricket — treat as a neutral tournament/host venue unless the side is the designated host)`);
  lines.push(`COMPETITION: ${c.seriesName || LEAGUE_LABELS[league] || league}`);
  lines.push('');

  // Match context — format is authoritative for how the game is played.
  lines.push('CRICKET MATCH CONTEXT:');
  if (c.format)    lines.push(`  Format: ${c.format}${c.matchDesc ? ` — ${c.matchDesc}` : ''}`);
  else if (c.matchDesc) lines.push(`  ${c.matchDesc}`);
  if (c.seriesName) lines.push(`  Series/Tournament: ${c.seriesName}`);
  if (c.status) {
    const stage = c.ended ? 'completed result' : c.started ? 'in progress' : 'scheduled — not yet started';
    lines.push(`  Match status: ${c.status} (${stage})`);
  }
  if (c.toss)    lines.push(`  Toss: ${c.toss}`);
  if (c.started && (c.teamScoreLine || c.opponentScoreLine)) {
    if (c.teamScoreLine)     lines.push(`  ${teamName}: ${c.teamScoreLine}`);
    if (c.opponentScoreLine) lines.push(`  ${opponentName}: ${c.opponentScoreLine}`);
  }
  lines.push('');

  // Recent form (this series/tournament) — qualitative, no scorelines.
  if (c.teamRecentResults && c.teamRecentResults.length > 0) {
    lines.push('RECENT FORM (this series/tournament, most recent first):');
    lines.push(`  ${teamName}: ${c.teamRecentResults.join('; ')}`);
    lines.push('');
  }
  if (c.h2hNote) {
    lines.push('HEAD-TO-HEAD (matchup trend only — no scores, years or dates):');
    lines.push(`  ${c.h2hNote}.`);
    lines.push('');
  }

  // Named squad — the ONLY source of player names for cricket (provenance label).
  const teamSquad = context.teamSquad ?? [];
  const oppSquad  = context.opponentSquad ?? [];
  const hasPlayerData = teamSquad.length > 0 || oppSquad.length > 0;
  if (hasPlayerData) {
    lines.push('ANNOUNCED SQUAD (named players in the official squad for this fixture — a selection guide, not a confirmed XI; may change at the toss):');
    if (teamSquad.length > 0) lines.push(`  ${teamName}: ${teamSquad.join(', ')}`);
    if (oppSquad.length  > 0) lines.push(`  ${opponentName}: ${oppSquad.join(', ')}`);
    lines.push('');
  }

  // Sport vocabulary + coaches.
  lines.push(`SPORT: ${SPORT_CONTEXT[league] ?? ''}`);
  if (context.teamManager || context.opponentManager) {
    const t = context.teamManager ? `${teamName}: ${context.teamManager}` : '';
    const o = context.opponentManager ? `${opponentName}: ${context.opponentManager}` : '';
    lines.push(`HEAD COACHES: ${[t, o].filter(Boolean).join(' | ')}`);
  }
  lines.push('');

  // Trailing player-data sentinel (mirrors the generic block so the validators behave).
  if (hasPlayerData) {
    lines.push('PLAYER NAMING CONSTRAINT: Only name players listed in the ANNOUNCED SQUAD section above (plus any names in a FROM THE MEDIA block, with attribution). Any player name from outside the data is forbidden — even if you know the side from your training data. Do NOT attach a statline (runs, wickets, strike rate, average) to any player — no per-player numbers are provided.');
  } else {
    lines.push('NO PLAYER DATA: No squad has been published for this fixture yet. Do NOT name any individual player; describe roles and units (top order, the spinners, the death bowlers) instead. Inventing player names from training knowledge is a grounding violation.');
  }
  lines.push('');
  lines.push('Generate the cricket match preview using only the data provided above. Do not invent statistics, scorelines, player names, or historical records not given.');

  return lines.join('\n');
}

/**
 * Parses ESPN's abbreviated series summary (e.g. "NY leads series 3-1") and
 * returns an unambiguous SERIES STATE line using the full team names from the
 * fixture, so the AI never has to interpret abbreviations.
 *
 * Matching strategy: compare ESPN's leader hint against the initials of each
 * team name (e.g. "NY" → "NYK" for "New York Knicks" → starts-with match).
 * Falls back to word-prefix matching. Returns null if ambiguous.
 */
function deriveSeriesState(
  summary: string,
  teamName: string,
  opponentName: string,
): string | null {
  const m = summary.match(/^(.+?)\s+leads?\s+series?\s+(\d+)[–\-](\d+)/i);
  if (!m) return null;

  const hint       = m[1].trim();
  const leaderWins = parseInt(m[2], 10);
  const trailerWins = parseInt(m[3], 10);
  const winsNeeded = 4 - leaderWins; // NBA/NHL playoffs are best-of-7

  const initials = (name: string) =>
    name.split(/\s+/).map(w => w[0].toUpperCase()).join('');
  const hintUp = hint.toUpperCase().replace(/[^A-Z]/g, '');
  const teamInit = initials(teamName);
  const oppInit  = initials(opponentName);

  // Match by initials prefix (e.g. "NY" matches "NYK" for New York Knicks)
  let leaderName: string, trailerName: string;
  if (teamInit.startsWith(hintUp) || hintUp.startsWith(teamInit.slice(0, 2))) {
    leaderName = teamName; trailerName = opponentName;
  } else if (oppInit.startsWith(hintUp) || hintUp.startsWith(oppInit.slice(0, 2))) {
    leaderName = opponentName; trailerName = teamName;
  } else {
    // Word-level fallback
    const hintLow = hint.toLowerCase();
    const teamWords = teamName.toLowerCase().split(/\s+/);
    const oppWords  = opponentName.toLowerCase().split(/\s+/);
    if (teamWords.some(w => hintLow === w || (w.length >= 3 && hintLow.startsWith(w.slice(0, 3))))) {
      leaderName = teamName; trailerName = opponentName;
    } else if (oppWords.some(w => hintLow === w || (w.length >= 3 && hintLow.startsWith(w.slice(0, 3))))) {
      leaderName = opponentName; trailerName = teamName;
    } else {
      return null;
    }
  }

  const clinchVerb = 'clinch the series';
  const mustWin    = 4 - trailerWins;
  return [
    `SERIES STATE: ${leaderName} LEAD ${leaderWins}–${trailerWins} and need ${winsNeeded} more win${winsNeeded !== 1 ? 's' : ''} to ${clinchVerb}.`,
    `${trailerName} TRAIL ${trailerWins}–${leaderWins} and must win ${mustWin} consecutive game${mustWin !== 1 ? 's' : ''} to come back.`,
    `CRITICAL: Do NOT describe ${trailerName} as "close to clinching", "one win away", or use any language suggesting they are the leading team.`,
    `Do NOT describe ${leaderName} as "down", "trailing", or "needing a miracle comeback".`,
  ].join(' ');
}

export function buildDataBlock(
  league: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  teamResults: GameResult[],
  oppResults: GameResult[],
  competition?: string,
  compact?: boolean,
  weather?: WeatherData,
  venue?: string,
  isHome?: boolean,
  teamId?: string,
  opponentId?: string,
  seriesSummary?: string,
  enabledBlocks?: Set<BlockId>,
): string {
  // ─── F1 — completely different data model ────────────────────────────────
  if (league === 'f1' && context.f1RaceName) {
    return buildF1DataBlock(context);
  }

  // ─── Cricket — its own data model (innings/squads, no league ladder) ──────
  if ((league === 'bbl' || league === 'cricket_int') && context.cricketContext) {
    return buildCricketDataBlock(league, teamName, opponentName, context, venue);
  }

  const enabled = (id: BlockId): boolean => !enabledBlocks || enabledBlocks.has(id);

  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  // A fixture is "off-league" when it's in a cup or European tournament that
  // genuinely differs from the primary league (e.g. CL, FA Cup, RC). NBA
  // playoffs are organized by the NBA itself, so playoff labels like
  // "NBA Finals - Game 5" are NOT off-league — the competition profile applies.
  const isOffLeague = !!competition && league !== 'nba';
  // Detect a cup/European final — single match, not two-legged.
  // 'Final' is set by normaliseRoundName() in the preview route; 'semi' guard avoids
  // matching 'Semi-finals' (which ARE two-legged ties).
  const isFinal = (() => {
    const cs = context.competitionStage;
    return !!cs && !cs.isGroupPhase &&
      /\bfinal\b/i.test(cs.roundName) && !/semi/i.test(cs.roundName);
  })();
  const lines: string[] = [];

  // Compute totalRounds and played early — used by both sportContext and standings blocks
  const totalRounds = LEAGUE_TOTAL_ROUNDS[league];
  const played      = context.teamStanding?.played ?? context.opponentStanding?.played;

  lines.push(`FIXTURE: ${teamName} vs ${opponentName}`);
  // World Cup: only the three host nations (USA, Canada, Mexico) have home advantage.
  // ESPN assigns home/away for scheduling but that designation is meaningless for all
  // other nations — every non-host game is played on neutral ground.
  const WC_HOST_IDS = new Set(['wc-usa', 'wc-canada', 'wc-mexico']);
  const effectiveIsHome = (league === 'world_cup' && !WC_HOST_IDS.has(teamId ?? '') && !WC_HOST_IDS.has(opponentId ?? ''))
    ? undefined
    : isHome;
  const venueLine = classifyVenue(venue, teamName, opponentName, teamId ?? '', opponentId, effectiveIsHome);
  if (venueLine) lines.push(venueLine);
  lines.push(`COMPETITION: ${competition ?? leagueLabel}`);
  if (isOffLeague) {
    lines.push(`PRIMARY LEAGUE: ${leagueLabel} (background context only — this preview is about the ${competition})`);
  }
  // Official series score from ESPN — preferred over results-based computation
  // because it's always available at heartbeat time (no lookback results needed).
  if (seriesSummary) {
    lines.push(`SERIES SCORE (official, before this game): ${seriesSummary}`);
    // Derive an unambiguous SERIES STATE line using full team names so the model
    // never has to interpret ESPN's abbreviated summary (e.g. "NY leads series 3-1").
    const seriesState = deriveSeriesState(seriesSummary, teamName, opponentName);
    if (seriesState) lines.push(seriesState);
  }

  // Playoff/cup series: compute series score from completed results so the AI
  // never has to count from raw form (and can't hallucinate it).
  // Triggered when the competition label looks like "X - Game N".
  // Skip when official series data is already present above.
  if (!seriesSummary && competition && /\s[-–]\s*game\s+\d+/i.test(competition)) {
    const seriesPrefix = competition.replace(/\s*[-–]\s*game\s+\d+.*/i, '').trim();
    const inSeries = teamResults.filter(r =>
      r.opponent === opponentName &&
      r.competition &&
      r.competition.toLowerCase().startsWith(seriesPrefix.toLowerCase()),
    );
    if (inSeries.length > 0) {
      const wins   = inSeries.filter(r => r.isWin).length;
      const losses = inSeries.filter(r => !r.isWin).length;
      const total  = wins + losses;
      const scoreLine = wins === losses
        ? `Series tied ${wins}–${losses}`
        : wins > losses
          ? `${teamName} lead ${wins}–${losses}`
          : `${opponentName} lead ${losses}–${wins}`;
      lines.push(`SERIES SCORE (before this game, based on ${total} completed game${total !== 1 ? 's' : ''}): ${scoreLine}`);
    }
  }
  // World Cup: tournament stage label injected early for immediate context
  if (league === 'world_cup' && context.worldCup) {
    const { stage, group, opponentTBD, opponentPlaceholder } = context.worldCup;
    lines.push(`TOURNAMENT STAGE: ${wcStageLabel(stage, group)}`);
    if (stage !== 'group') {
      lines.push(`ADVANCEMENT STAKES: ${wcKnockoutStake(stage)}`);
    }
    if (opponentTBD) {
      lines.push(
        `NOTE: Opponent not yet determined (bracket placeholder: ${opponentPlaceholder ?? 'TBD'}). ` +
        `Do NOT fabricate an opponent name, predict head-to-head dynamics, or assume a likely opponent from training knowledge.`,
      );
    }
  }
  // Competition stage (cup/European competitions only)
  if (context.competitionStage) {
    const { competitionStage: cs } = context;
    if (cs.isGroupPhase) {
      lines.push(`COMPETITION STAGE: ${cs.groupName ?? 'Group/League Phase'}`);
    } else if (isFinal) {
      lines.push(
        `COMPETITION STAGE: THE FINAL — single match at a neutral venue. ` +
        `Winner-takes-all: 90 minutes (plus extra time and penalties if level after 90). ` +
        `There is no second leg, no aggregate score. The winner lifts the trophy. ` +
        `This is the highest-stakes fixture in this competition.`
      );
    } else {
      lines.push(`COMPETITION STAGE: ${cs.roundName} (two-legged knockout tie — league phase records are now irrelevant; this tie is decided on aggregate over both legs only)`);
    }
  }
  // First-leg result for knockout ties — gives Claude the aggregate position.
  // Finals are single matches — no first-leg result exists.
  if (context.firstLegResult && !isFinal) {
    const { teamScore: ts, opponentScore: os } = context.firstLegResult;
    const aggLine = ts === os
      ? `Level ${ts}–${os} on aggregate — either team can win the tie`
      : ts > os
        ? `${teamName} lead ${ts}–${os} on aggregate — ${opponentName} must score to stay alive`
        : `${opponentName} lead ${os}–${ts} on aggregate — ${teamName} must overturn the deficit`;
    lines.push(`TIE AGGREGATE (second leg): ${aggLine}`);
  }
  // Opponent league tier — critical for cup fixtures involving lower-division clubs
  if (context.opponentLeague) {
    lines.push(`OPPONENT LEAGUE: ${opponentName} are currently playing in the ${context.opponentLeague} (NOT the Premier League). Factor this division gap into the analysis — do not describe them as a PL side or in a PL relegation battle.`);
    lines.push('');
  }

  if (enabled('fixtureContext')) {
    // Representative-series state (State of Origin) — replaces the club ladder,
    // which doesn't apply to rep teams. Authoritative, derived from the live series.
    if (context.seriesState) {
      lines.push(`SERIES STATE (authoritative — this is a representative series, NOT a club ladder fixture): ${context.seriesState}`);
      lines.push('');
    }

    // For finals: surface domestic competition status (title clinched, etc.) even though
    // the full league table is suppressed as irrelevant to the cup fixture.
    // This gives Claude the "double" narrative context when a team has already won the league.
    if (isFinal && context.leagueTable && context.leagueTable.length > 0) {
      const domTotalRounds = LEAGUE_TOTAL_ROUNDS[league];
      if (domTotalRounds) {
        const statusNotes = computeCompetitionStatus(league, context.leagueTable);
        if (statusNotes.length > 0) {
          lines.push('DOMESTIC COMPETITION STATUS (key context for this fixture — informs the "double" narrative; the final itself is independent of league position):');
          statusNotes.forEach(n => lines.push(`  ⚠ ${n}`));
          lines.push('');
        }
      }
    }

    // ── Fixture context (deterministic phase + stakes label) ────────────────────
    // Resolves a Phase and Stakes label from live standings and tournament state.
    // Only injected for first-wave leagues; omitted when stakes = STANDARD.
    if (!isOffLeague) {
      const fixtureCtxPlayed = context.teamStanding?.played ?? context.opponentStanding?.played;
      const fixtureCtx = resolveCompetitionContext(
        league,
        context.leagueTable ?? [],
        teamName,
        opponentName,
        fixtureCtxPlayed,
        context.worldCup ?? undefined,
        context.fixtureDate,
      );
      if (fixtureCtx.stakes !== 'STANDARD') {
        lines.push('FIXTURE CONTEXT (authoritative — derived from live standings):');
        lines.push(`  Phase: ${fixtureCtx.phase}`);
        const stakesLine = fixtureCtx.explanation
          ? `  Stakes: ${fixtureCtx.stakes} — ${fixtureCtx.explanation}`
          : `  Stakes: ${fixtureCtx.stakes}`;
        lines.push(stakesLine);
        lines.push('');
      }
    }
  }

  if (enabled('competitionProfile')) {
    // ── Competition profile (static) ────────────────────────────────────────────
    // Injected for primary-league fixtures so the model knows exactly how the
    // competition works — format, finals structure, qualification cutoffs.
    const compProfile = !isOffLeague ? getCompetitionProfile(league) : null;
    if (compProfile) {
      lines.push(`COMPETITION PROFILE — ${compProfile.name} (authoritative — use this for all season-structure, finals, qualification, and relegation statements):`);
      lines.push(compProfile.profile);
      lines.push('');
    }
  }

  if (enabled('sportContext')) {
    lines.push(`SPORT: ${sportCtx}`);

    // ── Season state (computed) ──────────────────────────────────────────────────
    if (!isOffLeague && totalRounds && played !== undefined && league !== 'world_cup') {
      const quarter   = Math.ceil(totalRounds / 4);
      const third     = Math.ceil(totalRounds / 3);
      const runHomeCutoff = Math.floor(totalRounds * 0.65);
      const isFinalsPhase = played >= totalRounds; // regular season complete
      const phase =
        isFinalsPhase      ? 'finals series'
        : played <= quarter    ? 'early season'
        : played <= runHomeCutoff ? 'mid-season'
        : 'run home — final stretch of the regular season';
      const roundsRemaining = totalRounds - played;

      const teamRemaining = context.teamStanding?.played !== undefined
        ? Math.max(0, totalRounds - context.teamStanding.played) : undefined;
      const oppRemaining  = context.opponentStanding?.played !== undefined
        ? Math.max(0, totalRounds - context.opponentStanding.played) : undefined;

      const remParts: string[] = [];
      if (teamRemaining !== undefined) remParts.push(`${teamName}: ${teamRemaining} remaining`);
      if (oppRemaining  !== undefined) remParts.push(`${opponentName}: ${oppRemaining} remaining`);

      // Finals: name the round from the date (the feed carries no stage label) so
      // the model never reads a knockout final as "Round N of N, regular season".
      const finalsRound = isFinalsPhase ? finalsRoundForDate(league, context.fixtureDate) : null;
      if (isFinalsPhase && finalsRound) {
        const decider = finalsRound.decider ? ' — the championship decider' : '';
        lines.push(
          `SEASON STATE: FINALS SERIES — ${finalsRound.name}${decider}. ` +
          `The ${totalRounds}-round regular season is COMPLETE; this is a knockout final, NOT a ladder fixture. ` +
          `The ladder below shows regular-season finishing order (seeding only).`
        );
      } else {
        lines.push(
          `SEASON STATE: Round ${played} of ${totalRounds} — ` +
          `${roundsRemaining} round${roundsRemaining !== 1 ? 's' : ''} left in regular season` +
          (isFinalsPhase ? ' (FINALS SERIES UNDERWAY)' : ` (phase: ${phase})`)
        );
        if (remParts.length > 0) lines.push(`  Games remaining: ${remParts.join(' | ')}`);
      }
    }
    if (context.teamManager || context.opponentManager) {
      const teamMgr = context.teamManager ? `${teamName}: ${context.teamManager}` : '';
      const oppMgr  = context.opponentManager ? `${opponentName}: ${context.opponentManager}` : '';
      lines.push(`HEAD COACHES: ${[teamMgr, oppMgr].filter(Boolean).join(' | ')}`);
    }
    lines.push('');
  }

  // World Cup: group standings table + advancement scenario
  if (enabled('worldCupGroup') && league === 'world_cup' && context.worldCup?.groupTable && context.worldCup.groupTable.length > 0) {
    const wc = context.worldCup;
    const wcGroupTable = wc.groupTable as WorldCupGroupRow[];
    const groupNotStarted = wcGroupTable.every(r => r.played === 0);

    if (groupNotStarted) {
      // Suppress the all-zeros table — it carries no information and misleads the model.
      // Instead inject the group composition so the model knows who else they face.
      lines.push(`GROUP ${wc.group ?? ''} COMPOSITION (group stage not yet begun):`);
      for (const row of wcGroupTable) {
        const isTracked = row.teamName === teamName || row.teamName === opponentName;
        lines.push(`  ${row.position}. ${row.teamName}${isTracked ? ' ◄' : ''}`);
      }
      lines.push('');
      lines.push(`ADVANCEMENT NOTE: Top 2 from Group ${wc.group ?? ''} advance automatically; the best 8 third-placed teams across all 12 groups also advance.`);
      lines.push('DO NOT comment on the standings or points tally — no games have been played yet. Focus on the match itself: tactics, form, key players, and what each team needs to do to win.');
    } else {
      // Recompute the live standing from the rules — the feed's `position` is the
      // draw/seeding order (it ranks 0-pt teams above 3-pt teams), so render in
      // corrected order and pre-compute the per-team group facts + stakes.
      const { ranked: wcRanked, lines: wcFacts } =
        buildWorldCupGroupFacts(wcGroupTable, wc.group ?? '', teamName, opponentName);

      lines.push(`GROUP ${wc.group ?? ''} STANDINGS (live — ranked by points, then goal difference, then goals scored; top 2 advance automatically, best 8 third-placed teams also advance):`);
      wcRanked.forEach((row, i) => {
        const gd = row.goalDifference >= 0 ? `+${row.goalDifference}` : `${row.goalDifference}`;
        const isTracked = row.teamName === teamName || row.teamName === opponentName;
        const marker = isTracked ? ' ◄' : '';
        lines.push(
          `  ${i + 1}. ${row.teamName.padEnd(22)} ${row.played}P  ` +
          `${row.wins}W ${row.draws}D ${row.losses}L  ` +
          `${row.points}pts  GD ${gd}  GF ${row.goalsFor}  GA ${row.goalsAgainst}${marker}`,
        );
      });
      lines.push('');
      // Spell out per-team match counts so the model cannot misread the table
      // and incorrectly claim all teams are "yet to play" when some have results.
      const matchTally = wcRanked.map(r => `${r.teamName}: ${r.played}`).join('  ');
      lines.push(`Matches played per team — ${matchTally}`);
      const teamRow2  = wcGroupTable.find(r => r.teamName === teamName);
      const oppRow2   = wcGroupTable.find(r => r.teamName === opponentName);
      const fixtureUnplayed  = (teamRow2?.played ?? 0) === 0 && (oppRow2?.played ?? 0) === 0;
      const othersHavePlayed = wcGroupTable.some(
        r => r.teamName !== teamName && r.teamName !== opponentName && r.played > 0,
      );
      if (fixtureUnplayed && othersHavePlayed) {
        lines.push(
          `This is ${teamName} and ${opponentName}'s opening group game (0 matches played each). ` +
          `Other matches in Group ${wc.group ?? ''} have already taken place — do NOT describe the group as unplayed or say all four teams are yet to play.`,
        );
      }
      lines.push('');
      // GROUP DERIVED FACTS — authoritative per-team group records + stakes.
      // (The feed's `advancementScenario` is built off the wrong seeding position,
      // so it is intentionally NOT rendered — these computed facts replace it.)
      lines.push(...wcFacts);
      lines.push('');
      if (wc.gamesPlayed !== undefined) {
        lines.push(`Tournament progress: ${teamName} has played ${wc.gamesPlayed} of 3 group games (${wc.gamesRemaining ?? 0} remaining in group stage).`);
      }
      lines.push('');
    }
  }

  if (enabled('standings')) {
    // Cup/European competition group/league-phase standings (highest relevance)
    const cs = context.competitionStage;
    if (cs?.isGroupPhase && (cs.teamStanding || cs.opponentStanding)) {
      lines.push(`${(competition ?? 'COMPETITION').toUpperCase()} STANDINGS (${cs.groupName ?? 'League Phase'}):`);
      for (const [name, s] of [
        [teamName, cs.teamStanding],
        [opponentName, cs.opponentStanding],
      ] as const) {
        if (!s) continue;
        const draws = s.draws > 0 ? ` ${s.draws}D` : '';
        const record = `${s.wins}W${draws} ${s.losses}L`;
        lines.push(`  ${name}: rank ${s.position} — played ${s.played}, ${record}, competition points: ${s.points ?? 0}`);
      }
      lines.push('');
    }

    // Ladder/Table positions — suppressed for cup/off-league fixtures and knockout-phase ties.
    // When a game is in any non-primary competition (isOffLeague=true), the domestic
    // league table has zero bearing on the cup result; including it only invites the
    // model to misuse it. Exception: F1 driver championship standing is always relevant.
    const isKnockoutTie = !!cs && !cs.isGroupPhase;
    const suppressStandings = (isOffLeague && league !== 'f1') || isKnockoutTie || league === 'world_cup';
    if (!suppressStandings) {
      const isF1Standing = league === 'f1';

      if (isF1Standing) {
        // F1: show driver championship standing only
        if (context.teamStanding) {
          lines.push('DRIVERS\' CHAMPIONSHIP STANDING:');
          const s = context.teamStanding;
          const constructor = s.constructorName ? ` (${s.constructorName})` : '';
          lines.push(`  ${teamName}${constructor}: ${ordinalSuffix(s.position)} in Championship — ${s.wins} wins, ${s.points ?? 0} pts`);
          lines.push('');
        }
      } else if (context.leagueTable && context.leagueTable.length > 0 && totalRounds) {
        // Knockout final (Grand Final / Semi): the regular-season ladder is SEEDING
        // only and actively misleads the model ("1st → minor premiership"). Replace
        // the full table + derived-finals arithmetic with a one-line seeding note;
        // FIXTURE CONTEXT + SEASON STATE carry the knockout-final framing.
        const isFinalsKnockout = played !== undefined && played >= totalRounds
          && !!finalsRoundForDate(league, context.fixtureDate);
        if (isFinalsKnockout) {
          const sorted   = [...context.leagueTable].sort((a, b) => a.position - b.position);
          const tRow = sorted.find(r => rowMatchesTeam(r.name, teamName));
          const oRow = sorted.find(r => rowMatchesTeam(r.name, opponentName));
          const seedParts = [
            tRow ? `${teamName} finished ${ordinalSuffix(tRow.position)}` : '',
            oRow ? `${opponentName} finished ${ordinalSuffix(oRow.position)}` : '',
          ].filter(Boolean);
          if (seedParts.length > 0) {
            lines.push('REGULAR-SEASON SEEDING (context only — this is a knockout final; the ladder no longer applies and there is no "minor premiership" or finals-cutoff at stake here):');
            lines.push(`  ${seedParts.join('; ')} in the regular season.`);
            lines.push('');
          }
        } else {
          // Full table with mathematical status analysis
          const statusNotes = computeCompetitionStatus(league, context.leagueTable);
          const tableLines  = buildTableSection(league, context.leagueTable, teamName, opponentName, totalRounds);

          if (tableLines.length > 0) {
            lines.push(...tableLines);
            lines.push('');
          }

          if (statusNotes.length > 0) {
            lines.push('COMPETITION STATUS (mathematically confirmed — non-negotiable facts):');
            statusNotes.forEach(n => lines.push(`  ⚠ ${n}`));
            lines.push('');
          }

          // Derived standings arithmetic — pre-computed so the model never has to
          const derivedFacts = buildDerivedFacts(league, context.leagueTable, teamName, opponentName, played, totalRounds);
          if (derivedFacts.length > 0) {
            lines.push(...derivedFacts);
            lines.push('');
          }
        }
      } else if (context.teamStanding || context.opponentStanding) {
        // Fallback: just the two teams' rows (no full table available)
        lines.push('CURRENT LADDER/TABLE POSITIONS (rank = place in competition, 1st = top):');
        for (const [name, s] of [
          [teamName, context.teamStanding],
          [opponentName, context.opponentStanding],
        ] as [string, typeof context.teamStanding][]) {
          if (!s) continue;
          const draws = s.draws > 0 ? ` ${s.draws}D` : '';
          const record = `${s.wins}W${draws} ${s.losses}L`;
          const extra = s.points !== undefined
            ? `, competition points: ${s.points}`
            : s.percentage !== undefined
              ? `, percentage: ${s.percentage.toFixed(1)}%`
              : '';
          lines.push(`  ${name}: rank ${s.position} — played ${s.played}, ${record}${extra}`);
        }
        lines.push('');
      }
    }
  }

  // Recent form prefers the context fields (populated from ESPN's lastFiveGames /
  // Squiggle games by the fetchers); falls back to positional results otherwise.
  const tForm = context.teamRecentForm ?? teamResults;
  const oForm = context.opponentRecentForm ?? oppResults;

  if (enabled('recentForm')) {
    // Recent form — spans all competitions
    if (tForm.length > 0 || oForm.length > 0) {
      const isF1 = league === 'f1';
      const formHeading = isF1
        ? 'RECENT FORM — Race Results (most recent first):'
        : isOffLeague
          ? 'RECENT FORM — all competitions (last 5 fixtures, most recent first):'
          : 'RECENT FORM (last 5 fixtures, most recent first):';
      lines.push(formHeading);
      if (tForm.length > 0) {
        if (isF1) {
          // For F1: format as "P{position} — {race name}" instead of W/L score
          const f1FormStr = tForm.map(r => `P${r.teamScore} — ${r.opponent}`).join('; ');
          lines.push(`  ${teamName}: ${f1FormStr}`);
        } else {
          lines.push(`  ${teamName}: ${formString(tForm)} — ${formDetail(tForm)}`);
        }
      }
      if (oForm.length > 0 && league !== 'f1') {
        lines.push(`  ${opponentName}: ${formString(oForm)} — ${formDetail(oForm)}`);
      }
      lines.push('');
    }
  }

  // Head-to-head — recent meetings between the two sides. Deliberately omits years
  // (the system prompt forbids citing specific years) and presents an aggregate
  // plus the most recent margin as analytical context, not a recitable record.
  if (enabled('headToHead')) {
    const h2h = context.headToHead ?? [];
    if (h2h.length >= 2 && league !== 'f1') {
      const w = h2h.filter(m => m.result === 'W').length;
      const l = h2h.filter(m => m.result === 'L').length;
      // Qualitative only — no raw scorelines (the model must not recite them) and
      // no years/dates. A trend descriptor + the most-recent outcome (W/L/D + venue).
      const trend = w > l ? `${teamName} have had the better of recent meetings`
        : l > w ? `${opponentName} have had the better of recent meetings`
        : 'recent meetings have been evenly split';
      const last = h2h[0];
      const venueNote = last.teamWasHome === true ? ' at home'
        : last.teamWasHome === false ? ' away' : '';
      const lastVerb = last.result === 'D' ? 'drew' : last.result === 'W' ? 'won' : 'lost';
      lines.push(`HEAD-TO-HEAD (matchup trend only — no scores, years or dates are given; use for context, do NOT recite a record):`);
      lines.push(`  Over the last ${h2h.length} meetings, ${trend}.`);
      lines.push(`  Most recently, ${teamName} ${lastVerb}${venueNote}.`);
      lines.push('');
    }
  }

  if (enabled('personnel')) {
    // Recent starting lineups
    const teamLineup = context.teamLastLineup ?? [];
    const oppLineup  = context.opponentLastLineup ?? [];
    if (teamLineup.length > 0 || oppLineup.length > 0) {
      lines.push('MOST RECENT STARTING LINEUP (from each side\'s last completed game — a likely-selection guide, NOT a confirmed teamsheet for this fixture):');
      if (teamLineup.length > 0)
        lines.push(`  ${teamName}: ${teamLineup.join(', ')}`);
      if (oppLineup.length > 0)
        lines.push(`  ${opponentName}: ${oppLineup.join(', ')}`);
      lines.push('');
    }

    // Player availability — squad (AFL) and injury report (NRL/EPL/SRU)
    const teamSquad = context.teamSquad ?? [];
    const oppSquad  = context.opponentSquad ?? [];
    const teamInj   = context.teamInjuryReport ?? [];
    const oppInj    = context.opponentInjuryReport ?? [];

    if (teamSquad.length > 0 || oppSquad.length > 0) {
      // AFL: 26-man squad submission — compare against last lineup to surface ins/outs
      lines.push('SQUAD SUBMISSION FOR THIS GAME (official 26-man AFL selection):');
      const teamLineupSet = new Set((context.teamLastLineup ?? []).map(n => n.toLowerCase()));
      const oppLineupSet  = new Set((context.opponentLastLineup ?? []).map(n => n.toLowerCase()));

      for (const [name, squad, lineupSet] of [
        [teamName,     teamSquad, teamLineupSet],
        [opponentName, oppSquad,  oppLineupSet],
      ] as [string, string[], Set<string>][]) {
        if (squad.length === 0) continue;
        const squadSet = new Set(squad.map((n: string) => n.toLowerCase()));
        // Players in last lineup but NOT in current squad → likely absent
        const absent   = (lineupSet.size > 0)
          ? Array.from(lineupSet).filter((n: string) => !squadSet.has(n)).map((n: string) =>
              squad.find((s: string) => s.toLowerCase() === n) ?? n,
            )
          : [];
        // Players in current squad NOT in last lineup → possible return or new inclusion
        const returns  = (lineupSet.size > 0)
          ? squad.filter((n: string) => !lineupSet.has(n.toLowerCase()))
          : [];

        lines.push(`  ${name} (${squad.length} players): ${squad.join(', ')}`);
        if (absent.length > 0)  lines.push(`  → Absent vs last lineup (likely out): ${absent.join(', ')}`);
        if (returns.length > 0 && returns.length <= 6) lines.push(`  → In squad, not in last lineup (possible returns/inclusions): ${returns.join(', ')}`);
      }
      lines.push('');
    }

    if (teamInj.length > 0 || oppInj.length > 0) {
      lines.push('INJURY REPORT (confirmed/likely unavailable for this fixture):');
      const fmtInjuries = (injuries: Array<{ name: string; status: string }>) =>
        injuries.map(i => `${i.name} (${i.status})`).join(', ');
      if (teamInj.length > 0) lines.push(`  ${teamName}: ${fmtInjuries(teamInj)}`);
      if (oppInj.length > 0)  lines.push(`  ${opponentName}: ${fmtInjuries(oppInj)}`);
      lines.push('');
    }

    // Key players from the most recent game (basketball / any sport that supplies them)
    const teamKP = context.teamKeyPlayers ?? [];
    const oppKP  = context.opponentKeyPlayers ?? [];
    if (teamKP.length > 0 || oppKP.length > 0) {
      const gameLabel = context.keyPlayersGameLabel ? ` (${context.keyPlayersGameLabel})` : '';
      lines.push(`KEY PERFORMERS — most recent game${gameLabel}:`);
      if (teamKP.length > 0)
        lines.push(`  ${teamName}: ${teamKP.map(p => `${p.name} ${p.stats}`).join(', ')}`);
      if (oppKP.length > 0)
        lines.push(`  ${opponentName}: ${oppKP.map(p => `${p.name} ${p.stats}`).join(', ')}`);
      lines.push('');
    }
  }

  // Player-data availability — reflects the actual fixture data, independent of the
  // personnel toggle. (Block-independent so the trailing sentinel below stays
  // invariant across the sandbox's block-decomposition; see the sentinel note.)
  const hasPlayerData = (
    (context.teamLastLineup?.length ?? 0) > 0 || (context.opponentLastLineup?.length ?? 0) > 0 ||
    (context.teamSquad?.length ?? 0) > 0 || (context.opponentSquad?.length ?? 0) > 0 ||
    (context.teamInjuryReport?.length ?? 0) > 0 || (context.opponentInjuryReport?.length ?? 0) > 0 ||
    (context.teamKeyPlayers?.length ?? 0) > 0 || (context.opponentKeyPlayers?.length ?? 0) > 0
  );

  if (enabled('mediaWatch')) {
    // FROM THE MEDIA — attributed editorial source material (news headlines + model
    // tips). This is the ONLY home for subjective/predictive content; it feeds the
    // "mediaWatch" output field, never the factual prose. Suppressed when empty.
    const teamNews = context.teamNews ?? [];
    const oppNews  = context.opponentNews ?? [];
    const hasNews  = teamNews.length > 0 || oppNews.length > 0;
    const hasTips  = !!context.tips;
    if (hasNews || hasTips) {
      lines.push('FROM THE MEDIA (attributed editorial source material — present these as reporting or opinion with attribution, NEVER as your own factual claim; paraphrase, do not fabricate quotes):');
      if (hasNews) {
        lines.push('  RECENT HEADLINES (may be speculative or outdated):');
        teamNews.slice(0, 3).forEach(n => {
          const desc = n.description ? ` — ${n.description.slice(0, 100)}` : '';
          lines.push(`    ${teamName}: "${n.headline}"${desc}`);
        });
        oppNews.slice(0, 3).forEach(n => {
          const desc = n.description ? ` — ${n.description.slice(0, 100)}` : '';
          lines.push(`    ${opponentName}: "${n.headline}"${desc}`);
        });
      }
      if (hasTips) {
        const t = context.tips!;
        // Keep the exact "average predicted winning margin: N points" phrasing —
        // validatePointsClaims keys off it to bound any margin claim in the output.
        lines.push(`  MODEL TIP (a prediction, not a result): ${t.tipsFor} of ${t.tipsTotal} models tip ${t.favouriteTeam}, average predicted winning margin: ${t.avgMargin} points`);
      }
      lines.push('');
    }
  }

  if (enabled('weather')) {
    // Weather at kickoff — only included when conditions are notable. Prefers the
    // context field (populated by buildPreviewContext for outdoor leagues); falls
    // back to the positional weather arg.
    const wx = context.weather ?? weather;
    if (wx && wx.isNotable) {
      lines.push(`WEATHER AT KICKOFF: ${wx.icon} ${wx.description}`);
      lines.push(`  Temperature: ${wx.tempC}°C`);
      if (wx.precipMm > 0.5)    lines.push(`  Precipitation: ${wx.precipMm}mm (${wx.precipProbability}% chance)`);
      if (wx.windKmh > 25)      lines.push(`  Wind: ${wx.windKmh} km/h`);
      lines.push('');
    }
  }

  if (compact) {
    lines.push('');
    lines.push('BREVITY MODE — this preview appears in a league-wide fixture list alongside many other games. Be concise:');
    lines.push('• "context": ONE sentence, max 25 words. Essential narrative only — what is at stake.');
    lines.push('• "tacticalBattle": ONE sentence, max 20 words. The single decisive match-up.');
    lines.push(`• "playerSpotlight": REQUIRED. ${hasPlayerData ? 'Player full name (from the player data above) + one specific phrase about their gamestate impact, max 12 words total. Never empty.' : 'Decisive tactical unit or role, max 12 words. NO player names — describe the system, not an individual.'}`);

    lines.push('• "verdict": ONE sentence, max 20 words. Most likely outcome and why.');
    lines.push('• "keyInsights": exactly TWO specific, grounded points, max 8 words each — no filler.');
  }
  // Player-data availability sentinel — emitted AFTER every data block so it is the
  // model's final signal, and so it always sits in the trailing footer (invariant
  // across block toggles, which keeps the sandbox decomposition byte-faithful).
  if (hasPlayerData) {
    lines.push('PLAYER NAMING CONSTRAINT: Only name players explicitly listed in the MOST RECENT STARTING LINEUP, SQUAD SUBMISSION, INJURY REPORT, or KEY PERFORMERS sections above (plus any names in the FROM THE MEDIA block, with attribution). Any player name from outside the data is forbidden — even if you know who plays for the team from your training data.');
    lines.push('');
  } else {
    lines.push('NO PLAYER DATA: No lineup, squad, or injury report is available for this fixture. Do NOT name any individual player in any field. The playerSpotlight field must describe a tactical unit, position group, or system — never a named individual. Inventing player names from training knowledge is a grounding violation. (Names appearing in the FROM THE MEDIA block may be cited in mediaWatch with attribution.)');
    lines.push('');
  }

  lines.push(hasPlayerData
    ? 'Generate the match preview using the data provided above. Do not invent statistics, historical records, or player names not in the sections above.'
    : 'Generate the match preview using the data provided above. Do not invent statistics or historical records not given. IMPORTANT: no player data was provided — the playerSpotlight field must describe a tactical role or positional unit, never a named individual player.'
  );

  return lines.join('\n');
}

/**
 * Assembles the LLM user-message from the fixture context.
 *
 * @param enabledBlocks - when provided, only these blocks are included. When omitted, all blocks
 *   are included and the output is byte-identical to buildDataBlock with the same args.
 */
export function assemblePrompt(
  league: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  teamResults: GameResult[],
  oppResults: GameResult[],
  competition?: string,
  compact?: boolean,
  weather?: WeatherData,
  venue?: string,
  isHome?: boolean,
  teamId?: string,
  opponentId?: string,
  seriesSummary?: string,
  enabledBlocks?: Set<BlockId>,
): string {
  return buildDataBlock(
    league, teamName, opponentName, context, teamResults, oppResults,
    competition, compact, weather, venue, isHome, teamId, opponentId, seriesSummary,
    enabledBlocks,
  );
}

/** Finds lines present in `full` but absent in `without` (preserving order). */
function diffRemoved(full: string, without: string): string {
  const fullLines  = full.split('\n');
  const withLines  = without.split('\n');
  const removed: string[] = [];
  let j = 0;
  for (const line of fullLines) {
    if (j < withLines.length && line === withLines[j]) {
      j++;
    } else {
      removed.push(line);
    }
  }
  return removed.join('\n');
}

/** Longest common trailing line-run shared by two assembled prompts. */
function commonSuffix(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  let i = al.length - 1;
  let j = bl.length - 1;
  const suffix: string[] = [];
  while (i >= 0 && j >= 0 && al[i] === bl[j]) {
    suffix.unshift(al[i]);
    i--; j--;
  }
  return suffix.join('\n');
}

/** Removes a known trailing line-run from a prompt. */
function stripSuffix(full: string, suffix: string): string {
  if (!suffix) return full;
  const fl = full.split('\n');
  const sl = suffix.split('\n');
  return fl.slice(0, fl.length - sl.length).join('\n');
}

/**
 * Decomposes the assembled prompt into per-block text plus a shared footer, for
 * sandbox use. The footer (player-data sentinel + closing instruction) is always
 * appended last by buildDataBlock regardless of which blocks are enabled, so it
 * is extracted separately rather than folded into matchFacts.
 *
 * Faithfulness contract: with every block enabled,
 *   [matchFacts, ...toggleableBlocks].map(b => b.text).filter(Boolean).join('\n')
 *   + '\n' + footer
 * reproduces buildDataBlock(...) byte-for-byte. (Verified by diff in
 * scripts/verify-sandbox-faithful.ts.)
 */
export function buildBlocks(
  league: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  teamResults: GameResult[],
  oppResults: GameResult[],
  competition?: string,
  compact?: boolean,
  weather?: WeatherData,
  venue?: string,
  isHome?: boolean,
  teamId?: string,
  opponentId?: string,
  seriesSummary?: string,
): { blocks: BlockResult[]; footer: string } {
  const full = buildDataBlock(
    league, teamName, opponentName, context, teamResults, oppResults,
    competition, compact, weather, venue, isHome, teamId, opponentId, seriesSummary,
  );

  // matchFacts is always-on; the matchFacts-only prompt is matchFacts text + footer.
  const matchFactsOnly = buildDataBlock(
    league, teamName, opponentName, context, teamResults, oppResults,
    competition, compact, weather, venue, isHome, teamId, opponentId, seriesSummary,
    new Set<BlockId>(['matchFacts']),
  );

  // Footer = the trailing lines shared by the full prompt and the matchFacts-only
  // prompt — i.e. the part that belongs to no toggleable block.
  const footer = commonSuffix(full, matchFactsOnly);

  const blocks = BLOCK_ORDER.map(id => {
    if (id === 'matchFacts') {
      // matchFacts text = the matchFacts-only prompt with the shared footer removed.
      return { id, label: BLOCK_LABELS[id], text: stripSuffix(matchFactsOnly, footer) };
    }
    // For toggleable blocks: build without this block, diff to find what it contributes.
    const others = new Set(BLOCK_ORDER.filter(b => b !== id));
    const without = buildDataBlock(
      league, teamName, opponentName, context, teamResults, oppResults,
      competition, compact, weather, venue, isHome, teamId, opponentId, seriesSummary,
      others,
    );
    return { id, label: BLOCK_LABELS[id], text: diffRemoved(full, without) };
  });

  return { blocks, footer };
}

export function buildUpdatePrompt(
  previous: AIPreview,
  teamName: string,
  opponentName: string,
  teamNews: { headline: string; description?: string }[],
  oppNews:  { headline: string; description?: string }[],
  context?: PreviewContext,
): string {
  const lines: string[] = [
    'The following match preview was generated earlier. It remains accurate for the fixture context, tactical analysis, and ladder positions.',
    '',
    'EXISTING PREVIEW:',
    JSON.stringify(previous),
    '',
    'NEW INFORMATION has emerged since this preview was written:',
    'UPDATED TEAM NEWS & HEADLINES:',
  ];
  teamNews.slice(0, 4).forEach(n => {
    const desc = n.description ? ` — ${n.description.slice(0, 120)}` : '';
    lines.push(`  ${teamName}: "${n.headline}"${desc}`);
  });
  oppNews.slice(0, 4).forEach(n => {
    const desc = n.description ? ` — ${n.description.slice(0, 120)}` : '';
    lines.push(`  ${opponentName}: "${n.headline}"${desc}`);
  });
  // Include squad/injury updates if available
  if (context?.teamSquad?.length || context?.opponentSquad?.length) {
    lines.push('');
    lines.push('UPDATED SQUAD DATA (official selection for this game):');
    if (context.teamSquad?.length)   lines.push(`  ${teamName}: ${context.teamSquad.join(', ')}`);
    if (context.opponentSquad?.length) lines.push(`  ${opponentName}: ${context.opponentSquad.join(', ')}`);
  }
  if (context?.teamInjuryReport?.length || context?.opponentInjuryReport?.length) {
    lines.push('');
    lines.push('UPDATED INJURY REPORT:');
    const fmtInj = (injuries: Array<{ name: string; status: string }>) =>
      injuries.map(i => `${i.name} (${i.status})`).join(', ');
    if (context?.teamInjuryReport?.length)     lines.push(`  ${teamName}: ${fmtInj(context.teamInjuryReport)}`);
    if (context?.opponentInjuryReport?.length) lines.push(`  ${opponentName}: ${fmtInj(context.opponentInjuryReport)}`);
  }
  lines.push('');
  lines.push(
    'Return the same JSON structure. Update only the sections directly affected by this new information (e.g. playerSpotlight if an injury is mentioned, verdict if significant news shifts the outlook). If squad or injury data has changed, update tactical analysis, playerSpotlight, and verdict as needed. Preserve analysis that remains accurate. Do not invent new facts beyond what is provided above.'
  );
  return lines.join('\n');
}

// ─── Convenience wrapper ────────────────────────────────────────────────────────

export interface PreviewPromptInput {
  league: string;
  teamName: string;
  opponentName: string;
  context: PreviewContext;
  teamResults: GameResult[];
  oppResults: GameResult[];
  competition?: string;
  compact?: boolean;
  weather?: WeatherData;
  venue?: string;
  isHome?: boolean;
  teamId?: string;
  opponentId?: string;
}

/** Returns the exact { system, user } message pair production sends to the model. */
export function buildPreviewPrompt(input: PreviewPromptInput): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: buildDataBlock(
      input.league, input.teamName, input.opponentName, input.context,
      input.teamResults, input.oppResults, input.competition, input.compact,
      input.weather, input.venue, input.isHome, input.teamId, input.opponentId,
    ),
  };
}
