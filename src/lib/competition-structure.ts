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
 * First wave: afl, nrl, super_rugby (ladder→finals), epl (table, no finals).
 * All other leagues return STANDARD.
 */

import type { LeagueTableRow } from '@/types';
import { COMP_RULES, finalsRoundForDate } from '@/lib/competition-rules';

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

/**
 * Local view of a competition's structure used by the predicates below. Built
 * from the single-source per-season config (`COMP_RULES`) — these are no longer
 * hardcoded here. Adding/changing a rule is a `competition-rules.ts` edit.
 */
interface StructureDef {
  archetype: 'ladder-finals' | 'table-no-finals';
  totalRounds?: number;
  finalsTeams?: number;
  /** AFL: top-N go direct; (N+1 … finalsTeams) play a wildcard round. */
  directFinalsTeams?: number;
  winsPoints: number;
  maxPpg: number;
  relegationFrom?: number;
  clSpots?: number;
}

const STRUCTURE: Record<string, StructureDef> = Object.fromEntries(
  Object.entries(COMP_RULES)
    .filter(([, r]) =>
      r.archetype === 'ladder-finals' ||
      r.archetype === 'table-no-finals')
    .map(([league, r]) => [league, {
      archetype:         r.archetype as StructureDef['archetype'],
      totalRounds:       r.totalRounds,
      finalsTeams:       r.finalsTeams,
      directFinalsTeams: r.directFinalsTeams,
      winsPoints:        r.winsPoints ?? 0,
      maxPpg:            r.maxPpg ?? 0,
      relegationFrom:    r.relegationFrom,
      clSpots:           r.clSpots,
    }]),
);

// ─── Finals round display ─────────────────────────────────────────────────────

export interface FinalsRoundDisplay {
  name: string;
  /** Structure note: what this round means inside the series. */
  detail?: string;
  decider: boolean;
}

/**
 * Resolves the display name + structure note for a finals fixture, or null when
 * the date is outside every finals window. For final-eight week one (AFL/NRL,
 * `finalEightWeek1`) the same weekend holds two different rounds, told apart by
 * the teams' regular-season seeds: seeds 1–4 play Qualifying Finals (the loser
 * is NOT eliminated — the double chance), seeds 5+ play Elimination Finals
 * (loser out). Without both seeds the combined name is kept and the note covers
 * both cases. Shared by FIXTURE CONTEXT, SEASON STATE, and the review path so
 * every surface tells the same story about the same round.
 */
export function finalsRoundDisplay(
  league: string,
  isoDate: string | undefined,
  teamSeed?: number,
  oppSeed?: number,
): FinalsRoundDisplay | null {
  const round = finalsRoundForDate(league, isoDate);
  if (!round) return null;
  if (round.finalEightWeek1) {
    if (teamSeed !== undefined && oppSeed !== undefined) {
      if (teamSeed <= 4 && oppSeed <= 4) {
        return {
          name: 'Qualifying Final',
          detail: 'seeds 1–4 — the loser is NOT eliminated: they drop to a home semi-final (the double chance); the winner advances straight to a preliminary final with a week off',
          decider: false,
        };
      }
      if (teamSeed >= 5 && oppSeed >= 5) {
        return {
          name: 'Elimination Final',
          detail: 'knockout (no second chance) — the winner advances to an away semi-final',
          decider: false,
        };
      }
    }
    return {
      name: round.name,
      detail: 'week one of the final-eight series — seeds 1–4 play Qualifying Finals (loser gets a second chance), seeds 5–8 play Elimination Finals (loser out)',
      decider: false,
    };
  }
  return { name: round.name, detail: round.detail, decider: !!round.decider };
}

// ─── Finals path facts ────────────────────────────────────────────────────────

