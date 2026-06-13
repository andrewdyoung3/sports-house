/**
 * Declarative per-competition structure reference and fixture-context resolver.
 *
 * Converts the standings arithmetic already computed by buildDerivedFacts /
 * computeCompetitionStatus into explicit, deterministic Phase + Stakes labels,
 * injected as a FIXTURE CONTEXT block in the AI data block.
 *
 * Conservative rule (non-negotiable): a wrong confident label is worse than no
 * label. ELIMINATED, FINALS LOCKED, RELEGATED, and DEAD RUBBER are only emitted
 * when mathematically certain. FINALS RACE / TITLE RACE / RELEGATION BATTLE are
 * directional (near-cutoff + run-home phase) but never contradict the maths.
 *
 * First wave: afl, nrl, super_rugby (ladder→finals), epl (table, no finals),
 * world_cup (group→knockout). All other leagues return STANDARD.
 */

import type { LeagueTableRow, WorldCupMatchContext } from '@/types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CompetitionContext {
  /** Phase label — mirrors SEASON STATE vocabulary for consistency. */
  phase: string;
  /**
   * Deterministic stakes label. 'STANDARD' means nothing notable is
   * mathematically confirmed; all other values are certain or defensible.
   */
  stakes: string;
  /** One-line explanation to accompany the stakes label in the prompt. */
  explanation?: string;
}

// ─── Per-competition structure reference ──────────────────────────────────────

interface StructureDef {
  archetype: 'ladder-finals' | 'table-no-finals' | 'group-knockout';
  /** Regular-season rounds (undefined for tournament competitions). */
  totalRounds?: number;
  /** Top-N teams qualify for finals/playoffs. */
  finalsTeams?: number;
  /** Points awarded for a win. */
  winsPoints: number;
  /**
   * Conservative max points per game (includes bonus points).
   * Super Rugby uses 5 (4-win + 1 try bonus) so clinching maths are conservative.
   */
  maxPpg: number;
  /** EPL: position at which relegation begins (18 → 18th, 19th, 20th go down). */
  relegationFrom?: number;
  /** EPL: positions that earn Champions League entry. */
  clSpots?: number;
}

const STRUCTURE: Record<string, StructureDef> = {
  // Ladder → finals
  afl:         { archetype: 'ladder-finals',   totalRounds: 23, finalsTeams: 8, winsPoints: 4, maxPpg: 4 },
  nrl:         { archetype: 'ladder-finals',   totalRounds: 27, finalsTeams: 8, winsPoints: 2, maxPpg: 2 },
  super_rugby: { archetype: 'ladder-finals',   totalRounds: 14, finalsTeams: 8, winsPoints: 4, maxPpg: 5 },

  // Table, no finals
  epl: { archetype: 'table-no-finals', totalRounds: 38, winsPoints: 3, maxPpg: 3, relegationFrom: 18, clSpots: 4 },

  // Group → knockout tournament
  world_cup: { archetype: 'group-knockout', winsPoints: 3, maxPpg: 3 },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function rowMatchesTeam(rowName: string, teamName: string): boolean {
  const r = rowName.toLowerCase();
  const t = teamName.toLowerCase();
  return r === t || t.includes(r) || r.includes(t);
}

function gamesRemaining(row: LeagueTableRow, totalRounds: number): number {
  return Math.max(0, totalRounds - row.played);
}

// ─── Ladder-finals predicates (AFL / NRL / Super Rugby) ───────────────────────

/** Team's top-N position is mathematically guaranteed regardless of remaining results. */
function isFinalsLocked(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
): boolean {
  if (!def.finalsTeams || !def.totalRounds) return false;
  const nPlusOne = sorted[def.finalsTeams]; // 0-indexed: position N+1
  if (!nPlusOne) return false;
  // Even if N+1 wins every game at max points, they can't reach team's current total.
  return teamRow.points > nPlusOne.points + gamesRemaining(nPlusOne, def.totalRounds) * def.maxPpg;
}

/** Team cannot reach the top-N even by winning every remaining game. */
function isFinalsEliminated(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
): boolean {
  if (!def.finalsTeams || !def.totalRounds) return false;
  const nthTeam = sorted[def.finalsTeams - 1]; // 0-indexed: Nth position
  if (!nthTeam || nthTeam.points === 0) return false;
  const teamMax = teamRow.points + gamesRemaining(teamRow, def.totalRounds) * def.winsPoints;
  return teamMax < nthTeam.points;
}

/**
 * Team is near the finals cutoff, still mathematically alive, and in the
 * run-home phase. Conservative: only fired after 65% of the season.
 */
function isInFinalsRace(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!def.finalsTeams || !def.totalRounds) return false;
  if (!phase.startsWith('run home')) return false;

  const nthTeam = sorted[def.finalsTeams - 1];
  if (!nthTeam || nthTeam.points === 0) return false;

  // Must still be able to reach the cutoff
  const teamMax = teamRow.points + gamesRemaining(teamRow, def.totalRounds) * def.winsPoints;
  if (teamMax < nthTeam.points) return false;

  // Near the cutoff: within 4 positions or within 3 wins' worth of points
  const posGap = Math.abs(teamRow.position - def.finalsTeams);
  const ptsGap = Math.abs(teamRow.points - nthTeam.points);
  return posGap <= 4 || ptsGap <= def.winsPoints * 3;
}

