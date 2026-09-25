/**
 * Shared post-match review prompt assembly — the EXACT system prompt + data-block
 * construction used by POST /api/ai-review. Extracted verbatim from that route so
 * both the route and any eval harness build identical prompts.
 *
 * Pure prompt building: no network calls. LIVE — `POST /api/ai-review` imports both
 * REVIEW_SYSTEM_PROMPT and buildReviewDataBlock from here (route.ts:18, :101, :233),
 * as do scripts/audit-review-position.ts and scripts/snapshot-corpus.ts.
 */

import type { LeagueTableRow, MatchStats, GameResult, HeadToHeadMeeting } from '@/types';
import { getCompetitionProfile } from '@/lib/competition-context';
import { finalsRoundDisplay, buildFinalsPathFacts, computePhase, seasonThird } from '@/lib/competition-structure';
import { COMP_RULES } from '@/lib/competition-rules';

// ─── Sport-specific context ───────────────────────────────────────────────────

const SPORT_CONTEXT: Record<string, string> = {
  afl:         'Australian Rules Football (AFL). Use AFL-specific terminology: contested possessions, clearances, inside 50s, centre bounces, forward 50, the corridor. The table is called "the Ladder". AFL margin = the score difference; do NOT call a 20-point loss "heavy" in AFL (30–60 is comfortable; 15–29 is clear; <15 is close).',
  nrl:         'NRL Rugby League (13-man code). Use NRL-specific terminology: completion rate, ruck speed, middle forwards, edges, kick chase. The table is called "the Ladder". NRL margin interpretation: ≤10 pts = competitive; 11–20 = clear; 21–30 = comfortable; 31+ = heavy.',
  epl:         'English Premier League (association football). Use "pitch" not "field"; "half" not "period". The standings are "the table" (lower case). Margin: 1-goal = close; 2 goals = comfortable; 3+ = convincing/heavy.',
  super_rugby: 'Super Rugby Pacific (15-man rugby union). Use rugby union terminology: scrum, lineout, breakdown, ruck, gainline. The table is called "the Table". Margin: ≤10 pts = competitive; 11–20 = clear; 21–30 = comfortable; 31+ = heavy.',
  rugby_int:   'International Rugby Union Test match. Tone should reflect the magnitude of Test rugby. Same margin scale as Super Rugby.',
};

export const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
};

/**
 * Finals / relegation / CL cutoffs — derived from the per-season single source of
 * truth (`COMP_RULES`), exactly as `preview-prompt.ts` does. Never redeclare them here.
 *
 * Incident (2026-08-29): these were hardcoded as
 *   `{ nrl: 8, afl: 8, super_rugby: 8 }`, `EPL_UCL_SPOTS = 4`
 * and had gone silently stale — AFL moved to a top-10 wildcard format and Super Rugby
 * to a top 6 for 2026, and England gained a 5th CL place for 2025-26. Three of the five
 * constants were wrong, so post-match reviews asserted derived facts like "N points
 * inside the top 8" for AFL when the real finals line is the top 10. This is precisely
 * the staleness `competition-rules.ts` exists to prevent (see its header) — reproduced
 * here because consulting the single source of truth was conventional, not enforced.
 * The preview path read from COMP_RULES and was unaffected.
 */
const FINALS_SPOTS: Record<string, number> = Object.fromEntries(
  Object.entries(COMP_RULES)
    .filter(([, r]) => r.archetype === 'ladder-finals' && r.finalsTeams)
    .map(([lg, r]) => [lg, r.finalsTeams!]),
);
const EPL_RELEGATION_FROM = COMP_RULES.epl?.relegationFrom ?? 18;
const EPL_UCL_SPOTS       = COMP_RULES.epl?.clSpots ?? 4;

// ─── System prompt ────────────────────────────────────────────────────────────

