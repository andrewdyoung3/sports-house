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
};

const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
  f1:          'Formula 1',
  world_cup:   'FIFA World Cup 2026',
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

/** Positions that earn finals / playoff qualification. */
const FINALS_SPOTS: Record<string, number> = {
  nrl:         8,
  afl:         8,
  super_rugby: 8,
};

/** Position at which EPL relegation begins (inclusive — 18th, 19th, 20th go down). */
const EPL_RELEGATION_FROM = 18;

/** EPL: top-N positions earn Champions League group-stage entry next season. */
const EPL_UCL_SPOTS = 4;

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

  // ── Finals cutoff gap (AFL / NRL / Super Rugby — top 8) ──────────────────
  const finalsSpot = FINALS_SPOTS[league];
  if (finalsSpot && sorted.length > finalsSpot) {
    const cutoff    = sorted[finalsSpot - 1]; // 8th place
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

  const injuryText = extractSection(/INJURY REPORT/);
  if (injuryText) {
    hasPlayerData = true;
    for (const line of injuryText.split('\n')) addNamesFromLine(line);
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
• Player names: only name a specific player if they appear in the MOST RECENT STARTING LINEUP or TEAM NEWS data. Do not name players drawn from your own training knowledge — this produces confident-sounding claims that may be outdated or simply wrong (e.g. a player transferred, dropped, or injured since your training cutoff).
• If team news mentions injuries or absences, state their structural impact on the side — who covers that role, how it changes the setup.
• If a section has insufficient data to say something specific, write less — compress the section rather than filling it with generic observations. A short precise sentence is better than two vague ones.
• Do not fabricate head-to-head records or historical facts. If no head-to-head data is provided, omit historical comparison entirely.

INFORMATION ECONOMY — no redundant data:
• The user already sees W/D/L form icons, ladder positions, exact scores, points totals, and win/loss records displayed in the app. Repeating any of this is redundant and wastes the available space.
• The core rule: never state a number (wins, losses, draws, points, scorelines, positions) that the user can already read on screen. Every sentence must add something the data display cannot show — interpretation, cause, consequence, structural pattern.
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
• For standings: state the stakes and what they mean structurally — not the coordinates that produced them.
• POSITION vs POINTS — understand the model, then use it correctly:
  HOW IT WORKS: Each result earns competition points (e.g. 2 pts for a win, 1 for a draw, 0 for a loss in most leagues). The total of those points determines a team's ordinal position on the ladder/table — 1st = most points, last = fewest. Position and points are two different things derived from the same underlying results; never conflate them.
  TALKING ABOUT THE POINTS TOTAL — acceptable phrases: "league points", "points on the table", "points tally", "competition points". Example: "Brisbane sit on 10 points" or "12 points from eight games".
  TALKING ABOUT THE ORDINAL RANK — acceptable phrases: "league position", "ladder position", "Xth on the ladder", "Xth on the table", "sitting in Xth". Example: "Brisbane sit 13th on the ladder".
  FORBIDDEN: "ladder points" — this phrase conflates the two concepts and is meaningless. Never use it. Never write "13 ladder points" when you mean 13th place. Never write "6 table points" when you mean 6th on the table.
• Defensive/offensive records: never cite a raw total in isolation ("52 points conceded", "14 goals scored"). A raw number is meaningless without context. Instead, express the record as a league rank — "the tightest defence in the competition", "conceding the fewest points of any side", "the second-highest scoring attack". If the data doesn't tell you where they rank, describe the quality directionally ("among the better defensive sides") rather than quoting a figure. The analytical question is always: where do they sit relative to the rest of the league?

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
• If the data block provides an explicit head-to-head result, reproduce it accurately and do not embellish.
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
• Do NOT invent coaching tendencies you are not confident about. If you don't have reliable knowledge of a coach's system, refer to the team's play style based on results data instead, but still name the coach by surname.
• Keep coach references analytical, not biographical. "Dyche's side will be compact and physical from the first whistle" is useful. "Dyche, who was appointed in January 2023..." is not.

LINEUP AND AVAILABILITY ANALYSIS:
• PLAYER NAMING RULE: Only name a specific player if they appear in one of: MOST RECENT STARTING LINEUP, TEAM NEWS, SQUAD SUBMISSION FOR THIS GAME, or INJURY REPORT. Do not name players from your own training knowledge who are not referenced in the data — this produces confident-sounding claims that may be outdated (transferred, retired, dropped).
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

GROUNDING — absolute constraint, no exceptions:
• Only cite statistics, percentages, rankings, or records that are explicitly present in the data block below. Never invent numbers. If a stat is not in the data, do not state it.
• Only name individual players whose names appear in the provided STARTING LINEUP or TEAM NEWS sections. If no player data is provided, do not name any player — describe roles and patterns instead.
• Tactical observations and situational framing drawn from the data are encouraged. Invented statistics presented as fact are not.
• DERIVED FACTS — when the data block contains a DERIVED FACTS section, every points gap, standings margin, or competition arithmetic figure MUST be taken verbatim from that section. Do NOT compute your own ladder arithmetic. Do NOT round, rephrase, or approximate derived figures. If a gap you want to discuss is not listed in DERIVED FACTS, describe the situation qualitatively (e.g. "well clear of the finals") rather than quoting any number.
• EXPERT MODEL PREDICTIONS margin — when a predicted winning margin is provided, you may round it or express it as a range consistent with that figure (e.g. "around 40" or "40+" for a 43-point tip). Do NOT cite a margin that contradicts the prediction — if the tip says 43 points, do not write "15 points" or "a close finish".

STRUCTURE — four elements required in every preview, distributed naturally across the sections:
• KEY MATCHUP: Name the single most decisive tactical or personnel contest — the specific duel where the fixture will be decided. One concrete clash, not a general overview.
• RECENT FORM: What each side's last few results reveal structurally — pattern and cause, not scorelines. Connect it directly to this fixture.
• STATISTICAL ANGLE: One meaningful number or comparative record that frames the game (ranked in the league where possible). Only include it if it adds genuine analytical weight.
• REASONED PREDICTION: The most probable outcome with specific reasoning. Name the decisive factor. No hedged non-answers.

These four elements must appear across the response — they do not need to be labelled separately.

OUTPUT — respond ONLY with a valid JSON object. No markdown code fences. No extra text before or after the JSON:
{
  "context": "1–3 sentences. Specific situational setup: where each side sits in this competition and what concretely is at stake in this fixture. No generic importance statements — only state stakes that are factually grounded in the data (e.g. finals position, relegation gap, cup progression). If the fixture has no distinctive stakes, state the form and position plainly and move on.",
  "tacticalBattle": "2–3 sentences. When HEAD COACHES are provided, open by naming both coaches by surname and framing the contest as a clash of their systems (e.g. 'Postecoglou's high press faces Dyche's compact mid-block'). Then name the specific structural contest where this fixture will be decided. Use sport-specific terminology. Do not describe tactics generically — name the actual system clash.",
  "playerSpotlight": "REQUIRED — never return an empty string. FOR F1: lead with the FOLLOWED ENTITY's full name (the driver or constructor marked '◄ FOLLOWED' in the data block). At least 80% of this section must be directly about that followed driver/constructor — their form, this circuit's characteristics relative to their strengths, championship situation. Only mention other drivers when it directly contextualises the followed entity's own position. FOR ALL OTHER SPORTS: if player data appears in the data block (lineup/squad/injury report/team news), name the single most analytically compelling player from that data and connect them to the specific gamestate. If the data block contains a NO PLAYER DATA notice, describe the decisive tactical unit or positional role instead — never invent or assume a player name from training knowledge, even if you are confident about the squad.",
  "verdict": "2–3 sentences. The most probable outcome based on the available data, with the specific reasoning. If there is a genuine swing factor grounded in the data (an injury, a set-piece disparity, a form gap), name it. Do not add a generic hedge — if the outcome is uncertain, state why it is uncertain specifically.",
  "keyInsights": [
    "Specific analytical point grounded in the data (max ~12 words)",
    "Specific analytical point grounded in the data (max ~12 words)",
    "Specific analytical point grounded in the data (max ~12 words)"
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
): string {
  // ─── F1 — completely different data model ────────────────────────────────
  if (league === 'f1' && context.f1RaceName) {
    return buildF1DataBlock(context);
  }

  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  // A fixture is "off-league" when it's in a cup, European, or international
  // tournament that differs from the primary league (e.g. CL, FA Cup, RC).
  const isOffLeague = !!competition;
  // Detect a cup/European final — single match, not two-legged.
  // 'Final' is set by normaliseRoundName() in the preview route; 'semi' guard avoids
  // matching 'Semi-finals' (which ARE two-legged ties).
  const isFinal = (() => {
    const cs = context.competitionStage;
    return !!cs && !cs.isGroupPhase &&
      /\bfinal\b/i.test(cs.roundName) && !/semi/i.test(cs.roundName);
  })();
  const lines: string[] = [];

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

  // Playoff/cup series: compute series score from completed results so the AI
  // never has to count from raw form (and can't hallucinate it).
  // Triggered when the competition label looks like "X - Game N".
  if (competition && /\s[-–]\s*game\s+\d+/i.test(competition)) {
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

  // ── Competition profile (static) ────────────────────────────────────────────
  // Injected for primary-league fixtures so the model knows exactly how the
  // competition works — format, finals structure, qualification cutoffs.
  const compProfile = !isOffLeague ? getCompetitionProfile(league) : null;
  if (compProfile) {
    lines.push(`COMPETITION PROFILE — ${compProfile.name} (authoritative — use this for all season-structure, finals, qualification, and relegation statements):`);
    lines.push(compProfile.profile);
    lines.push('');
  }

  lines.push(`SPORT: ${sportCtx}`);

  // ── Season state (computed) ──────────────────────────────────────────────────
  const totalRounds = LEAGUE_TOTAL_ROUNDS[league];
  const played      = context.teamStanding?.played ?? context.opponentStanding?.played;
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

    lines.push(
      `SEASON STATE: Round ${played} of ${totalRounds} — ` +
      `${roundsRemaining} round${roundsRemaining !== 1 ? 's' : ''} left in regular season` +
      (isFinalsPhase ? ' (FINALS SERIES UNDERWAY)' : ` (phase: ${phase})`)
    );
    if (remParts.length > 0) lines.push(`  Games remaining: ${remParts.join(' | ')}`);
  }
  if (context.teamManager || context.opponentManager) {
    const teamMgr = context.teamManager ? `${teamName}: ${context.teamManager}` : '';
    const oppMgr  = context.opponentManager ? `${opponentName}: ${context.opponentManager}` : '';
    lines.push(`HEAD COACHES: ${[teamMgr, oppMgr].filter(Boolean).join(' | ')}`);
  }
  lines.push('');

  // World Cup: group standings table + advancement scenario
  if (league === 'world_cup' && context.worldCup?.groupTable && context.worldCup.groupTable.length > 0) {
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
      lines.push(`GROUP ${wc.group ?? ''} STANDINGS (live — top 2 advance automatically; best 8 third-placed teams also advance):`);
      for (const row of wcGroupTable) {
        const gd = row.goalDifference >= 0 ? `+${row.goalDifference}` : `${row.goalDifference}`;
        const isTracked = row.teamName === teamName || row.teamName === opponentName;
        const marker = isTracked ? ' ◄' : '';
        lines.push(
          `  ${row.position}. ${row.teamName.padEnd(22)} ${row.played}P  ` +
          `${row.wins}W ${row.draws}D ${row.losses}L  ` +
          `${row.points}pts  GD ${gd}  GF ${row.goalsFor}  GA ${row.goalsAgainst}${marker}`,
        );
      }
      lines.push('');
      if (wc.advancementScenario) {
        lines.push(`ADVANCEMENT SCENARIO: ${wc.advancementScenario}`);
      }
      if (wc.gamesPlayed !== undefined) {
        lines.push(`Tournament progress: ${teamName} has played ${wc.gamesPlayed} of 3 group games (${wc.gamesRemaining ?? 0} remaining in group stage).`);
      }
      lines.push('');
    }
  }

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

  // Recent form — spans all competitions
  if (teamResults.length > 0 || oppResults.length > 0) {
    const isF1 = league === 'f1';
    const formHeading = isF1
      ? 'RECENT FORM — Race Results (most recent first):'
      : isOffLeague
        ? 'RECENT FORM — all competitions (last 5 fixtures, most recent first):'
        : 'RECENT FORM (last 5 fixtures, most recent first):';
    lines.push(formHeading);
    if (teamResults.length > 0) {
      if (isF1) {
        // For F1: format as "P{position} — {race name}" instead of W/L score
        const f1FormStr = teamResults.map(r => `P${r.teamScore} — ${r.opponent}`).join('; ');
        lines.push(`  ${teamName}: ${f1FormStr}`);
      } else {
        lines.push(`  ${teamName}: ${formString(teamResults)} — ${formDetail(teamResults)}`);
      }
    }
    if (oppResults.length > 0 && league !== 'f1') {
      lines.push(`  ${opponentName}: ${formString(oppResults)} — ${formDetail(oppResults)}`);
    }
    lines.push('');
  }

  // Team news and headlines
  const teamNews = context.teamNews ?? [];
  const oppNews  = context.opponentNews ?? [];
  if (teamNews.length > 0 || oppNews.length > 0) {
    lines.push('TEAM NEWS & RECENT HEADLINES:');
    teamNews.slice(0, 3).forEach(n => {
      const desc = n.description ? ` — ${n.description.slice(0, 100)}` : '';
      lines.push(`  ${teamName}: "${n.headline}"${desc}`);
    });
    oppNews.slice(0, 3).forEach(n => {
      const desc = n.description ? ` — ${n.description.slice(0, 100)}` : '';
      lines.push(`  ${opponentName}: "${n.headline}"${desc}`);
    });
    lines.push('');
  }

  // Recent starting lineups
  const teamLineup = context.teamLastLineup ?? [];
  const oppLineup  = context.opponentLastLineup ?? [];
  if (teamLineup.length > 0 || oppLineup.length > 0) {
    lines.push('MOST RECENT STARTING LINEUP (use to infer likely selection for this fixture):');
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

  // Player-data availability sentinel — must appear AFTER all lineup/squad/injury blocks
  // so the model has a clear, final signal before it generates.
  const hasPlayerData = teamLineup.length > 0 || oppLineup.length > 0 ||
    teamSquad.length > 0 || oppSquad.length > 0 ||
    teamInj.length > 0  || oppInj.length > 0 ||
    teamKP.length > 0   || oppKP.length > 0;
  if (hasPlayerData) {
    lines.push('PLAYER NAMING CONSTRAINT: Only name players explicitly listed in the MOST RECENT STARTING LINEUP, SQUAD SUBMISSION, INJURY REPORT, or TEAM NEWS sections above. Any player name not in those sections is forbidden — even if you know who plays for the team from your training data.');
    lines.push('');
  } else {
    lines.push('NO PLAYER DATA: No lineup, squad, or injury report is available for this fixture. Do NOT name any individual player in any field. The playerSpotlight field must describe a tactical unit, position group, or system — never a named individual. Inventing player names from training knowledge is a grounding violation.');
    lines.push('');
  }

  // Model tips (AFL Squiggle)
  if (context.tips) {
    const t = context.tips;
    lines.push(`EXPERT MODEL PREDICTIONS: ${t.tipsFor} of ${t.tipsTotal} models tip ${t.favouriteTeam}, average predicted winning margin: ${t.avgMargin} points`);
    lines.push('');
  }

  // Weather at kickoff — only included when conditions are notable
  if (weather && weather.isNotable) {
    lines.push(`WEATHER AT KICKOFF: ${weather.icon} ${weather.description}`);
    lines.push(`  Temperature: ${weather.tempC}°C`);
    if (weather.precipMm > 0.5)    lines.push(`  Precipitation: ${weather.precipMm}mm (${weather.precipProbability}% chance)`);
    if (weather.windKmh > 25)      lines.push(`  Wind: ${weather.windKmh} km/h`);
    lines.push('');
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
  lines.push(hasPlayerData
    ? 'Generate the match preview using the data provided above. Do not invent statistics, historical records, or player names not in the sections above.'
    : 'Generate the match preview using the data provided above. Do not invent statistics or historical records not given. IMPORTANT: no player data was provided — the playerSpotlight field must describe a tactical role or positional unit, never a named individual player.'
  );

  return lines.join('\n');
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