// ─── EPL predicates (table, no finals) ───────────────────────────────────────

/** Team cannot escape relegation even by winning every remaining game. */
function isRelegated(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
): boolean {
  if (!def.relegationFrom || !def.totalRounds) return false;
  const safeRow = sorted[def.relegationFrom - 2]; // 17th place (safety line)
  if (!safeRow || safeRow.points === 0) return false;
  const teamMax = teamRow.points + gamesRemaining(teamRow, def.totalRounds) * def.maxPpg;
  return teamMax < safeRow.points;
}

/** Team cannot be relegated even if they lose every remaining game. */
function isRelegationSafe(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
): boolean {
  if (!def.relegationFrom || !def.totalRounds) return false;
  const relegRow = sorted[def.relegationFrom - 1]; // 18th place
  if (!relegRow || relegRow.points === 0) return false;
  // Even if 18th wins every remaining game at max points, they can't catch the safe team.
  return teamRow.points > relegRow.points + gamesRemaining(relegRow, def.totalRounds) * def.maxPpg;
}

/** Near the drop zone, still in danger, run-home phase only. */
function isInRelegationBattle(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!def.relegationFrom || !def.totalRounds) return false;
  if (!phase.startsWith('run home')) return false;
  if (isRelegationSafe(teamRow, sorted, def)) return false;

  const relegRow = sorted[def.relegationFrom - 1];
  if (!relegRow || relegRow.points === 0) return false;

  const posGap = Math.abs(teamRow.position - def.relegationFrom);
  const ptsGap = Math.abs(teamRow.points - relegRow.points);
  return posGap <= 4 || ptsGap <= def.winsPoints * 3;
}

/** Mathematically in contention for the title, run-home only. */
function isInTitleRace(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!def.totalRounds) return false;
  if (!phase.startsWith('run home')) return false;
  const leader = sorted[0];
  if (!leader) return false;
  if (rowMatchesTeam(leader.name, teamRow.name)) return true; // is the leader
  const gap = leader.points - teamRow.points;
  const left = gamesRemaining(teamRow, def.totalRounds);
  return teamRow.position <= 4 && gap <= left * def.winsPoints;
}

/** Near the CL top-4 places, run-home only. */
function isInTopFourRace(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!def.clSpots || !def.totalRounds) return false;
  if (!phase.startsWith('run home')) return false;
  if (isInTitleRace(teamRow, sorted, def, phase)) return false; // title race is more specific
  const fourthRow = sorted[def.clSpots - 1];
  if (!fourthRow || fourthRow.points === 0) return false;
  const posGap = Math.abs(teamRow.position - def.clSpots);
  const ptsGap = Math.abs(teamRow.points - fourthRow.points);
  return posGap <= 3 || ptsGap <= def.winsPoints * 3;
}

// ─── Dead rubber ──────────────────────────────────────────────────────────────