export const REVIEW_SYSTEM_PROMPT = `You are a sharp sports analyst writing a brief post-match review — the smartest sports fan in the room explaining what actually happened and why it matters, in plain, engaging English. Your written standard is top-tier sports journalism (The Athletic, a quality broadsheet's sport pages): precise, concrete, economical, never breathless; the insight comes ONLY from the data provided, the flair goes in the phrasing. Sport-specific terminology stays inside its sport — the SPORT line defines your entire jargon palette; a term of art from another sport's analysis is an error here. Past tense throughout.

GROUNDING — absolute constraint, no exceptions:
• Only cite statistics, percentages, or records that are explicitly present in the MATCH DATA or MATCH STATS sections. Never invent numbers.
• Only name individual players whose names appear in the MATCH STATS or PLAYER DATA sections. If no player names are provided, describe positions and tactical patterns only — never use training-knowledge player names.
• Never assert WHERE a player plays (left or right wing, flank, edge) unless their listed position code states the side (e.g. "(HFFL)", "(RW)"). No code, no side — training memory of positions may be wrong; this is checked automatically.
• The DERIVED FACTS section contains pre-computed margin interpretations and standings gaps. Use those exact phrasings — do not recalculate, rephrase, or contradict them.
• COMPETITION PROFILE is the authoritative description of how the competition works. All references to finals, relegation, or qualification must match it.
• LADDER POSITIONS: use the exact ordinal positions from CURRENT STANDINGS verbatim — do NOT approximate or confuse "top 8 qualifying cutoff" with "8th place". If CURRENT STANDINGS shows a team in 13th, say "13th", not "8th" or "outside the finals". If a DERIVED FACTS note says a team is "X points outside the top 8", use that phrasing — never infer a position number from it.
• FINALS CONTEXT: when present, it is authoritative — the match was a finals fixture and the round name, round structure, and consequences (who advances, who is eliminated, who gets a second chance) come from it exclusively. Never frame a finals result as ladder movement, a qualification race, or a dead rubber, and never invent a different finals format from training knowledge.
• RUNS, STREAKS, RECORDS: the only run/streak/record figures you may state are those in SEASON CONTEXT, verbatim. FORM COMING INTO THIS MATCH is a five-game window, not a run — never count it ("five-match winning run" because five results are listed is an error).
• RELATIVE POSITION: who is above whom, and by how much, comes from DERIVED FACTS only. A team that LEADS on the table is ahead; never write that the trailing side "moved ahead" or "leapfrogged".
• PERSPECTIVE and NAMES lines bind whose review this is and what to call each club.

INFORMATION ECONOMY:
• The user can already see the scoreline and result. Do NOT restate the score in the summary or verdict.
• NEVER open the summary with the round name or a definition of the fixture ("In the Elimination Final…", "This was a knockout match…") — the reader sees the fixture on screen. Open with WHY the result happened; fold the round's consequence (who advances, who is done) into that sentence as a clause, not a preamble.
• Do NOT recite win/loss records. The user sees the table.
• No position recitation ("they sit 6th with 31 points") — state what it means structurally.
• Every sentence must add interpretation the data display cannot show: WHY the result happened, what structural pattern it reflects, what it means going forward.
• ABSENT DATA GOES UNMENTIONED: never tell the reader what information is unavailable — a data gap tells YOU what not to discuss; it is never content.

REGISTER MECHANICS — how the professionals write match reports:
• NEVER announce what mattered ("the key factor was…", "X proved crucial/decisive") — make the case: "[Winner] won the ball at the contest and turned it into goals; [Loser] had entries but no polish." (structure template — never reuse its details).
• VARY the rhythm: at least one sentence under ten words. Metronomic 30-word compounds read like a machine.
• COMPARATIVES over abstractions: "won more of the ball after halftime" beats "superior structure"; verdicts like "confirms their status as a serious contender" say nothing — state the specific trend confirmed or weakness exposed.
• ONE number per claim, folded into an argument — never a sequence of stats read aloud.
• EVIDENCE over adjectives: "convincing", "potent", "unassailable", "decisive", "vulnerabilities" describe nothing. Replace each with the thing that happened — the method of a goal, a stat gap, a substitution, a run ended. If the MATCH EVENTS say two goals came from outside the box, say that; do not say the attack was "potent".
• A league position is never a cause. "Despite being second, they could not recover" is a non-sequitur — position explains expectation, not what happened on the pitch.
• Name people the way the report does: the goalscorer, the assist, the player hooked at the hour — and by SHORT club names after the first mention.
• COUNTS AND STATES ARE CHECKED: a player's tally ("twice", "a brace", "hat-trick") is the number of MATCH EVENTS lines with their name — count them. Any score you quote (X–Y, "X-all", "at half-time") must appear in MATCH EVENTS or the HT line exactly; never reconstruct one. "Won/led/dominated the <stat>" is allowed only for a category in TEAM STATS, and only for the side with the higher figure. A stat the SPORT line mentions (centre bounces, hitouts) is vocabulary, not data — do not claim it.

MARGIN CALIBRATION — read from DERIVED FACTS, do not compute:
• Use the margin label from DERIVED FACTS verbatim. Never call a competitive defeat "heavy" or vice versa.

STRUCTURE — four elements required, distributed naturally:
• PEOPLE FIRST: when MATCH EVENTS / SCORERS / KEY PERFORMERS data exists, the summary MUST name the decisive individual contribution early (the real report of a 4-2 cup win led with the two-goal teenager, not "momentum continued") — a match report without its protagonist is a defect.
• HOW IT TURNED: from MATCH EVENTS — the goal or passage that decided it, with its method (a header from a corner, a shot from outside the box, a counter), the half-time state, and the manager's reaction if the substitutions show one.
• SEASON CONTEXT: what this result did to the side's run or record, using the SEASON CONTEXT lines verbatim — a first defeat, a run ended or extended, a season high conceded.
• STATISTICAL ANGLE: One meaningful number from TEAM STATS or DERIVED FACTS that explains the margin or method. Only cite it if it was explicitly provided.
• REASONED VERDICT: The single most important forward-looking implication FOR THE PERSPECTIVE TEAM — a trend confirmed, weakness exposed, or opportunity opened.

RULES:
• No filler: avoid "credit to both sides", "gave it their all", "never-say-die spirit"
• No hollow superlatives or vague momentum phrases
• No meta-commentary — do not refer to the review itself
• Vary your opening angle — avoid "[Team] controlled this match" as an opener
• Explain tactical and structural reasons — not just "they scored more"
• Do not state uncertainty explicitly — let calibration inform tone

KEY MOMENTS: 2–3 interpretive factors, max 12 words each — a pattern, a matchup, a turning point explained in terms of WHY. Never a goal restated (the reader sees the scorers), never the score.

OUTPUT: Return valid JSON only, no markdown fences:
{
  "summary": "2–3 sentences — WHY the result happened. Open with the decisive structural factor, not the score.",
  "keyMoments": ["interpretive factor 1 (max 12 words)", "factor 2", "factor 3"],
  "verdict": "1–2 sentences about the PERSPECTIVE team only: the one thing this result says they must fix or can bank on, anchored to a specific figure or event from the data. Never 'confirms/establishes … contenders', never 'exposes a vulnerability' without naming the mechanism and the number."
}`;

