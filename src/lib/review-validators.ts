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
    ...validateReviewOverlap(review, dataBlock),
    ...validateReviewPhase(review, dataBlock),
    ...validateReviewStatlines(review, dataBlock),
    ...validateReviewOpener(review, dataBlock),
  ];
}