/**
 * Both teams have a mathematically confirmed fate that this result cannot change.
 * Ladder-finals: both locked in OR both eliminated.
 * Table-no-finals: both safe with nothing material left to play for.
 */
function isDeadRubber(
  teamRow: LeagueTableRow | undefined,
  oppRow: LeagueTableRow | undefined,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!teamRow || !oppRow) return false;
  if (!phase.startsWith('run home')) return false;

  if (def.archetype === 'ladder-finals') {
    const tLocked = isFinalsLocked(teamRow, sorted, def);
    const tElim   = isFinalsEliminated(teamRow, sorted, def);
    const oLocked = isFinalsLocked(oppRow, sorted, def);
    const oElim   = isFinalsEliminated(oppRow, sorted, def);
    return (tLocked && oLocked) || (tElim && oElim);
  }

  if (def.archetype === 'table-no-finals') {
    const tSafe = isRelegationSafe(teamRow, sorted, def);
    const oSafe = isRelegationSafe(oppRow, sorted, def);
    if (!tSafe || !oSafe) return false;
    // Both safe — also confirm neither is in a meaningful race
    const tRace = isInTitleRace(teamRow, sorted, def, phase) || isInTopFourRace(teamRow, sorted, def, phase);
    const oRace = isInTitleRace(oppRow, sorted, def, phase)  || isInTopFourRace(oppRow, sorted, def, phase);
    return !tRace && !oRace;
  }

  return false;
}

// ─── World Cup stakes ─────────────────────────────────────────────────────────

function resolveWorldCupStakes(
  wc: WorldCupMatchContext,
  teamName: string,
): { stakes: string; explanation?: string } | null {
  // Knockout: ADVANCEMENT STAKES line already covers this — skip FIXTURE CONTEXT.
  if (wc.stage !== 'group') return null;

  const groupTable = wc.groupTable;
  if (!groupTable || groupTable.length === 0) return null;

  const sorted = [...groupTable].sort((a, b) => a.position - b.position);
  // Match by exact name first, then by last word of teamName (e.g. "Socceroos" in "Australia")
  const lastWord = teamName.split(/\s+/).at(-1)?.toLowerCase() ?? '';
  const teamRow = sorted.find(r =>
    r.teamName === teamName ||
    r.teamName.toLowerCase().includes(teamName.toLowerCase()) ||
    (lastWord.length > 3 && r.teamName.toLowerCase().includes(lastWord)),
  );
  if (!teamRow) return null;

  const gamesLeft = wc.gamesRemaining ?? 0;
  const thirdRow  = sorted[2];
  const secondRow = sorted[1];

  // Group complete
  if (gamesLeft === 0) {
    if (teamRow.position <= 2) {
      return { stakes: 'ALREADY QUALIFIED', explanation: 'group stage complete — finished in the top 2' };
    }
    return null; // third-place best-eight still TBD — don't claim STANDARD or ELIMINATED
  }

  // ALREADY ELIMINATED: even with max points, can't overtake 3rd's current total
  const teamMaxPts = teamRow.points + gamesLeft * 3;
  if (thirdRow && teamMaxPts < thirdRow.points) {
    return {
      stakes: 'ALREADY ELIMINATED',
      explanation: `cannot reach 3rd place (${thirdRow.teamName}, ${thirdRow.points} pts) even winning all remaining group games`,
    };
  }

  // ALREADY QUALIFIED: top-2 and 3rd cannot mathematically catch up
  if (teamRow.position <= 2 && thirdRow) {
    const rem3 = Math.max(0, 3 - thirdRow.played);
    if (thirdRow.points + rem3 * 3 < teamRow.points) {
      return {
        stakes: 'ALREADY QUALIFIED',
        explanation: `top-2 finish is mathematically guaranteed — ${thirdRow.teamName} (${thirdRow.points} pts) cannot catch up`,
      };
    }
  }

  // WIN-TO-ADVANCE: 1 game left, currently 3rd, a win would reach 2nd's current total
  if (gamesLeft === 1 && teamRow.position === 3 && secondRow) {
    if (teamRow.points + 3 >= secondRow.points) {
      return {
        stakes: 'WIN-TO-ADVANCE',
        explanation: `a win (${teamRow.points + 3} pts) would match or surpass ${secondRow.teamName} (${secondRow.points} pts) and clinch a top-2 finish`,
      };
    }
  }

  return null; // nothing certifiable — omit FIXTURE CONTEXT for WC group games
}