function ord(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Deterministic bracket facts for a final-eight finals fixture (AFL/NRL):
 * who the higher seed actually is, WHY the host is hosting (from week two on,
 * hosting is earned in the bracket, NOT by ladder position), how each side got
 * here, and exactly what winning/losing means. Pure rules arithmetic — no data
 * source needed, and the LLM must never be left to infer any of it.
 *
 * Incident (2026-09-13): a Preliminary Final preview called the 2nd-seeded host
 * "the higher-seeded side" over the 1st-seeded visitor — the model invented a
 * seeding explanation for hosting because nothing told it hosting comes from
 * winning a Qualifying Final. These facts exist so that inference never happens.
 */
/** The slice of a GameResult the finals-path narrator needs. */
export interface FinalsFormEntry {
  date: string;
  opponent: string;
  isWin: boolean;
  teamScore: number;
  opponentScore: number;
}

/**
 * Names a team's completed finals results so far ("lost their Qualifying Final
 * to Sydney 88–141, then beat Adelaide 144–91 in the Semi-Final") from recent
 * form + the finals date windows. The week-one round is labelled from the
 * team's own seed (1–4 → Qualifying Final, 5+ → Elimination Final).
 */
export function finalsPathSoFar(
  league: string,
  form: FinalsFormEntry[] | undefined,
  teamSeed: number | undefined,
  beforeISO: string | undefined,
): string | undefined {
  if (!form?.length) return undefined;
  const day = beforeISO?.slice(0, 10);
  const played = form
    .map(r => ({ r, round: finalsRoundForDate(league, r.date) }))
    .filter(x => x.round && !x.round.decider && (!day || x.r.date.slice(0, 10) < day))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : 1));
  if (played.length === 0) return undefined;
  return played.map(({ r, round }) => {
    const roundName = round!.finalEightWeek1
      ? (teamSeed !== undefined ? (teamSeed <= 4 ? 'Qualifying Final' : 'Elimination Final') : 'week-one final')
      : round!.name;
    return r.isWin
      ? `beat ${r.opponent} ${r.teamScore}–${r.opponentScore} in the ${roundName}`
      : `lost the ${roundName} to ${r.opponent} ${r.teamScore}–${r.opponentScore}`;
  }).join(', then ');
}

