/**
 * House copy-edit for AI match reports, applied at render time so every
 * stored review benefits without regeneration. Rules follow the Guardian
 * style guide (the register the review prompt already models):
 *
 * - Plural club names take a bare apostrophe: "Roosters'", not "Roosters's".
 *   Singular names ending in s keep 's ("Watts's"), so only plural CLUB names
 *   (from TEAMS short/full names) are touched.
 * - Dashes: a spaced en dash for parenthesis — never an em dash or a hyphen
 *   with spaces. Score ranges keep their unspaced en dash ("36–20").
 * - "half-time", "full-time", "three-quarter time", "quarter-time".
 * - Single spaces; no space before punctuation; no doubled punctuation.
 */

import { TEAMS } from '@/lib/teams';

const PLURAL_CLUBS: string[] = [...new Set(
  TEAMS.flatMap(t => [t.shortName, t.name.split(' ').pop() ?? ''])
    .filter(n => n.length > 3 && /s$/.test(n) && !/ss$/.test(n)),
)].sort((a, b) => b.length - a.length);

const pluralPossessive = new RegExp(`\\b(${PLURAL_CLUBS.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})['’]s\\b`, 'g');

export function copyedit(text: string): string {
  if (!text) return text;
  let s = text;
  s = s.replace(pluralPossessive, (_m, club: string) => `${club}’`);
  // Dashes: em dash or spaced hyphen → spaced en dash. Unspaced en dash in
  // "36–20" / "Q1–Q4" is left alone.
  s = s.replace(/\s*—\s*/g, ' – ').replace(/\s+-\s+/g, ' – ').replace(/\s+–\s+/g, ' – ');
  // Guardian spellings.
  s = s.replace(/\bhalf[ ]?time\b/gi, m => (m[0] === 'H' ? 'Half-time' : 'half-time'))
       .replace(/\bfull[ ]?time\b/gi, m => (m[0] === 'F' ? 'Full-time' : 'full-time'))
       .replace(/\bthree[- ]quarter[- ]time\b/gi, m => (m[0] === 'T' ? 'Three-quarter time' : 'three-quarter time'))
       .replace(/\bquarter time\b/gi, m => (m[0] === 'Q' ? 'Quarter-time' : 'quarter-time'));
  // Whitespace and punctuation hygiene.
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])\1+/g, '$1')
       .replace(/\.{2}(?!\.)/g, '.').replace(/\s+$/g, '').replace(/^\s+/g, '');
  return s;
}

/** Split a summary into paragraphs, copy-edited. */
export function reportParagraphs(summary: string): string[] {
  return summary.split(/\n\s*\n/).map(p => copyedit(p.replace(/\s*\n\s*/g, ' '))).filter(Boolean);
}
