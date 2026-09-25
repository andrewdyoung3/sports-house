/**
 * Output validators for POST-MATCH REVIEWS — the review-route port of the
 * preview validator suite (previews have had retry + refuse-store since
 * REL-1; reviews shipped their first parse un-validated until 2026-09-13).
 *
 * Reviews reuse the preview validators wherever the review data block emits
 * the same authoritative markers (LADDER POSITION, REGULAR-SEASON SEEDING /
 * FINALS PATH facts, DERIVED FACTS points figures, SCORERS whitelists), plus
 * review-specific checks for phase-calibrated language and fabricated
 * in-game statistics.
 *
 * Contract mirrors the preview pipeline: violations → one retry → still
 * violating → REFUSE (throw, so the Next data cache never stores it).
 */

import type { AIReview, AIPreview } from '@/types';
import {
  validateFinalsSeeding,
  validateLadderPosition,
  validatePointsClaims,
  validatePlayerNames,
  validatePlayerSideClaims,
  validateFinalsRedundancy,
  validateAbsenceNarration,
  validateSportRegister,
  validateRegisterCrutches,
  validateCricketRegister,
  validateSeasonPlacement,
  validateDayCounts,
  validateNumeralBinding,
  validateVenueFormClaims,
  validateDoubleChance,
  validateSeriesClaims,
  validateProvisionalLadder,
  validateFormRuns,
  validateResultDirection,
  validateHeadToHeadClaims,
  validateVenueDimensions,
  validateDeciderClaims,
} from '@/lib/preview-generator';

/** Every verdict the review carries: the per-club map (model output) or the single stored line. */
function verdictTexts(r: AIReview): string[] {
  const out: string[] = [];
  if (r.verdicts) for (const v of Object.values(r.verdicts)) if (typeof v === 'string' && v.trim()) out.push(v);
  if (out.length === 0 && r.verdict) out.push(r.verdict);
  return out;
}

/** Adapt an AIReview to the AIPreview field shape the shared validators scan. */
function asPreviewShape(r: AIReview): AIPreview {
  return {
    context:         r.summary ?? '',
    tacticalBattle:  '',
    playerSpotlight: '',
    verdict:         verdictTexts(r).join('  '),
    keyInsights:     Array.isArray(r.keyMoments) ? r.keyMoments : [],
    mediaWatch:      [],
  };
}

/**
 * Phase/stakes binding for reviews.
 * - FINALS CONTEXT present → the match was a finals fixture: dead-rubber /
 *   no-bearing / regular-season framing is factually wrong.
 * - SEASON PHASE: early season → season-defining consequence language is
 *   disproportionate by definition (the calibration line says so explicitly).
 */
export function validateReviewPhase(review: AIReview, dataBlock: string): string[] {
  const text = REVIEW_TEXT(review);
  const violations: string[] = [];

  if (/FINALS CONTEXT/.test(dataBlock)) {
    const badRe = /\b(regular[- ]season (?:fixture|game|match|clash|round)|dead rubber|no bearing on (?:qualification|finals|the finals|seeding)|nothing (?:to play for|at stake)|finals[- ](?:qualification|race)|finals (?:berth|spot|place)|top[- ]?(?:\d+|four|five|six|eight|ten)[- ](?:berth|spot|place|race)|(?:grip|hold) on (?:a|the|their) top[- ]?\d+)\b/gi;
    for (const m of text.matchAll(badRe)) {
      violations.push(`phase contradiction "${m[0]}" — FINALS CONTEXT says this was a finals fixture`);
    }
    // A side that LOST a qualifying final is here BECAUSE of the second chance;
    // "had no second chance" inverts the bracket (live, 2026-09-25).
    if (/second life|double chance/i.test(dataBlock)) {
      for (const m of text.matchAll(/\b(?:no|without (?:a|the|any)) (?:second chance|safety net|second life|double chance)\b/gi)) {
        violations.push(`bracket contradiction "${m[0]}" — the bracket facts describe the second chance that brought the qualifying-final loser here; read them again`);
      }
    }
  }

  if (/SEASON PHASE: early season/.test(dataBlock)) {
    const overRe = /\b(must[- ]win|do[- ]or[- ]die|season(?:-defining| on the brink| over| in (?:crisis|tatters))|premiership credentials confirmed|title hopes (?:over|ended|dead)|relegation (?:looms|beckons|confirmed))\b/gi;
    for (const m of text.matchAll(overRe)) {
      violations.push(`early-season overstatement "${m[0]}" — SEASON PHASE says one result moves very little`);
    }
  }
  return violations;
}

/**
 * Fabricated in-game statistics. When the block explicitly declares NO IN-GAME
 * MATCH STATS PROVIDED, any quantified in-game metric in the review is invented.
 */
export function validateReviewStatlines(review: AIReview, dataBlock: string): string[] {
  if (!/NO IN-GAME MATCH STATS PROVIDED/.test(dataBlock)) return [];
  const text = REVIEW_TEXT(review);
  const statRe = /\b\d+\s*(?:tackles|clearances|inside[- ]50s?|turnovers|metres gained|possessions|disposals|completions|line[- ]breaks|offloads|marks|hit[- ]?outs)\b|\b\d+\s*%\s*(?:completion|possession|efficiency|accuracy)|\b(?:completion|possession|efficiency|accuracy)\s+(?:rate\s+)?(?:of\s+)?\d+\s*%/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(statRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`invented in-game statistic "${m[0]}" — the data block declares no match stats were provided`);
  }
  return violations;
}

/**
 * Narrative-opener guard for finals reviews: the summary must open with WHY
 * the result happened, not a fixture definition ("In the Elimination Final…",
 * "This was a knockout match…"). Style guidance alone does not move the small
 * local model; paired with feedback retries this lands the angle.
 */
