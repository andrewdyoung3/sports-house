/**
 * Ollama-backed match-preview generation — shared between the API route (read-only
 * session path) and the standalone `scripts/generate-previews.ts` generator.
 *
 * All Ollama calls, validation, and Supabase upserts live here so the route and
 * the script can never drift.
 *
 * NOT safe to import in client components — uses Node-only modules (fs, OpenAI).
 */

import { appendFileSync } from 'fs';
import OpenAI from 'openai';
import type { AIPreview, UpcomingGame, PreviewContext } from '@/types';
import { SYSTEM_PROMPT, buildDataBlock, collectPlayerWhitelist } from '@/lib/preview-prompt';
import { AI_MODEL } from '@/lib/ai-model';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildPreviewContext } from '@/lib/preview-context';

// ─── Logger ───────────────────────────────────────────────────────────────────

export function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-preview] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// ─── Points-claim validator ───────────────────────────────────────────────────

const WORD_NUM: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
};
const normNum = (s: string): string => WORD_NUM[s.toLowerCase()] ?? s;
const NUM_TOKEN = `\\d+|${Object.keys(WORD_NUM).join('|')}`;

export function validatePointsClaims(output: AIPreview, prompt: string): string[] {
  const violations: string[] = [];
  const outputText = JSON.stringify(output);

  const dfMatch = prompt.match(/DERIVED FACTS[\s\S]*?(?=\n\n[A-Z]|\n\n\n|$)/);
  if (dfMatch) {
    const df = dfMatch[0];
    const derivedNums = new Set(
      [...df.matchAll(/\b(\d+)\b/g)].map(m => m[1]),
    );

    // (1) Gap claims: "<N> points behind/ahead/inside/outside…" — number (digit
    //     OR word) must appear in DERIVED FACTS.
    const claimRe = new RegExp(
      `(${NUM_TOKEN})[-\\s]+(?:competition\\s+)?points?\\s+(?:behind|ahead|adrift|clear|above|below|outside|inside)`,
      'gi',
    );
    for (const m of outputText.matchAll(claimRe)) {
      const n = normNum(m[1]);
      if (!derivedNums.has(n)) {
        violations.push(`standings gap "${m[0].slice(0, 60)}" — ${n} not in DERIVED FACTS`);
      }
    }

    // (2) Points-total claims: "level on/tied on/sit on <N> points" or
    //     "<N> points each/apiece" — the total must appear in DERIVED FACTS
    //     (catches reciting the round number as a points total).
    const totalRe = new RegExp(
      `(?:level(?:\\s+(?:on|with))?|tied(?:\\s+(?:on|at))?|sit(?:ting)?\\s+on|locked(?:\\s+(?:on|at))?)\\s+(${NUM_TOKEN})\\s+(?:competition\\s+)?points?`,
      'gi',
    );
    const totalRe2 = new RegExp(
      `(${NUM_TOKEN})\\s+(?:competition\\s+)?points?\\s+(?:each|apiece|respectively|both)`,
      'gi',
    );
    for (const re of [totalRe, totalRe2]) {
      for (const m of outputText.matchAll(re)) {
        const n = normNum(m[1]);
        if (!derivedNums.has(n)) {
          violations.push(`points total "${m[0].slice(0, 60)}" — ${n} not in DERIVED FACTS`);
        }
      }
    }

    // (3) Direction inversion: DERIVED FACTS states "<N> points inside|outside the
    //     finals places". If the output claims the SAME number with the OPPOSITE
    //     direction (e.g. derived "2 inside", output "two points outside the top
    //     eight"), that is a contradiction.
    const derivedDir = new Map<string, Set<string>>(); // num → {inside,outside}
    for (const m of df.matchAll(/(\d+)\s+points?\s+(inside|outside)\s+the\s+finals/gi)) {
      const n = m[1];
      if (!derivedDir.has(n)) derivedDir.set(n, new Set());
      derivedDir.get(n)!.add(m[2].toLowerCase());
    }
    const outDirRe = new RegExp(
      `(${NUM_TOKEN})\\s+points?\\s+(inside|outside)\\s+the\\s+(?:top\\s+\\w+|finals|eight)`,
      'gi',
    );
    for (const m of outputText.matchAll(outDirRe)) {
      const n   = normNum(m[1]);
      const dir = m[2].toLowerCase();
      const opp = dir === 'inside' ? 'outside' : 'inside';
      const dd  = derivedDir.get(n);
      if (dd && dd.has(opp) && !dd.has(dir)) {
        violations.push(`standings direction "${m[0].slice(0, 60)}" — DERIVED FACTS says ${n} points ${opp}, not ${dir}`);
      }
    }
  }

  const expertMarginMatch = prompt.match(/average predicted winning margin:\s*(\d+)\s*points/i);
  if (expertMarginMatch) {
    const expertMargin = parseInt(expertMarginMatch[1], 10);
    const tolerance    = expertMargin * 0.25;
    const marginRe = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:point[s]?\s+(?:margin|win|victory|lead|defeat)|point[s]?\s+is\s+(?:likely|probable|expected))/gi;
    for (const m of outputText.matchAll(marginRe)) {
      const lo  = parseInt(m[1], 10);
      const hi  = m[2] ? parseInt(m[2], 10) : lo;
      const mid = (lo + hi) / 2;
      if (Math.abs(mid - expertMargin) > tolerance) {
        violations.push(`margin claim "${m[0].slice(0, 60)}" (mid=${mid}) — expert margin is ${expertMargin} pts, outside ±25%`);
      }
    }
  }

  return violations;
}

