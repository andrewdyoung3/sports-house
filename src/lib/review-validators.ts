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
    const badRe = /\b(regular[- ]season (?:fixture|game|match|clash|round)|dead rubber|no bearing on (?:qualification|finals|the finals|seeding)|nothing (?:to play for|at stake)|finals[- ]qualification race)\b/gi;
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

/** Full review validation pass. Empty array = clean, safe to cache and serve. */
export function validateReviewOutput(review: AIReview, dataBlock: string): string[] {
  const shaped = asPreviewShape(review);
  return [
    ...validateFinalsSeeding(shaped, dataBlock),
    ...validateLadderPosition(shaped, dataBlock),
    ...validatePointsClaims(shaped, dataBlock),
    ...validatePlayerNames(shaped, dataBlock),
    ...validateReviewPhase(review, dataBlock),
    ...validateReviewStatlines(review, dataBlock),
  ];
}