export function validateReviewOpener(review: AIReview, dataBlock: string): string[] {
  if (!/FINALS CONTEXT/.test(dataBlock)) return [];
  const opener = (review.summary ?? '').trimStart();
  const recapRe = /^(?:this (?:is|was)\b|in (?:a|the) (?:wildcard|qualifying|elimination|semi|preliminary|grand)\b|(?:a|the) (?:wildcard round|qualifying final|elimination final|semi[- ]final|preliminary final|grand final)\b)/i;
  if (recapRe.test(opener)) {
    return [`summary opens with a fixture definition ("${opener.slice(0, 60)}…") — open with WHY the result happened; fold the round's consequence into that sentence as a clause`];
  }
  return [];
}

/**
 * Summary/verdict overlap guard (2026-09-16 editorial audit): the review's two
 * prose fields have disjoint jobs — summary = WHY it happened, verdict = the
 * forward implication. Heavy shared phrasing means the verdict is a re-summary.
 */
export function validateReviewOverlap(review: AIReview, dataBlock: string): string[] {
  void dataBlock;
  const grams = (t: string): Set<string> => {
    const w = (t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const g = new Set<string>();
    for (let i = 0; i + 3 < w.length; i++) g.add(w.slice(i, i + 4).join(' '));
    return g;
  };
  const a = grams(review.summary ?? '');
  const out: string[] = [];
  for (const v of verdictTexts(review)) {
    const b = grams(v);
    if (a.size < 8 || b.size < 8) continue;
    let shared = 0;
    for (const g of a) if (b.has(g)) shared++;
    const ratio = shared / Math.min(a.size, b.size);
    if (ratio > 0.22) out.push(`summary and a verdict substantially repeat each other (${Math.round(ratio * 100)}% shared phrasing) — the verdict must add the forward implication, not restate the summary`);
  }
  return out;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};
const toN = (s: string): number => /^\d+$/.test(s) ? Number(s) : (NUM_WORDS[s.toLowerCase()] ?? NaN);

const REVIEW_TEXT = (r: AIReview): string =>
  [r.summary, ...verdictTexts(r), ...(r.keyMoments ?? [])].filter(Boolean).join('  ');

/** Words in a club name that identify it in prose (drops generic suffixes shared across clubs). */
const GENERIC_CLUB_WORDS = new Set(['united', 'city', 'town', 'albion', 'hove', 'rovers', 'athletic', 'wanderers', 'hotspur', 'county', 'the', 'and']);
function clubTokens(...names: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) for (const w of (n ?? '').toLowerCase().split(/[\s&-]+/)) {
    if (w.length >= 4 && !GENERIC_CLUB_WORDS.has(w)) out.add(w);
  }
  return [...out];
}

/**
 * Relative-position claims ("ahead of", "behind", "leapfrogged", "moved above")
 * bound to the points-gap DERIVED FACT. The ladder validator checks ordinals
 * only, so "Brighton now place third, moving ahead of Arsenal" — two points
 * BEHIND them — passed it (live, 2026-09-25).
 */
export function validateRelativePosition(review: AIReview, dataBlock: string): string[] {
  const fixture = dataBlock.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  if (!fixture) return [];
  const teamName = fixture[1].trim(), opponent = fixture[2].trim();
  const namesLine = dataBlock.match(/^NAMES: after first mention call .+? "(.+?)" and .+? "(.+?)"\.$/m);
  const teamToks = clubTokens(teamName, namesLine?.[1]);
  const oppToks  = clubTokens(opponent, namesLine?.[2]);
  if (teamToks.length === 0 || oppToks.length === 0) return [];

  const gap   = dataBlock.match(/^\s*•\s*(.+?) lead (.+?) by \d+ competition points? on the table\./m);
  const level = /are level on competition points/.test(dataBlock);
  if (!gap && !level) return [];
  const leader  = gap ? (gap[1].trim() === teamName ? 'team' : 'opp') : null;
  const trailer = leader === 'team' ? 'opp' : leader === 'opp' ? 'team' : null;

  const text = REVIEW_TEXT(review).toLowerCase();
  const nearest = (from: number, to: number, pickLast: boolean): 'team' | 'opp' | null => {
    let best: { side: 'team' | 'opp'; at: number } | null = null;
    for (const [side, toks] of [['team', teamToks], ['opp', oppToks]] as const) {
      for (const t of toks) {
        for (let at = text.indexOf(t, from); at >= 0 && at < to; at = text.indexOf(t, at + 1)) {
          if (!best || (pickLast ? at > best.at : at < best.at)) best = { side, at };
        }
      }
    }
    return best?.side ?? null;
  };

  const aheadRe  = /\b(?:ahead of|above|overt(?:ake|akes|ook|aken|aking)|leapfrog(?:s|ged|ging)?|mov(?:e|es|ed|ing) (?:above|ahead of|past|clear of)|clear of)\b/g;
  const behindRe = /\b(?:behind|below|adrift of|trail(?:s|ed|ing)?)\b/g;
  const violations: string[] = [];
  for (const [re, kind] of [[aheadRe, 'ahead'], [behindRe, 'behind']] as const) {
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      const subject = nearest(Math.max(0, idx - 90), idx, true);
      const object  = nearest(idx + m[0].length, idx + m[0].length + 60, false);
      if (!subject || !object || subject === object) continue;
      const need = kind === 'ahead' ? leader : trailer;
      if (level) {
        violations.push(`relative position "${m[0]}" — the two sides are level on competition points (DERIVED FACTS); neither is ahead`);
      } else if (subject !== need) {
        const subjName = subject === 'team' ? teamName : opponent;
        const leadName = leader === 'team' ? teamName : opponent;
        violations.push(`relative position: prose has ${subjName} "${m[0]}" the other side, but DERIVED FACTS say ${leadName} lead on the table — state who is ahead from the facts`);
      }
    }
  }
  return violations;
}

/**
 * Run/streak claims bound to SEASON CONTEXT. The shared form-run validator
 * keys on a RECENT FORM section the review block does not emit, so it never
 * ran here; and the five-game FORM window is not a run — "five-match winning
 * run" for a side on nine straight was the window edge read as a streak.
 */