/**
 * Phase/stakes binding: when the data block's FIXTURE CONTEXT declares a knockout
 * final (GRAND FINAL / FINALS — e.g. the Super Rugby decider), the prose must not
 * frame the game as a regular-season fixture, a dead rubber, or having "no bearing"
 * — the phase line is authoritative. The feed gives no stage label for these games,
 * so the model is prone to reading the regular-season ladder literally.
 */
function validatePhaseStakes(output: AIPreview, prompt: string): string[] {
  const isFinal = /Stakes:\s*(GRAND FINAL|FINALS)\b/.test(prompt)
    || /SEASON STATE: FINALS SERIES —/.test(prompt);
  if (!isFinal) return [];
  const factual = [output.context, output.tacticalBattle, output.verdict, ...(output.keyInsights ?? [])].join('  ');
  const badRe = /\b(regular[- ]season (?:fixture|game|match|clash|round|dead rubber)|final regular[- ]season|dead rubber|no bearing on (?:qualification|finals|the finals|seeding)|nothing (?:to play for|at stake)|minor premiership|end-of-season (?:fixture|clash))\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(badRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`phase contradiction "${m[0]}" — FIXTURE CONTEXT says this is a knockout final, not a regular-season/dead-rubber game`);
  }
  return violations;
}

/**
 * World Cup group-record binding: the GROUP DERIVED FACTS block states each team's
 * group games played. A team that has played ≤1 group game cannot have a two-result
 * group record — so a "win and a draw" / "one win and one loss" / "two wins" style
 * claim in the context field is the all-competitions-form-conflation error (reading
 * the RECENT FORM line as the group record). Reject → retry.
 */
/**
 * F1 championship-gap binding: the model miscalculates points margins ("121-point
 * lead over Red Bull" when the real gap is 173). When CHAMPIONSHIP DERIVED FACTS is
 * present, any "<N> point(s) lead/gap/behind/ahead/clear" in the prose must cite a
 * number that actually appears in the F1 data block (standings or derived gaps).
 */
export function validateF1ChampionshipClaims(output: AIPreview, prompt: string): string[] {
  if (!/CHAMPIONSHIP DERIVED FACTS/.test(prompt)) return [];
  const promptNums = new Set([...prompt.matchAll(/\b(\d+)\b/g)].map(m => m[1]));
  const factual = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])].join('  ');
  const gapRe = /(\d+)[-\s]?(?:point|pt|points)s?\s+(?:lead|gap|advantage|ahead|behind|clear|adrift|deficit)|(?:lead|ahead of|behind|trail\w*)\s+[^.]*?\bby\s+(\d+)\s*(?:point|pt|points)?/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(gapRe)) {
    const n = m[1] ?? m[2];
    if (!n || promptNums.has(n) || seen.has(n)) continue;
    seen.add(n);
    violations.push(`F1 championship gap "${m[0].slice(0, 50)}" — ${n} is not a figure in the data block; use the CHAMPIONSHIP DERIVED FACTS gaps verbatim`);
  }
  return violations;
}

