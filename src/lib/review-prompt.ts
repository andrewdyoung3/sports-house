/**
 * Shared post-match review prompt assembly — the EXACT system prompt + data-block
 * construction used by POST /api/ai-review. Extracted verbatim from that route so
 * both the route and any eval harness build identical prompts.
 *
 * Pure prompt building: no network calls, not wired into runtime.
 */

import type { LeagueTableRow, MatchStats } from '@/types';
import { getCompetitionProfile } from '@/lib/competition-context';

// ─── Sport-specific context ───────────────────────────────────────────────────

const SPORT_CONTEXT: Record<string, string> = {
  afl:         'Australian Rules Football (AFL). Use AFL-specific terminology: contested possessions, clearances, inside 50s, centre bounces, forward 50, the corridor. The table is called "the Ladder". AFL margin = the score difference; do NOT call a 20-point loss "heavy" in AFL (30–60 is comfortable; 15–29 is clear; <15 is close).',
  nrl:         'NRL Rugby League (13-man code). Use NRL-specific terminology: completion rate, ruck speed, middle forwards, edges, kick chase. The table is called "the Ladder". NRL margin interpretation: ≤10 pts = competitive; 11–20 = clear; 21–30 = comfortable; 31+ = heavy.',
  epl:         'English Premier League (association football). Use "pitch" not "field"; "half" not "period". The table is called "the Table". Margin: 1-goal = close; 2 goals = comfortable; 3+ = convincing/heavy.',
  super_rugby: 'Super Rugby Pacific (15-man rugby union). Use rugby union terminology: scrum, lineout, breakdown, ruck, gainline. The table is called "the Table". Margin: ≤10 pts = competitive; 11–20 = clear; 21–30 = comfortable; 31+ = heavy.',
  rugby_int:   'International Rugby Union Test match. Tone should reflect the magnitude of Test rugby. Same margin scale as Super Rugby.',
};

const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
};

// Finals cutoff: top-N by league
const FINALS_SPOTS: Record<string, number> = { nrl: 8, afl: 8, super_rugby: 8 };
const EPL_RELEGATION_FROM = 18;
const EPL_UCL_SPOTS = 4;

// ─── System prompt ────────────────────────────────────────────────────────────