export function validateReviewFormRuns(review: AIReview, dataBlock: string): string[] {
  const text = REVIEW_TEXT(review);
  const runRe = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:straight|consecutive|successive|on the (?:trot|bounce|spin)|in a row)(?:\s+(?:wins?|victories|losses|defeats|games?|matches))?|\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ](?:game|match)\s+(?:winning|losing|unbeaten)\s+(?:streak|run)|\b(?:winning|losing|unbeaten)\s+(?:streak|run)\s+of\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(?:won|lost)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:straight|consecutive|successive|in a row|on the (?:trot|bounce))/gi;

  const hasSeason = /^SEASON CONTEXT/m.test(dataBlock);
  const allowed = new Set<number>();
  if (hasSeason) {
    const section = dataBlock.slice(dataBlock.indexOf('SEASON CONTEXT'));
    const end = section.indexOf('\n\n');
    for (const m of (end > 0 ? section.slice(0, end) : section).matchAll(/\b(\d+) (?:straight|games unbeaten|consecutive)/g)) allowed.add(Number(m[1]));
  }
  const windowText = dataBlock.match(/^FORM COMING INTO THIS MATCH[^\n]*\n((?:[^\n]+\n)*?)\n/m)?.[1] ?? '';
  let windowSize = 0;
  const windowRuns: number[] = [];
  for (const line of windowText.split('\n')) {
    const letters = [...line.matchAll(/(?:^|,)\s*([WLD]) \d+/g)].map(m => m[1]);
    if (letters.length === 0) continue;
    windowSize = Math.max(windowSize, letters.length);
    let run = 1;
    for (let i = 1; i < letters.length && letters[i] === letters[0]; i++) run++;
    windowRuns.push(run);
  }

  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(runRe)) {
    const n = toN(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
    if (!Number.isFinite(n) || n < 2) continue;
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    if (allowed.has(n)) continue;
    if (hasSeason) {
      violations.push(`run claim "${m[0]}" — SEASON CONTEXT lists ${allowed.size ? `only ${[...allowed].join(', ')}` : 'no run of that kind'}; cite its figures verbatim or make no run claim`);
    } else if (windowSize > 0 && n >= windowSize) {
      violations.push(`run claim "${m[0]}" counts the ${windowSize}-game FORM window as a run — the list is truncated, so its length is not a streak; make no run claim`);
    } else if (windowSize > 0 && !windowRuns.some(r => r >= n)) {
      violations.push(`run claim "${m[0]}" — no such run appears in FORM COMING INTO THIS MATCH`);
    }
  }
  return violations;
}

// ─── Second-tier binders (2026-09-25 audit of the first v10 batch) ───────────
// With the block finally right, the residual errors were the model miscounting
// or inventing WITHIN it: "Brobbey and Semenyo score twice" (Brobbey: three),
// "levelling at 12-all" (never level), "16–4 by halftime" (6–16), "winning
// centre bounce differential" (no such data), "outpointed inside 50 (55-62)"
// (backwards). Each is a claim the block can bind.