export function validateWorldCupGroupRecord(output: AIPreview, prompt: string): string[] {
  if (!/GROUP\s+\S+\s+DERIVED FACTS/.test(prompt)) return [];
  // team → group games played, parsed from the derived-facts lines.
  const played = new Map<string, number>();
  for (const m of prompt.matchAll(/•\s*(.+?):\s*\d+ group points? from (\d+) game/gi)) {
    played.set(m[1].trim().toLowerCase(), parseInt(m[2], 10));
  }
  const ctx = output.context ?? '';
  const violations: string[] = [];
  const seen = new Set<string>();

  // (a) ARITHMETIC IMPOSSIBILITY (count-based, not phrasing-based): a team that has
  //     played N group games has at most N group results. Count the result-outcomes
  //     claimed in a RECORD framing and reject when they exceed games played — this
  //     catches any wording, including ones never enumerated. Scoped to avoid false
  //     positives on conditionals ("a win would…") and legit all-comps form refs.
  const playedVals = [...played.values()];
  if (playedVals.length > 0) {
    const nMin = Math.min(...playedVals);
    const RES = /\b(wins?|won|victor(?:y|ies)|loss(?:es)?|lost|defeats?|defeated|beaten|draws?|drew|tie[ds]?|tied)\b/gi;
    const PAST = /\b(won|lost|drew|beaten|defeated|tied)\b/i;
    const multOf = (w: string): number => (({ two: 2, '2': 2, both: 2, three: 3, '3': 3 }) as Record<string, number>)[w.toLowerCase()] ?? 1;

    // Locate every result token with its outcome-count (a count word adjacent before/after).
    const hits: Array<{ idx: number; end: number; n: number; tok: string }> = [];
    for (const m of ctx.matchAll(RES)) {
      const i = m.index ?? 0;
      const before = (ctx.slice(Math.max(0, i - 12), i).trim().split(/\s+/).pop() ?? '');
      const after  = (ctx.slice(i + m[0].length).match(/^\s+(\w+)/)?.[1] ?? '');
      hits.push({ idx: i, end: i + m[0].length, n: Math.max(multOf(before), multOf(after)), tok: m[0] });
    }

    // Cluster adjacent result tokens (within 35 chars) → a single record phrase.
    for (let i = 0; i < hits.length;) {
      let j = i, outcomes = hits[i].n;
      while (j + 1 < hits.length && hits[j + 1].idx - hits[j].end <= 35) { j++; outcomes += hits[j].n; }
      if (outcomes > nMin) {
        const start = hits[i].idx, fin = hits[j].end;
        const phrase = ctx.slice(start, fin);
        const lead   = ctx.slice(Math.max(0, start - 30), start);
        const around = ctx.slice(Math.max(0, start - 55), fin + 45);
        const isRecord     = PAST.test(phrase) || /\b(with|have|has|hold(?:ing)?|after|from|record|to (?:their|its) name|both|each|sit(?:ting)? on|level on)\b/i.test(lead);
        const isConditional = /\b(would|could|should|if|might|may|will)\b|'d\b/i.test(around);
        const oppAttached   = /\b(?:to|against|over|beat|def\.?|past|by|versus|vs\.?)\s+[A-ZÀ-Þ]/.test(around);
        const formFramed    = /\b(form|all competitions|recent(?:ly)?|qualifier|friendl|warm-?up|last (?:five|5))\b/i.test(around);
        if (isRecord && !isConditional && !oppAttached && !formFramed) {
          violations.push(`WC group-record arithmetic "${phrase.slice(0, 55)}" — implies ${outcomes} group results, but a tracked team has played only ${nMin} group game(s); a one-game record is a single result (see GROUP DERIVED FACTS)`);
        }
      }
      i = j + 1;
    }
  }

  // (b) Over-claimed qualification: if the derived facts mark NO tracked team as
  //     mathematically secured/through, prose must not assert qualification.
  const someoneThrough = /(mathematically secured a top-2|through to the Round of 32|finished in the automatic top 2)/i.test(prompt);
  if (!someoneThrough) {
    const overclaimRe = /\b(guaranteed (?:a )?(?:top-two|top two|qualification|progression|advancement)|already qualified|assured of (?:qualification|a top-two|progression)|through to the (?:round of 32|knockout)|secured (?:qualification|a top-two|progression|their place)|no (?:immediate )?(?:impact|bearing) on (?:advancement|qualification)|nothing to play for)\b/gi;
    for (const m of ctx.matchAll(overclaimRe)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`WC over-claim "${m[0]}" — no tracked team is mathematically through per GROUP DERIVED FACTS; a current top-2 position is NOT secured qualification`);
    }
  }
  return violations;
}

