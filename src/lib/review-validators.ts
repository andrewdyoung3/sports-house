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

/** Adapt an AIReview to the AIPreview field shape the shared validators scan. */
function asPreviewShape(r: AIReview): AIPreview {
  return {
    context:         r.summary ?? '',
    tacticalBattle:  '',
    playerSpotlight: '',
    verdict:         r.verdict ?? '',
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
  const text = [review.summary, review.verdict, ...(review.keyMoments ?? [])].filter(Boolean).join('  ');
  const violations: string[] = [];

  if (/FINALS CONTEXT/.test(dataBlock)) {
    const badRe = /\b(regular[- ]season (?:fixture|game|match|clash|round)|dead rubber|no bearing on (?:qualification|finals|the finals|seeding)|nothing (?:to play for|at stake)|finals[- ](?:qualification|race)|finals (?:berth|spot|place)|top[- ]?(?:\d+|four|five|six|eight|ten)[- ](?:berth|spot|place|race)|(?:grip|hold) on (?:a|the|their) top[- ]?\d+)\b/gi;
    for (const m of text.matchAll(badRe)) {
      violations.push(`phase contradiction "${m[0]}" — FINALS CONTEXT says this was a finals fixture`);
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
  const text = [review.summary, review.verdict, ...(review.keyMoments ?? [])].filter(Boolean).join('  ');
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
  const a = grams(review.summary ?? ''), b = grams(review.verdict ?? '');
  if (a.size < 8 || b.size < 8) return [];
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  const ratio = shared / Math.min(a.size, b.size);
  if (ratio > 0.22) {
    return [`summary and verdict substantially repeat each other (${Math.round(ratio * 100)}% shared phrasing) — the verdict must add the forward implication, not restate the summary`];
  }
  return [];
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};
const toN = (s: string): number => /^\d+$/.test(s) ? Number(s) : (NUM_WORDS[s.toLowerCase()] ?? NaN);

const REVIEW_TEXT = (r: AIReview): string =>
  [r.summary, r.verdict, ...(r.keyMoments ?? [])].filter(Boolean).join('  ');

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
    ...validateReviewPhase(review, dataBlock),
    ...validateReviewStatlines(review, dataBlock),
    ...validateReviewOpener(review, dataBlock),
  ];
}