export const REVIEW_SYSTEM_PROMPT = `You are a sports analyst writing a brief post-match review. Direct, analytical tone — not narrative or journalistic. Past tense throughout.

GROUNDING — absolute constraint, no exceptions:
• Only cite statistics, percentages, or records that are explicitly present in the MATCH DATA or MATCH STATS sections. Never invent numbers.
• Only name individual players whose names appear in the MATCH STATS or PLAYER DATA sections. If no player names are provided, describe positions and tactical patterns only — never use training-knowledge player names.
• The DERIVED FACTS section contains pre-computed margin interpretations and standings gaps. Use those exact phrasings — do not recalculate, rephrase, or contradict them.
• COMPETITION PROFILE is the authoritative description of how the competition works. All references to finals, relegation, or qualification must match it.
• LADDER POSITIONS: use the exact ordinal positions from CURRENT STANDINGS verbatim — do NOT approximate or confuse "top 8 qualifying cutoff" with "8th place". If CURRENT STANDINGS shows a team in 13th, say "13th", not "8th" or "outside the finals". If a DERIVED FACTS note says a team is "X points outside the top 8", use that phrasing — never infer a position number from it.

INFORMATION ECONOMY:
• The user can already see the scoreline and result. Do NOT restate the score in the summary or verdict.
• Do NOT recite win/loss records. The user sees the table.
• No position recitation ("they sit 6th with 31 points") — state what it means structurally.
• Every sentence must add interpretation the data display cannot show: WHY the result happened, what structural pattern it reflects, what it means going forward.

MARGIN CALIBRATION — read from DERIVED FACTS, do not compute:
• Use the margin label from DERIVED FACTS verbatim. Never call a competitive defeat "heavy" or vice versa.

STRUCTURE — four elements required, distributed naturally:
• KEY MATCHUP: The decisive tactical or personnel contest that determined the result. Name it specifically.
• RECENT FORM: What the form pattern before this game suggested — and whether this result fits or breaks it.
• STATISTICAL ANGLE: One meaningful number from the MATCH STATS or DERIVED FACTS that explains the margin or method. Only cite it if it was explicitly provided.
• REASONED VERDICT: The single most important forward-looking implication — a trend confirmed, weakness exposed, or opportunity opened.

RULES:
• No filler: avoid "credit to both sides", "gave it their all", "never-say-die spirit"
• No hollow superlatives or vague momentum phrases
• No meta-commentary — do not refer to the review itself
• Vary your opening angle — avoid "[Team] controlled this match" as an opener
• Explain tactical and structural reasons — not just "they scored more"
• Do not state uncertainty explicitly — let calibration inform tone

KEY MOMENTS: specific and grounded, max 12 words each. Not restatements of the score.

OUTPUT: Return valid JSON only, no markdown fences:
{
  "summary": "2–3 sentences — WHY the result happened. Open with the decisive structural factor, not the score.",
  "keyMoments": ["grounded factor 1 (max 12 words)", "grounded factor 2", "grounded factor 3"],
  "verdict": "1–2 sentences — forward-looking implication for the winning or followed team."
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
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
  } = input;

  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  const homeAway    = isHome ? 'Home' : 'Away';
  const result      = teamScore > opponentScore ? 'WIN' : teamScore < opponentScore ? 'LOSS' : 'DRAW';
  const comp        = competition ?? 'Regular season';
  const dateStr     = new Date(date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const margin      = Math.abs(teamScore - opponentScore);
  const winner      = teamScore > opponentScore ? teamName : teamScore < opponentScore ? opponent : null;
  const loser       = winner === teamName ? opponent : winner === opponent ? teamName : null;
  const marginCat   = marginCategory(league, margin);

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
  lines.push(`Competition: ${comp}`);
  lines.push(`Date: ${dateStr}`);
  lines.push(`${homeAway}: ${teamName} vs ${opponent}`);
  lines.push(`Score: ${teamName} ${teamScore} – ${opponentScore} ${opponent}`);
  lines.push(`Result: ${result}`);
  lines.push('');

  // ── DERIVED FACTS (pre-computed — model must use these verbatim) ────────────
  const facts: string[] = [];

  // Margin interpretation
  if (winner) {
    facts.push(`Match margin: ${margin} ${league === 'epl' ? 'goal' + (margin !== 1 ? 's' : '') : 'point' + (margin !== 1 ? 's' : '')} — ${marginCat} ${result.toLowerCase()} for ${winner} (${loser} defeat was ${marginCat}).`);
  } else {
    facts.push(`Match margin: DRAW — ${teamScore} each.`);
  }

  // Standings gap (when we have both teams' points)
  const tPts  = teamPoints;
  const oPts  = opponentPoints;
  if (tPts !== undefined && oPts !== undefined) {
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

  // Finals / relegation gaps from full table
  if (leagueTable && leagueTable.length > 0) {
    const sorted = [...leagueTable].sort((a, b) => a.position - b.position);
    const finalsSpot = FINALS_SPOTS[league];

    if (finalsSpot && sorted.length > finalsSpot) {
      const eighth    = sorted[finalsSpot - 1];
      const cutoffPts = eighth.points;
      for (const [name, pts] of [
        [teamName,   tPts],
        [opponent,   oPts],
      ] as [string, number | undefined][]) {
        if (pts === undefined || cutoffPts === 0) continue;
        const gap = pts - cutoffPts;
        if (gap > 0) {
          facts.push(`${name} is ${gap} point${gap !== 1 ? 's' : ''} inside the top ${finalsSpot} (${ordinalSuffix(finalsSpot)} is ${eighth.name} on ${cutoffPts} pts).`);
        } else if (gap < 0) {
          facts.push(`${name} is ${Math.abs(gap)} point${Math.abs(gap) !== 1 ? 's' : ''} outside the top ${finalsSpot} (${ordinalSuffix(finalsSpot)} is ${eighth.name} on ${cutoffPts} pts).`);
        } else {
          facts.push(`${name} holds ${ordinalSuffix(finalsSpot)} place — the last finals position (${cutoffPts} pts).`);
        }
      }
    }

    if (league === 'epl' && sorted.length >= EPL_UCL_SPOTS + 1) {
      const fourth = sorted[EPL_UCL_SPOTS - 1];
      for (const [name, pts] of [[teamName, tPts], [opponent, oPts]] as [string, number | undefined][]) {
        if (pts === undefined || !fourth.points) continue;
        if ((teamPosition ?? 99) <= EPL_UCL_SPOTS || (opponentPosition ?? 99) <= EPL_UCL_SPOTS) {
          const gap = fourth.points - pts;
          if (gap > 0) facts.push(`${name} is ${gap} point${gap !== 1 ? 's' : ''} behind the top four.`);
          else if (gap < 0) facts.push(`${name} is in the top four, ${Math.abs(gap)} point${Math.abs(gap) !== 1 ? 's' : ''} clear of 5th.`);
        }
      }
    }

    if (league === 'epl' && sorted.length >= EPL_RELEGATION_FROM) {
      const seventeenth = sorted[EPL_RELEGATION_FROM - 2];
      for (const [name, pos] of [[teamName, teamPosition], [opponent, opponentPosition]] as [string, number | undefined][]) {
        if (!pos || !seventeenth.points) continue;
        if (pos >= EPL_RELEGATION_FROM - 2) {
          const relPts = (pos === teamPosition ? tPts : oPts) ?? 0;
          const gap = relPts - seventeenth.points;
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
  if (teamPosition !== undefined || opponentPosition !== undefined) {
    lines.push('CURRENT STANDINGS (after this result):');
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
    lines.push('');
  }

  // ── Match stats (EPL / NRL / SRU — from match-stats API) ──────────────────
  if (matchStats) {
    for (const [label, side] of [
      [teamName,   matchStats.team],
      [opponent,   matchStats.opponent],
    ] as [string, typeof matchStats.team][]) {
      if (!side) continue;

      // Team-level aggregate stats
      if (side.aggStats && side.aggStats.length > 0) {
        lines.push(`${label.toUpperCase()} TEAM STATS:`);
        side.aggStats.slice(0, 8).forEach(s => lines.push(`  ${s.label}: ${s.value}`));
      }

      // Key scorers / standout players — only include players with notable stats
      const scorers = side.players?.filter(p =>
        p.stats.some(s =>
          ['T', 'G', 'Tries', 'Goals', 'Points', 'G(1)', 'G(2)', 'G(3)'].includes(s.label) &&
          parseInt(s.value, 10) > 0,
        ),
      );
      if (scorers && scorers.length > 0) {
        lines.push(`${label.toUpperCase()} SCORERS:`);
        scorers.slice(0, 6).forEach(p => {
          const statStr = p.stats.map(s => `${s.label}: ${s.value}`).join(', ');
          lines.push(`  ${p.name}${p.position ? ` (${p.position})` : ''} — ${statStr}`);
        });
      }
      lines.push('');
    }
  }

  // Explicit note when no match stats were provided — prevents tactical stat fabrication
  if (!matchStats) {
    lines.push('NO IN-GAME MATCH STATS PROVIDED. Do NOT cite specific in-game statistics (e.g. completion rate, inside 50 efficiency, possession percentage, metres gained) — none were provided and any figure would be fabricated. Use only the scores, standings, and DERIVED FACTS above.');
  }

  lines.push('');
  lines.push('Generate the post-match review using ONLY the data provided above. Do not invent statistics, player names, or historical records not mentioned.');
  return lines.join('\n');
}