/**
 * WC group-letter binding. The fixture's group is stated authoritatively in the
 * data block (THIS FIXTURE IS IN GROUP <X> / GROUP <X> DERIVED FACTS), sourced from
 * world-cup.ts. The model has hallucinated a different letter ("Group F" for a Group
 * D fixture). Reject when prose names a single group letter that differs from the
 * fixture's — but stay conservative: a wrong letter inside a best-third / cross-group
 * clause ("the best third-placed teams across the groups") is a legitimate collective
 * reference, not a mis-stamp of THIS fixture, so it is allowed.
 */
export function validateWorldCupGroupLetter(output: AIPreview, prompt: string): string[] {
  const m = prompt.match(/THIS FIXTURE IS IN GROUP ([A-L])\b/)
    ?? prompt.match(/GROUP ([A-L]) DERIVED FACTS/)
    ?? prompt.match(/GROUP ([A-L]) (?:STANDINGS|COMPOSITION)/);
  if (!m) return [];
  const correct = m[1];
  const text = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].filter(Boolean).join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const mm of text.matchAll(/\bGroup\s+([A-L])\b/g)) {
    const letter = mm[1];
    if (letter === correct || seen.has(letter)) continue;
    const i = mm.index ?? 0;
    const around = text.slice(Math.max(0, i - 80), i + 80).toLowerCase();
    if (/third|best[-\s]third|across|other group|all 12 group|12 groups|each group|every group/.test(around)) continue;
    seen.add(letter);
    violations.push(`WC group letter "Group ${letter}" — this fixture is in Group ${correct} (see GROUP ${correct} DERIVED FACTS); name the group verbatim and do not introduce another group letter`);
  }
  return violations;
}

function validateFinalsImminence(output: AIPreview, prompt: string): string[] {
  const phaseMatch = prompt.match(/SEASON STATE:.*?\(phase:\s*([^)]+)\)/i);
  if (!phaseMatch) return [];
  const phase = phaseMatch[1].trim().toLowerCase();
  if (phase === 'run home' || phase.startsWith('run home') || phase.startsWith('finals')) return [];

  const imminenceRe = /finals\s+(?:(?:just\s+)?(?:around\s+the\s+corner|looming|approaching|weeks?\s+away|months?\s+away|not\s+far)|are\s+(?:near|close|imminent))|playoffs?\s+(?:looming|approaching|near|close|imminent|weeks?\s+away)/gi;
  const outputText = JSON.stringify(output);
  const violations: string[] = [];
  for (const m of outputText.matchAll(imminenceRe)) {
    violations.push(`finals-imminence language "${m[0].slice(0, 80)}" in ${phase} phase`);
  }
  return violations;
}

/**
 * Catches invented per-player statlines. When the data block contains NO KEY
 * PERFORMERS section, the model has no grounded per-player numbers, so any stat
 * like "two tries", "18 tackles", "3 turnovers" attached in the factual fields is
 * fabricated. Scans only the factual fields (mediaWatch is attributed editorial
 * and may legitimately echo a real headline's numbers). Excludes "points"/"goals"
 * — those collide with competition points and team scorelines.
 */
function validateInventedStatlines(output: AIPreview, prompt: string): string[] {
  if (/^KEY PERFORMERS/m.test(prompt)) return []; // grounded stats may be present
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const statRe = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(tries|try|assists?|tackles?|turnovers?|line[\s-]?breaks?|tackle[\s-]?busts?|carries|offloads?|rebounds?|steals?|blocks?|interceptions?)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(statRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`invented player statline "${m[0]}" — no KEY PERFORMERS data provided for this fixture`);
  }
  return violations;
}

/**
 * Catches invented calendar years. The data block deliberately omits past years
 * (form/H2H carry no dates), so any year in the factual fields that does NOT appear
 * in the prompt (e.g. competition labels like "World Cup 2026") is fabricated —
 * the classic "winless in 2024" failure. Scans factual fields only.
 */