// ─── Phase computation ────────────────────────────────────────────────────────

/**
 * Mirrors the phase logic in preview-prompt.ts (SEASON STATE) so the two blocks
 * are always consistent. Same thresholds: quarter = ⌈total/4⌉, run-home = ⌊total×0.65⌋.
 */
function computePhase(played: number, totalRounds: number): string {
  const quarter       = Math.ceil(totalRounds / 4);
  const runHomeCutoff = Math.floor(totalRounds * 0.65);
  if (played >= totalRounds)     return 'finals series';
  if (played <= quarter)         return 'early season';
  if (played <= runHomeCutoff)   return 'mid-season';
  return 'run home';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Resolves the phase and stakes for a fixture and returns a CompetitionContext
 * suitable for injection as a FIXTURE CONTEXT block in the AI data block.
 *
 * Returns `{ phase, stakes: 'STANDARD' }` for any unclassified case — the caller
 * can suppress the FIXTURE CONTEXT block entirely when stakes is STANDARD.
 *
 * Pure function — no I/O, no side effects.
 */
export function resolveCompetitionContext(
  league: string,
  leagueTable: LeagueTableRow[],
  teamName: string,
  opponentName: string,
  played: number | undefined,
  worldCupCtx?: WorldCupMatchContext,
): CompetitionContext {
  const def = STRUCTURE[league];
  if (!def) return { phase: 'standard', stakes: 'STANDARD' };

  // ── Phase ─────────────────────────────────────────────────────────────────
  let phase = 'standard';
  if (def.totalRounds && played !== undefined) {
    phase = computePhase(played, def.totalRounds);
  } else if (def.archetype === 'group-knockout') {
    phase = worldCupCtx?.stage === 'group' ? 'group stage' : 'knockout stage';
  }

  // ── World Cup ─────────────────────────────────────────────────────────────
  if (def.archetype === 'group-knockout') {
    if (!worldCupCtx) return { phase, stakes: 'STANDARD' };
    const result = resolveWorldCupStakes(worldCupCtx, teamName);
    if (!result) return { phase, stakes: 'STANDARD' };
    return { phase, stakes: result.stakes, explanation: result.explanation };
  }

  // ── Guard: no table or all-zero (corrupt/pre-season) ─────────────────────
  if (leagueTable.length === 0 || leagueTable.every(r => r.points === 0)) {
    return { phase, stakes: 'STANDARD' };
  }

  const sorted   = [...leagueTable].sort((a, b) => a.position - b.position);
  const teamRow  = sorted.find(r => rowMatchesTeam(r.name, teamName));
  const oppRow   = sorted.find(r => rowMatchesTeam(r.name, opponentName));
  const roundsLeft = def.totalRounds ? def.totalRounds - (played ?? def.totalRounds) : 0;

  // ── Ladder → finals (AFL / NRL / Super Rugby) ─────────────────────────────
  if (def.archetype === 'ladder-finals' && def.finalsTeams && def.totalRounds) {
    const nthTeam = sorted[def.finalsTeams - 1];

    // DEAD RUBBER first — most specific (both confirmed)
    if (isDeadRubber(teamRow, oppRow, sorted, def, phase)) {
      return {
        phase,
        stakes: 'DEAD RUBBER',
        explanation: `both teams have a confirmed finals fate — this result cannot change either team's position relative to the top ${def.finalsTeams}`,
      };
    }

    if (teamRow) {
      if (isFinalsLocked(teamRow, sorted, def)) {
        return {
          phase,
          stakes: 'FINALS LOCKED',
          explanation: `${teamName} have mathematically secured a top-${def.finalsTeams} finals position`,
        };
      }
      if (isFinalsEliminated(teamRow, sorted, def)) {
        return {
          phase,
          stakes: 'ELIMINATED',
          explanation: `${teamName} cannot reach the top ${def.finalsTeams} regardless of remaining results`,
        };
      }
      if (isInFinalsRace(teamRow, sorted, def, phase) && nthTeam) {
        const gap     = teamRow.points - nthTeam.points;
        const gapDesc =
          gap === 0 ? `on the finals cutoff`
          : gap > 0 ? `${gap} pt${gap !== 1 ? 's' : ''} inside the top ${def.finalsTeams}`
          :           `${Math.abs(gap)} pt${Math.abs(gap) !== 1 ? 's' : ''} outside the top ${def.finalsTeams}`;
        return {
          phase,
          stakes: 'FINALS RACE',
          explanation: `${teamName} are ${gapDesc} with ${roundsLeft} round${roundsLeft !== 1 ? 's' : ''} remaining`,
        };
      }
    }

    return { phase, stakes: 'STANDARD' };
  }

  // ── Table, no finals (EPL) ────────────────────────────────────────────────
  if (def.archetype === 'table-no-finals' && def.totalRounds) {
    const safeRow   = def.relegationFrom ? sorted[def.relegationFrom - 2] : undefined;
    const relegRow  = def.relegationFrom ? sorted[def.relegationFrom - 1] : undefined;
    const leader    = sorted[0];
    const fourthRow = def.clSpots ? sorted[def.clSpots - 1] : undefined;

    // DEAD RUBBER first
    if (isDeadRubber(teamRow, oppRow, sorted, def, phase)) {
      return {
        phase,
        stakes: 'DEAD RUBBER',
        explanation: 'both teams are mathematically safe from relegation with no meaningful race remaining',
      };
    }

    if (teamRow) {
      if (isRelegated(teamRow, sorted, def)) {
        return {
          phase,
          stakes: 'RELEGATED',
          explanation: `${teamName} are mathematically relegated — cannot reach safety regardless of remaining results`,
        };
      }
      if (isRelegationSafe(teamRow, sorted, def) && phase === 'run home') {
        return {
          phase,
          stakes: 'SAFE',
          explanation: `${teamName} are mathematically safe from relegation`,
        };
      }
      if (isInRelegationBattle(teamRow, sorted, def, phase) && safeRow) {
        const gap = teamRow.points - safeRow.points;
        const gapDesc =
          gap > 0 ? `${gap} pt${gap !== 1 ? 's' : ''} above the drop zone`
          : gap < 0 ? `${Math.abs(gap)} pt${Math.abs(gap) !== 1 ? 's' : ''} in the relegation zone`
          :           `level with the safety line`;
        return {
          phase,
          stakes: 'RELEGATION BATTLE',
          explanation: `${teamName} are ${gapDesc} with ${roundsLeft} round${roundsLeft !== 1 ? 's' : ''} left`,
        };
      }
      if (isInTitleRace(teamRow, sorted, def, phase) && leader) {
        const gap = leader.points - teamRow.points;
        const gapDesc = gap === 0 ? 'lead the table' : `are ${gap} pt${gap !== 1 ? 's' : ''} off the lead`;
        return {
          phase,
          stakes: 'TITLE RACE',
          explanation: `${teamName} ${gapDesc} with ${roundsLeft} round${roundsLeft !== 1 ? 's' : ''} left`,
        };
      }
      if (isInTopFourRace(teamRow, sorted, def, phase) && fourthRow) {
        const gap = teamRow.points - fourthRow.points;
        const gapDesc =
          gap >= 0 ? `${gap} pt${gap !== 1 ? 's' : ''} inside the top 4`
          :          `${Math.abs(gap)} pt${Math.abs(gap) !== 1 ? 's' : ''} outside the top 4`;
        return {
          phase,
          stakes: 'TOP-FOUR RACE',
          explanation: `${teamName} are ${gapDesc} (Champions League places) with ${roundsLeft} round${roundsLeft !== 1 ? 's' : ''} left`,
        };
      }
    }

    return { phase, stakes: 'STANDARD' };
  }

  return { phase, stakes: 'STANDARD' };
}