export function buildFinalsPathFacts(
  league: string,
  isoDate: string | undefined,
  teamName: string,
  opponentName: string,
  teamSeed: number | undefined,
  oppSeed: number | undefined,
  teamIsHome: boolean | undefined,
  teamForm?: FinalsFormEntry[],
  oppForm?: FinalsFormEntry[],
): string[] {
  const rules = COMP_RULES[league];
  // Final-eight bracket comps only — the system these derivations describe.
  if (!rules?.finalsSchedule?.some(r => r.finalEightWeek1)) return [];
  const round = finalsRoundForDate(league, isoDate);
  if (!round) return [];

  const facts: string[] = [];
  const haveSeeds = teamSeed !== undefined && oppSeed !== undefined;
  const knownHost = teamIsHome !== undefined;
  const home     = teamIsHome === false ? opponentName : teamName;
  const away     = teamIsHome === false ? teamName : opponentName;
  const homeSeed = teamIsHome === false ? oppSeed : teamSeed;
  const awaySeed = teamIsHome === false ? teamSeed : oppSeed;
  // AFL: seeds below the direct-qualification line came through the wildcard round.
  const viaWildcard = (seed?: number) =>
    rules.directFinalsTeams !== undefined && seed !== undefined && seed > rules.directFinalsTeams;

  if (haveSeeds && teamSeed !== oppSeed) {
    const hi = teamSeed! < oppSeed! ? teamName : opponentName;
    const hiSeed = Math.min(teamSeed!, oppSeed!);
    facts.push(
      `Seeding: ${teamName} finished ${ord(teamSeed!)}${teamSeed === 1 ? ' (minor premiers)' : ''}; ` +
      `${opponentName} finished ${ord(oppSeed!)}${oppSeed === 1 ? ' (minor premiers)' : ''}. ` +
      `${hi} (${ord(hiSeed)}) is the higher seed.`
    );
  }

  // Named finals results so far (derived from completed-game form + the finals
  // date windows) — real scores for the bracket path the rules imply.
  const teamPath = finalsPathSoFar(league, teamForm, teamSeed, isoDate);
  const oppPath  = finalsPathSoFar(league, oppForm, oppSeed, isoDate);
  if (teamPath) facts.push(`${teamName}'s finals so far: ${teamPath}.`);
  if (oppPath)  facts.push(`${opponentName}'s finals so far: ${oppPath}.`);

  if (round.decider) {
    facts.push('Both sides won Preliminary Finals to reach the Grand Final. The Grand Final venue is fixed — a home-ground label here does not mean higher seeding.');
    facts.push('The winner is the premier.');
    return facts;
  }

  if (round.name === 'Wildcard Round') {
    if (knownHost) facts.push(`Hosting: ${home} host as the higher seed — wildcard hosting follows ladder position.`);
    facts.push('One game for a final-eight place: the winner takes one of the last two spots in the final eight.');
    return facts;
  }

  if (round.finalEightWeek1 && haveSeeds) {
    const isQualifying = teamSeed! <= 4 && oppSeed! <= 4;
    if (knownHost) facts.push(`Hosting: ${home} host as the higher seed — week-one hosting follows ladder position.`);
    if (isQualifying) {
      facts.push('NEITHER side can be eliminated in this game: the Qualifying Final loser drops to a home Semi-Final next week (the double chance); the winner advances straight to a home Preliminary Final with a week off.');
    } else {
      facts.push('The Elimination Final winner advances to an away Semi-Final.');
    }
    return facts;
  }

  // Conservative guard for the bracket-derived hosting claims below: semi and
  // preliminary-final hosts are structurally seeds 1–4 (QF losers / QF winners).
  // If the data says otherwise, something upstream is wrong — emit nothing
  // confident rather than a wrong reconstruction.
  const hostSeedConsistent = homeSeed === undefined || homeSeed <= 4;

  if (round.name === 'Semi-Final') {
    if (knownHost && hostSeedConsistent) {
      facts.push(`Hosting: ${home} host because they LOST a Qualifying Final and hold the double chance — semi-final hosting comes from the bracket, not from being the higher seed.`);
      if (homeSeed !== undefined) facts.push(`${home} (${ord(homeSeed)}) lost their Qualifying Final — this Semi-Final is their double chance, now being used.`);
      if (awaySeed !== undefined && awaySeed >= 5) facts.push(`${away} (${ord(awaySeed)}) won an Elimination Final to reach this Semi-Final${viaWildcard(awaySeed) ? ', having already survived the Wildcard Round' : ''}.`);
    }
    facts.push('The winner advances to an away Preliminary Final.');
    return facts;
  }

  if (round.name === 'Preliminary Final') {
    if (knownHost && hostSeedConsistent) {
      facts.push(`Hosting: ${home} earned this home Preliminary Final by WINNING their Qualifying Final (and had last week off) — hosting here is earned in the bracket and does NOT follow ladder position.`);
      if (awaySeed !== undefined) {
        facts.push(awaySeed <= 4
          ? `${away} (${ord(awaySeed)}) LOST their Qualifying Final, then survived a home Semi-Final — their double chance is spent.`
          : `${away} (${ord(awaySeed)}) have taken the long road: an Elimination Final win, then a Semi-Final win${viaWildcard(awaySeed) ? ', after coming through the Wildcard Round' : ''}.`);
      }
    }
    facts.push('The winner advances to the Grand Final.');
    return facts;
  }

  return facts;
}

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

/** Near the Champions League places (top clSpots), run-home only. */
function isInCLRace(
  teamRow: LeagueTableRow,
  sorted: LeagueTableRow[],
  def: StructureDef,
  phase: string,
): boolean {
  if (!def.clSpots || !def.totalRounds) return false;
  if (!phase.startsWith('run home')) return false;
  if (isInTitleRace(teamRow, sorted, def, phase)) return false; // title race is more specific
  const clCutoffRow = sorted[def.clSpots - 1];
  if (!clCutoffRow || clCutoffRow.points === 0) return false;
  const posGap = Math.abs(teamRow.position - def.clSpots);
  const ptsGap = Math.abs(teamRow.points - clCutoffRow.points);
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
    const tRace = isInTitleRace(teamRow, sorted, def, phase) || isInCLRace(teamRow, sorted, def, phase);
    const oRace = isInTitleRace(oppRow, sorted, def, phase)  || isInCLRace(oppRow, sorted, def, phase);
    return !tRace && !oRace;
  }

  return false;
}

// ─── Phase computation ────────────────────────────────────────────────────────

/**
 * Mirrors the phase logic in preview-prompt.ts (SEASON STATE) so the two blocks
 * are always consistent. Same thresholds: quarter = ⌈total/4⌉, run-home = ⌊total×0.65⌋.
 */