function validateInventedYears(output: AIPreview, prompt: string): string[] {
  const promptYears = new Set([...prompt.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m => m[0]));
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    if (promptYears.has(m[0]) || seen.has(m[0])) continue;
    seen.add(m[0]);
    violations.push(`invented year "${m[0]}" — not present in the data block`);
  }
  return violations;
}

const PLAYER_NAME_SAFE_WORDS = new Set([
  'premier', 'league', 'champions', 'europa', 'conference', 'cup', 'final',
  'finals', 'series', 'grand', 'super', 'rugby', 'football', 'soccer',
  'cricket', 'season', 'round', 'phase', 'preliminary', 'semi', 'quarter',
  'trophy', 'stage', 'world', 'national', 'international', 'premiership',
  'championship', 'division', 'competition', 'association', 'pacific',
  'magic', 'regular', 'origin', 'state', 'group',
  'north', 'south', 'east', 'west', 'central', 'united', 'city', 'town',
  'park', 'ground', 'stadium', 'arena', 'oval', 'field', 'harbour',
  'harbor', 'bay', 'lake', 'river',
  'australian', 'american', 'english', 'british', 'french', 'spanish',
  'irish', 'welsh', 'scottish', 'zealand', 'african', 'european', 'asian',
  'home', 'away', 'neutral', 'match', 'game', 'fixture',
  'if', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'when', 'but', 'and',
  'or', 'as', 'by', 'of', 'to', 'that', 'this', 'there', 'their', 'his',
  'her', 'its', 'while', 'although', 'despite', 'with', 'without', 'both',
  'these', 'those', 'what', 'which', 'who', 'whose', 'how', 'whether',
  'once', 'since', 'given', 'despite', 'against', 'throughout', 'across',
  'between', 'within', 'beyond', 'before', 'after', 'during', 'through',
]);