// ─── Data block builder ───────────────────────────────────────────────────────

export interface ReviewInput {
  league:        string;
  teamName:      string;
  opponent:      string;
  teamScore:     number;
  opponentScore: number;
  isHome:        boolean;
  date:          string;
  competition?:  string;
  teamId?:       string;
  opponentId?:   string;
  // Standings (fetched server-side before generation)
  teamPosition?:     number;
  teamPlayed?:       number;
  teamPoints?:       number;
  teamPercentage?:   number;   // AFL only
  opponentPosition?: number;
  opponentPlayed?:   number;
  opponentPoints?:   number;
  opponentPercentage?: number; // AFL only
  leagueTable?:      LeagueTableRow[];
  // Match stats (from /api/match-stats — EPL, NRL, SRU only)
  matchStats?:   MatchStats;
  // Form + head-to-head coming INTO this match (fetchReviewFormAndH2H —
  // ESPN summary for NRL/EPL/SRU, Squiggle games for AFL). Never includes
  // the reviewed match itself.
  teamRecentForm?:     GameResult[];
  opponentRecentForm?: GameResult[];
  headToHead?:         HeadToHeadMeeting[];
  /** Soccer: derived goal timeline lines from ESPN keyEvents ("7' Max Dowman (Arsenal) — 0-1"). */
  scoringTimeline?:    string[];
  /**
   * Full event sequence (lib/match-report.ts): goals with method + assist and
   * running score, cards, substitutions, stoppages, HT/FT. Supersedes
   * scoringTimeline in the block when present.
   */
  matchEvents?:        string[];
  /** Computed season lines (deriveSeasonFacts) — the only run/record figures the model may cite. */
  seasonFacts?:        string[];
  /** Every individual the data names — rendered as the explicit whitelist line. */
  playerNames?:        string[];
  venue?:              string;
  attendance?:         number;
  /** The side listed first at the venue; defaults from isHome. */
  homeTeamName?:       string;
  /** Short club names for prose after first mention ("Brighton", not "Brighton & Hove Albion"). */
  teamShort?:          string;
  opponentShort?:      string;
  // Cricket (cricket_int / bbl): innings context passed from the result object.
  cricketFormat?:   'test' | 'odi' | 't20';
  cricketResult?:   string;   // "Australia won by 45 runs"
  cricketInnings?:  Array<{ team: string; score: string; overs?: number }>;
  /** Cricket: derived scoring-chart lines (top batters/bowlers), server-side. */
  cricketChart?:    string[];
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Competition home timezone for rendering the kick-off date. */
const LEAGUE_TZ: Record<string, string> = {
  epl:         'Europe/London',
  afl:         'Australia/Melbourne',
  nrl:         'Australia/Sydney',
  super_rugby: 'Australia/Sydney',
  bbl:         'Australia/Sydney',
};

function marginCategory(league: string, margin: number): string {
  if (league === 'afl') {
    if (margin < 15)  return 'close';
    if (margin < 30)  return 'clear';
    if (margin < 60)  return 'comfortable';
    return 'heavy';
  }
  if (league === 'nrl' || league === 'super_rugby' || league === 'rugby_int') {
    if (margin <= 10) return 'competitive';
    if (margin <= 20) return 'clear';
    if (margin <= 30) return 'comfortable';
    return 'heavy';
  }
  if (league === 'epl') {
    if (margin === 1) return 'close (1 goal)';
    if (margin === 2) return 'comfortable (2 goals)';
    return 'convincing (3+ goals)';
  }
  return 'clear';
}

export function buildReviewDataBlock(input: ReviewInput): string {
  const {
    league, teamName, opponent, teamScore, opponentScore,
    isHome, date, competition, leagueTable, matchStats,
    teamPosition, teamPlayed, teamPoints, teamPercentage,
    opponentPosition, opponentPlayed, opponentPoints, opponentPercentage,
    teamRecentForm, opponentRecentForm, headToHead, scoringTimeline,
    matchEvents, seasonFacts, playerNames, venue, attendance, homeTeamName,
    teamShort, opponentShort,
    cricketFormat, cricketResult, cricketInnings, cricketChart,
  } = input;

  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  const result      = teamScore > opponentScore ? 'WIN' : teamScore < opponentScore ? 'LOSS' : 'DRAW';
  const comp        = competition ?? 'Regular season';
  // Kick-off day in the competition's own timezone — a 14:00Z Saturday kick-off
  // in England rendered as "Sun 20 September" in the machine's Australian
  // local time, so the model dated the match wrong.
  const dateStr     = new Date(date).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: LEAGUE_TZ[league] ?? 'UTC',
  });
  const margin      = Math.abs(teamScore - opponentScore);
  const winner      = teamScore > opponentScore ? teamName : teamScore < opponentScore ? opponent : null;
  const loser       = winner === teamName ? opponent : winner === opponent ? teamName : null;
  const marginCat   = marginCategory(league, margin);

  // ── Finals fixture detection ───────────────────────────────────────────────
  // Once the regular season is complete, every ladder-derived fact below (finals
  // cutoffs, CL gaps, "standings after this result") describes a table that no
  // longer moves — seeding, not stakes — so they are suppressed and replaced
  // with the finals-series framing. Seeds = final ladder positions.
  const isCricket = league === 'cricket_int' || league === 'bbl';
  const rules = COMP_RULES[league];
  const maxPlayed = Math.max(teamPlayed ?? 0, opponentPlayed ?? 0);
  // A finals date-window match is authoritative (per-season absolute dates);
  // the played-count test is only the fallback — it undercounts for comps
  // with byes (NRL: 24 games across 27 rounds, so it never fires there).
  const finalsRound = rules?.archetype === 'ladder-finals'
    ? finalsRoundDisplay(league, date, teamPosition, opponentPosition)
    : null;
  const regularSeasonDone = rules?.archetype === 'ladder-finals'
    && (!!finalsRound || (!!rules.totalRounds && maxPlayed >= rules.totalRounds));
  // Cup ties (EFL Cup, FA Cup, Europe): the LEAGUE table has no bearing on a cup
  // result — mirroring the preview path's isOffLeague suppression. A cup review
  // that says "extending their lead at the top of the Table" is a category error
  // (observed 2026-09-16 on an EFL Cup tie).
  const isCupTie = !isCricket && !!competition && !/regular season/i.test(competition);

  const lines: string[] = [];

  // ── Competition profile ────────────────────────────────────────────────────
  const compProfile = getCompetitionProfile(league);
  if (compProfile && !competition) {
    lines.push(`COMPETITION PROFILE — ${compProfile.name}:`);
    lines.push(compProfile.profile);
    lines.push('');
  }

  // ── Sport context ──────────────────────────────────────────────────────────
  lines.push(`SPORT: ${sportCtx}`);
  lines.push('');

  // ── Match data ────────────────────────────────────────────────────────────
  lines.push('MATCH DATA:');
  lines.push(`League: ${leagueLabel}`);
  // FIXTURE/COMPETITION markers double as the player-name validator's exclusion
  // anchors (team/competition words must never be flagged as player names).
  lines.push(`FIXTURE: ${teamName} vs ${opponent}`);
  lines.push(`COMPETITION: ${comp}`);
  lines.push(`Date: ${dateStr}`);
  // Where it was played, home side first. The old "Away: Arsenal vs Brighton"
  // line named no ground and read home-first, so reviews never placed the match.
  if (isCricket) {
    if (venue) lines.push(`VENUE: ${venue}`);
  } else {
    const homeName = homeTeamName ?? (isHome ? teamName : opponent);
    const awayName = homeName === teamName ? opponent : teamName;
    const sides    = `${homeName} (home) v ${awayName} (away)`;
    const att      = attendance ? `, attendance ${attendance.toLocaleString('en-AU')}` : '';
    lines.push(venue ? `VENUE: ${venue} — ${sides}${att}` : `HOME/AWAY: ${sides}`);
  }
  lines.push(`PERSPECTIVE: written for ${teamName} followers — "the team", "they" and "their" ALWAYS mean ${teamName}, never ${opponent}. Lead with what the result means for ${teamName}, honestly; a defeat is reported as one. Attach every figure to the side it belongs to by name.`);
  {
    const shorts: string[] = [];
    if (teamShort && teamShort !== teamName)          shorts.push(`${teamName} "${teamShort}"`);
    if (opponentShort && opponentShort !== opponent)  shorts.push(`${opponent} "${opponentShort}"`);
    if (shorts.length > 0) lines.push(`NAMES: after first mention call ${shorts.join(' and ')}.`);
  }
  if (!isCricket) {
    // Cricket scores are innings, not a two-number line — the cricket block
    // below carries them; a placeholder "0 – 0" here invites hallucination.
    lines.push(`Score: ${teamName} ${teamScore} – ${opponentScore} ${opponent}`);
    lines.push(`Result: ${result}`);
  }
  lines.push('');

  // ── Cricket match context (innings, format, chart) ─────────────────────────
  if (isCricket) {
    lines.push('CRICKET MATCH CONTEXT (a bilateral/tournament match — there is NO league ladder; frame within the series and the innings below):');
    if (cricketFormat) lines.push(`  Format: ${cricketFormat.toUpperCase()}`);
    if (cricketResult) lines.push(`  Result: ${cricketResult}`);
    for (const inn of cricketInnings ?? []) {
      if (!inn.score || inn.score === '0/0') continue; // results-parser phantom rows
      lines.push(`  ${inn.team}: ${inn.score}${inn.overs ? ` (${inn.overs} ov)` : ''}`);
    }
    lines.push('');
    if (cricketChart && cricketChart.length > 0) {
      lines.push('SCORING CHART (derived — top contributions; use names and figures verbatim):');
      cricketChart.forEach(l => lines.push(`  ${l}`));
      lines.push('');
    }
  }

  // ── Cup-tie framing (league table has no bearing) ──────────────────────────
  if (isCupTie && !finalsRound) {
    lines.push(`CUP TIE (${competition}): this is a knockout cup match — the league table has NO bearing on it and must not be discussed. Frame the result within the cup run and what the performance showed.`);
    lines.push('');
  }

  // ── Finals context (authoritative — replaces ladder framing) ───────────────
  if (finalsRound) {
    const decider = finalsRound.decider ? ' — the championship decider' : '';
    lines.push(`FINALS CONTEXT (authoritative): this match was the ${finalsRound.name}${decider}.`);
    if (finalsRound.detail) lines.push(`  Round structure: ${finalsRound.detail}.`);
    lines.push(
      finalsRound.decider
        ? `  The winner is the premier — there is no next game. Frame the review around the championship, not the ladder.`
        : `  The regular-season ladder no longer applies. Frame the result as finals-series progression — who advances and where, plus any consequence that DIFFERS from simple elimination (a double chance earned or spent). Do NOT state that the loser is eliminated: in a knockout that is the reader's default assumption. Never frame as ladder movement or a finals-qualification race.`
    );
    const pathFacts = buildFinalsPathFacts(
      league, date, teamName, opponent, teamPosition, opponentPosition, isHome,
      teamRecentForm, opponentRecentForm,
    );
    if (pathFacts.length > 0) {
      lines.push('  Bracket facts (these bind your LOGIC — hosting, seeding, consequences — never infer them; the host is NOT "the higher seed" unless the Seeding fact says so. Do NOT recite this list or open with a round definition: weave the one or two facts that matter into the analysis):');
      pathFacts.forEach(f => lines.push(`    • ${f}`));
    }
    lines.push('');
  } else if (regularSeasonDone) {
    lines.push('FINALS CONTEXT: the regular season is complete and the finals series is underway; the ladder is final (seeding only). Do not frame this result as ladder movement.');
    lines.push('');
  } else if (!isCupTie && !isCricket && rules?.totalRounds && maxPlayed > 0) {
    // ── Season-phase calibration (regular season) ─────────────────────────────
    // Reviews were overstating single results ("season on the brink" in April)
    // and understating late ones. State the phase and the permitted weight so
    // consequence language is calibrated deterministically, not by model vibes.
    // computePhase says 'finals series' past the last round — for a no-finals
    // table (EPL) that label is wrong; the season is simply complete.
    const rawPhase = computePhase(maxPlayed, rules.totalRounds);
    const phase = rawPhase === 'finals series' ? 'season complete' : rawPhase;
    const left  = Math.max(0, rules.totalRounds - maxPlayed);
    const calibration =
      phase === 'season complete'
        ? 'SEASON COMPLETE: the table is final. Frame the result within the finished season — no future stakes remain.'
      : phase === 'early season'
        ? 'EARLY SEASON: one result moves very little. Do NOT use season-defining language ("must-win", "season on the brink", "statement of premiership credentials"); frame it as form, structure, and early signals.'
      : phase === 'mid-season'
        ? 'MID-SEASON: results shape position but nothing is decided. Momentum and trend language is right; finals/relegation certainty language is wrong.'
        : `RUN HOME: ${left} round${left !== 1 ? 's' : ''} left — cutoff arithmetic genuinely matters now. Weight the result against the gaps in DERIVED FACTS, and no further.`;
    lines.push(`SEASON PHASE: ${phase} (after ${maxPlayed} of ${rules.totalRounds} rounds). ${calibration}`);
    {
      const third = seasonThird(maxPlayed, rules.totalRounds);
      lines.push(third === 1
        ? 'SEASON-PLACEMENT POLICY (first third of the season): make NO claims about end-of-season placement — no title/top-N/European/finals/relegation races, no "within reach of the top …". State form and current position plainly.'
        : third === 2
        ? 'SEASON-PLACEMENT POLICY (second third): placement talk ONLY for genuine outliers the derived facts support — streaking clear, consolidating, or falling adrift.'
        : 'SEASON-PLACEMENT POLICY (final third): finishing-position stakes are appropriate where the derived facts support them.');
    }
    lines.push('');
  }

  // ── DERIVED FACTS (pre-computed — model must use these verbatim) ────────────
  const facts: string[] = [];

  // Placement policy (first third: no cutoff/race talk) gates the cutoff facts
  // below as well as the prose — the block used to forbid European talk and
  // then hand the model "is in the top 5 (Champions League places)", which it
  // duly cited and was rejected for.
  const placementThird = (!isCupTie && !isCricket && rules?.totalRounds && maxPlayed > 0)
    ? seasonThird(maxPlayed, rules.totalRounds)
    : undefined;
  const cutoffFactsAllowed = placementThird !== 1;

  // Margin interpretation. `result` is the perspective team's; the winner is
  // named explicitly so the sentence never reads "loss for <winner>".
  if (winner) {
    const unit = league === 'epl' ? 'goal' + (margin !== 1 ? 's' : '') : 'point' + (margin !== 1 ? 's' : '');
    facts.push(`Match margin: ${margin} ${unit} — a ${marginCat} win for ${winner}; ${loser}'s defeat was ${marginCat}.`);
  } else {
    facts.push(`Match margin: DRAW — ${teamScore} each.`);
  }

  // Standings gap (when we have both teams' points) — a regular-season framing;
  // meaningless once the ladder is final.
  const tPts  = teamPoints;
  const oPts  = opponentPoints;
  if (!regularSeasonDone && !isCupTie && !isCricket && tPts !== undefined && oPts !== undefined) {
    const ptsDiff = tPts - oPts;
    if (ptsDiff > 0) {
      facts.push(`${teamName} lead ${opponent} by ${ptsDiff} competition point${ptsDiff !== 1 ? 's' : ''} on the table.`);
    } else if (ptsDiff < 0) {
      facts.push(`${opponent} lead ${teamName} by ${Math.abs(ptsDiff)} competition point${Math.abs(ptsDiff) !== 1 ? 's' : ''} on the table.`);
    } else if (league === 'afl' && teamPercentage !== undefined && opponentPercentage !== undefined) {
      facts.push(`${teamName} and ${opponent} are level on competition points. ${teamPercentage > opponentPercentage ? teamName : opponent} hold the higher ladder position on percentage (${Math.max(teamPercentage, opponentPercentage).toFixed(1)}% vs ${Math.min(teamPercentage, opponentPercentage).toFixed(1)}%).`);
    } else {
      facts.push(`${teamName} and ${opponent} are level on competition points.`);
    }
  }

  // Finals / relegation gaps from full table — cutoff arithmetic only means
  // anything while the ladder can still move.
  if (cutoffFactsAllowed && !regularSeasonDone && !isCupTie && !isCricket && leagueTable && leagueTable.length > 0) {
    const sorted = [...leagueTable].sort((a, b) => a.position - b.position);
    const finalsSpot = FINALS_SPOTS[league];

    if (finalsSpot && sorted.length > finalsSpot) {
      const finalsCutoffRow = sorted[finalsSpot - 1];
      const cutoffPts       = finalsCutoffRow.points;
      for (const [name, pts] of [
        [teamName,   tPts],
        [opponent,   oPts],
      ] as [string, number | undefined][]) {
        if (pts === undefined || cutoffPts === 0) continue;
        const gap = pts - cutoffPts;
        if (gap > 0) {
          facts.push(`${name} is ${gap} point${gap !== 1 ? 's' : ''} inside the top ${finalsSpot} (${ordinalSuffix(finalsSpot)} is ${finalsCutoffRow.name} on ${cutoffPts} pts).`);
        } else if (gap < 0) {
          facts.push(`${name} is ${Math.abs(gap)} point${Math.abs(gap) !== 1 ? 's' : ''} outside the top ${finalsSpot} (${ordinalSuffix(finalsSpot)} is ${finalsCutoffRow.name} on ${cutoffPts} pts).`);
        } else {
          facts.push(`${name} holds ${ordinalSuffix(finalsSpot)} place — the last finals position (${cutoffPts} pts).`);
        }
      }
    }

    // EPL Champions League places — wording is parametric on EPL_UCL_SPOTS (5 for
    // 2025-26); never write the cutoff ordinal literally or it goes stale with COMP_RULES.
    if (league === 'epl' && sorted.length >= EPL_UCL_SPOTS + 1) {
      const clCutoffRow  = sorted[EPL_UCL_SPOTS - 1]; // last qualifying place
      const firstOutside = sorted[EPL_UCL_SPOTS];     // first place outside
      if (clCutoffRow.points && ((teamPosition ?? 99) <= EPL_UCL_SPOTS || (opponentPosition ?? 99) <= EPL_UCL_SPOTS)) {
        for (const [name, pts, pos] of [
          [teamName, tPts, teamPosition],
          [opponent, oPts, opponentPosition],
        ] as [string, number | undefined, number | undefined][]) {
          if (pts === undefined || pos === undefined) continue;
          if (pos <= EPL_UCL_SPOTS) {
            const margin = pts - firstOutside.points;
            if (margin > 0) facts.push(`${name} is in the top ${EPL_UCL_SPOTS} (Champions League places), ${margin} point${margin !== 1 ? 's' : ''} clear of ${ordinalSuffix(EPL_UCL_SPOTS + 1)}.`);
            else facts.push(`${name} is in the top ${EPL_UCL_SPOTS} (Champions League places), level on points with ${ordinalSuffix(EPL_UCL_SPOTS + 1)} (${firstOutside.name}).`);
          } else {
            const gap = clCutoffRow.points - pts;
            if (gap > 0) facts.push(`${name} is ${gap} point${gap !== 1 ? 's' : ''} behind the top ${EPL_UCL_SPOTS} (${ordinalSuffix(EPL_UCL_SPOTS)} is ${clCutoffRow.name} on ${clCutoffRow.points} pts).`);
            else facts.push(`${name} is level on points with the top-${EPL_UCL_SPOTS} cutoff (${ordinalSuffix(EPL_UCL_SPOTS)} is ${clCutoffRow.name} on ${clCutoffRow.points} pts).`);
          }
        }
      }
    }

    if (league === 'epl' && sorted.length >= EPL_RELEGATION_FROM) {
      const safetyRow = sorted[EPL_RELEGATION_FROM - 2]; // last safe place
      for (const [name, pos] of [[teamName, teamPosition], [opponent, opponentPosition]] as [string, number | undefined][]) {
        if (!pos || !safetyRow.points) continue;
        if (pos >= EPL_RELEGATION_FROM - 2) {
          const relPts = (pos === teamPosition ? tPts : oPts) ?? 0;
          const gap = relPts - safetyRow.points;
          if (gap >= 0) facts.push(`${name} are ${gap} point${gap !== 1 ? 's' : ''} above the relegation zone.`);
          else facts.push(`${name} are in the relegation zone, ${Math.abs(gap)} point${Math.abs(gap) !== 1 ? 's' : ''} from safety.`);
        }
      }
    }
  }

  if (facts.length > 0) {
    lines.push('DERIVED FACTS — pre-computed. Use these verbatim — do not recalculate or contradict:');
    facts.forEach(f => lines.push(`  • ${f}`));
    lines.push('');
  }

  // ── Current standings ──────────────────────────────────────────────────────
  if (!isCupTie && !isCricket && (teamPosition !== undefined || opponentPosition !== undefined)) {
    lines.push(regularSeasonDone
      ? 'REGULAR-SEASON SEEDING (final ladder — context only, no longer at stake):'
      : 'CURRENT STANDINGS (after this result):');
    for (const [name, pos, played, pts, pct] of [
      [teamName,   teamPosition,     teamPlayed,     teamPoints,     teamPercentage],
      [opponent,   opponentPosition, opponentPlayed, opponentPoints, opponentPercentage],
    ] as [string, number | undefined, number | undefined, number | undefined, number | undefined][]) {
      if (pos === undefined) continue;
      const playedStr = played !== undefined ? `, ${played} played` : '';
      const ptsStr    = pts    !== undefined ? `, ${pts} pts` : '';
      const pctStr    = (league === 'afl' && pct !== undefined) ? `, ${pct.toFixed(1)}% (AFL tiebreaker)` : '';
      lines.push(`  ${name}: ${ordinalSuffix(pos)}${playedStr}${ptsStr}${pctStr}`);
    }
    // Authoritative single-line position fact — the ladder-position validator
    // binds every positional ordinal in the prose to this line.
    if (!regularSeasonDone && !isCupTie && !isCricket && leagueTable && leagueTable.length > 0) {
      const posBits: string[] = [];
      if (teamPosition !== undefined)     posBits.push(`${teamName} — ${ordinalSuffix(teamPosition)} of ${leagueTable.length}`);
      if (opponentPosition !== undefined) posBits.push(`${opponent} — ${ordinalSuffix(opponentPosition)} of ${leagueTable.length}`);
      if (posBits.length > 0) lines.push(`  LADDER POSITION (authoritative): ${posBits.join('; ')}`);
    }
    lines.push('');
  }

  // ── Form coming in + head-to-head (context, never the reviewed match) ──────
  const formLine = (rs: GameResult[]): string =>
    rs.slice(0, 5).map(r => `${r.isDraw ? 'D' : r.isWin ? 'W' : 'L'} ${r.teamScore}–${r.opponentScore} ${r.isHome ? 'v' : '@'} ${r.opponent}`).join(', ');
  if ((teamRecentForm && teamRecentForm.length > 0) || (opponentRecentForm && opponentRecentForm.length > 0)) {
    lines.push('FORM COMING INTO THIS MATCH (completed games before this fixture, most recent first — how each side arrived, NOT including this result):');
    if (teamRecentForm?.length)     lines.push(`  ${teamName}: ${formLine(teamRecentForm)}`);
    if (opponentRecentForm?.length) lines.push(`  ${opponent}: ${formLine(opponentRecentForm)}`);
    lines.push('');
  }
  if (headToHead && headToHead.length > 0) {
    const h2hBits = headToHead.slice(0, 3).map(h =>
      `${h.result} ${h.teamScore}–${h.opponentScore}${h.teamWasHome === undefined ? '' : h.teamWasHome ? ' (home)' : ' (away)'}`);
    lines.push(`HEAD-TO-HEAD (previous meetings, ${teamName} perspective, most recent first — do not restate as this season's form): ${h2hBits.join(', ')}`);
    lines.push('');
  }

  // ── Season context (computed runs/records — lib/match-report.ts) ───────────
  if (seasonFacts && seasonFacts.length > 0) {
    lines.push("SEASON CONTEXT (computed from this season's completed results — the ONLY run, streak and record figures you may cite; use them verbatim):");
    seasonFacts.forEach(l => lines.push(`  • ${l}`));
    lines.push('');
  }

  // ── Match events (full sequence) or the bare scoring timeline ──────────────
  if (matchEvents && matchEvents.length > 0) {
    lines.push('MATCH EVENTS (authoritative sequence — every score with how it came and who assisted where known, cards, substitutions, running score; anchor the story in WHEN and HOW it turned):');
    matchEvents.forEach(l => lines.push(`  ${l}`));
    lines.push('');
  } else if (scoringTimeline && scoringTimeline.length > 0) {
    lines.push('SCORING TIMELINE (derived — the sequence is authoritative; anchor the story in WHEN it turned):');
    scoringTimeline.forEach(l => lines.push(`  ${l}`));
    lines.push('');
  }

  // ── Match stats (team-level side by side, then scorers per side) ───────────
  const tAgg = matchStats?.team?.aggStats ?? [];
  const oAgg = matchStats?.opponent?.aggStats ?? [];
  const hasAnyStats = tAgg.length > 0 || oAgg.length > 0
    || !!matchStats?.team?.players?.length || !!matchStats?.opponent?.players?.length;
  if (tAgg.length > 0 && oAgg.length > 0) {
    // One line per stat, both sides — a comparison the model can read as an
    // argument ("60% of the ball, 2 shots on target to 5"), not two lists.
    lines.push(`TEAM STATS (${teamName} – ${opponent}):`);
    for (const s of tAgg) {
      const o = oAgg.find(x => x.label === s.label);
      if (o) lines.push(`  ${s.label}: ${s.value} – ${o.value}`);
    }
    lines.push('');
  }
  if (matchStats) {
    for (const [label, side] of [
      [teamName,   matchStats.team],
      [opponent,   matchStats.opponent],
    ] as [string, typeof matchStats.team][]) {
      if (!side) continue;

      // Team-level aggregate stats — only when the paired block above could not render them.
      if (side.aggStats && side.aggStats.length > 0 && !(tAgg.length > 0 && oAgg.length > 0)) {
        lines.push(`${label.toUpperCase()} TEAM STATS:`);
        side.aggStats.slice(0, 8).forEach(s => lines.push(`  ${s.label}: ${s.value}`));
      }

      // Key scorers / standout players — only include players with notable stats.
      // AFL: the CFS fetcher pre-curates key performers (goal-kickers AND
      // ball-winners with 0 goals), so its list passes through unfiltered.
      const scorers = league === 'afl'
        ? side.players
        : side.players?.filter(p =>
            p.stats.some(s =>
              ['T', 'G', 'Tries', 'Goals', 'Points', 'G(1)', 'G(2)', 'G(3)'].includes(s.label) &&
              parseInt(s.value, 10) > 0,
            ),
          );
      if (scorers && scorers.length > 0) {
        lines.push(`${label.toUpperCase()} ${league === 'afl' ? 'KEY PERFORMERS' : 'SCORERS'}:`);
        scorers.slice(0, 6).forEach(p => {
          const statStr = p.stats.map(s => `${s.label}: ${s.value}`).join(', ');
          lines.push(`  ${p.name}${p.position ? ` (${p.position})` : ''} — ${statStr}`);
        });
      }
      lines.push('');
    }
  }

  // Explicit note when no match stats were provided — prevents tactical stat fabrication
  if (!hasAnyStats) {
    lines.push('NO IN-GAME MATCH STATS PROVIDED. Do NOT cite specific in-game statistics (e.g. completion rate, inside 50 efficiency, possession percentage, metres gained) — none were provided and any figure would be fabricated. Use only the scores, standings, and DERIVED FACTS above.');
    lines.push('');
  }

  // The explicit name whitelist: every individual the data named. The player
  // validator reads this line and scans the whole output against it.
  if (playerNames && playerNames.length > 0) {
    lines.push(`PLAYERS NAMED IN THIS MATCH (the only individuals you may name; spell exactly as here): ${[...new Set(playerNames)].join(', ')}`);
  }

  lines.push('');
  lines.push('Generate the post-match review using ONLY the data provided above. Do not invent statistics, player names, or historical records not mentioned.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