export function computePhase(played: number, totalRounds: number): string {
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
  fixtureDate?: string,
): CompetitionContext {
  const def = STRUCTURE[league];
  if (!def) return { phase: 'standard', stakes: 'STANDARD' };

  // ── Finals round (ladder comps) ─────────────────────────────────────────
  // The feed carries no stage label for these finals (ESPN tags every Super
  // Rugby finals game seasonType=1), so the round is inferred from the fixture
  // DATE against the per-season finals schedule. When the regular season is
  // complete AND the date lands in a finals window, this is authoritative — a
  // knockout final, NOT a ladder fixture. It overrides the ladder-based stakes
  // (a Grand Final must never read as a regular-season dead rubber).
  if (def.archetype === 'ladder-finals' && def.totalRounds) {
    // Date-window match is authoritative: the finals windows are per-season
    // ABSOLUTE dates, and no regular-season game is scheduled inside them.
    // played >= totalRounds is only the fallback — it undercounts for comps
    // with byes (NRL: 24 games across 27 rounds, so it never fires there).
    const inFinalsWindow = finalsRoundForDate(league, fixtureDate) !== null;
    const regularSeasonDone = inFinalsWindow || (played !== undefined && played >= def.totalRounds);
    if (regularSeasonDone) {
      // Seeds (final regular-season ladder positions) disambiguate final-eight
      // week one: Qualifying Final (1–4, double chance) vs Elimination Final.
      const seedSorted = [...leagueTable].sort((a, b) => a.position - b.position);
      const teamSeed = seedSorted.find(r => rowMatchesTeam(r.name, teamName))?.position;
      const oppSeed  = seedSorted.find(r => rowMatchesTeam(r.name, opponentName))?.position;
      const round = finalsRoundDisplay(league, fixtureDate, teamSeed, oppSeed);
      if (round) {
        const structureNote = round.detail ? ` (${round.detail})` : '';
        if (round.decider) {
          return {
            phase: round.name, // e.g. 'Grand Final'
            stakes: 'GRAND FINAL',
            explanation: `the ${round.name} — winner-takes-all for the championship; the regular-season ladder no longer applies`,
          };
        }
        return {
          phase: round.name, // e.g. 'Semi-Final'
          stakes: 'FINALS',
          explanation: `the ${round.name} in the finals series${structureNote}; the regular-season ladder no longer applies`,
        };
      }
      // Regular season complete but the date matched no finals window (schedule
      // missing or stale). Regular-season stakes (FINALS LOCKED / ELIMINATED /
      // FINALS RACE / DEAD RUBBER) are meaningless — and actively wrong — once
      // the ladder is final, so emit nothing rather than something confident.
      return { phase: 'finals series', stakes: 'STANDARD' };
    }
  }

  // ── Phase ─────────────────────────────────────────────────────────────────
  let phase = 'standard';
  if (def.totalRounds && played !== undefined) {
    phase = computePhase(played, def.totalRounds);
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
    const clCutoffRow = def.clSpots ? sorted[def.clSpots - 1] : undefined;

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
      if (isInCLRace(teamRow, sorted, def, phase) && clCutoffRow) {
        const gap = teamRow.points - clCutoffRow.points;
        const gapDesc =
          gap >= 0 ? `${gap} pt${gap !== 1 ? 's' : ''} inside the top ${def.clSpots}`
          :          `${Math.abs(gap)} pt${Math.abs(gap) !== 1 ? 's' : ''} outside the top ${def.clSpots}`;
        return {
          phase,
          stakes: `TOP-${def.clSpots} RACE`,
          explanation: `${teamName} are ${gapDesc} (Champions League places) with ${roundsLeft} round${roundsLeft !== 1 ? 's' : ''} left`,
        };
      }
      // SAFE last — races are the newsworthy stake; safety is the fallback for a
      // team confirmed up with nothing else confirmed in play.
      if (isRelegationSafe(teamRow, sorted, def) && phase === 'run home') {
        return {
          phase,
          stakes: 'SAFE',
          explanation: `${teamName} are mathematically safe from relegation`,
        };
      }
    }

    return { phase, stakes: 'STANDARD' };
  }

  return { phase, stakes: 'STANDARD' };
}