export function validatePlayerNames(output: AIPreview, prompt: string): string[] {
  const { whitelist, hasPlayerData } = collectPlayerWhitelist(prompt);

  const fixtureM = prompt.match(/^FIXTURE:\s*(.+?)\s+vs\s+(.+)$/m);
  const teamName     = fixtureM?.[1]?.trim() ?? '';
  const opponentName = fixtureM?.[2]?.trim() ?? '';

  const compM = prompt.match(/^COMPETITION:\s*(.+)$/m);
  const competition = compM?.[1]?.trim() ?? '';

  // The VENUE line carries a stadium name (e.g. "McDonald Jones Stadium") that the
  // model legitimately references; its words must not be flagged as player names.
  const venueM = prompt.match(/^VENUE:\s*([^—\n]+)/m);
  const venueName = venueM?.[1]?.trim() ?? '';

  // Expand a name token into the forms the validator's matcher may produce.
  // The name regex breaks internal-capital surnames (e.g. "O'Brien" → "Brien"),
  // so also surface the substring after an apostrophe.
  const expandWord = (w: string): string[] => {
    const out = [w];
    if (w.includes("'") || w.includes('’')) {
      const tail = w.split(/['’]/).pop();
      if (tail && tail.length > 1) out.push(tail);
    }
    return out;
  };

  const excluded = new Set(PLAYER_NAME_SAFE_WORDS);
  for (const w of `${teamName} ${opponentName} ${competition} ${venueName}`.toLowerCase().split(/\s+/)) {
    if (w) for (const e of expandWord(w)) excluded.add(e);
  }
  for (const name of whitelist) {
    for (const w of name.split(/\s+/)) for (const e of expandWord(w)) excluded.add(e);
  }

  const whitelistWords = new Set<string>();
  for (const entry of whitelist) {
    for (const w of entry.split(/\s+/)) {
      for (const e of expandWord(w)) if (e.length >= 3) whitelistWords.add(e);
    }
  }

  // When player data is present we scan the whole output. Otherwise we scan the
  // factual playerSpotlight PLUS the attributed mediaWatch — names invented in
  // either are caught, while real names from the fetched headlines pass because
  // collectPlayerWhitelist added them to the whitelist.
  const textToScan = hasPlayerData
    ? JSON.stringify(output)
    : `${output.playerSpotlight ?? ''} ${(output.mediaWatch ?? []).join(' ')}`;

  const violations: string[] = [];
  const seen = new Set<string>();

  const nameRe = /\b([A-Z][a-zÀ-ÿ'\-]{1,}(?:\s+[A-Z][a-zÀ-ÿ'\-]{1,})+)\b/g;
  for (const m of textToScan.matchAll(nameRe)) {
    const candidate = m[1];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const stripped = candidate.replace(/'s\b/gi, '').trim();
    const lower    = stripped.toLowerCase();
    const words    = lower.split(/\s+/);

    // A real name word is ≥2 chars; single letters (group letters like "D" in
    // "Group D's", stray initials) are structural tokens, never surnames — treat
    // them as non-evidence so possessive group labels don't trip the validator.
    if (words.every(w => excluded.has(w) || w.length < 2)) continue;
    if (teamName.toLowerCase().includes(lower) || opponentName.toLowerCase().includes(lower)) continue;
    if (competition.toLowerCase().includes(lower)) continue;
    if (whitelist.has(lower)) continue;
    if ([...whitelist].some(entry => entry.includes(lower) || lower.includes(entry))) continue;
    const nonSafeWords = words.filter(w => !excluded.has(w) && w.length >= 2);

    if (!hasPlayerData) {
      if (nonSafeWords.length < 2) continue;
    } else {
      if (nonSafeWords.every(w => whitelistWords.has(w))) continue;
    }

    violations.push(hasPlayerData
      ? `player name "${candidate}" not in provided lineup/squad/injury data`
      : `player name "${candidate}" invented — no player data was provided for this fixture`
    );
  }

  return violations;
}

// ─── Ollama client ────────────────────────────────────────────────────────────

const ollamaClient = new OpenAI({
  baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
  apiKey:  'ollama',
  timeout: 15 * 60 * 1000,
});

// ─── mediaWatch enforcement ───────────────────────────────────────────────────

/**
 * mediaWatch may carry content ONLY when a FROM THE MEDIA block was actually
 * supplied in the data block. The model reliably ignores the prompt's "if no media
 * block, OMIT mediaWatch" instruction and fabricates attributed lines ("Reports
 * suggest…", "The tipsters lean toward…") — which are exempt from the name/stat
 * validators because mediaWatch is treated as attributed editorial. So enforce it
 * deterministically (same principle as binding standings to DERIVED FACTS): if the
 * data block carried no FROM THE MEDIA section, strip mediaWatch to empty before
 * storing. A retry is not enough — the model overrides retry nudges; the strip is
 * robust to non-compliance. When a media block WAS supplied, leave it untouched
 * (it is relaying real, attributed content).
 */
function stripUnsourcedMediaWatch(output: AIPreview, prompt: string): AIPreview {
  if (/^FROM THE MEDIA/m.test(prompt)) return output;        // real source present — keep
  if (!output.mediaWatch || output.mediaWatch.length === 0) return output;
  aiLog(`mediaWatch-strip: removed ${output.mediaWatch.length} unsourced item(s) (no FROM THE MEDIA block)`);
  return { ...output, mediaWatch: [] };
}

// ─── Ollama call ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for the output validator set. Run the full faithfulness
 * suite over a candidate preview and return every violation. Used by both the
 * generate-with-retry path and the storage gate so the two can never drift.
 */
function collectViolations(v: AIPreview, prompt: string): string[] {
  return [
    ...validatePointsClaims(v, prompt),
    ...validateFinalsImminence(v, prompt),
    ...validatePhaseStakes(v, prompt),
    ...validateWorldCupGroupRecord(v, prompt),
    ...validateWorldCupGroupLetter(v, prompt),
    ...validateF1ChampionshipClaims(v, prompt),
    ...validatePlayerNames(v, prompt),
    ...validateInventedStatlines(v, prompt),
    ...validateInventedYears(v, prompt),
  ];
}

/**
 * Generate a preview (with a one-shot retry on validation failure) and return it
 * ALONGSIDE any violations that remain after the retry. The caller — never this
 * function — decides what to do with a still-violating preview (REL-1: the
 * storage gate refuses to persist it). The validators are unchanged; this only
 * stops their result from being silently discarded at the boundary.
 */
export async function callOllamaValidated(
  prompt: string,
  compact = false,
  maxTokensOverride?: number,
  modelOverride?: string,
): Promise<{ preview: AIPreview; violations: string[] }> {
  const doGenerate = async (): Promise<AIPreview> => {
    const response = await ollamaClient.chat.completions.create({
      model:      modelOverride ?? AI_MODEL,
      // Non-compact ceiling is 6000 (headroom for richer future prompts; current
      // previews land well under 1000 tokens so this never costs anything today).
      // compact (2500) is unreachable on the main preview path — generateAndStorePreview
      // always passes compact=false — and is left untouched.
      max_tokens: maxTokensOverride ?? (compact ? 2500 : 6000),
      messages:   [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    });
    const raw          = response.choices[0]?.message?.content ?? '{}';
    const withoutThink = raw.includes('</think>') ? raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '') : raw;
    const cleaned      = withoutThink.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned) as AIPreview;
    } catch {
      aiLog(`parse-fail raw_len=${raw.length} first300=${JSON.stringify(cleaned.slice(0, 300))}`);
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd   = cleaned.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as AIPreview;
      }
      throw new SyntaxError(`Non-JSON model output (len=${raw.length}): ${cleaned.slice(0, 120)}`);
    }
  };

  const model  = modelOverride ?? AI_MODEL;
  const t0     = Date.now();
  aiLog(`start model=${model} compact=${compact}`);

  let result: AIPreview;
  try {
    result = await doGenerate();
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    aiLog(`total-parse-fail elapsed=${Date.now() - t0}ms — retrying model call`);
    result = await doGenerate();
  }

  const violations = collectViolations(result, prompt);
  if (violations.length === 0) {
    aiLog(`done elapsed=${Date.now() - t0}ms`);
    return { preview: stripUnsourcedMediaWatch(result, prompt), violations: [] };
  }

  aiLog(`validation-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — retrying`);
  try {
    const retry      = await doGenerate();
    const retryViols = collectViolations(retry, prompt);
    if (retryViols.length === 0) {
      aiLog(`retry-ok elapsed=${Date.now() - t0}ms`);
      return { preview: stripUnsourcedMediaWatch(retry, prompt), violations: [] };
    }
    // Both attempts violate — surface the better attempt AND its remaining
    // violations so the caller can refuse to store (REL-1). We no longer return a
    // "clean-looking" first attempt that silently buries caught hallucinations.
    aiLog(`retry-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(retryViols)} — both attempts violate, will not store`);
    const best = retryViols.length < violations.length
      ? { preview: retry,  violations: retryViols }
      : { preview: result, violations };
    return { preview: stripUnsourcedMediaWatch(best.preview, prompt), violations: best.violations };
  } catch (e) {
    aiLog(`retry-error elapsed=${Date.now() - t0}ms err=${e}`);
    return { preview: stripUnsourcedMediaWatch(result, prompt), violations };
  }
}

