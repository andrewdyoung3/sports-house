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
    // The next opponent is never in the data: "against Sydney in the Grand
    // Final" was invented (it is Fremantle) — 2026-09-26.
    const ctx = sideContext(dataBlock);
    if (ctx) {
      for (const m of text.matchAll(/\b(?:grand final|decider|preliminary final|semi-final)\b[^.;]{0,40}?\b(?:against|versus|vs\.?|v\.?|with|meet(?:s|ing)?|face|facing)\s+(?:the\s+)?([A-Z][\w'’]+(?:\s+[A-Z][\w'’]+)?)/g)) {
        const who = m[1].toLowerCase();
        const isSide = ctx.teamToks.some(t => who.includes(t)) || ctx.oppToks.some(t => who.includes(t))
          || ctx.teamName.toLowerCase().includes(who) || ctx.opponent.toLowerCase().includes(who);
        if (!isSide && /\b(?:Panthers|Knights|Storm|Sydney|Fremantle|Dockers|Swans|Collingwood|Geelong|Cats|Magpies|Broncos|Eels|Sharks|Roosters|Dolphins|Rabbitohs|Bulldogs|Warriors|Raiders|Cowboys|Titans|Dragons|Tigers|Sea Eagles|Hawks|Lions|Blues|Crows|Power|Saints|Bombers|Demons|Giants|Suns|Eagles|Kangaroos)\b/.test(m[1])) {
          violations.push(`next opponent "${m[0]}" — the data does not say who the next opponent is; do not name one`);
        }
      }
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
      // Table position only: "Arsenal trailed 2–0 at half-time" is the match,
      // not the ladder (false refusal, 2026-09-26).
      const clause = text.slice(Math.max(0, idx - 80), idx + m[0].length + 80).toLowerCase();
      if (!/\b(?:table|ladder|standings|competition points?|points? (?:clear|behind|adrift)|in the league|place|position|seed)/.test(clause)) continue;
      if (/\b(?:half[- ]?time|the break|at the interval|minutes?|\d{1,3}\s*[–-]\s*\d{1,3})\b/.test(clause) && !/\b(?:table|ladder|standings)\b/.test(clause)) continue;
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

/**
 * Per-player scoring tallies as the block states them: counted from the
 * events (soccer GOAL / rugby Try lines), and from the KEY PERFORMERS stat
 * lines ("Tries: 2", "Goals: 1", AFL "Goals: 5.1") — the higher of the two,
 * since a feed can leave a try unnamed in the timeline but count it in the
 * player's line.
 */
