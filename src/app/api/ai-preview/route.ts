/**
 * POST /api/ai-preview
 *
 * Generates a structured match preview using Claude (claude-sonnet-4-6).
 * Written in the voice of a seasoned sports journalist for a high-end
 * Australian/UK sports publication.
 *
 * Accepts all available context (standings, recent form, team news, model tips)
 * and returns four structured sections + key insights — all grounded in real data.
 *
 * Responses are cached per gameId for 6 hours so the same fixture doesn't
 * trigger repeated API calls across users.
 *
 * Requires ANTHROPIC_API_KEY in environment variables.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { unstable_cache } from 'next/cache';
import type { PreviewContext, GameResult, AIPreview } from '@/types';

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
};

const LEAGUE_LABELS: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby Pacific',
  rugby_int:   'International Rugby Union',
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a seasoned sports journalist and tactical analyst for a high-end Australian sports publication that covers AFL, NRL, rugby union, and Premier League football. Your writing is insightful, narrative-driven, and focused on the theatre of sport. You write for readers who are knowledgeable fans — they want substance, not boilerplate.

LANGUAGE RULES — strictly enforced:
• "Pitch/Ground" not "Field" (use "pitch" for football/soccer, "ground" for rugby/AFL)
• "Fixture" not "Game" or "Match" when referring to the scheduled contest
• "Ladder/Table" not "Standings"
• "Form" not "Performance Trends"
• "attack/defence" not "offense/defense"
• "half/quarter" not "period"
• Numbers as words under ten; numerals for 10 and above
• British/Australian idioms where natural: "backs against the wall", "premiership window", "relegation scrap", "six-pointer", "wooden spoon", "finals series", "the run-in", "searching for answers", "claim a scalp", "under the pump", "sitter on the ladder"

DATA INTEGRITY — non-negotiable:
• Use ONLY the data provided. Do NOT invent statistics, player names, scorelines, or results not mentioned.
• If team news mentions injuries or absences, weave them naturally into the narrative.
• If a section has no data (e.g., no news, no tips), write authoritatively in general terms — never expose the absence with phrases like "no data available".
• Do not fabricate head-to-head records or historical facts.

INFORMATION ECONOMY — avoid redundancy:
• The app already displays W/D/L form icons, ladder positions, exact scores, and win/loss records graphically. Never recite these back verbatim.
• Forbidden patterns: "won 4 of their last 5", "sitting 6th with 31 points", "their W-W-L-W record", "beat Arsenal 2–1 last week", "7 wins 3 draws 2 losses", "ranked 3rd on the table".
• Instead, translate numbers into narrative meaning and stakes: "building serious momentum", "wobbling at the wrong end of the season", "a side that cannot be trusted on the road", "the ladder flatters them — xG tells a different story", "the table tightens with every round", "fighting to stay in the conversation for top four".
• Directional cues (recency without the tally) are acceptable: "fresh off a convincing derby win", "arriving on the back of successive defeats", "unbeaten in six". Count-based recitations are not: "won three of their last four".
• For standings: convey the stakes and narrative weight — "locked in a title race", "deep in a relegation battle", "chasing Champions League football" — not the coordinates.

STATISTICAL CALIBRATION — think like a good analyst:
• The CURRENT LADDER/TABLE data includes a "played" count. Use it to judge how much weight the data deserves.
• Early season (≤4 games played): the ladder is noise, not signal. A team sitting first after three rounds has proved almost nothing. Do NOT write "on course for the title", "early front-runner", "set the standard", or any phrase implying the season's shape is clear. Instead, acknowledge the open nature: "too early to draw firm conclusions", "the table will look very different in a month", "results are forming a picture but the sample is small".
• Small-sample form (≤3 results in the form guide): do not overstate momentum. A single heavy win or loss does not constitute a trend. Only describe sustained momentum when there are four or more results pointing the same direction.
• Exception — strong early signals ARE worth noting when they are genuinely striking: three consecutive high-margin wins, three consecutive heavy defeats, or an unusually dominant set-piece record across all fixtures. Name the signal clearly and note it is early but meaningful.
• Mid-season (5–15 games): patterns are becoming real. Discuss trends with moderate confidence.
• Late season (16+ games): form, ladder position, and momentum carry full analytical weight.
• When the "played" count differs between the two teams, acknowledge the imbalance if it affects your interpretation.

COMPETITION CONTEXT — critical:
• The COMPETITION field tells you what is actually being played. The PRIMARY LEAGUE field (when present) is background only.
• For cup or European fixtures (e.g. Champions League, FA Cup, EFL Cup, Europa League, Rugby Championship, Six Nations), the "context" section must focus on the teams' form and journey in THAT competition — not their domestic league table position. A team's EPL standing is irrelevant to a Champions League preview.
• When standings are labelled as "primary league context only", treat them as a footnote — do not lead with or centre the narrative on league position.
• The recent form covers all competitions. Acknowledge this naturally ("across all fronts", "in recent weeks") rather than implying it is competition-specific.

WRITING STYLE:
• Present tense throughout — this is a preview, not a report.
• Each section should feel like part of the same narrative arc, not isolated paragraphs.
• Vary sentence length. Mix punchy sentences with longer analytical ones.
• Avoid clichés like "both sides will be looking to", "key battle will be in", or "it promises to be".
• The "playerSpotlight" must name a specific player if one appears in the news/data, OR describe a pivotal position/role if no individual is named.

OUTPUT — respond ONLY with a valid JSON object. No markdown code fences. No extra text before or after the JSON:
{
  "context": "2–3 sentence paragraph. Big-picture story for THIS competition specifically — for cup/European fixtures focus on the teams' journey and stakes in that competition, not their domestic league position. Include what's at stake in this specific fixture.",
  "tacticalBattle": "2–3 sentence paragraph. The precise tactical clash where the game will be won or lost. Use sport-specific vocabulary from the SPORT field. Identify the key structural tension.",
  "playerSpotlight": "Begin with the player or position name (e.g. 'Marcus Bontempelli' or 'The halfback line'). 1–2 sentences on why this individual or role is the pivotal storyline — their current form trajectory, what's riding on their performance.",
  "verdict": "2–3 sentence paragraph. The most likely narrative outcome and why — authoritative but not arrogant. Acknowledge what could flip the result.",
  "keyInsights": [
    "Punchy tactical or contextual point (max ~12 words)",
    "Punchy tactical or contextual point (max ~12 words)",
    "Punchy tactical or contextual point (max ~12 words)",
    "Punchy tactical or contextual point (max ~12 words)"
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

function buildDataBlock(
  league: string,
  teamName: string,
  opponentName: string,
  context: PreviewContext,
  teamResults: GameResult[],
  oppResults: GameResult[],
  competition?: string,
  compact?: boolean,
): string {
  const leagueLabel = LEAGUE_LABELS[league] ?? league.toUpperCase();
  const sportCtx    = SPORT_CONTEXT[league] ?? '';
  // A fixture is "off-league" when it's in a cup, European, or international
  // tournament that differs from the primary league (e.g. CL, FA Cup, RC).
  const isOffLeague = !!competition;
  const lines: string[] = [];

  lines.push(`FIXTURE: ${teamName} vs ${opponentName}`);
  lines.push(`COMPETITION: ${competition ?? leagueLabel}`);
  if (isOffLeague) {
    lines.push(`PRIMARY LEAGUE: ${leagueLabel} (background context only — this preview is about the ${competition})`);
  }
  // Competition stage (cup/European competitions only)
  if (context.competitionStage) {
    const { competitionStage: cs } = context;
    if (cs.isGroupPhase) {
      lines.push(`COMPETITION STAGE: ${cs.groupName ?? 'Group/League Phase'}`);
    } else {
      lines.push(`COMPETITION STAGE: ${cs.roundName}`);
    }
  }
  lines.push(`SPORT: ${sportCtx}`);
  lines.push('');

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
      lines.push(`  ${name}: ${ordinalSuffix(s.position)} — played ${s.played}, ${record}, ${s.points ?? 0} pts`);
    }
    lines.push('');
  }

  // Ladder/Table positions
  if (context.teamStanding || context.opponentStanding) {
    // When the fixture is in a different competition, label standings clearly
    // so Claude treats them as background context, not the central narrative.
    const standingsHeading = isOffLeague
      ? `${leagueLabel.toUpperCase()} STANDING (primary league context only — NOT the focus for this ${competition} fixture):`
      : 'CURRENT LADDER/TABLE POSITIONS:';
    lines.push(standingsHeading);
    for (const [name, s] of [
      [teamName, context.teamStanding],
      [opponentName, context.opponentStanding],
    ] as const) {
      if (!s) continue;
      const draws = s.draws > 0 ? ` ${s.draws}D` : '';
      const record = `${s.wins}W${draws} ${s.losses}L`;
      const extra = s.points !== undefined
        ? `, ${s.points} pts`
        : s.percentage !== undefined
          ? `, ${s.percentage.toFixed(1)}% percentage`
          : '';
      lines.push(`  ${name}: ${ordinalSuffix(s.position)} — played ${s.played}, ${record}${extra}`);
    }
    lines.push('');
  }

  // Recent form — spans all competitions
  if (teamResults.length > 0 || oppResults.length > 0) {
    const formHeading = isOffLeague
      ? 'RECENT FORM — all competitions (last 5 fixtures, most recent first):'
      : 'RECENT FORM (last 5 fixtures, most recent first):';
    lines.push(formHeading);
    if (teamResults.length > 0) {
      lines.push(`  ${teamName}: ${formString(teamResults)} — ${formDetail(teamResults)}`);
    }
    if (oppResults.length > 0) {
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

  // Model tips (AFL Squiggle)
  if (context.tips) {
    const t = context.tips;
    lines.push(`EXPERT MODEL PREDICTIONS: ${t.tipsFor} of ${t.tipsTotal} models tip ${t.favouriteTeam}, average predicted winning margin: ${t.avgMargin} points`);
    lines.push('');
  }

  if (compact) {
    lines.push('');
    lines.push('BREVITY MODE — this preview appears in a league-wide fixture list alongside many other games. Be concise:');
    lines.push('• "context": ONE sentence, max 25 words. Essential narrative only — what is at stake.');
    lines.push('• "tacticalBattle": ONE sentence, max 20 words. The single decisive match-up.');
    lines.push('• "playerSpotlight": player or role name + one brief phrase, max 12 words total.');
    lines.push('• "verdict": ONE sentence, max 20 words. Most likely outcome and why.');
    lines.push('• "keyInsights": exactly TWO points, max 8 words each.');
  }
  lines.push(`Generate the match preview using only the data provided above. Do not invent statistics, player names not mentioned, or historical records not given.`);

  return lines.join('\n');
}

function buildUpdatePrompt(
  previous: AIPreview,
  teamName: string,
  opponentName: string,
  teamNews: { headline: string; description?: string }[],
  oppNews:  { headline: string; description?: string }[],
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
  lines.push('');
  lines.push(
    'Return the same JSON structure. Update only the sections directly affected by this new information (e.g. playerSpotlight if an injury is mentioned, verdict if significant news shifts the outlook). Preserve the tactical analysis, historical form narrative, and ladder context where it remains accurate. Do not invent new facts beyond what is provided above.'
  );
  return lines.join('\n');
}

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(prompt: string, compact = false): Promise<AIPreview> {
  const client   = new Anthropic();
  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: compact ? 380 : 800,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw     = (response.content[0] as { type: string; text: string }).text ?? '{}';
  // Strip accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(cleaned) as AIPreview;
}

// Cache per unique (cacheKey, prompt, compact) triple — 6-hour TTL.
// compact previews are cached separately (shorter content, different prompt).
const getCachedPreview = unstable_cache(
  async (_cacheKey: string, prompt: string, compact: boolean): Promise<AIPreview> => callClaude(prompt, compact),
  ['ai-preview-v2'],
  { revalidate: 21600 }, // 6 hours
);

// ─── Route handler ────────────────────────────────────────────────────────────

const ALLOWED_LEAGUES = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);
const TEAMID_RE       = /^[a-z]+-[a-z0-9-]+$/;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI preview not configured' }, { status: 503 });
  }

  try {
    const body = await req.json() as {
      league:          string;
      teamId:          string;
      teamName:        string;
      opponentName:    string;
      gameId:          string;
      context:         PreviewContext;
      teamResults:     GameResult[];
      oppResults:      GameResult[];
      competition?:    string;
      compact?:        boolean;
      previousPreview?: AIPreview;
      newsFingerprint?: string;
    };

    const {
      league, teamId, teamName, opponentName, gameId,
      context, teamResults, oppResults, competition, compact,
      previousPreview, newsFingerprint,
    } = body;

    if (!ALLOWED_LEAGUES.has(league) || !TEAMID_RE.test(teamId)) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
    }

    let prompt: string;
    let cacheKey: string;

    const isCompact = compact === true;

    if (previousPreview && newsFingerprint) {
      // Update mode — news has changed since last generation.
      const teamNews = context.teamNews ?? [];
      const oppNews  = context.opponentNews ?? [];
      prompt   = buildUpdatePrompt(previousPreview, teamName, opponentName, teamNews, oppNews);
      cacheKey = `update:${gameId}:${newsFingerprint}${isCompact ? ':c' : ''}`;
    } else {
      // Full generation mode.
      prompt   = buildDataBlock(league, teamName, opponentName, context ?? {}, teamResults ?? [], oppResults ?? [], competition, isCompact);
      cacheKey = isCompact ? `${gameId}:compact` : gameId;
    }

    const preview = await getCachedPreview(cacheKey, prompt, isCompact);
    return NextResponse.json(preview);
  } catch (err) {
    console.error('[/api/ai-preview]', err);
    return NextResponse.json({ error: 'Preview generation failed' }, { status: 500 });
  }
}