/**
 * Back-compat wrapper: returns just the preview. Prefer callOllamaValidated on any
 * path that persists output so caught violations can block storage.
 */
export async function callOllama(
  prompt: string,
  compact = false,
  maxTokensOverride?: number,
  modelOverride?: string,
): Promise<AIPreview> {
  return (await callOllamaValidated(prompt, compact, maxTokensOverride, modelOverride)).preview;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

/**
 * DAT-3: stable fingerprint of the news-ish signals that should trigger a future
 * regeneration (headlines + injuries + named squad). Persisted to
 * game_previews.news_fingerprint so the column is no longer permanently NULL and a
 * later staleness trigger can compare it (the trigger itself is deferred — see
 * CHANGES.md). Mirrors the client's buildFingerprint in spirit (sorted, hashed);
 * results/weather are intentionally excluded here (the client folds those into its
 * own localStorage cache key).
 */
export function computeNewsFingerprint(ctx: Partial<PreviewContext>): string | null {
  const headlines = [
    ...(ctx.teamNews ?? []).map(n => n.headline),
    ...(ctx.opponentNews ?? []).map(n => n.headline),
  ].sort();
  const injuries = [
    ...(ctx.teamInjuryReport ?? []).map(i => `${i.name}:${i.status}`),
    ...(ctx.opponentInjuryReport ?? []).map(i => `${i.name}:${i.status}`),
  ].sort();
  const squad = [
    ...(ctx.teamSquad ?? []),
    ...(ctx.opponentSquad ?? []),
  ].sort().join(',').slice(0, 80);
  if (headlines.length === 0 && injuries.length === 0 && squad.length === 0) return null;
  const parts = [...headlines, ...injuries, squad].join('\x00');
  return Buffer.from(parts).toString('base64').slice(0, 48);
}

export function isValidPreview(v: unknown): v is AIPreview {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.context          === 'string' && p.context.length > 0 &&
    typeof p.tacticalBattle   === 'string' && p.tacticalBattle.length > 0 &&
    typeof p.playerSpotlight  === 'string' && p.playerSpotlight.length > 0 &&
    typeof p.verdict          === 'string' && p.verdict.length > 0 &&
    Array.isArray(p.keyInsights) && (p.keyInsights as unknown[]).length > 0
  );
}