const COUNT_WORDS: Record<string, number> = { once: 1, twice: 2, brace: 2, 'hat-trick': 3, 'hat trick': 3, treble: 3, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const countOf = (s: string): number => COUNT_WORDS[s.toLowerCase()] ?? (/^\d+$/.test(s) ? Number(s) : NaN);

/** Named players from the PLAYERS NAMED line (full names + surnames), lower-case. */
function namedPlayers(dataBlock: string): string[] {
  const m = dataBlock.match(/^PLAYERS NAMED IN THIS MATCH[^:\n]*:\s*(.+)$/m);
  return m ? m[1].split(',').map(s => s.trim()).filter(s => s.length > 1) : [];
}

/** Per-player scoring tallies as the block states them (soccer goals, NRL tries, AFL goals). */
function scorerTallies(dataBlock: string): Map<string, number> {
  const tally = new Map<string, number>();
  const add = (name: string, n = 1) => { const k = name.trim().toLowerCase(); if (k) tally.set(k, (tally.get(k) ?? 0) + n); };
  for (const m of dataBlock.matchAll(/^\s*\S+ GOAL [^—\n]+ — ([^,(\[\n]+?)(?: \(own goal\))?(?:,|\s\(|\s\[)/gm)) add(m[1]);
  for (const m of dataBlock.matchAll(/^\s*\d+' Try(?: [^—\n]+)? — ([^—\n]+?) — /gm)) add(m[1]);
  for (const m of dataBlock.matchAll(/^\s+([^(\n—]+?)(?: \([^)]*\))? — Goals: (\d+)\.\d+/gm)) add(m[1], Number(m[2]));
  return tally;
}

/**
 * A player's stated tally must equal the block's count of their scores.
 */
export function validateScorerCounts(review: AIReview, dataBlock: string): string[] {
  const tally = scorerTallies(dataBlock);
  if (tally.size === 0) return [];
  const text = REVIEW_TEXT(review);
  const names = namedPlayers(dataBlock);
  const surnameOf = (full: string) => full.split(/\s+/).pop()!.toLowerCase();
  const resolve = (token: string): string | null => {
    const t = token.toLowerCase().replace(/['’]s$/, '');
    const hit = names.find(n => n.toLowerCase() === t || surnameOf(n) === t);
    return hit ? hit.toLowerCase() : null;
  };
  const NAME = String.raw`([A-Z][\w'’\-]+(?:\s+[A-Z][\w'’\-]+){0,2})`;
  const CNT  = String.raw`(twice|a brace|brace|a hat-trick|hat-trick|hat trick|treble|two|three|four|five|six|\d)`;
  const VERB = String.raw`(?:scor(?:e|ed|es|ing)|nett(?:ed|ing)|kick(?:ed|ing|s)|cross(?:ed|ing)|bagg(?:ed|ing)|grabb(?:ed|ing)|add(?:ed|ing)|struck|slott(?:ed|ing)|touch(?:ed|ing) down|finish(?:ed|ing))`;
  const patterns = [
    new RegExp(String.raw`${NAME}(?:['’]s)?\s+(?:who\s+)?${VERB}\s+(?:[a-z-]+\s+){0,3}?${CNT}(?:\s+(?:goals?|tries|majors|times))?\b`, 'g'),
    new RegExp(String.raw`(?:a\s+)?${CNT}\s+(?:goals?|tries|majors)?\s*(?:from|by|for|courtesy of)\s+${NAME}`, 'g'),
    new RegExp(String.raw`${NAME}['’]s?\s+${CNT}\b(?:\s+(?:goals?|tries|majors))?`, 'g'),
    new RegExp(String.raw`(?:both|each of)\s+${NAME}\s+and\s+${NAME}\s+${VERB}\s+${CNT}`, 'g'),
  ];
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      // Pattern 2 puts the count first; pattern 4 binds two names to one count.
      const groups = m.slice(1).filter(Boolean);
      const cntTok = groups.find(g => Number.isFinite(countOf(g.replace(/^a\s+/, ''))));
      if (!cntTok) continue;
      const n = countOf(cntTok.replace(/^a\s+/, ''));
      if (!Number.isFinite(n) || n < 1) continue;
      for (const g of groups) {
        if (g === cntTok) continue;
        const who = resolve(g);
        if (!who) continue;
        const actual = tally.get(who) ?? 0;
        if (actual === n) continue;
        const key = `${who}:${n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push(`scorer count: "${m[0].trim()}" — the events credit ${g} with ${actual} score${actual === 1 ? '' : 's'}, not ${n}; count the MATCH EVENTS lines`);
      }
    }
  }
  return violations;
}

/** Every score pair the block states, either order: events, HT/FT, TEAM STATS. */
function blockPairs(dataBlock: string): Set<string> {
  const pairs = new Set<string>();
  const add = (a: string, b: string) => { pairs.add(`${a}:${b}`); pairs.add(`${b}:${a}`); };
  for (const m of dataBlock.matchAll(/(\d+)\s*[–-]\s*(\d+)/g)) add(m[1], m[2]);
  for (const m of dataBlock.matchAll(/(\d+),\s*[A-Z][^\n,]*?\s(\d+)\b/g)) add(m[1], m[2]); // "Dolphins 4, Roosters 16"
  for (const m of dataBlock.matchAll(/(\d+) \((\d+)\.(\d+)\)\s*[–-]\s*(\d+) \((\d+)\.(\d+)\)/g)) { // AFL "30 (20.10) – 26 (19.7)"
    add(m[1], m[4]); add(m[2], m[5]); add(m[3], m[6]);
  }
  return pairs;
}

/** The review's prose in separately-validated segments (an HT window must not bleed across bullets). */
const REVIEW_SEGMENTS = (r: AIReview): string[] =>
  [r.summary, ...verdictTexts(r), ...(r.keyMoments ?? [])].filter((s): s is string => !!s);

/**
 * Segments with the club a verdict is written for, so "they" inside that
 * verdict resolves to that club; the neutral body carries no default.
 */
function sidedSegments(r: AIReview, ctx: SideContext): Array<{ text: string; side: 'team' | 'opp' | null }> {
  const out: Array<{ text: string; side: 'team' | 'opp' | null }> = [];
  if (r.summary) out.push({ text: r.summary, side: null });
  if (r.verdicts) {
    for (const [club, v] of Object.entries(r.verdicts)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const c = club.toLowerCase();
      const side = ctx.teamToks.some(t => c.includes(t)) || ctx.teamName.toLowerCase() === c ? 'team'
        : ctx.oppToks.some(t => c.includes(t)) || ctx.opponent.toLowerCase() === c ? 'opp' : null;
      out.push({ text: v, side });
    }
  } else if (r.verdict) out.push({ text: r.verdict, side: null });
  for (const k of r.keyMoments ?? []) if (k) out.push({ text: k, side: null });
  return out;
}

/**
 * Quoted score states ("12-all", "16–4", "2-0 at half-time") must exist in
 * the block; a half-time claim must match the HT line exactly.
 */
export function validateScoreStates(review: AIReview, dataBlock: string): string[] {
  const pairs = blockPairs(dataBlock);
  if (pairs.size === 0) return [];
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (raw: string, msg: string) => { if (!seen.has(raw)) { seen.add(raw); violations.push(msg); } };
  const ht = dataBlock.match(/^\s*HT — (.+?) (\d+)–(\d+) (.+)$/m);
  const h = ht ? Number(ht[2]) : NaN, a = ht ? Number(ht[3]) : NaN;
  const htRe = /(?:(?:at|by|before|into|reached)\s+(?:the\s+)?(?:half[- ]?time|the break|the interval)|half[- ]?time (?:lead|score|margin|deficit|advantage))/gi;

  for (const text of REVIEW_SEGMENTS(review)) {
    for (const m of text.matchAll(/\b(\d{1,3})\s*[–-]\s*(\d{1,3})\b(?!['’%])/g)) {
      if (!pairs.has(`${m[1]}:${m[2]}`)) flag(m[0], `score/stat pair "${m[0]}" appears nowhere in the data — quote states and pairs exactly as MATCH EVENTS or TEAM STATS give them`);
    }
    for (const m of text.matchAll(/\b(\d{1,3})[–-]\s?all\b/gi)) {
      if (!pairs.has(`${m[1]}:${m[1]}`)) flag(m[0], `"${m[0]}" — the scores were never level at ${m[1]} in MATCH EVENTS`);
    }
    if (!ht) continue;
    for (const m of text.matchAll(htRe)) {
      const idx = m.index ?? 0;
      const near = text.slice(Math.max(0, idx - 90), idx + m[0].length + 40);
      for (const p of near.matchAll(/\b(\d{1,3})\s*[–-]\s*(\d{1,3})\b(?!['’%])/g)) {
        const x = Number(p[1]), y = Number(p[2]);
        if (!((x === h && y === a) || (x === a && y === h))) flag(`ht:${p[0]}`, `half-time score "${p[0]}" — the HT line says ${ht[1]} ${h}–${a} ${ht[4]}`);
      }
      for (const p of near.matchAll(/\b(?:trail(?:ed|ing)?|led|lead(?:ing)?|behind|ahead|up|down)\s+by\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)) {
        const n = toN(p[1]);
        if (Number.isFinite(n) && n !== Math.abs(h - a)) flag(`htby:${p[0]}`, `half-time margin "${p[0]}" — the HT line says ${h}–${a}, a margin of ${Math.abs(h - a)}`);
      }
    }
  }
  return violations;
}

/** Prose stat nouns → TEAM STATS labels (null = the sport's data never carries it). */
const STAT_NOUNS: Array<{ re: RegExp; labels: string[] | null }> = [
  { re: /centre[- ]bounces?|centre[- ]clearances?|hit[- ]?outs?|ruck(?: battle| contest| duel)?/i, labels: null },
  { re: /clearances?/i,                                              labels: ['Clearances'] },
  { re: /contested[- ](?:possessions?|ball|footy)|the contest|contested work/i, labels: ['Contested possessions'] },
  { re: /inside[- ]50s?|forward[- ]50 entries|entries inside 50|territory/i,    labels: ['Inside 50s', 'Terr %'] },
  { re: /disposals?/i,                                               labels: ['Disposals'] },
  { re: /scoring shots?/i,                                           labels: ['Scoring shots'] },
  { re: /line[- ]?breaks?/i,                                         labels: ['Line breaks'] },
  { re: /tackle[- ]breaks?/i,                                        labels: ['Tackle breaks'] },
  { re: /run metres|metres gained|yardage|metres/i,                  labels: ['Run metres'] },
  { re: /offloads?/i,                                                labels: ['Offloads'] },
  { re: /completion(?: rates?)?|completions/i,                       labels: ['Comp %'] },
  { re: /possession(?: (?:share|count|battle|stakes))?/i,            labels: ['Poss %', 'Possession %'] },
  { re: /shots on target/i,                                          labels: ['Shots on target'] },
  { re: /shots?(?: count)?/i,                                        labels: ['Shots'] },
  { re: /corners?(?: count)?/i,                                      labels: ['Corners'] },
  { re: /tackles?(?: count)?/i,                                      labels: ['Tackles'] },
];

/**
 * "Won / led / dominated the <stat>" claims: the stat must exist in TEAM
 * STATS and the named side must be the one with the higher figure.
 */
export function validateStatClaims(review: AIReview, dataBlock: string): string[] {
  const fixture = dataBlock.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  if (!fixture) return [];
  const teamName = fixture[1].trim(), opponent = fixture[2].trim();
  const namesLine = dataBlock.match(/^NAMES: after first mention call .+$/m)?.[0] ?? '';
  const quoted = [...namesLine.matchAll(/"([^"]+)"/g)].map(q => q[1]);
  const teamToks = clubTokens(teamName, quoted.find(q => teamName.includes(q) || q.includes(teamName.split(' ')[0])));
  const oppToks  = clubTokens(opponent, quoted.find(q => opponent.includes(q) || q.includes(opponent.split(' ')[0])));

  const statsHead = dataBlock.match(/^TEAM STATS \((.+?) – (.+?)\):\n((?:[^\n]+\n)*?)\n/m);
  const stats = new Map<string, [number, number]>();
  if (statsHead) {
    for (const line of statsHead[3].split('\n')) {
      const m = line.match(/^\s+(.+?):\s*([\d.]+)(?:\s*\([^)]*\))?\s*–\s*([\d.]+)/);
      if (m) stats.set(m[1], [Number(m[2]), Number(m[3])]);
    }
  }

  const text = REVIEW_TEXT(review);
  const lower = text.toLowerCase();
  // Up to three words after the verb ("controlled centre bounces and" → the
  // noun test runs on the phrase), and up to three before "advantage".
  const claimRe = /\b(?:won|winning|led|leading|dominat(?:ed|ing)|controll(?:ed|ing)|edg(?:ed|ing)|owned|owning|shaded|monopoli[sz]ed)\s+(?:the\s+|their\s+|its\s+)?([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})|\b([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})\s+(?:advantage|dominance|differential|supremacy)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  const sideAt = (from: number, to: number): 'team' | 'opp' | null => {
    let best: { side: 'team' | 'opp'; at: number } | null = null;
    for (const [side, toks] of [['team', teamToks], ['opp', oppToks]] as const) {
      for (const t of toks) for (let at = lower.indexOf(t, from); at >= 0 && at < to; at = lower.indexOf(t, at + 1)) {
        if (!best || at > best.at) best = { side, at };
      }
    }
    return best?.side ?? null;
  };
  for (const m of text.matchAll(claimRe)) {
    const phrase = (m[1] ?? m[2] ?? '').trim();
    if (!phrase) continue;
    const noun = STAT_NOUNS.find(s => s.re.test(phrase));
    if (!noun) continue;
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (noun.labels === null) {
      violations.push(`stat claim "${m[0]}" — the data carries no such figure; claim only categories listed in TEAM STATS`);
      continue;
    }
    const label = noun.labels.find(l => stats.has(l));
    if (!label) {
      violations.push(`stat claim "${m[0]}" — ${noun.labels[0]} is not in TEAM STATS for this match; claim only categories listed there`);
      continue;
    }
    const [t, o] = stats.get(label)!;
    const idx = m.index ?? 0;
    const subject = sideAt(Math.max(0, idx - 100), idx);
    if (!subject) continue;
    const mine = subject === 'team' ? t : o, theirs = subject === 'team' ? o : t;
    if (mine <= theirs) {
      const who = subject === 'team' ? teamName : opponent;
      violations.push(`stat claim "${m[0]}" — TEAM STATS have ${who} ${mine} to ${theirs} on ${label}; they did not win that category`);
    }
  }
  return violations;
}

// ─── Third-tier binders (audit of the regenerated batch) ─────────────────────

interface SideContext { teamName: string; opponent: string; teamToks: string[]; oppToks: string[] }
function sideContext(dataBlock: string): SideContext | null {
  const fixture = dataBlock.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  if (!fixture) return null;
  const teamName = fixture[1].trim(), opponent = fixture[2].trim();
  const quoted = [...(dataBlock.match(/^NAMES: after first mention call .+$/m)?.[0] ?? '').matchAll(/"([^"]+)"/g)].map(q => q[1]);
  return {
    teamName, opponent,
    teamToks: clubTokens(teamName, quoted.find(q => teamName.includes(q) || q.includes(teamName.split(' ')[0]))),
    oppToks:  clubTokens(opponent, quoted.find(q => opponent.includes(q) || q.includes(opponent.split(' ')[0]))),
  };
}

/**
 * Whose figure a phrase is about: the nearest club named before it ("the
 * team"/"they" = `fallback`, the club a verdict is written for; null in the
 * neutral body), flipped when "conced…" is the verb governing the phrase
 * (a side concedes the OTHER side's tally).
 */
function subjectFor(lowerText: string, idx: number, ctx: SideContext, fallback: 'team' | 'opp' | null = null): 'team' | 'opp' | null {
  const from = Math.max(0, idx - 110);
  const window = lowerText.slice(from, idx);
  let best: { side: 'team' | 'opp'; at: number } | null = null;
  for (const [side, toks] of [['team', ctx.teamToks], ['opp', ctx.oppToks]] as const) {
    for (const t of toks) for (let at = window.indexOf(t); at >= 0; at = window.indexOf(t, at + 1)) {
      if (!best || at > best.at) best = { side, at };
    }
  }
  if (fallback) {
    for (const m of window.matchAll(/\bthe (?:team|side)\b|\bthey\b|\btheir\b/g)) {
      if (!best || (m.index ?? 0) > best.at) best = { side: fallback, at: m.index ?? 0 };
    }
  }
  if (!best) return null;
  // Flip only when "conceding" is the verb governing THIS phrase — "conceding
  // 45 tackle breaks and missing 33 tackles" flips the first figure, not the second.
  const between = window.slice(best.at);
  let lastVerb: string | null = null;
  for (const v of between.matchAll(/\b(conced\w*|miss(?:ed|ing)|made|making|won|winning|led|leading|scor\w+|record\w*|manag\w+|had|with)\b/g)) lastVerb = v[1];
  return lastVerb && /^conced/.test(lastVerb) ? (best.side === 'team' ? 'opp' : 'team') : best.side;
}

/** Scores per side per half from MATCH EVENTS (soccer GOAL lines, rugby Try lines). */
function halfCounts(dataBlock: string, ctx: SideContext): { first: [number, number]; second: [number, number] } | null {
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return null;
  const section = dataBlock.slice(start, dataBlock.indexOf('\n\n', start) === -1 ? undefined : dataBlock.indexOf('\n\n', start));
  const first: [number, number] = [0, 0], second: [number, number] = [0, 0];
  let half: 'first' | 'second' = 'first';
  let sawHT = false;
  for (const line of section.split('\n')) {
    if (/^\s*HT — /.test(line)) { half = 'second'; sawHT = true; continue; }
    const m = line.match(/^\s*\S+ (?:GOAL|Try) ([^—\n]+?) — /);
    if (!m) continue;
    const side = m[1].trim().toLowerCase();
    const isTeam = ctx.teamToks.some(t => side.includes(t)) || ctx.teamName.toLowerCase().includes(side);
    const isOpp  = ctx.oppToks.some(t => side.includes(t))  || ctx.opponent.toLowerCase().includes(side);
    if (!isTeam && !isOpp) continue;
    (half === 'first' ? first : second)[isTeam ? 0 : 1]++;
  }
  return sawHT ? { first, second } : null;
}

/**
 * "N goals/tries before half-time", "N first-half tries", "three tries to two
 * after the break" — bound to the events on either side of the HT line.
 */
export function validateHalfCounts(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  const counts = halfCounts(dataBlock, ctx);
  if (!counts) return [];
  const N = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight)`;
  const UNIT = String.raw`(?:goals?|tries|majors)`;
  const HALF = String.raw`(first half|second half|half[- ]?time|halftime|the break|the interval)`;
  const halfOf = (s: string): 'first' | 'second' | null => {
    const l = s.toLowerCase();
    if (/second half/.test(l)) return 'second';
    if (/first half/.test(l)) return 'first';
    return null;
  };
  const halfFromPrep = (prep: string, word: string): 'first' | 'second' | null =>
    halfOf(word) ?? (/^(?:after|since|from)$/i.test(prep) ? 'second' : /^(?:before|by|inside|in|during|to|into)$/i.test(prep) ? 'first' : null);
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (k: string, msg: string) => { if (!seen.has(k)) { seen.add(k); violations.push(msg); } };

  for (const { text, side } of sidedSegments(review, ctx)) {
    const lower = text.toLowerCase();
    // "three goals before halftime" / "four first-half tries" / "three tries in the second half"
    const reA = new RegExp(String.raw`\b${N}\s+(?:unanswered\s+|more\s+|further\s+)?${UNIT}\s+(in|during|after|before|by|inside|since|from|into)\s+(?:the\s+)?${HALF}`, 'gi');
    const reB = new RegExp(String.raw`\b${N}\s+(?:unanswered\s+)?(first|second)[- ]half\s+${UNIT}`, 'gi');
    // "both of the team's second-half tries" → the side had exactly two.
    const reD = new RegExp(String.raw`\b(both)\s+(?:of\s+)?(?:the\s+|their\s+|[A-Z][\w'’]*\s+)?(?:team['’]s\s+|side['’]s\s+)?(first|second)[- ]half\s+${UNIT}`, 'gi');
    for (const re of [reA, reB, reD]) {
      for (const m of text.matchAll(re)) {
        const n = re === reD ? 2 : toN(m[1]);
        const half = re !== reA ? (m[2].toLowerCase() as 'first' | 'second') : halfFromPrep(m[2], m[3]);
        if (!Number.isFinite(n) || !half) continue;
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        const [t, o] = counts[half];
        const ok = subject === 'team' ? n === t : subject === 'opp' ? n === o : (n === t || n === o);
        if (!ok) flag(m[0], `half count "${m[0]}" — MATCH EVENTS give ${ctx.teamName} ${t}, ${ctx.opponent} ${o} in the ${half} half`);
      }
    }
    // "three tries to two" with a half indicator nearby
    const reC = new RegExp(String.raw`\b${N}\s+${UNIT}\s+to\s+${N}\b`, 'gi');
    for (const m of text.matchAll(reC)) {
      const idx = m.index ?? 0;
      const near = lower.slice(Math.max(0, idx - 70), idx + m[0].length + 50);
      const half = /second half|after (?:half[- ]?time|halftime|the break|the interval)/.test(near) ? 'second'
        : /first half|before (?:half[- ]?time|halftime|the break)|by (?:half[- ]?time|halftime|the break)/.test(near) ? 'first' : null;
      if (!half) continue;
      const a = toN(m[1]), b = toN(m[2]);
      const [t, o] = counts[half];
      if (!((a === t && b === o) || (a === o && b === t))) flag(m[0], `half count "${m[0]}" — the ${half} half was ${ctx.teamName} ${t}, ${ctx.opponent} ${o} in MATCH EVENTS`);
    }
  }
  return violations;
}

/** Stat nouns as they appear with a number in prose → block labels. */
const VALUE_NOUNS: Array<{ re: RegExp; labels: string[] }> = [
  { re: /^tackle[- ]breaks?$/i,                     labels: ['Tackle breaks'] },
  { re: /^missed tackles?$/i,                       labels: ['Missed tackles'] },
  { re: /^line[- ]?breaks?$/i,                      labels: ['Line breaks'] },
  { re: /^(?:run )?metres$/i,                       labels: ['Run metres'] },
  { re: /^errors?$/i,                               labels: ['Errors'] },
  { re: /^penalties$/i,                             labels: ['Pens'] },
  { re: /^offloads?$/i,                             labels: ['Offloads'] },
  { re: /^disposals?$/i,                            labels: ['Disposals'] },
  { re: /^inside[- ]50s?$/i,                        labels: ['Inside 50s'] },
  { re: /^clearances?$/i,                           labels: ['Clearances'] },
  { re: /^contested possessions?$/i,                labels: ['Contested possessions'] },
  { re: /^tackles?$/i,                              labels: ['Tackles'] },
  { re: /^scoring shots?$/i,                        labels: ['Scoring shots'] },
  { re: /^shots on target$/i,                       labels: ['Shots on target'] },
  { re: /^shots?$/i,                                labels: ['Shots'] },
  { re: /^corners?$/i,                              labels: ['Corners'] },
  { re: /^(?:of (?:the )?)?possession$/i,           labels: ['Poss %', 'Possession %'] },
  { re: /^completion(?: rate)?$/i,                  labels: ['Comp %'] },
];

/**
 * "45 tackle breaks", "missing 33 tackles", "55% possession" — the figure must
 * be the named side's value for that TEAM STATS label.
 */
export function validateStatValues(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  const head = dataBlock.match(/^TEAM STATS \((.+?) – (.+?)\):\n((?:[^\n]+\n)*?)\n/m);
  if (!head) return [];
  const stats = new Map<string, [number, number]>();
  for (const line of head[3].split('\n')) {
    const m = line.match(/^\s+(.+?):\s*([\d.]+)(?:\s*\([^)]*\))?\s*–\s*([\d.]+)/);
    if (m) stats.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  // Player-level figures ("Caleb Serong 28 disposals") are not team totals:
  // skip a figure that matches a KEY PERFORMERS / SCORERS value for that stat,
  // or that follows a named player closely.
  const playerVals = new Map<string, Set<number>>();
  for (const line of dataBlock.matchAll(/^\s+[^\n—]+ — ((?:[A-Za-z0-9 %]+: [\d.]+(?:, )?)+)$/gm)) {
    for (const kv of line[1].matchAll(/([A-Za-z0-9 %]+): ([\d.]+)/g)) {
      const k = kv[1].trim();
      (playerVals.get(k) ?? playerVals.set(k, new Set()).get(k)!).add(Math.floor(Number(kv[2])));
    }
  }
  const surnames = namedPlayers(dataBlock).map(n => n.split(/\s+/).pop()!.toLowerCase());
  const violations: string[] = [];
  const seen = new Set<string>();
  const NOUN = String.raw`([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?)`;
  for (const { text, side } of sidedSegments(review, ctx)) {
    const lower = text.toLowerCase();
    const hits: Array<{ idx: number; raw: string; n: number; noun: string }> = [];
    for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,4})\s*%?\s+${NOUN}\b`, 'gi'))) hits.push({ idx: m.index ?? 0, raw: m[0], n: Number(m[1]), noun: m[2] });
    for (const m of text.matchAll(/\b(?:missed|missing)\s+(\d{1,3})\s+tackles\b/gi)) hits.push({ idx: m.index ?? 0, raw: m[0], n: Number(m[1]), noun: 'missed tackles' });
    for (const h of hits) {
      const spec = VALUE_NOUNS.find(v => v.re.test(h.noun.trim()));
      if (!spec) continue;
      const label = spec.labels.find(l => stats.has(l));
      if (!label) continue;
      if (playerVals.get(label)?.has(h.n)) continue;
      const before = lower.slice(Math.max(0, h.idx - 45), h.idx);
      if (surnames.some(s => s.length >= 3 && before.includes(s))) continue;
      const [t, o] = stats.get(label)!;
      const subject = subjectFor(lower, h.idx, ctx, side);
      const ok = subject === 'team' ? h.n === t : subject === 'opp' ? h.n === o : (h.n === t || h.n === o);
      if (ok || seen.has(h.raw)) continue;
      seen.add(h.raw);
      const who = subject === 'team' ? ctx.teamName : ctx.opponent;
      violations.push(`stat value "${h.raw}" — TEAM STATS have ${who} at ${subject === 'team' ? t : o} on ${label} (the other side ${subject === 'team' ? o : t}); attach each figure to the side it belongs to`);
    }
  }
  return violations;
}

/**
 * Season-record claims ("season high", "first time this season", "first defeat
 * of the season") exist only where SEASON CONTEXT states them.
 */
export function validateSeasonClaims(review: AIReview, dataBlock: string): string[] {
  const start = dataBlock.indexOf('SEASON CONTEXT');
  const section = start >= 0 ? dataBlock.slice(start, dataBlock.indexOf('\n\n', start) === -1 ? undefined : dataBlock.indexOf('\n\n', start)).toLowerCase() : '';
  const kinds: Array<{ re: RegExp; needs: RegExp; label: string }> = [
    { re: /\b(?:season[- ]high|season maximum|highest (?:\w+ ){0,3}(?:of|this) (?:the )?season|most (?:goals|points|tries) (?:\w+ ){0,5}this season)\b/gi, needs: /most (?:goals|points) .* (?:scored|conceded)/, label: 'a season-high line' },
    { re: /\bfirst time this season\b|\bfor the first time\b(?=[^.]{0,40}(?:season|campaign))/gi, needs: /first time this season/, label: '"first time this season"' },
    { re: /\bfirst (?:defeat|loss) of (?:the|their) (?:season|campaign)\b|\bfirst defeat of any kind\b/gi, needs: /first .*defeat/, label: 'a first-defeat line' },
    { re: /\bfirst (?:win|victory) of (?:the|their) (?:season|campaign)\b/gi, needs: /first .*win/, label: 'a first-win line' },
  ];
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const text of REVIEW_SEGMENTS(review)) {
    for (const k of kinds) {
      for (const m of text.matchAll(k.re)) {
        const hit = m[0].toLowerCase();
        if (seen.has(hit)) continue;
        // Direction for season highs: scored vs conceded must match a line of that kind.
        let needs = k.needs;
        if (k.label === 'a season-high line') {
          const near = text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + hit.length + 40).toLowerCase();
          if (/conced/.test(near)) needs = /conceded/; else if (/scor/.test(near)) needs = /have scored/;
        }
        if (!needs.test(section)) {
          seen.add(hit);
          violations.push(`season claim "${m[0]}" — SEASON CONTEXT has no ${k.label} supporting it; state only the season facts given`);
        }
      }
    }
  }
  return violations;
}

/**
 * Map the model's verdict keys (which may be short names or approximate) onto
 * the exact FIXTURE club names. Null when a side has no verdict.
 */
export function normalizeVerdicts(review: AIReview, dataBlock: string): Record<string, string> | null {
  const ctx = sideContext(dataBlock);
  if (!ctx) return null;
  const raw = review.verdicts ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const key = k.toLowerCase();
    if (key === ctx.teamName.toLowerCase() || ctx.teamToks.some(t => key.includes(t))) out[ctx.teamName] = v.trim();
    else if (key === ctx.opponent.toLowerCase() || ctx.oppToks.some(t => key.includes(t))) out[ctx.opponent] = v.trim();
  }
  return out[ctx.teamName] && out[ctx.opponent] ? out : null;
}

/**
 * One verdict per club, each about its club (names it, or "the team/they" —
 * unambiguous inside a verdict), neither about the other club alone.
 */
export function validateVerdicts(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  if (!review.verdicts) return review.verdict ? [] : [`verdicts missing — return "verdicts" with one entry for ${ctx.teamName} and one for ${ctx.opponent}`];
  const norm = normalizeVerdicts(review, dataBlock);
  if (!norm) return [`verdicts must cover both clubs, keyed exactly "${ctx.teamName}" and "${ctx.opponent}" (got: ${Object.keys(review.verdicts).map(k => `"${k}"`).join(', ') || 'none'})`];
  const violations: string[] = [];
  for (const [club, toks, otherToks] of [[ctx.teamName, ctx.teamToks, ctx.oppToks], [ctx.opponent, ctx.oppToks, ctx.teamToks]] as const) {
    const l = norm[club].toLowerCase();
    const mine  = toks.some(t => l.includes(t) && !otherToks.includes(t)) || /\bthe (?:team|side)\b|\bthey\b|\btheir\b/.test(l);
    if (!mine) violations.push(`verdict for ${club} never refers to ${club} — it must state the implication for them`);
  }
  return violations;
}

/** Full review validation pass. Empty array = clean, safe to cache and serve. */
export function validateReviewOutput(review: AIReview, dataBlock: string): string[] {
  const shaped = asPreviewShape(review);
  return [
    ...validateFinalsSeeding(shaped, dataBlock),
    ...validateLadderPosition(shaped, dataBlock),
    ...validatePointsClaims(shaped, dataBlock),
    ...validatePlayerNames(shaped, dataBlock),
    ...validatePlayerSideClaims(shaped, dataBlock),
    ...validateFinalsRedundancy(shaped, dataBlock),
    ...validateAbsenceNarration(shaped, dataBlock),
    ...validateSportRegister(shaped, dataBlock),
    ...validateRegisterCrutches(shaped, dataBlock),
    ...validateCricketRegister(shaped, dataBlock),
    ...validateSeasonPlacement(shaped, dataBlock),
    ...validateDayCounts(shaped, dataBlock),
    ...validateNumeralBinding(shaped, dataBlock),
    ...validateVenueFormClaims(shaped, dataBlock),
    ...validateDoubleChance(shaped, dataBlock),
    ...validateSeriesClaims(shaped, dataBlock),
    ...validateProvisionalLadder(shaped, dataBlock),
    ...validateFormRuns(shaped, dataBlock),
    ...validateResultDirection(shaped, dataBlock),
    ...validateHeadToHeadClaims(shaped, dataBlock),
    ...validateVenueDimensions(shaped, dataBlock),
    ...validateDeciderClaims(shaped, dataBlock),
    ...validateReviewOverlap(review, dataBlock),
    ...validateRelativePosition(review, dataBlock),
    ...validateReviewFormRuns(review, dataBlock),
    ...validateScorerCounts(review, dataBlock),
    ...validateScoreStates(review, dataBlock),
    ...validateStatClaims(review, dataBlock),
    ...validateStatValues(review, dataBlock),
    ...validateHalfCounts(review, dataBlock),
    ...validateSeasonClaims(review, dataBlock),
    ...validateVerdicts(review, dataBlock),
    ...validateReviewPhase(review, dataBlock),
    ...validateReviewStatlines(review, dataBlock),
    ...validateReviewOpener(review, dataBlock),
  ];
}