function scorerTallies(dataBlock: string): Map<string, number> {
  const fromEvents = new Map<string, number>();
  const fromStats  = new Map<string, number>();
  const key = (name: string) => name.trim().toLowerCase();
  const bump = (m: Map<string, number>, name: string, n = 1) => { const k = key(name); if (k) m.set(k, (m.get(k) ?? 0) + n); };
  for (const m of dataBlock.matchAll(/^\s*\S+ GOAL [^—\n]+ — ([^,(\[\n]+?)(?: \(own goal\))?(?:,|\s\(|\s\[)/gm)) bump(fromEvents, m[1]);
  for (const m of dataBlock.matchAll(/^\s*\d+' Try(?: [^—\n]+)? — ([^—\n]+?) — /gm)) bump(fromEvents, m[1]);
  for (const m of dataBlock.matchAll(/^\s+([^(\n—]+?)(?: \([^)]*\))? — ([^\n]+)$/gm)) {
    const name = m[1], stats = m[2];
    const tries = stats.match(/\bTries: (\d+)/)?.[1];
    const goals = stats.match(/\bGoals: (\d+)(?:\.\d+)?(?!\/)/)?.[1]; // AFL "5.1" → 5; kicker "2/4" excluded
    const n = tries ? Number(tries) : goals ? Number(goals) : 0;
    if (n > 0) bump(fromStats, name, n);
  }
  const tally = new Map<string, number>();
  for (const k of new Set([...fromEvents.keys(), ...fromStats.keys()])) tally.set(k, Math.max(fromEvents.get(k) ?? 0, fromStats.get(k) ?? 0));
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
  const CNT  = String.raw`(once|twice|a brace|brace|a hat-trick|hat-trick|hat trick|treble|two|three|four|five|six|\d)`;
  const VERB = String.raw`(?:scor(?:e|ed|es|ing)|nett(?:ed|ing)|kick(?:ed|ing|s)|cross(?:ed|ing)|bagg(?:ed|ing)|grabb(?:ed|ing)|add(?:ed|ing)|struck|slott(?:ed|ing)|touch(?:ed|ing) down|finish(?:ed|ing))`;
  const patterns = [
    // The count follows the verb directly or after one adjective; never across
    // "and" ("crossed once and made five tackle breaks" is one try). A bare
    // number needs its unit ("adding two" may be a goal and an assist); the
    // tally words (twice, a brace, a hat-trick) stand alone.
    new RegExp(String.raw`${NAME}(?:['’]s)?\s+(?:who\s+)?${VERB}\s+(?:(?!and\b|but\b|then\b)[a-z-]+\s+)?(once|twice|a brace|brace|a hat-trick|hat-trick|hat trick|treble)\b`, 'g'),
    new RegExp(String.raw`${NAME}(?:['’]s)?\s+(?:who\s+)?${VERB}\s+(?:(?!and\b|but\b|then\b)[a-z-]+\s+)?(two|three|four|five|six|\d)\s+(?:goals?|tries|majors|times)\b`, 'g'),
    new RegExp(String.raw`(?:a\s+)?${CNT}\s+(?:goals?|tries|majors)?\s*(?:from|by|for|courtesy of)\s+${NAME}`, 'g'),
    // Possessive form needs the unit: "Cobbo's two" was his two line breaks.
    new RegExp(String.raw`${NAME}['’]s?\s+${CNT}\s+(?:goals?|tries|majors)\b`, 'g'),
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
  // AFL quarter lines: "Hawthorn 12.5 (77) – 15.7 (97) Brisbane Lions" → 77–97, 12–15, 5–7.
  for (const m of dataBlock.matchAll(/(\d+)\.(\d+) \((\d+)\)\s*[–-]\s*(\d+)\.(\d+) \((\d+)\)/g)) {
    add(m[3], m[6]); add(m[1], m[4]); add(m[2], m[5]);
  }
  for (const m of dataBlock.matchAll(/(\d+)\.(\d+) \((\d+)\) v [^\n]+? (\d+)\.(\d+) \((\d+)\) in the term/g)) {
    add(m[3], m[6]); add(m[1], m[4]);
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
    // "level at ten apiece", "ten each", "levelling at 12" — the same claim in words.
    for (const m of text.matchAll(/\b(?:level(?:l?ed|ling)?(?: the scores)? at|locked at|tied at)\s+(\d{1,3}|[a-z]+)(?:[- ](?:apiece|all|each))?\b|\b(\d{1,3}|[a-z]+)[- ](?:apiece|each)\b/gi)) {
      const n = toN(m[1] ?? m[2] ?? '');
      if (!Number.isFinite(n) || n < 1) continue;
      if (!pairs.has(`${n}:${n}`)) flag(m[0], `"${m[0]}" — the scores were never level at ${n} in MATCH EVENTS`);
    }
    if (!ht) continue;
    const ft = dataBlock.match(/^\s*FT — .+? (\d+)–(\d+) /m);
    for (const m of text.matchAll(htRe)) {
      const idx = m.index ?? 0;
      // Only a score that sits WITH the half-time phrase ("led 16–6 at
      // half-time", "at the break it was 16–6"): a wider window swept up the
      // 16–0 burst two clauses earlier and the full-time score (2026-09-26).
      const near = text.slice(Math.max(0, idx - 28), idx + m[0].length + 32);
      for (const p of near.matchAll(/\b(\d{1,3})\s*[–-]\s*(\d{1,3})\b(?!['’%])/g)) {
        const x = Number(p[1]), y = Number(p[2]);
        if (ft && ((x === Number(ft[1]) && y === Number(ft[2])) || (x === Number(ft[2]) && y === Number(ft[1])))) continue;
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
  // The inverse: "lost the clearances by one" claims the LOWER figure.
  const lostRe = /\b(?:lost|losing|conceded|trailed in|were beaten in|were outdone in|lost out in)\s+(?:the\s+|their\s+)?([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})/gi;
  for (const m of text.matchAll(lostRe)) {
    const phrase = m[1].trim();
    const noun = STAT_NOUNS.find(s => s.re.test(phrase) && s.labels);
    if (!noun?.labels) continue;
    const label = noun.labels.find(l => stats.has(l));
    if (!label) continue;
    const [t, o] = stats.get(label)!;
    const idx = m.index ?? 0;
    const subject = sideAt(Math.max(0, idx - 100), idx);
    if (!subject) continue;
    const mine = subject === 'team' ? t : o, theirs = subject === 'team' ? o : t;
    const key = `lost:${m[0].toLowerCase()}`;
    if (mine >= theirs && !seen.has(key)) { seen.add(key); violations.push(`stat claim "${m[0]}" — TEAM STATS have ${subject === 'team' ? teamName : opponent} ${mine} to ${theirs} on ${label}; they did not lose that category`); }
  }
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
    // "won fewer clearances" claims the LOWER figure — a true statement for the
    // side that lost the category (false refusal, 2026-09-26).
    const claimsLower = /^(?:fewer|less|only|just)\b/i.test(phrase);
    if (claimsLower ? mine >= theirs : mine <= theirs) {
      const who = subject === 'team' ? teamName : opponent;
      violations.push(`stat claim "${m[0]}" — TEAM STATS have ${who} ${mine} to ${theirs} on ${label}; ${claimsLower ? 'they had the higher figure' : 'they did not win that category'}`);
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
  for (const v of between.matchAll(/\b(conced\w*|allow\w*|leak\w*|gave up|giving up|coughed up|let in|letting in|suffer\w*|absorb\w*|miss(?:ed|ing)|made|making|won|winning|led|leading|scor\w+|record\w*|manag\w+|had|with)\b/g)) lastVerb = v[1];
  return lastVerb && /^(?:conced|allow|leak|gave up|giving up|coughed up|let in|letting in|suffer|absorb)/.test(lastVerb) ? (best.side === 'team' ? 'opp' : 'team') : best.side;
}

/** Every score in order with its side and point value (rugby: try 4, conversion 2 folded into the running score, penalty goal 2, field goal 1; soccer 1). */
function scoringSequence(dataBlock: string, ctx: SideContext): Array<{ side: 'team' | 'opp'; points: number }> {
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return [];
  const end = dataBlock.indexOf('\n\n', start);
  const section = dataBlock.slice(start, end === -1 ? undefined : end);
  const out: Array<{ side: 'team' | 'opp'; points: number }> = [];
  let prevH = 0, prevA = 0;
  for (const line of section.split('\n')) {
    let m = line.match(/^\s*\S+ GOAL ([^—\n]+?) — /);
    if (m) {
      const s = m[1].trim().toLowerCase();
      const side = ctx.teamToks.some(t => s.includes(t)) ? 'team' : ctx.oppToks.some(t => s.includes(t)) ? 'opp' : null;
      if (side) out.push({ side, points: 1 });
      continue;
    }
    // Rugby: "11' Try Roosters — Daniel Tupou — Roosters 10, Sharks 0" → points from the running score delta.
    m = line.match(/^\s*\d+' (?:Try|Penalty Goal|Field Goal) ([^—\n]+?) —[^—\n]*?(?:— )?([A-Za-z][^,\n]*?) (\d+), ([A-Za-z][^\n]*?) (\d+)\s*$/);
    if (m) {
      const s = m[1].trim().toLowerCase();
      const side = ctx.teamToks.some(t => s.includes(t)) ? 'team' : ctx.oppToks.some(t => s.includes(t)) ? 'opp' : null;
      const h = Number(m[3]), a = Number(m[5]);
      const delta = Math.max(h - prevH, a - prevA, 0);
      prevH = Math.max(prevH, h); prevA = Math.max(prevA, a);
      if (side) out.push({ side, points: delta || 4 });
    }
  }
  return out;
}

/** Scores per side per half from MATCH EVENTS (soccer GOAL lines, rugby Try lines). */
function halfCounts(dataBlock: string, ctx: SideContext): { first: [number, number]; second: [number, number] } | null {
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return null;
  const section = dataBlock.slice(start, dataBlock.indexOf('\n\n', start) === -1 ? undefined : dataBlock.indexOf('\n\n', start));
  const first: [number, number] = [0, 0], second: [number, number] = [0, 0];
  let half: 'first' | 'second' = 'first';
  let sawHT = false, sawScores = false;
  const sideOf = (label: string): 0 | 1 | null => {
    const s = label.trim().toLowerCase();
    if (ctx.teamToks.some(t => s.includes(t)) || ctx.teamName.toLowerCase().includes(s)) return 0;
    if (ctx.oppToks.some(t => s.includes(t))  || ctx.opponent.toLowerCase().includes(s)) return 1;
    return null;
  };
  for (const line of section.split('\n')) {
    if (/^\s*HT — /.test(line)) { half = 'second'; sawHT = true; continue; }
    const m = line.match(/^\s*\S+ (?:GOAL|Try) ([^—\n]+?) — /);
    if (m) {
      const side = sideOf(m[1]);
      if (side === null) continue;
      sawScores = true;
      (half === 'first' ? first : second)[side]++;
      continue;
    }
    // AFL quarter line: "Q1 — Home 5.1 (31) v Away 5.2 (32) in the term; …" → goals per side.
    const q = line.match(/^\s*Q\d — (.+?) (\d+)\.(\d+) \(\d+\) v (.+?) (\d+)\.(\d+) \(\d+\) in the term/);
    if (q) {
      const hs = sideOf(q[1]), as = sideOf(q[4]);
      if (hs === null || as === null) continue;
      sawScores = true;
      (half === 'first' ? first : second)[hs] += Number(q[2]);
      (half === 'first' ? first : second)[as] += Number(q[5]);
    }
  }
  return sawHT && sawScores ? { first, second } : null;
}

/**
 * "N goals/tries before half-time", "N first-half tries", "three tries to two
 * after the break" — bound to the events on either side of the HT line.
 */
/** Margin (absolute) after each scoring event, keyed by minute, from the running scores in MATCH EVENTS. */
function marginAfter(dataBlock: string, ctx: SideContext): Map<number, number> {
  void ctx;
  const out = new Map<number, number>();
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return out;
  const end = dataBlock.indexOf('\n\n', start);
  for (const line of dataBlock.slice(start, end === -1 ? undefined : end).split('\n')) {
    let m = line.match(/^\s*(\d+)'(?:\+\d+')? GOAL .*\[(?:.+?) (\d+)–(\d+) (?:.+?)\]$/);
    if (!m) m = line.match(/^\s*(\d+)' (?:Try|Penalty Goal|Field Goal) .*? (\d+), [^,\n]*? (\d+)\s*$/);
    if (m) out.set(Number(m[1]), Math.abs(Number(m[2]) - Number(m[3])));
  }
  return out;
}

/** AFL goals per side per quarter from the Q-lines, or null when there are none. */
function quarterGoals(dataBlock: string, ctx: SideContext): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const q of dataBlock.matchAll(/^\s*Q(\d) — (.+?) (\d+)\.\d+ \(\d+\) v (.+?) (\d+)\.\d+ \(\d+\) in the term/gm)) {
    const sideOf = (label: string): 0 | 1 | null => {
      const s = label.trim().toLowerCase();
      if (ctx.teamToks.some(t => s.includes(t)) || ctx.teamName.toLowerCase().includes(s)) return 0;
      if (ctx.oppToks.some(t => s.includes(t))  || ctx.opponent.toLowerCase().includes(s)) return 1;
      return null;
    };
    const hs = sideOf(q[2]), as = sideOf(q[4]);
    if (hs === null || as === null) continue;
    const pair: [number, number] = [0, 0];
    pair[hs] = Number(q[3]); pair[as] = Number(q[5]);
    out[Number(q[1]) - 1] = pair;
  }
  return out.length ? out : null;
}

/** AFL per-quarter state from the Q-lines: term points per side, who led after the term and by how much. */
function quarterStatesOf(dataBlock: string, ctx: SideContext): Array<{ termScore: [number, number]; termWinner: 'team' | 'opp' | null; leader: 'team' | 'opp' | null; margin: number }> | null {
  const out: Array<{ termScore: [number, number]; termWinner: 'team' | 'opp' | null; leader: 'team' | 'opp' | null; margin: number }> = [];
  const sideOf = (label: string): 'team' | 'opp' | null => {
    const s = label.trim().toLowerCase();
    if (ctx.teamToks.some(t => s.includes(t)) || ctx.teamName.toLowerCase().includes(s)) return 'team';
    if (ctx.oppToks.some(t => s.includes(t))  || ctx.opponent.toLowerCase().includes(s)) return 'opp';
    return null;
  };
  for (const q of dataBlock.matchAll(/^\s*Q(\d) — (.+?) \d+\.\d+ \((\d+)\) v (.+?) \d+\.\d+ \((\d+)\) in the term;.*?; (?:(.+?) lead by (\d+)|scores level)\s*$/gm)) {
    const hs = sideOf(q[2]), as = sideOf(q[4]);
    if (!hs || !as) continue;
    const pts: [number, number] = [0, 0];
    pts[hs === 'team' ? 0 : 1] = Number(q[3]); pts[as === 'team' ? 0 : 1] = Number(q[5]);
    const leader = q[6] ? sideOf(q[6]) : null;
    out[Number(q[1]) - 1] = { termScore: pts, termWinner: pts[0] === pts[1] ? null : pts[0] > pts[1] ? 'team' : 'opp', leader, margin: q[7] ? Number(q[7]) : 0 };
  }
  return out.length ? out : null;
}

export function validateHalfCounts(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  const counts = halfCounts(dataBlock, ctx);
  if (!counts) return [];
  const quarters = quarterGoals(dataBlock, ctx);
  const quarterStates = quarterStatesOf(dataBlock, ctx);
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
    const reA = new RegExp(String.raw`\b${N}\s+(?:[a-z]+\s+)?${UNIT}\s+(in|during|after|before|by|inside|since|from|into)\s+(?:the\s+)?${HALF}`, 'gi');
    // Reverse order: "after halftime with two quick tries" → second half.
    const reE = new RegExp(String.raw`\b(after|before|by|since)\s+(?:the\s+)?${HALF}\b[^.;]{0,40}?\b${N}\s+(?:[a-z]+\s+)?${UNIT}\b`, 'gi');
    for (const m of text.matchAll(reE)) {
      const n = toN(m[3]);
      const half = halfFromPrep(m[1], m[2]);
      if (!Number.isFinite(n) || !half) continue;
      const subject = subjectFor(lower, m.index ?? 0, ctx, side);
      const [t, o] = counts[half];
      const ok = subject === 'team' ? n === t : subject === 'opp' ? n === o : (n === t || n === o);
      if (!ok) flag(m[0], `half count "${m[0]}" — MATCH EVENTS give ${ctx.teamName} ${t}, ${ctx.opponent} ${o} in the ${half} half`);
    }
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
    // "N unanswered tries/goals/points" → the longest run of consecutive
    // scores by one side must be at least N (points: the longest points run).
    const runRe = new RegExp(String.raw`\b${N}\s+(?:unanswered|straight|consecutive)\s+(tries|goals|points|majors)\b`, 'gi');
    for (const m of text.matchAll(runRe)) {
      const n = toN(m[1]);
      if (!Number.isFinite(n)) continue;
      const seq = scoringSequence(dataBlock, ctx);
      if (!seq.length) continue;
      const subject = subjectFor(lower, m.index ?? 0, ctx, side);
      let best = 0, run = 0, runPts = 0, bestPts = 0, last: 'team' | 'opp' | null = null;
      for (const e of seq) {
        if (e.side === last) { run++; runPts += e.points; } else { run = 1; runPts = e.points; last = e.side; }
        if (!subject || e.side === subject) { best = Math.max(best, run); bestPts = Math.max(bestPts, runPts); }
      }
      const isPts = /points/i.test(m[2]);
      const have = isPts ? bestPts : best;
      if (n > have) flag(m[0], `run claim "${m[0]}" — MATCH EVENTS show at most ${have} ${isPts ? 'unanswered points' : 'consecutive scores'} for ${subject ? (subject === 'team' ? ctx.teamName : ctx.opponent) : 'either side'}`);
    }
    // "their sixth try of the second half" → the event at the segment's minute is that ordinal.
    const ordRe = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(try|goal|major)\s+of\s+the\s+(first|second)\s+half\b/gi;
    for (const m of text.matchAll(ordRe)) {
      const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].indexOf(m[1].toLowerCase()) + 1;
      const half = m[3].toLowerCase() as 'first' | 'second';
      const subject = subjectFor(lower, m.index ?? 0, ctx, side);
      const [t, o] = counts[half];
      const have = subject === 'team' ? t : subject === 'opp' ? o : Math.max(t, o);
      if (ord > have) flag(m[0], `"${m[0]}" — MATCH EVENTS give ${subject === 'team' ? ctx.teamName : subject === 'opp' ? ctx.opponent : 'the sides at most'} ${have} in the ${half} half`);
    }
    // "three tries to two" with a half (or AFL term) indicator nearby
    const reC = new RegExp(String.raw`\b${N}\s+${UNIT}\s+to\s+${N}\b`, 'gi');
    for (const m of text.matchAll(reC)) {
      const idx = m.index ?? 0;
      const near = lower.slice(Math.max(0, idx - 70), idx + m[0].length + 50);
      const a = toN(m[1]), b = toN(m[2]);
      const qm = near.match(/\b(first|opening|second|third|fourth|final|last)[- ](?:term|quarter)\b/);
      if (qm && quarters) {
        const qi = ({ first: 0, opening: 0, second: 1, third: 2, fourth: 3, final: 3, last: 3 } as Record<string, number>)[qm[1]];
        const [t, o] = quarters[qi] ?? [0, 0];
        if (!((a === t && b === o) || (a === o && b === t))) flag(m[0], `term count "${m[0]}" — the ${qm[1]} term was ${ctx.teamName} ${t} goals, ${ctx.opponent} ${o} in MATCH EVENTS`);
        continue;
      }
      const half = /second half|after (?:half[- ]?time|halftime|the break|the interval)/.test(near) ? 'second'
        : /first half|before (?:half[- ]?time|halftime|the break)|by (?:half[- ]?time|halftime|the break)/.test(near) ? 'first' : null;
      // No half indicator → the whole-match tally ("six tries to four").
      const [t, o] = half ? counts[half] : [counts.first[0] + counts.second[0], counts.first[1] + counts.second[1]];
      if (!((a === t && b === o) || (a === o && b === t))) flag(m[0], `${half ? 'half' : 'match'} count "${m[0]}" — ${half ? `the ${half} half` : 'the match'} was ${ctx.teamName} ${t}, ${ctx.opponent} ${o} in MATCH EVENTS`);
    }
    // AFL quarter states: "ahead by one point after the first term",
    // "outscored Hawthorn in the final quarter", "led by 20 at three-quarter time".
    if (quarterStates) {
      const QREF = String.raw`(?:(?:after|at|by)\s+(?:the\s+)?(?:end\s+of\s+the\s+)?(first|opening|second|third|fourth|final|last)\s+(?:term|quarter|change)|at\s+(quarter|half|three-quarter)[- ]time|at\s+the\s+(last|first|main)\s+change)`;
      const qIndexOf = (w: string): number | null =>
        ({ first: 0, opening: 0, quarter: 0, second: 1, half: 1, main: 1, third: 2, 'three-quarter': 2, last: 3, fourth: 3, final: 3 } as Record<string, number>)[w.toLowerCase()] ?? null;
      const leadRe = new RegExp(String.raw`\b(led|lead|leading|ahead|in front|up|trailed|trailing|behind|down)\s+by\s+${N}(?:\s+points?)?\b[^.;]{0,40}?${QREF}`, 'gi');
      for (const m of text.matchAll(leadRe)) {
        const n = toN(m[2]);
        const qi = qIndexOf(m[3] ?? m[4] ?? m[5] ?? '');
        if (qi === null || !quarterStates[qi] || !Number.isFinite(n)) continue;
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        if (!subject) continue;
        const st = quarterStates[qi];
        const leads = /^(?:led|lead|leading|ahead|in front|up)$/i.test(m[1]);
        const okDir = st.margin === 0 ? false : (leads ? st.leader === subject : st.leader !== subject);
        if (!okDir || n !== st.margin) flag(m[0], `quarter state "${m[0]}" — MATCH EVENTS have ${st.margin === 0 ? 'scores level' : `${st.leader === 'team' ? ctx.teamName : ctx.opponent} ${st.margin} ahead`} at that point`);
      }
      const outRe = new RegExp(String.raw`\b(outscor(?:ed|ing)|won|winning|dominat(?:ed|ing)|took|taking|claimed)\s+(?:[A-Z][\w'’]*(?:\s+[A-Z][\w'’]*)?\s+)?(?:in\s+)?(?:the\s+)?(first|opening|second|third|fourth|final|last)\s+(?:term|quarter)\b`, 'gi');
      for (const m of text.matchAll(outRe)) {
        const qi = ({ first: 0, opening: 0, second: 1, third: 2, fourth: 3, final: 3, last: 3 } as Record<string, number>)[m[2].toLowerCase()];
        const qs = quarterStates[qi];
        if (!qs) continue;
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        if (!subject) continue;
        if (qs.termWinner !== subject) flag(m[0], `"${m[0]}" — the ${m[2]} term was ${qs.termScore[0]}–${qs.termScore[1]} (${ctx.teamName}–${ctx.opponent}) in MATCH EVENTS`);
      }
    }
    // AFL: "kicked seven goals in the third term" → that quarter's goals for the side.
    if (quarters) {
      const reQ = new RegExp(String.raw`\b${N}\s+(?:[a-z]+\s+)?(?:goals?|majors)\s+(?:in|during)\s+(?:the\s+)?(first|opening|second|third|fourth|final|last)[- ](?:term|quarter)\b`, 'gi');
      for (const m of text.matchAll(reQ)) {
        const n = toN(m[1]);
        const qi = ({ first: 0, opening: 0, second: 1, third: 2, fourth: 3, final: 3, last: 3 } as Record<string, number>)[m[2].toLowerCase()];
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        const [t, o] = quarters[qi] ?? [0, 0];
        const ok = subject === 'team' ? n === t : subject === 'opp' ? n === o : (n === t || n === o);
        if (Number.isFinite(n) && !ok) flag(m[0], `term count "${m[0]}" — the ${m[2]} term was ${ctx.teamName} ${t} goals, ${ctx.opponent} ${o} in MATCH EVENTS`);
      }
      // A segment anchored to a term ("Q3 — … Lions kick six goals") binds a bare goal count to that term.
      const anchor = text.match(/^\s*(?:Q(\d)|(first|opening|second|third|fourth|final|last)[- ](?:term|quarter))\b/i);
      if (anchor) {
        const qi = anchor[1] ? Number(anchor[1]) - 1 : ({ first: 0, opening: 0, second: 1, third: 2, fourth: 3, final: 3, last: 3 } as Record<string, number>)[anchor[2].toLowerCase()];
        const reBare = new RegExp(String.raw`\b(?:kick(?:ed|s|ing)?|boot(?:ed|s)?|slot(?:ted|s)?|add(?:ed|s)?)\s+${N}\s+(?:goals?|majors)\b`, 'gi');
        for (const m of text.matchAll(reBare)) {
          const n = toN(m[1]);
          const subject = subjectFor(lower, m.index ?? 0, ctx, side);
          const [t, o] = quarters[qi] ?? [0, 0];
          const ok = subject === 'team' ? n === t : subject === 'opp' ? n === o : (n === t || n === o);
          if (Number.isFinite(n) && !ok) flag(m[0], `term count "${m[0]}" — that term was ${ctx.teamName} ${t} goals, ${ctx.opponent} ${o} in MATCH EVENTS`);
        }
      }
    }
    // "closed the gap to four", "cut the deficit to eight", "within six" — the margin after the event at the segment's minute.
    {
      const seq = scoringEvents(dataBlock);
      const minM = text.match(/\b(\d{1,3})'/);
      const gapM = text.match(new RegExp(String.raw`\b(?:(?:clos(?:ed|ing)|cut|narrow(?:ed|ing)|reduc(?:ed|ing)|trimm(?:ed|ing)|pull(?:ed|ing)) (?:the )?(?:gap|deficit|margin|lead)(?: back)? to|(?:to )?within|back to within)\s+${N}\b`, 'i'));
      if (minM && gapM && seq.length) {
        const ev = seq.find(e => e.minute === Number(minM[1]));
        const margins = marginAfter(dataBlock, ctx);
        const margin = ev ? margins.get(ev.minute) : undefined;
        const n = toN(gapM[1]);
        if (margin !== undefined && Number.isFinite(n) && n !== margin) flag(gapM[0], `"${gapM[0]}" — after the score on ${minM[1]}' the margin was ${margin} in MATCH EVENTS`);
      }
    }
  }
  return violations;
}

/** Sides of the scoring events in order, split at the HT line. */
function scoringOrder(dataBlock: string, ctx: SideContext): { first: Array<'team' | 'opp'>; second: Array<'team' | 'opp'> } | null {
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return null;
  const end = dataBlock.indexOf('\n\n', start);
  const section = dataBlock.slice(start, end === -1 ? undefined : end);
  const first: Array<'team' | 'opp'> = [], second: Array<'team' | 'opp'> = [];
  let half: 'first' | 'second' = 'first';
  for (const line of section.split('\n')) {
    if (/^\s*HT — /.test(line)) { half = 'second'; continue; }
    const m = line.match(/^\s*\S+ (?:GOAL|Try|Penalty Goal|Field Goal) ([^—\n]+?) — /);
    if (!m) continue;
    const s = m[1].trim().toLowerCase();
    const isTeam = ctx.teamToks.some(t => s.includes(t)) || ctx.teamName.toLowerCase().includes(s);
    const isOpp  = ctx.oppToks.some(t => s.includes(t))  || ctx.opponent.toLowerCase().includes(s);
    if (!isTeam && !isOpp) continue;
    (half === 'first' ? first : second).push(isTeam ? 'team' : 'opp');
  }
  return first.length + second.length > 0 ? { first, second } : null;
}

/**
 * "Opened the scoring", "struck first", "opened with two quick tries",
 * "first to score after the break" — bound to the order of the events;
 * "posted / scored N points" bound to the final score.
 */
export function validateScoringOrder(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  const order = scoringOrder(dataBlock, ctx);
  const score = dataBlock.match(/^Score:\s*(.+?) (\d+) – (\d+) (.+)$/m);
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (k: string, msg: string) => { if (!seen.has(k)) { seen.add(k); violations.push(msg); } };
  const name = (s: 'team' | 'opp') => s === 'team' ? ctx.teamName : ctx.opponent;

  for (const { text, side } of sidedSegments(review, ctx)) {
    const lower = text.toLowerCase();
    if (order) {
      const firstRe = /\b(?:opened the scoring|opened (?:up )?with|scored first|struck first|drew first blood|first (?:team |side )?to score|first on the (?:board|scoreboard)|early (?:lead|breakthrough))\b/gi;
      for (const m of text.matchAll(firstRe)) {
        const idx = m.index ?? 0;
        const near = lower.slice(idx, idx + m[0].length + 60);
        // "opened the scoring FOR Sunderland" is that side's first goal, not
        // the match's: bind it to the side's first scorer instead.
        const forSide = near.match(/^\S+(?:\s+\S+){0,2}?\s+for\s+([a-z][a-z&' -]{2,30}?)(?=[\s,.;]|$)/);
        if (forSide) {
          const s = forSide[1].trim();
          const sideOf = ctx.teamToks.some(t => s.includes(t)) ? 'team' : ctx.oppToks.some(t => s.includes(t)) ? 'opp' : null;
          if (sideOf) {
            const firstOf = order.first.concat(order.second).findIndex(x => x === sideOf);
            if (firstOf >= 0) continue; // the side did score; who scored it is checked by the tally binders
          }
        }
        const half = /second half|after (?:half[- ]?time|halftime|the break|the interval)/.test(near) ? 'second'
          : /each half|both halves/.test(near) ? 'both' : 'first';
        const subject = subjectFor(lower, idx, ctx, side);
        if (!subject) continue;
        const check = (h: 'first' | 'second') => {
          const seq = order[h];
          if (seq.length === 0) return true;
          // "opened with two quick tries" → the first N scores must all be theirs.
          const nM = near.match(/^\S+(?:\s+\S+){0,3}?\s+(two|three|four|\d)\s+(?:[a-z]+\s+)?(?:tries|goals)/);
          const n = nM ? toN(nM[1]) : 1;
          return seq.slice(0, Math.max(1, n)).every(s => s === subject);
        };
        const ok = half === 'both' ? check('first') && check('second') : check(half);
        if (!ok) {
          const h = half === 'both' ? 'second' : half;
          flag(m[0], `scoring order "${m[0]}" — MATCH EVENTS have ${name(order[h][0])} scoring first in the ${h} half`);
        }
      }
    }
    if (score) {
      const tScore = Number(score[2]), oScore = Number(score[3]);
      for (const m of text.matchAll(/\b(?:posted|scored|racked up|put up|ran up|amassed|managed|finished with)\s+(\d{1,3})\s+points\b/gi)) {
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        const n = Number(m[1]);
        const ok = subject === 'team' ? n === tScore : subject === 'opp' ? n === oScore : (n === tScore || n === oScore);
        if (!ok) flag(m[0], `"${m[0]}" — the final score is ${ctx.teamName} ${tScore}, ${ctx.opponent} ${oScore}`);
      }
    }
  }
  return violations;
}

// ─── Per-player binders (report-craft prompt, 2026-09-26) ────────────────────
// With KEY PERFORMERS lines and a narrative prompt, the model now writes about
// people — and slips there: "Havertz had two shots on target" (one), "doubled
// the lead two minutes later" (fourteen), "six substitutions" (five), "Semenyo
// scored twice before half-time" (once).

interface PlayerLine { name: string; surname: string; stats: Map<string, number> }
/** KEY PERFORMERS / SCORERS lines → per-player labelled figures. */
function playerLines(dataBlock: string): PlayerLine[] {
  const out: PlayerLine[] = [];
  for (const m of dataBlock.matchAll(/^\s+([^(\n—]+?)(?: \([^)]*\))? — ([^\n]+)$/gm)) {
    const name = m[1].trim();
    if (!name || /^\d/.test(name)) continue;
    const stats = new Map<string, number>();
    for (const kv of m[2].matchAll(/([A-Za-z][A-Za-z0-9 %\-]*?):\s*(\d+(?:\.\d+)?)(?:\/(\d+))?/g)) {
      const label = kv[1].trim().toLowerCase();
      stats.set(label, Math.floor(Number(kv[2])));
      if (kv[3]) stats.set(`${label} attempts`, Number(kv[3])); // "Goals: 2/4" → goals 2, goal attempts 4
    }
    if (stats.size) out.push({ name, surname: name.split(/\s+/).pop()!.toLowerCase(), stats });
  }
  return out;
}

/** Scoring events with minute, scorer and half, in order. */
function scoringEvents(dataBlock: string): Array<{ minute: number; scorer: string; half: 'first' | 'second' }> {
  const start = dataBlock.indexOf('MATCH EVENTS');
  if (start < 0) return [];
  const end = dataBlock.indexOf('\n\n', start);
  const section = dataBlock.slice(start, end === -1 ? undefined : end);
  const out: Array<{ minute: number; scorer: string; half: 'first' | 'second' }> = [];
  let half: 'first' | 'second' = 'first';
  for (const line of section.split('\n')) {
    if (/^\s*HT — /.test(line)) { half = 'second'; continue; }
    let m = line.match(/^\s*(\d+)'(?:\+\d+')? GOAL [^—\n]+ — ([^,(\[\n]+?)(?: \(own goal\))?(?:,|\s\(|\s\[)/);
    if (!m) m = line.match(/^\s*(\d+)' Try(?: [^—\n]+)? — ([^—\n]+?) — /);
    if (m) out.push({ minute: Number(m[1]), scorer: m[2].trim().toLowerCase(), half });
  }
  return out;
}

const PLAYER_FIGURE_NOUNS: Array<{ re: RegExp; labels: string[] }> = [
  { re: /^(?:goal|conversion|kick(?:ing)?) attempts?$|^attempts? at goal$|^shots? at goal$/i, labels: ['goals attempts'] },
  { re: /^shots? on target$|^efforts? on target$|^on target$/i, labels: ['on target'] },
  { re: /^shots?$|^efforts?$|^attempts?$/i,                     labels: ['shots'] },
  { re: /^saves?$/i,                                             labels: ['saves'] },
  { re: /^tackle[- ]breaks?$/i,                                  labels: ['tackle breaks'] },
  { re: /^(?:run(?:ning)? )?metres$/i,                           labels: ['run metres'] },
  { re: /^line[- ]?breaks?$/i,                                   labels: ['line breaks'] },
  { re: /^try assists?$/i,                                       labels: ['try assists'] },
  { re: /^tries$/i,                                              labels: ['tries'] },
  { re: /^goals?$|^majors?$/i,                                   labels: ['goals'] },
  { re: /^assists?$/i,                                           labels: ['assists', 'try assists'] },
  { re: /^marks?$/i,                                             labels: ['marks'] },
  { re: /^disposals?$|^touches$|^possessions$/i,                 labels: ['disposals'] },
  { re: /^clearances?$/i,                                        labels: ['clearances'] },
  { re: /^tackles?$/i,                                           labels: ['tackles'] },
  { re: /^offloads?$/i,                                          labels: ['offloads'] },
  { re: /^intercepts?$/i,                                        labels: ['intercepts'] },
  { re: /^hit[- ]?outs?$/i,                                      labels: ['hitouts'] },
];

export function validatePlayerFigures(review: AIReview, dataBlock: string): string[] {
  const ctx = sideContext(dataBlock);
  if (!ctx) return [];
  const players = playerLines(dataBlock);
  const events = scoringEvents(dataBlock);
  // Team-level figures ("Brighton had 17 shots to Arsenal's 11", "Brighton's
  // three goals") are not a player's, whoever was named just before them.
  const teamLevel = new Map<string, Set<number>>();
  const addTeam = (label: string, ...vals: number[]) => { const s = teamLevel.get(label) ?? teamLevel.set(label, new Set()).get(label)!; vals.forEach(v => s.add(v)); };
  const tsHead = dataBlock.match(/^TEAM STATS \(.+?\):\n((?:[^\n]+\n)*?)\n/m);
  for (const line of (tsHead?.[1] ?? '').split('\n')) {
    const m = line.match(/^\s+(.+?):\s*([\d.]+)(?:\s*\([^)]*\))?\s*–\s*([\d.]+)/);
    if (m) addTeam(m[1].trim().toLowerCase(), Math.floor(Number(m[2])), Math.floor(Number(m[3])));
  }
  const scoreLine = dataBlock.match(/^Score:\s*.+? (\d+) – (\d+) .+$/m);
  if (scoreLine) { addTeam('goals', Number(scoreLine[1]), Number(scoreLine[2])); addTeam('tries', Number(scoreLine[1]), Number(scoreLine[2])); }
  const isTeamFigure = (label: string, n: number): boolean => {
    const aliases: Record<string, string[]> = { 'on target': ['shots on target', 'on target'], shots: ['shots'], goals: ['goals'], tries: ['tries'], 'tackle breaks': ['tackle breaks'], 'line breaks': ['line breaks'], 'run metres': ['run metres'], tackles: ['tackles', 'missed tackles'], disposals: ['disposals'], clearances: ['clearances'], marks: ['marks'], saves: ['saves'] };
    return (aliases[label] ?? [label]).some(a => teamLevel.get(a)?.has(n));
  };
  const subsBySide = { team: 0, opp: 0 };
  for (const m of dataBlock.matchAll(/^\s*\S+ Substitution ([^—\n]+?) — /gm)) {
    const s = m[1].trim().toLowerCase();
    if (ctx.teamToks.some(t => s.includes(t)) || ctx.teamName.toLowerCase() === s) subsBySide.team++;
    else if (ctx.oppToks.some(t => s.includes(t)) || ctx.opponent.toLowerCase() === s) subsBySide.opp++;
  }
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (k: string, msg: string) => { if (!seen.has(k)) { seen.add(k); violations.push(msg); } };
  const NUMW = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twice|once|thrice|a brace|a hat-trick)`;
  const cnt = (s: string) => /^twice$/i.test(s) ? 2 : /^once$/i.test(s) ? 1 : /^thrice$/i.test(s) ? 3 : /brace/i.test(s) ? 2 : /hat-trick/i.test(s) ? 3 : toN(s);
  const mentioned = (sentence: string): PlayerLine[] => {
    const l = sentence.toLowerCase();
    return players.filter(p => (p.surname.length >= 4 && l.includes(p.surname)) || l.includes(p.name.toLowerCase()));
  };
  const nearestPlayerBefore = (sentence: string, idx: number): PlayerLine | null => {
    const l = sentence.toLowerCase();
    let best: { p: PlayerLine; at: number } | null = null;
    for (const p of players) {
      for (const tok of [p.name.toLowerCase(), p.surname]) {
        if (tok.length < 4) continue;
        for (let at = l.indexOf(tok); at >= 0 && at < idx; at = l.indexOf(tok, at + 1)) if (!best || at > best.at) best = { p, at };
      }
    }
    return best && idx - best.at <= 90 ? best.p : null;
  };

  let prevScorers: string[] = [];
  for (const { text, side } of sidedSegments(review, ctx)) {
    for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
      const lower = sentence.toLowerCase();

      // (a) A player's figure: "Havertz had two shots on target".
      for (const m of sentence.matchAll(new RegExp(String.raw`\b${NUMW}\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})`, 'gi'))) {
        const n = cnt(m[1]);
        if (!Number.isFinite(n)) continue;
        const words = m[2].trim().split(/\s+/);
        let spec: (typeof PLAYER_FIGURE_NOUNS)[number] | undefined, noun = '';
        for (let len = Math.min(3, words.length); len >= 1 && !spec; len--) { noun = words.slice(0, len).join(' '); spec = PLAYER_FIGURE_NOUNS.find(v => v.re.test(noun)); }
        if (!spec) continue;
        // "put Brighton three goals ahead" is a score state, not Groß's tally.
        const after = sentence.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14).toLowerCase();
        const before = sentence.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0).toLowerCase();
        if (/^\s*(?:ahead|up|clear|behind|down|in front|to the good|adrift|lead|margin)\b/.test(after) || /\b(?:put|went|go|goes|moved|by)\s*$/.test(before)) continue;
        const who = nearestPlayerBefore(sentence, m.index ?? 0);
        if (!who) continue;
        const label = spec.labels.find(l => who.stats.has(l));
        if (!label) continue;
        const actual = who.stats.get(label)!;
        if (actual !== n && isTeamFigure(label, n)) continue; // a club's total, not this player's
        if (actual !== n) flag(`${who.name}:${label}`, `player figure "${m[0].trim()}" — the block gives ${who.name} ${actual} ${label}, not ${n}`);
      }

      // (a2) Superlatives: "led all players with 26 disposals", "game-high 193 metres",
      // "the most tackle breaks on the ground (11)" → must be the maximum across
      // every KEY PERFORMERS line for that label (Ashcroft had 28; Neale 26 — live).
      const supRe = new RegExp(String.raw`\b(?:led all (?:players|comers)|led the (?:game|match|ground|field)|top(?:ped)? the (?:count|charts?)|game[- ]high|match[- ]high|most (?:of anyone|on the (?:ground|field|park|night|day)))\b[^.;]{0,40}?\b${NUMW}\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})|\b${NUMW}\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\b[^.;]{0,30}?\b(?:the most (?:of anyone|on the (?:ground|field|park)|in the (?:game|match))|game[- ]high|match[- ]high|led all (?:players|comers))\b`, 'gi');
      for (const m of sentence.matchAll(supRe)) {
        const n = cnt(m[1] ?? m[3] ?? '');
        const phrase = (m[2] ?? m[4] ?? '').trim();
        if (!Number.isFinite(n) || !phrase) continue;
        const words = phrase.split(/\s+/);
        let spec: (typeof PLAYER_FIGURE_NOUNS)[number] | undefined;
        for (let len = Math.min(3, words.length); len >= 1 && !spec; len--) spec = PLAYER_FIGURE_NOUNS.find(v => v.re.test(words.slice(0, len).join(' ')));
        if (!spec) continue;
        const label = spec.labels.find(l => players.some(p => p.stats.has(l)));
        if (!label) continue;
        const max = Math.max(...players.map(p => p.stats.get(label) ?? 0));
        if (n < max) flag(`sup:${label}`, `superlative "${m[0].trim()}" — the block's highest ${label} figure is ${max} (${players.find(p => p.stats.get(label) === max)?.name}); ${n} is not the most`);
      }

      // (b) Minute gaps between two scorers: "doubled the lead two minutes later".
      const gapM = sentence.match(new RegExp(String.raw`\b(?:(?:just|only|barely)\s+)?${NUMW}\s+minutes?\s+(?:later|after|earlier)|\bwithin\s+${NUMW}\s+minutes?\b`, 'i'));
      if (gapM && events.length) {
        const n = cnt(gapM[1] ?? gapM[2] ?? '');
        const here = mentioned(sentence).map(p => p.surname);
        const scorersHere = events.filter(e => here.some(s => e.scorer.endsWith(s)));
        const prev = events.filter(e => prevScorers.some(s => e.scorer.endsWith(s)));
        const pool = scorersHere.length >= 2 ? scorersHere : [...prev.slice(-1), ...scorersHere];
        if (Number.isFinite(n) && pool.length >= 2) {
          const a = pool[pool.length - 2].minute, b = pool[pool.length - 1].minute;
          const gap = Math.abs(b - a);
          if (Math.abs(gap - n) > 1) flag(gapM[0], `minute gap "${gapM[0].trim()}" — those scores came at ${a}' and ${b}', ${gap} minutes apart`);
        }
      }

      // (c) Substitution counts: "Arsenal completed six substitutions".
      for (const m of sentence.matchAll(new RegExp(String.raw`\b${NUMW}\s+(?:substitutions?|substitutes|changes|subs)\b`, 'gi'))) {
        if (subsBySide.team + subsBySide.opp === 0) break;
        const n = cnt(m[1]);
        const subject = subjectFor(lower, m.index ?? 0, ctx, side);
        if (!subject || !Number.isFinite(n)) continue;
        const actual = subsBySide[subject];
        if (actual !== n) flag(m[0], `substitution count "${m[0]}" — MATCH EVENTS list ${actual} for ${subject === 'team' ? ctx.teamName : ctx.opponent}`);
      }

      // (d) A player's tally in a half: "Semenyo scored twice before half-time".
      const halfM = sentence.match(new RegExp(String.raw`\b(?:scored|crossed|kicked|netted|struck)\s+${NUMW}(?:\s+(?:goals?|tries|times))?\s+(before|after|in|by)\s+(?:the\s+)?(half[- ]?time|halftime|the break|the interval|first half|second half)`, 'i'));
      if (halfM && events.length) {
        const who = nearestPlayerBefore(sentence, halfM.index ?? 0) ?? mentioned(sentence)[0];
        const n = cnt(halfM[1]);
        const half = /second half/i.test(halfM[3]) ? 'second' : /first half/i.test(halfM[3]) ? 'first' : /^after$/i.test(halfM[2]) ? 'second' : 'first';
        if (who && Number.isFinite(n)) {
          const actual = events.filter(e => e.half === half && e.scorer.endsWith(who.surname)).length;
          if (actual !== n) flag(halfM[0], `player half tally "${halfM[0].trim()}" — MATCH EVENTS give ${who.name} ${actual} in the ${half} half`);
        }
      }

      const here = mentioned(sentence).map(p => p.surname);
      if (here.length) prevScorers = here;
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
  // Every "Label: value" pair on a player line ("Run metres: 343", "Goals:
  // 2/4", "Line-break assists: 2"), keyed by label; a figure matching one of
  // these is a player's, never a team total.
  const playerVals = new Map<string, Set<number>>();
  for (const line of dataBlock.matchAll(/^\s+[^\n—]+ — ([^\n]+)$/gm)) {
    for (const kv of line[1].matchAll(/([A-Za-z][A-Za-z0-9 %\-]*?):\s*(\d+(?:\.\d+)?)(?:\/(\d+))?/g)) {
      const k = kv[1].trim();
      const set = playerVals.get(k) ?? playerVals.set(k, new Set()).get(k)!;
      set.add(Math.floor(Number(kv[2])));
      if (kv[3]) set.add(Number(kv[3]));
    }
  }
  const surnames = namedPlayers(dataBlock).map(n => n.split(/\s+/).pop()!.toLowerCase());
  const violations: string[] = [];
  const seen = new Set<string>();
  // Up to three words after the figure; the noun test runs longest-first so
  // "tackle breaks" is not read as "tackle(s)" and "scoring shots" as "scoring".
  const NOUN = String.raw`([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})`;
  const nounSpec = (phrase: string): { noun: string; spec: (typeof VALUE_NOUNS)[number] } | null => {
    const words = phrase.trim().split(/\s+/);
    for (let len = Math.min(3, words.length); len >= 1; len--) {
      const cand = words.slice(0, len).join(' ');
      const spec = VALUE_NOUNS.find(v => v.re.test(cand));
      if (spec) return { noun: cand, spec };
    }
    return null;
  };
  for (const { text, side } of sidedSegments(review, ctx)) {
    const lower = text.toLowerCase();
    const hits: Array<{ idx: number; raw: string; n: number; noun: string }> = [];
    for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,4})\s*%?\s+${NOUN}\b`, 'gi'))) {
      const ns = nounSpec(m[2]);
      if (ns) hits.push({ idx: m.index ?? 0, raw: `${m[1]} ${ns.noun}`, n: Number(m[1]), noun: ns.noun });
    }
    for (const m of text.matchAll(/\b(?:missed|missing)\s+(\d{1,3})\s+tackles\b/gi)) hits.push({ idx: m.index ?? 0, raw: m[0], n: Number(m[1]), noun: 'missed tackles' });
    // "12 more scoring shots" / "45 fewer disposals" → the gap between the sides.
    for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,4})\s+(more|fewer|extra|additional)\s+${NOUN}\b`, 'gi'))) {
      const ns = nounSpec(m[3]);
      const label = ns?.spec.labels.find(l => stats.has(l));
      if (!label) continue;
      const [t, o] = stats.get(label)!;
      const gap = Math.abs(t - o);
      if (Number(m[1]) !== gap && !seen.has(m[0])) {
        seen.add(m[0]);
        violations.push(`stat gap "${m[0]}" — TEAM STATS have ${ctx.teamName} ${t}, ${ctx.opponent} ${o} on ${label}: a gap of ${gap}`);
      }
    }
    for (const h of hits) {
      const spec = VALUE_NOUNS.find(v => v.re.test(h.noun.trim()));
      if (!spec) continue;
      const label = spec.labels.find(l => stats.has(l));
      if (!label) continue;
      if (/^\d+\s+(?:more|fewer|extra|additional)\b/i.test(h.raw)) continue; // handled as a gap above
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
    { re: /\b(?:season[- ]high|season maximum|highest (?:\w+ ){0,3}(?:of|this) (?:the )?season|most (?:goals|points|tries) (?:\w+ ){0,5}this season|than (?:they|[A-Z][\w'’]+(?: [A-Z][\w'’]+)?) (?:have|had) (?:all|this|the whole) (?:season|campaign|year))\b/gi, needs: /most (?:goals|points) .* (?:scored|conceded)/, label: 'a season-high line' },
    { re: /\bfirst time this season\b|\bfor the first time\b(?=[^.]{0,40}(?:season|campaign))/gi, needs: /first time this season/, label: '"first time this season"' },
    { re: /\bfirst (?:defeat|loss) of (?:the|their) (?:season|campaign)\b|\bfirst defeat of any kind\b/gi, needs: /first .*defeat/, label: 'a first-defeat line' },
    { re: /\bfirst (?:win|victory) of (?:the|their) (?:season|campaign)\b/gi, needs: /first .*win/, label: 'a first-win line' },
    // No per-player season data exists anywhere in the block.
    { re: /\b(?:personal|career)[- ](?:high|best)\b|\bbest (?:return|haul|tally) of (?:the|his|her|their) (?:season|career)\b/gi, needs: /(?!)/, label: 'per-player season data (the block carries none)' },
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

/**
 * Numbers the model may legitimately derive: the gap between the two sides on
 * any TEAM STATS line or score pair ("1781 run metres to 1554" → 227). The
 * shared numeral binder only knows literal figures, and was refusing correct
 * arithmetic three ticks running (2026-09-26).
 */
function derivedNumbers(dataBlock: string): Set<number> {
  const out = new Set<number>();
  for (const m of dataBlock.matchAll(/(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?\s*[–-]\s*(\d+(?:\.\d+)?)/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) { out.add(Math.abs(Math.round(a - b))); out.add(Math.round(a + b)); }
  }
  for (const m of dataBlock.matchAll(/(\d+),\s*[A-Z][^\n,]*?\s(\d+)\b/g)) out.add(Math.abs(Number(m[1]) - Number(m[2])));
  return out;
}

/** Full review validation pass. Empty array = clean, safe to cache and serve. */
export function validateReviewOutput(input: AIReview, dataBlock: string): string[] {
  // "1,811 metres" is 1811, not 1 and 811 (the shared numeral binder split it, 2026-09-26).
  const dethousand = (s: string) => s.replace(/(\d),(\d{3})\b/g, '$1$2');
  const review: AIReview = {
    ...input,
    summary:    dethousand(input.summary ?? ''),
    verdict:    input.verdict ? dethousand(input.verdict) : input.verdict,
    keyMoments: (input.keyMoments ?? []).map(k => typeof k === 'string' ? dethousand(k) : k),
    verdicts:   input.verdicts ? Object.fromEntries(Object.entries(input.verdicts).map(([k, v]) => [k, typeof v === 'string' ? dethousand(v) : v])) : input.verdicts,
  };
  const derived = derivedNumbers(dataBlock);
  return validateReviewOutputRaw(review, dataBlock).filter(v => {
    const m = v.match(/^unsourced number "[^"]*" — no figure (\d+) appears/);
    return !(m && derived.has(Number(m[1])));
  });
}

function validateReviewOutputRaw(review: AIReview, dataBlock: string): string[] {
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
    ...validatePlayerFigures(review, dataBlock),
    ...validateHalfCounts(review, dataBlock),
    ...validateScoringOrder(review, dataBlock),
    ...validateSeasonClaims(review, dataBlock),
    ...validateVerdicts(review, dataBlock),
    ...validateReviewPhase(review, dataBlock),
    ...validateReviewStatlines(review, dataBlock),
    ...validateReviewOpener(review, dataBlock),
  ];
}