export async function upsertPreview(
  gameId: string,
  payload: AIPreview,
  model: string,
  newsFingerprint: string | null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) { aiLog('upsert-skip: admin client not configured'); return; }
  const { error } = await admin.from('game_previews').upsert(
    { game_id: gameId, payload, model, news_fingerprint: newsFingerprint, updated_at: new Date().toISOString() },
    { onConflict: 'game_id' },
  );
  if (error) aiLog(`upsert-fail gameId=${gameId} err=${error.message}`);
  else        aiLog(`upsert-ok   gameId=${gameId} model=${model}`);
}

// ─── High-level orchestrator ──────────────────────────────────────────────────

/**
 * Generates a match preview for the given fixture (using Ollama) and upserts
 * the result to Supabase. Designed to be called server-side or from the
 * standalone generator script — never from the browser.
 *
 * Builds a rich context (standings, WC group, managers) via buildPreviewContext,
 * then merges any caller-provided enrichment (form/news/lineups from the API
 * route). All entry points — heartbeat, poller, regen — converge here.
 */
export async function generateAndStorePreview(
  league: string,
  fixture: UpcomingGame,
  teamName: string,
  previewContext?: Partial<PreviewContext>,
): Promise<{ ok: boolean; error?: string }> {
  const isF1      = league === 'f1';
  // Non-F1 falls through to callOllama's 6000 default. F1 previews are longer
  // (driver + constructor + championship detail); keep them at the same ceiling.
  const maxTokens = isF1 ? 6000 : undefined;

  try {
    // Build the canonical base context (standings + WC group + managers).
    // Results are cached per league — safe for batch heartbeat runs.
    const baseCtx = await buildPreviewContext(league, fixture, teamName);
    // Merge: baseCtx provides structure; previewContext adds form/news/lineups.
    const ctx = { ...baseCtx, ...previewContext } as PreviewContext;

    const prompt = buildDataBlock(
      league,
      teamName,
      fixture.opponent,
      ctx,
      [],
      [],
      fixture.competition,
      false,
      undefined,
      fixture.venue,
      fixture.isHome,
      fixture.teamId,
      fixture.opponentId,
      fixture.seriesSummary,
    );

    const { preview, violations } = await callOllamaValidated(prompt, false, maxTokens);

    // REL-1: the validators are the faithfulness backbone — never store output that
    // still violates them after the retry. Returning ok:false marks the job failed
    // (poller retries up to MAX_ATTEMPTS); a missing preview is strictly better than
    // a persisted one that asserts wrong facts. Do NOT relax this to "store anyway".
    if (violations.length > 0) {
      aiLog(`refuse-store gameId=${fixture.id} violations=${JSON.stringify(violations)}`);
      return { ok: false, error: `validation: ${violations.join('; ')}`.slice(0, 480) };
    }

    if (isValidPreview(preview)) {
      const newsFingerprint = computeNewsFingerprint(ctx);  // DAT-3
      await upsertPreview(fixture.id, preview, AI_MODEL, newsFingerprint);
      // Representative games (State of Origin) key per perspective on the display
      // side — upsert the SAME payload under the mirror key(s) so both resolve.
      for (const mirrorId of fixture.mirrorGameIds ?? []) {
        await upsertPreview(mirrorId, preview, AI_MODEL, newsFingerprint);
      }
      return { ok: true };
    }

    aiLog(`invalid-preview gameId=${fixture.id}`);
    return { ok: false, error: 'invalid preview shape' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    aiLog(`generate-fail gameId=${fixture.id} err=${msg}`);
    return { ok: false, error: msg };
  }
}
