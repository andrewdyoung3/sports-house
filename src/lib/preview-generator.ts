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
import { TEAMS } from '@/lib/teams';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildPreviewContext } from '@/lib/preview-context';

// ─── Logger ───────────────────────────────────────────────────────────────────

export function aiLog(msg: string) {
  const line = `[${new Date().toISOString()}] [ai-preview] ${msg}\n`;
  try { appendFileSync('/tmp/sporthouse-ai.log', line); } catch { /* non-fatal */ }
  console.log(msg);
}

// ─── Points-claim validator ───────────────────────────────────────────────────

/**
 * Points-claim binding — three related checks.
 *
 * Incident A — level-on-points figure not emitted (commit 1532a7e): when two teams
 *   were level on points, buildDerivedFacts didn't emit the shared figure, so correct
 *   prose like "level on 36 competition points" was rejected because 36 was absent
 *   from DERIVED FACTS. Fixed by emitting the shared figure; this check became the
 *   backstop for direction-correct totals.
 * Incident B — direction inversion: model said "2 points outside the finals" when
 *   DERIVED FACTS said "2 inside". Caught by the derivedDir map + outDirRe check.
 * Incident C — expert-margin divergence: model cited a margin well outside the
 *   Squiggle-tip predicted window. Caught when expert margin is present in the prompt.
 */
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
 *
 * Incident: AFL/NRL finals previews described confirmed-finals fixtures as
 *   "regular-season" or "dead rubbers" because the feed carries no stage label and
 *   the model read only the ladder context (commit ac36fed).
 */
function validatePhaseStakes(output: AIPreview, prompt: string): string[] {
  // NB: FINALS must not match the regular-season stakes FINALS RACE / FINALS
  // LOCKED — those are ladder games, where "dead rubber" prose can be accurate.
  const isFinal = /Stakes:\s*(?:GRAND FINAL\b|FINALS\b(?!\s+(?:RACE|LOCKED)))/.test(prompt)
    || /SEASON STATE: FINALS SERIES —/.test(prompt);
  if (!isFinal) return [];
  const factual = [output.context, output.tacticalBattle, output.verdict, ...(output.keyInsights ?? [])].join('  ');
  const badRe = /\b(regular[- ]season (?:fixture|game|match|clash|round|dead rubber)|final regular[- ]season|dead rubber|no bearing on (?:qualification|finals|the finals|seeding)|nothing (?:to play for|at stake)|minor premiership|end-of-season (?:fixture|clash)|finals (?:berth|qualification|race)|top[- ]?(?:\d+|four|five|six|eight|ten)[- ](?:berth|spot|place|race))\b/gi;
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
 * WC knockout-stakes binding: when the data block declares SINGLE-ELIMINATION
 * (emitted by the knockout block for R32/R16/QF/SF/Final), the prose must not
 * use dead-rubber language — every knockout match is always high-stakes.
 * Same design as validatePhaseStakes; bound to the STAGE & STAKES marker.
 */
/**
 * F1 championship-gap binding: the model miscalculates points margins ("121-point
 * lead over Red Bull" when the real gap is 173). When CHAMPIONSHIP DERIVED FACTS is
 * present, any "<N> point(s) lead/gap/behind/ahead/clear" in the prose must cite a
 * number that actually appears in the F1 data block (standings or derived gaps).
 *
 * Incident: "121-point lead over Red Bull" when the data block's own CHAMPIONSHIP
 *   DERIVED FACTS stated 173 — the model was computing the gap from memory rather
 *   than from the provided figures (derived-facts Phase C).
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

/**
 * Finals-imminence language guard. When SEASON STATE is NOT in the run-home or
 * finals phase, the prose must not use "finals are just around the corner" language
 * — that framing is factually wrong in early/mid-season and conflicts with the
 * declared phase.
 *
 * Incident: early/mid-season previews (rounds 5–10) wrote "finals are looming"
 *   regardless of phase, because the model defaulted to building narrative tension
 *   without checking the phase signal.
 */
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

// ─── Ladder-position validator ─────────────────────────────────────────────────

const ORDINAL_WORD: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20,
};
const ordinalToNum = (s: string): number | null => {
  const w = s.toLowerCase();
  if (ORDINAL_WORD[w] !== undefined) return ORDINAL_WORD[w];
  const m = w.match(/^(\d+)(?:st|nd|rd|th)$/);
  return m ? parseInt(m[1], 10) : null;
};
const ordSuffix = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

/**
 * Ladder-position binding (the 8→7 "occupy 7th" class). buildDerivedFacts emits one
 * authoritative `LADDER POSITION` fact per fixture team; the prose must not state a
 * DIFFERENT positional ordinal for either team. Deterministic — reject → retry →
 * refuse-to-store (REL-1). Tightly scoped to ordinals in a POSITIONAL context near a
 * fixture team so "4-point lead", "top 10", "fourth straight win", "third quarter"
 * never fire.
 *
 * Incident (commit 447d216): Brisbane Lions were 8th on the ladder; the wildcard-
 *   band description "7th–10th" in the derived facts caused the model to write
 *   "occupy 7th". Fixed by emitting the authoritative LADDER POSITION ordinal as a
 *   separate leading sentence, before the zone text, so the two cannot be conflated.
 */
export function validateLadderPosition(output: AIPreview, prompt: string): string[] {
  // PRE-SEASON: no standings exist — any positional claim is fabricated from
  // placeholder rows or training memory (live catch: "seventh in the East"
  // in the NBA opener, sourced from a played-0 alphabetical table).
  if (/^PRE-SEASON: the new season has NOT started/m.test(prompt)) {
    const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
      .filter(Boolean).join('  ');
    const posRe = /\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+(?:in|on|of)\s+the\s+(?:east|west|ladder|table|standings|league|conference)\b|\bsit(?:s|ting)?\s+(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi;
    const v: string[] = [];
    for (const m of text.matchAll(posRe)) {
      v.push(`pre-season position claim "${m[0]}" — the season has not started; no standings exist to cite`);
    }
    if (v.length > 0) return v;
  }
  // 1. Authoritative positions from the LADDER POSITION derived fact.
  const factLine = prompt.match(/LADDER POSITION[^\n]*?:\s*([^\n]+)/);
  if (!factLine) return [];
  const expected: { name: string; pos: number; tokens: string[] }[] = [];
  for (const m of factLine[1].matchAll(/([A-Za-zÀ-ÿ][\w .'&-]+?)\s*[—–-]\s*(\d+)(?:st|nd|rd|th)\s+of\s+\d+/g)) {
    const name   = m[1].trim();
    const pos    = parseInt(m[2], 10);
    const tokens = name.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    if (tokens.length > 0) expected.push({ name, pos, tokens });
  }
  if (expected.length === 0) return [];

  // 2. Factual prose only (mediaWatch is attributed editorial).
  const prose = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ').toLowerCase();

  // 3. Positional-ordinal claims (two directions; non-positional nouns excluded).
  const ORD = `\\d+(?:st|nd|rd|th)|${Object.keys(ORDINAL_WORD).join('|')}`;
  const NON_POS = `(?:straight|consecutive|successive|in\\s+a\\s+row|wins?|won|losses?|loss|defeats?|draws?|quarters?|halves|half|years?|seasons?|times?|minutes?|goals?|tr(?:y|ies)|rounds?|legs?|gear|innings)`;
  const reVerb = new RegExp(`\\b(?:sit|sits|sitting|occupy|occupies|occupying|are|in|placed|ranked|rank|languish|languishing|down\\s+in)\\s+(?:in\\s+|at\\s+)?(${ORD})\\b(?!\\s+${NON_POS})`, 'gi');
  const rePhrase = new RegExp(`\\b(${ORD})\\b(?:[-\\s]placed)?\\s+(?:on\\s+the\\s+(?:ladder|table)|in\\s+the\\s+(?:ladder|table|standings)|place|spot|position)\\b`, 'gi');

  const claims: { num: number; idx: number }[] = [];
  for (const re of [reVerb, rePhrase]) {
    for (const m of prose.matchAll(re)) {
      const num = ordinalToNum(m[1]);
      if (num !== null) claims.push({ num, idx: m.index ?? 0 });
    }
  }
  if (claims.length === 0) return [];

  // 4. Attribute each claim to the nearest fixture-team mention (≤70 chars before,
  //    ≤40 after) and flag any contradiction with that team's authoritative position.
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const c of claims) {
    let best: { team: typeof expected[number]; dist: number } | null = null;
    for (const t of expected) {
      for (const tok of t.tokens) {
        for (let at = prose.indexOf(tok); at >= 0; at = prose.indexOf(tok, at + tok.length)) {
          const dist = c.idx - (at + tok.length);          // >0: team before ordinal
          if (dist < -40 || dist > 70) continue;
          const ad = Math.abs(dist);
          if (!best || ad < best.dist) best = { team: t, dist: ad };
        }
      }
    }
    if (best && c.num !== best.team.pos) {
      const key = `${best.team.name}:${c.num}`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push(`ladder position: prose places ${best.team.name} ${ordSuffix(c.num)} but the table has them ${ordSuffix(best.team.pos)} (LADDER POSITION fact)`);
      }
    }
  }
  return violations;
}

/**
 * Finals seeding/bracket binding. In finals mode the ladder is replaced by a
 * REGULAR-SEASON SEEDING line ("X finished 2nd; Y finished 1st"), and the model
 * has a record of inventing seeding logic around it — calling the HOST "the
 * higher-seeded side" when hosting was earned in the bracket, or misattributing
 * the minor premiership. Binds three claim shapes to the seeding facts:
 *   1. "higher(-)seed(ed)" / "top seed" near a team that is NOT the better seed
 *      (and the inverse for "lower seed");
 *   2. "minor premier(s)" near a team that did not finish 1st;
 *   3. "finished <ordinal>" near a team whose seed is a different number.
 *
 * Incident (2026-09-13): afl-38728 Preliminary Final preview stored "Sydney
 *   Swans, as the higher-seeded side (2nd on the ladder), host Fremantle, who
 *   finished [1st]" — 2nd is not a higher seed than 1st; hosting came from
 *   winning the Qualifying Final. No validator checked seeding-logic words.
 */
export function validateFinalsSeeding(output: AIPreview, prompt: string): string[] {
  // Finals mode only — preview blocks carry REGULAR-SEASON SEEDING / FINALS PATH,
  // review blocks carry FINALS CONTEXT with the same bracket "Seeding:" fact.
  if (!/REGULAR-SEASON SEEDING|FINALS PATH|FINALS CONTEXT/.test(prompt)) return [];
  // Seeds from every "X finished 2nd" statement in the data block (the seeding
  // line and the bracket Seeding fact use identical wording); a name appearing
  // with two different seeds means corrupt input — validate nothing.
  const byName = new Map<string, number>();
  let conflict = false;
  for (const m of prompt.matchAll(/([A-Za-zÀ-ÿ][\w .'&-]+?)\s+finished\s+(\d+)(?:st|nd|rd|th)/g)) {
    const name = m[1].trim();
    const seed = parseInt(m[2], 10);
    const prev = byName.get(name);
    if (prev !== undefined && prev !== seed) conflict = true;
    byName.set(name, seed);
  }
  if (conflict) return [];
  const seeds = [...byName.entries()]
    .map(([name, seed]) => ({ name, seed, tokens: name.toLowerCase().split(/\s+/).filter(w => w.length >= 4) }))
    .filter(s => s.tokens.length > 0);
  if (seeds.length !== 2 || seeds[0].seed === seeds[1].seed) return [];

  const prose = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ').toLowerCase();

  // Nearest-team attribution, same window shape as validateLadderPosition.
  const nearestTeam = (idx: number) => {
    let best: { team: typeof seeds[number]; dist: number } | null = null;
    for (const t of seeds) {
      for (const tok of t.tokens) {
        for (let at = prose.indexOf(tok); at >= 0; at = prose.indexOf(tok, at + tok.length)) {
          const dist = idx - (at + tok.length);
          if (dist < -40 || dist > 70) continue;
          const ad = Math.abs(dist);
          if (!best || ad < best.dist) best = { team: t, dist: ad };
        }
      }
    }
    return best?.team ?? null;
  };

  const better = seeds[0].seed < seeds[1].seed ? seeds[0] : seeds[1];
  const worse  = seeds[0].seed < seeds[1].seed ? seeds[1] : seeds[0];
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (v: string) => { if (!seen.has(v)) { seen.add(v); violations.push(v); } };

  for (const m of prose.matchAll(/\b(higher|top|better)[-\s]seed(?:ed)?\b/g)) {
    const t = nearestTeam(m.index ?? 0);
    if (t && t.name === worse.name) {
      flag(`seeding contradiction: prose calls ${t.name} the higher/top seed, but seeding says ${t.name} finished ${t.seed} and ${better.name} finished ${better.seed} (FINALS PATH fact)`);
    }
  }
  for (const m of prose.matchAll(/\b(lower|worse)[-\s]seed(?:ed)?\b/g)) {
    const t = nearestTeam(m.index ?? 0);
    if (t && t.name === better.name) {
      flag(`seeding contradiction: prose calls ${t.name} the lower seed, but seeding says they finished ${t.seed} vs ${worse.name}'s ${worse.seed} (FINALS PATH fact)`);
    }
  }
  for (const m of prose.matchAll(/\bminor[-\s]premier(?:s|ship)?\b/g)) {
    const t = nearestTeam(m.index ?? 0);
    if (t && t.seed !== 1) {
      flag(`seeding contradiction: prose attributes the minor premiership to ${t.name}, who finished ${t.seed} (FINALS PATH fact)`);
    }
  }
  for (const m of prose.matchAll(/\bfinished\s+(\d+)(?:st|nd|rd|th)\b/g)) {
    const claimed = parseInt(m[1], 10);
    const t = nearestTeam(m.index ?? 0);
    if (t && claimed !== t.seed) {
      flag(`seeding contradiction: prose says ${t.name} finished ${claimed}, but seeding says ${t.seed} (REGULAR-SEASON SEEDING fact)`);
    }
  }
  return violations;
}

/**
 * Season-placement policy guard (user rule 2026-09-16): in the FIRST third of
 * a season, end-of-season placement claims are banned outright ("Arsenal …
 * five points clear … within reach of the top five" after FOUR games carries
 * no season-outcome meaning). Second third is prompt-guided (outliers only —
 * not machine-judgeable); final third is free. Also catches the CIRCULAR
 * placement claim in any phase: "within reach of the top N" about a team whose
 * authoritative position is already INSIDE the top N.
 */
const PLACEMENT_ORD: Record<string, number> = { four: 4, five: 5, six: 6, eight: 8, ten: 10 };
export function validateSeasonPlacement(output: AIPreview, prompt: string): string[] {
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  const flag = (v: string) => { if (!seen.has(v)) { seen.add(v); violations.push(v); } };

  // First third: hard ban on placement-race framing.
  if (/SEASON-PLACEMENT POLICY \(first third/.test(prompt)) {
    const raceRe = /\bwithin (?:reach|touching distance|striking distance) of (?:the )?top\b|\btop[- ](?:\d+|four|five|six|eight|ten)[- ]?(?:race|push|charge|bid|finish|contention|hopes|chase)\b|\btitle (?:race|charge|contenders?|bid|hopes|credentials)\b|\brelegation (?:battle|scrap|fight|six-pointer|candidates?)\b|\b(?:on (?:course|track)|heading|destined) for (?:the )?(?:title|top|europe|finals|relegation)\b|\bin the (?:hunt|mix|frame) for\b|\b(?:champions league|european) (?:race|places?|spots?|qualification)\b|\bfinals (?:race|contention|push)\b/gi;
    for (const m of text.matchAll(raceRe)) {
      flag(`first-third placement claim "${m[0]}" — the table cannot carry end-of-season meaning yet; state form and position plainly (SEASON-PLACEMENT POLICY)`);
    }
  }

  // Circular claim (any phase): "within reach of the top N" for a team already ≤ N.
  const factLine = prompt.match(/LADDER POSITION[^\n]*?:\s*([^\n]+)/);
  if (factLine) {
    const positions: Array<{ tokens: string[]; pos: number }> = [];
    for (const m of factLine[1].matchAll(/([A-Za-zÀ-ÿ][\w .'&-]+?)\s*[—–-]\s*(\d+)(?:st|nd|rd|th)\s+of\s+\d+/g)) {
      positions.push({ tokens: m[1].trim().toLowerCase().split(/\s+/).filter(w => w.length >= 4), pos: parseInt(m[2], 10) });
    }
    const lower = text.toLowerCase();
    for (const m of lower.matchAll(/within (?:reach|touching distance|striking distance) of (?:the )?top[- ](\d+|four|five|six|eight|ten)/g)) {
      const n = PLACEMENT_ORD[m[1]] ?? parseInt(m[1], 10);
      const idx = m.index ?? 0;
      for (const p of positions) {
        for (const tok of p.tokens) {
          const at = lower.lastIndexOf(tok, idx);
          if (at >= 0 && idx - at < 110 && p.pos <= n) {
            flag(`circular placement claim "within reach of the top ${m[1]}" — that team is ALREADY ${p.pos <= n ? `inside the top ${n} (position ${p.pos})` : ''}; a position cannot be "within reach" of a band it occupies`);
          }
        }
      }
    }
  }
  return violations;
}

/**
 * Register-crutch guard (2026-09-16 editorial audit): the template
 * incantations professional coverage never uses — announcing what matters
 * instead of making the case ("The key contest will be…", "will be crucial"),
 * plus the emptiest intensifiers. Small list, outright bans; the feedback
 * retry converts them into direct claims.
 */
export function validateRegisterCrutches(output: AIPreview, prompt: string): string[] {
  void prompt;
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  const crutchRe = /\bthe (?:key|decisive|crucial|critical) (?:contest|battle|factor|question|clash|matchup) (?:will be|is|lies|hinges)\b|\bwill be (?:crucial|critical|paramount|vital|non-negotiable)\b|\bhigh-stakes\b|\bone-off contest\b|\bremains to be seen\b|\bat the end of the day\b|\bfirepower\b|\b(?:confirms?|affirms?|validates?|cements?|solidif(?:y|ies)) (?:their|its|his|her) (?:status|resilience|credentials|readiness|dominance)\b|\bunderlines? (?:their|its) readiness\b|\bserious (?:flag |premiership |title )?contender\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(crutchRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`register crutch "${m[0]}" — never announce what matters; make the comparative case directly (e.g. "X tackle harder and win more of the ball")`);
  }
  return violations;
}

/**
 * Cross-field redundancy guard (2026-09-16 editorial audit): tacticalBattle,
 * playerSpotlight, and verdict were restating one thesis three ways (an AFL
 * prelim said "midfield/inside 50s decide it" in all three). Fields have
 * disjoint jobs (mechanism / people / call); heavy shared wording between any
 * pair means one of them is not doing its job. Measured by shared 4-gram ratio.
 */
export function validateFieldOverlap(output: AIPreview, prompt: string): string[] {
  void prompt;
  const grams = (t: string): Set<string> => {
    const w = (t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const g = new Set<string>();
    for (let i = 0; i + 3 < w.length; i++) g.add(w.slice(i, i + 4).join(' '));
    return g;
  };
  const fields: Array<[string, string]> = [
    ['tacticalBattle', output.tacticalBattle ?? ''],
    ['playerSpotlight', output.playerSpotlight ?? ''],
    ['verdict', output.verdict ?? ''],
  ];
  const violations: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = grams(fields[i][1]), b = grams(fields[j][1]);
      if (a.size < 8 || b.size < 8) continue;
      let shared = 0;
      for (const g of a) if (b.has(g)) shared++;
      const ratio = shared / Math.min(a.size, b.size);
      if (ratio > 0.22) {
        violations.push(`${fields[i][0]} and ${fields[j][0]} substantially repeat each other (${Math.round(ratio * 100)}% shared phrasing) — each field has a distinct job (mechanism / people / call); rewrite one with different content`);
      }
    }
  }
  return violations;
}

/**
 * Absence-count binding (2026-09-16 editorial audit): "missing five starters"
 * with three names listed, "missing nine key players". A claimed count of
 * absences must be supported by the data block's absence/injury listings.
 */
export function validateAbsenceCounts(output: AIPreview, prompt: string): string[] {
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  // Count names in absence/injury lines (comma-separated after the marker).
  let listed = 0;
  for (const m of prompt.matchAll(/(?:Absent vs last lineup[^:]*|INJURY REPORT[^\n]*):?\s*\n?([^\n]+)/gi)) {
    listed += m[1].split(',').filter(x => x.trim().length > 1).length;
  }
  const WORD_N: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const violations: string[] = [];
  for (const m of text.matchAll(/\bmissing (\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:key |frontline |first[- ]choice )?(?:players?|starters?|names?)\b/gi)) {
    const n = WORD_N[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    if (n > Math.max(listed, 0)) {
      violations.push(`absence count "${m[0]}" — the data block lists ${listed} absent/injured name(s); never inflate the count`);
    }
  }
  return violations;
}

/**
 * Cross-sport jargon fence (2026-09-16, journalism-register direction): the
 * written standard is top-tier sports journalism, and a term of art from one
 * sport's analysis is an error in another's. The map lists only UNAMBIGUOUS
 * markers (terms never used metaphorically across codes); the block's SPORT
 * line identifies the piece's sport. Conservative by design — a missing term
 * is fine, a false positive is not.
 */
const SPORT_OF_PROMPT: Array<[RegExp, string]> = [
  [/^SPORT: Australian Rules Football/m, 'afl'],
  [/^SPORT: NBA Basketball/m, 'nba'],
  [/^SPORT: NRL Rugby League/m, 'nrl'],
  [/^SPORT: English Premier League/m, 'epl'],
  [/^SPORT: Super Rugby/m, 'super_rugby'],
  [/^SPORT: International Rugby Union/m, 'rugby_int'],
  [/^SPORT: International Cricket/m, 'cricket_int'],
  [/^SPORT: Big Bash League/m, 'bbl'],
];
/** Phrases WRONG in specific sports (unit errors), even though the words exist there. */
const SPORT_BANNED_PHRASES: Array<{ re: RegExp; bannedIn: string[]; why: string }> = [
  { re: /\b(?:one|two|three|four|\d+)[- ]goal (?:difference|margin|lead|win|loss|victory|defeat)\b/gi,
    bannedIn: ['nrl', 'super_rugby', 'rugby_int', 'afl'],
    why: 'margins in this sport are POINTS, not goals — a 48–46 rugby game is a 2-point margin' },
  { re: /\bladder\b/gi,
    bannedIn: ['nba', 'epl'],
    why: 'this sport does not use "ladder" — NBA says "the standings", the EPL says "the Table"' },
  { re: /\bpitch\b/gi,
    bannedIn: ['afl'],
    why: 'AFL is played on a GROUND or OVAL — "pitch" is football/cricket vocabulary' },
];
const SPORT_MARKER_TERMS: Array<{ re: RegExp; sports: string[]; family: string }> = [
  { re: /\binside[- ]50s?\b|\bcentre bounces?\b|\bpremiership quarter\b|\bbehinds\b/gi, sports: ['afl'], family: 'AFL' },
  { re: /\blineouts?\b|\bmauls?\b|\bgarryowens?\b/gi, sports: ['super_rugby', 'rugby_int'], family: 'rugby union' },
  { re: /\bdummy[- ]half\b|\bset restarts?\b/gi, sports: ['nrl'], family: 'rugby league' },
  { re: /\bpowerplays?\b|\bdeath overs?\b|\bnew[- ]ball\b|\byorkers?\b|\bcover drives?\b|\brun rate\b/gi, sports: ['cricket_int', 'bbl'], family: 'cricket' },
  { re: /\bfalse nine\b|\boffside trap\b|\binverted wingers?\b|\bpressing triggers?\b/gi, sports: ['epl'], family: 'football' },
];
export function validateSportRegister(output: AIPreview, prompt: string): string[] {
  let sport: string | null = null;
  for (const [re, sp] of SPORT_OF_PROMPT) { if (re.test(prompt)) { sport = sp; break; } }
  if (!sport) return [];
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const { re, bannedIn, why } of SPORT_BANNED_PHRASES) {
    if (!bannedIn.includes(sport)) continue;
    for (const m of text.matchAll(re)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`"${m[0]}" — ${why}`);
    }
  }
  for (const { re, sports, family } of SPORT_MARKER_TERMS) {
    if (sports.includes(sport)) continue;
    for (const m of text.matchAll(re)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`"${m[0]}" is ${family} vocabulary — outside this sport's jargon palette (see the SPORT line); rewrite in this sport's own terms`);
    }
  }
  return violations;
}

/**
 * Cricket register guard (2026-09-16): the shared system prompt teaches a
 * footy-code analytical register ("what it means structurally", "phases") and
 * the model imported it into cricket ("Australia holds a structural edge …
 * across all phases of the game" — unknowledgeable padding in cricket terms).
 * Cricket previews/reviews must speak cricket; the SPORT_CONTEXT ban plus this
 * check (with feedback retry) enforces it. Also rejects unsourced pitch
 * speculation when no VENUE PROFILE grounds it.
 */
export function validateCricketRegister(output: AIPreview, prompt: string): string[] {
  if (!/CRICKET MATCH CONTEXT/.test(prompt)) return [];
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  const footyRe = /\bstructur(?:al|ally|es?)\b|\b(?:all )?phases? of the game\b|\bacross all phases\b|\bgain[- ]?line\b|\bfield position\b/gi;
  for (const m of text.matchAll(footyRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`footy-register term "${m[0]}" in a cricket preview — use cricket vocabulary (top order, powerplay, death overs, spin through the middle, new-ball spells) instead`);
  }
  if (!/VENUE PROFILE/.test(prompt)) {
    const pitchRe = /\b(?:flat|green|turning|spinning|slow|two-paced|road of a) (?:wicket|deck|pitch|track)\b|\bwicket (?:favouring|that favours)\b|\b(?:turn|seam|swing|bounce) (?:that )?(?:often |typically |usually )?(?:develops|on offer|available)\b|\bsurface that (?:offers|suits|favours|turns)\b|\bpitch (?:is )?expected to (?:favour|suit|offer)\b/gi;
    for (const m of text.matchAll(pitchRe)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`unsourced pitch characterisation "${m[0]}" — no VENUE PROFILE in the data; do not speculate about conditions`);
    }
  }
  return violations;
}

/**
 * Absence-narration guard (2026-09-16 economy rule, second species): the data
 * block's gaps instruct the MODEL what not to discuss — they are never content.
 * Incident: a cricket preview opened analysis with "No specific stakes from the
 * series standings are available" — the reader learns nothing from being told
 * what we don't know. Catches meta-statements about data availability only;
 * analytical negatives ("no injury concerns", "no clear favourite") pass.
 */
export function validateAbsenceNarration(output: AIPreview, prompt: string): string[] {
  void prompt; // applies to every preview/review, no marker gate
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  const absenceRe = /\bno (?:specific |official |detailed |such )?(?:stakes|series (?:stakes|standings|context)|standings|stats|statistics|data|information|injury (?:news|data|information|updates?)|team news|lineup (?:data|information)|form data)\b[^.!?]{0,50}\b(?:available|provided|known|released|published|to hand)\b|\b(?:data|information|details|statistics|stats)\s+(?:is|are)\s+(?:not\s+|un)available\b|\b(?:no|little)\s+(?:information|data)\s+(?:is|was)\s+(?:yet\s+)?(?:available|provided)\b|\bwithout (?:specific|detailed|official) (?:data|information|stats|statistics)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(absenceRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`narrates missing data ("${m[0].slice(0, 60)}") — a data gap is never content; write only from what is known and do not raise the topic`);
  }
  return violations;
}

/**
 * Finals-redundancy guard (2026-09-16 economy rule): in a knockout final,
 * "the loser is eliminated" is the reader's default assumption — stating it
 * (or a paraphrase: "loser goes home", "lose and the season/campaign ends")
 * adds nothing. Only consequences that DIFFER from the default earn words
 * (the double chance, wildcard survival). Catches the flat restatement forms
 * only; tension idioms like "season on the line" are left alone.
 */
export function validateFinalsRedundancy(output: AIPreview, prompt: string): string[] {
  if (!/FINALS PATH|FINALS CONTEXT/.test(prompt)) return [];
  // The double-chance rounds are the counter-case — elimination talk there can
  // be genuinely informative, so only plain knockout rounds are policed.
  if (/NEITHER side can be eliminated/.test(prompt)) return [];
  const text = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ');
  // The full default-consequence class, both directions. Loser side: any
  // elimination/season-over restatement. Winner side: advancing/booking a
  // place IS the definition of the round. "remain/stay alive" applies to both
  // sides of every knockout, so it carries zero information. Counter-case
  // consequences (double chance spent/earned, wildcard survival, hosting
  // earned) deliberately match none of these.
  const redundantRe = new RegExp([
    /\b(?:the )?loser(?:'s)? (?:is eliminated|goes home|is out|is knocked out|bows out|sees? their season end)\b/.source,
    /\bloser'?s? (?:season|campaign) (?:ends|is over)\b/.source,
    /\blose,? and (?:your|their|the) (?:premiership )?(?:campaign|season) (?:ends|is over)\b/.source,
    /\bdecides? who (?:advances|progresses|goes through|reaches|plays in)\b/.source,
    /\b(?:the )?winner (?:advances|progresses|goes through|moves on|books|earns|claims|secures)\b[^.]{0,40}\b(?:grand final|decider|final|championship)\b/.source,
    /\b(?:grand final|premiership) (?:berth|spot|place)\b[^.]{0,25}\b(?:on the line|at stake|awaits|up for grabs|for the winner)\b/.source,
    /\bto (?:remain|stay) alive\b|\bkeep (?:their|the) season alive\b|\bremain alive in the (?:competition|premiership|finals)\b/.source,
  ].join('|'), 'gi');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(redundantRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`redundant finals consequence "${m[0]}" — elimination is the default in a knockout and goes unsaid; state only consequences that differ (double chance earned/spent, wildcard survival)`);
  }
  return violations;
}

/**
 * Positional-side binding — the generalised rule behind the "Saka plays off
 * the left" incident (2026-09-16). The player-name whitelist verifies WHO
 * exists; nothing verified what was SAID about them, so side-of-pitch claims
 * came from (sometimes wrong or outdated) training memory. Rule: a left/right
 * claim about a named player must match that player's position code from the
 * data block (lineups now carry codes: soccer CD-L/RW/LM…, AFL HFFL/WR/FPR…);
 * a side claim about a player with NO coded side is unsourced and rejected —
 * the same standard as invented statlines. Team-level side talk ("overlaps
 * down the left") has no nearby player name and is untouched.
 */
const SIDE_CODE_EXCLUDE = new Set(['RR']); // AFL ruck-rover — the R is not a side
function sideFromCode(code: string): 'left' | 'right' | null {
  const c = code.toUpperCase();
  if (SIDE_CODE_EXCLUDE.has(c)) return null;
  if (/-L$/.test(c) || /^L[WMB]$/.test(c)) return 'left';
  if (/-R$/.test(c) || /^R[WMB]$/.test(c)) return 'right';
  if (/^[A-Z]{2,4}L$/.test(c)) return 'left';   // AFL: HFFL, WL, FPL, BPL, HBFL
  if (/^[A-Z]{2,4}R$/.test(c)) return 'right';  // AFL: HFFR, WR, FPR, BPR, HBFR
  return null;
}

export function validatePlayerSideClaims(output: AIPreview, prompt: string): string[] {
  const { whitelist, hasPlayerData } = collectPlayerWhitelist(prompt);
  if (!hasPlayerData || whitelist.size === 0) return [];

  // name → coded side (players whose data carries a position code with a side).
  const sides = new Map<string, 'left' | 'right'>();
  for (const m of prompt.matchAll(/([A-Za-zÀ-ÿ][\w .'’-]{2,}?)\s*\(([A-Z]{1,4}(?:-[LR])?)\)/g)) {
    const name = m[1].trim().toLowerCase();
    const side = sideFromCode(m[2]);
    if (side && whitelist.has(name)) sides.set(name, side);
  }

  const prose = [output.context, output.tacticalBattle, output.playerSpotlight, output.verdict, ...(output.keyInsights ?? [])]
    .filter(Boolean).join('  ').toLowerCase();

  // Player tokens for nearest-name attribution (≥4 chars, from the whitelist).
  const tokens: { name: string; tok: string }[] = [];
  for (const name of whitelist) {
    for (const t of name.split(/\s+/)) if (t.length >= 4) tokens.push({ name, tok: t });
  }

  const claimRe = /\b(?:off|down|from|along) the (left|right)\b|\b(left|right)[\s-](?:wing(?:er)?|flank|edge|channel)\b/g;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of prose.matchAll(claimRe)) {
    const claimed = (m[1] ?? m[2]) as 'left' | 'right';
    const idx = m.index ?? 0;
    let best: { name: string; dist: number } | null = null;
    for (const { name, tok } of tokens) {
      for (let at = prose.indexOf(tok); at >= 0; at = prose.indexOf(tok, at + tok.length)) {
        const dist = idx - (at + tok.length);
        if (dist < -40 || dist > 70) continue;
        const ad = Math.abs(dist);
        if (!best || ad < best.dist) best = { name, dist: ad };
      }
    }
    if (!best) continue; // team-level side talk — fine
    const dataSide = sides.get(best.name);
    const key = `${best.name}:${claimed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dataSide && dataSide !== claimed) {
      violations.push(`side contradiction: prose puts ${best.name} on the ${claimed}, but the lineup position code says ${dataSide} (LINEUP fact)`);
    } else if (!dataSide) {
      violations.push(`unsourced side claim: prose puts ${best.name} on the ${claimed}, but no position code in the data states a side — describe the player's role without a side`);
    }
  }
  return violations;
}

/**
 * Narrative-opener guard (finals mode). The model's strongest habit is opening
 * the context with a rules recap ("This is a Preliminary Final in the AFL
 * finals series — a knockout match between…") — accurate, bland, and redundant
 * (the UI already names the fixture and round). Style guidance alone does not
 * move the small local model, so the opener is a validated constraint: the
 * first sentence must lead with substance, not a fixture definition. Paired
 * with feedback-carrying retries, the second attempt lands the angle.
 */
export function validateNarrativeOpener(output: AIPreview, prompt: string): string[] {
  if (!/FINALS PATH|REGULAR-SEASON SEEDING/.test(prompt)) return [];
  const opener = (output.context ?? '').trimStart();
  const recapRe = /^(?:this (?:is|was)\b|it(?:'|’)?s (?:a|the)\b|in (?:a|the) (?:wildcard|qualifying|elimination|semi|preliminary|grand)\b|(?:a|the) (?:wildcard round|qualifying final|elimination final|semi[- ]final|preliminary final|grand final)\b)/i;
  if (recapRe.test(opener)) {
    return [`context opens with a rules recap ("${opener.slice(0, 60)}…") — open with the ANGLE: a team and a consequence. The reader already sees the fixture and round on screen; the round name may appear mid-sentence at most once`];
  }
  return [];
}

/**
 * Catches invented per-player statlines. When the data block contains NO KEY
 * PERFORMERS section, the model has no grounded per-player numbers, so any stat
 * like "two tries", "18 tackles", "3 turnovers" attached in the factual fields is
 * fabricated. Scans only the factual fields (mediaWatch is attributed editorial
 * and may legitimately echo a real headline's numbers). Excludes "points"/"goals"
 * — those collide with competition points and team scorelines.
 *
 * Incident: previews regularly cited "scored three tries", "made 18 tackles" etc.
 *   when no KEY PERFORMERS data was provided — model drew on training-data player
 *   statistics for players it believed were in the team.
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
 * in the prompt (e.g. competition labels like "2026 season") is fabricated —
 * the classic "winless in 2024" failure. Scans factual fields only.
 *
 * Incident: model wrote "first time since 2019" / "winless since 2022" — years
 *   drawn from training-memory team history, absent from the data block.
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

/**
 * Day-count claims (rest, breaks, turnarounds) must match a day figure stated
 * in the data block. Caught live: THE ANGLE said a 16-day break and the model
 * wrote "six-day break" in keyInsights — an internal contradiction, and word-
 * form numbers evade the digit-based checks, so both forms are normalised here.
 * Allowed figures = every number on a prompt line that mentions "day"/"days"
 * (the ANGLE rest line carries both figures but attaches "days" only to one).
 * Exemptions: "one-day" (the cricket format term) and numberless day phrases.
 */
const DAY_WORD_NUMS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
export function validateDayCounts(output: AIPreview, prompt: string): string[] {
  const allowed = new Set<number>();
  for (const line of prompt.split('\n')) {
    if (!/\bdays?\b/i.test(line)) continue;
    for (const m of line.matchAll(/\b(\d{1,2})\b/g)) allowed.add(Number(m[1]));
  }
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  const seen = new Set<number>();
  const wordAlt = Object.keys(DAY_WORD_NUMS).join('|');
  const claimRe = new RegExp(`\\b(\\d{1,2}|${wordAlt})[-\\s]days?\\b`, 'gi');
  for (const m of factual.matchAll(claimRe)) {
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : DAY_WORD_NUMS[raw];
    if (n === undefined || n === 1 || seen.has(n)) continue; // 1 = "one-day" format term
    if (allowed.has(n)) continue;
    seen.add(n);
    violations.push(`day-count claim "${m[0]}" — no ${n}-day figure appears in the data block${allowed.size > 0 ? ` (stated day figures: ${[...allowed].join(', ')})` : ''}`);
  }
  return violations;
}

/**
 * Universal numeral binder — the net under the claim-type-specific validators.
 * Every number ≥6 in the output (digit or word form) must appear somewhere in
 * the data block. Numbers 0–5 are exempt (reliable small-count range, and the
 * home of harmless idiom: "one of", "two sides", "four quarters"); year-shaped
 * numbers are validateInventedYears' jurisdiction; each sport keeps a small
 * lexicon of structural numbers ("inside 50", "the 22", 80 minutes) that need
 * no data support. Catches the fabricated-figure class wholesale ("44 tackles",
 * "74-point margin", "12 points per game") instead of claim type by claim type.
 */
const NUM_WORD_UNITS: Record<string, number> = {
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, hundred: 100,
};
const NUM_WORD_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SPORT_NUM_LEXICON: Record<string, number[]> = {
  afl:         [50, 6],              // 50m arc / inside 50; 6 points a goal
  nrl:         [10, 20, 40, 80, 13], // 10m, 20/40 & 40/20, 80 minutes, 13 players
  super_rugby: [22, 10, 80, 15],     // the 22, 10m line, 80 minutes, 15 players
  rugby_int:   [22, 10, 80, 15],
  epl:         [90, 18],             // 90 minutes; 18-yard box
  nba:         [48, 24, 12, 82],     // 48 min, 24s clock, 12-min quarters, 82 games
  cricket_int: [6, 50, 100, 22],     // sixes; fifty/hundred milestones; 22 yards
  bbl:         [6, 50, 100, 22],
};
export function validateNumeralBinding(output: AIPreview, prompt: string): string[] {
  const allowed = new Set<number>();
  for (const m of prompt.matchAll(/\d+/g)) allowed.add(Number(m[0]));
  let sport: string | null = null;
  for (const [re, sp] of SPORT_OF_PROMPT) { if (re.test(prompt)) { sport = sp; break; } }
  for (const n of SPORT_NUM_LEXICON[sport ?? ''] ?? []) allowed.add(n);

  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  const seen = new Set<number>();
  const flag = (n: number, raw: string) => {
    if (n <= 5 || (n >= 1900 && n <= 2099) || allowed.has(n) || seen.has(n)) return;
    seen.add(n);
    violations.push(`unsourced number "${raw}" — no figure ${n} appears in the data block; every number must come from the data`);
  };
  for (const m of factual.matchAll(/\b(\d+)(?:st|nd|rd|th)?\b/g)) flag(Number(m[1]), m[0]);
  const tensAlt = Object.keys(NUM_WORD_TENS).join('|');
  const unitsAlt = Object.keys(NUM_WORD_UNITS).join('|');
  const wordRe = new RegExp(`\\b(${tensAlt})(?:[-\\s](one|two|three|four|five|${unitsAlt}))?\\b|\\b(${unitsAlt})\\b`, 'gi');
  const smallWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  for (const m of factual.matchAll(wordRe)) {
    if (m[3] !== undefined) { flag(NUM_WORD_UNITS[m[3].toLowerCase()], m[0]); continue; }
    const tens = NUM_WORD_TENS[m[1].toLowerCase()];
    const unitWord = m[2]?.toLowerCase();
    const unit = unitWord ? (smallWords[unitWord] ?? NUM_WORD_UNITS[unitWord] ?? 0) : 0;
    flag(tens + (unit === 100 ? 0 : unit), m[0]);
  }
  return violations;
}

/**
 * Venue-form claims ("fortress", "performs well here", "strong record at")
 * require a VENUE RECORD line (or the cricket VENUE PROFILE) in the data.
 * Caught live: "have consistently performed well at the MCG" with nothing in
 * the block beyond the ground being Hawthorn's home venue.
 */
const VENUE_FORM_RE = /\b(?:fortress|graveyard for|(?:strong|formidable|proud|excellent|imposing|poor|dire|dismal) (?:record|form|history|returns) (?:at|here)|(?:performed?|performs?|performing) (?:well|poorly|strongly|badly) (?:at|here)|(?:thrives?|struggles?|excels?) (?:at|in) (?:the|this)\b[^.]{0,30}?(?:ground|stadium|venue|oval|gabba|mcg|scg))\b/gi;
export function validateVenueFormClaims(output: AIPreview, prompt: string): string[] {
  if (/^VENUE RECORD THIS SEASON/m.test(prompt) || /VENUE PROFILE/.test(prompt)) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(VENUE_FORM_RE)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`venue-form claim "${m[0]}" — no VENUE RECORD data in the data block; venue reputation claims need data support`);
  }
  return violations;
}

/**
 * Double-chance framing (user-flagged): the AFL/NRL double chance is a
 * STRUCTURAL property of qualifying-final week — top-four sides that lose
 * week one drop to a home semi instead of exiting. It is not a card a team
 * holds, plays, or spends at will. Outside week one (no "NEITHER side can be
 * eliminated" fact in the prompt), any possession/consumption framing is
 * rejected; and any mention at all requires the data block to have raised it.
 */
export function validateDoubleChance(output: AIPreview, prompt: string): string[] {
  // Bracket-sport scope: the double chance is AFL/NRL final-eight mechanics.
  // Other sports use these words legitimately — NBA "second-chance points"
  // (offensive rebounds) tripped the global version on the first-ever NBA
  // generation. Detect the sport from the prompt; only police afl/nrl.
  let sport: string | null = null;
  for (const [re, sp] of SPORT_OF_PROMPT) { if (re.test(prompt)) { sport = sp; break; } }
  if (sport !== 'afl' && sport !== 'nrl') return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const termRe = /(?:double[- ]chance|second[- ]chance|second life)/i;
  if (!termRe.test(factual)) return [];

  const violations: string[] = [];
  if (!/double chance|second life/i.test(prompt)) {
    violations.push('double-chance claim — the data block raises no double chance for this fixture; do not import bracket mechanics from training memory');
    return violations;
  }
  const isQualifyingWeek = /NEITHER side can be eliminated/.test(prompt);
  if (isQualifyingWeek) return [];

  // Post-week-one: the second life is a past structural event. Card-metaphor
  // verbs and stake framings around the term are factually wrong.
  const cardRe = new RegExp(
    '(?:' +
      '(?:holds?|holding|held|plays?|playing|played|spends?|spending|spent|uses?|using|used|burns?|burned|retains?|keeps?)\\s+(?:\\w+\\s+){0,3}(?:double[- ]chance|second[- ]chance|second life)' +
      '|(?:double[- ]chance|second[- ]chance|second life)[^.]{0,40}(?:is (?:now )?(?:spent|used|gone|on the line|at stake)|on the line|at stake|in hand|intact|available|remains?|still (?:alive|there)|to (?:play|use|burn|spend))' +
    ')', 'gi');
  const seen = new Set<string>();
  for (const m of factual.matchAll(cardRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`double-chance framing "${m[0]}" — the second life exists only in qualifying-final week; after week one refer to it only as a past structural event (lost the qualifying final, survived week one via the top-four second life), never as something held, spent, or at stake`);
  }
  return violations;
}

/**
 * Series-claim binding — the numeral binder exempts numbers <=5, which let a
 * FULLY fabricated playoff-series narrative through on the NBA preseason
 * opener ("Game 3… leading 2-0 after Games 1 and 2… semi-final series" with
 * nothing but a competition label in the block). Any series framing — game
 * numbers, series leads/scores, sweeps, best-of — requires the data block to
 * carry a SERIES SCORE / SERIES STATE line (cricket, SOO and playoff fixtures
 * emit them; everything else gets none and may not invent one).
 */
export function validateSeriesClaims(output: AIPreview, prompt: string): string[] {
  if (/SERIES (?:SCORE|STATE)/.test(prompt)) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const seriesRe = /\b(?:game\s+(?:one|two|three|four|five|six|seven|\d)\b[^.]{0,50}\bseries|series\b[^.]{0,40}\b(?:lead|leads|leading|trail|trails|trailing|tied|level|\d\s*[–-]\s*\d)|(?:leads?|leading|trails?|trailing)\b[^.]{0,25}\bseries|\d\s*[–-]\s*\d\s+(?:series|lead)\b|\bsweep(?:ing|ed)?\s+the\s+series|\bbest-of-(?:three|five|seven|\d))\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(seriesRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`invented series claim "${m[0].slice(0, 60)}" — the data block carries no SERIES SCORE/STATE for this fixture; do not construct a series narrative`);
  }
  return violations;
}

// ─── Form / meeting claim validators ─────────────────────────────────────────
// Parse the RECENT FORM block once: per team, the W/L/D string and the named
// results ("def. Hawthorn 131–122; lost to Sydney 88–141"). Both validators
// below bind prose claims to exactly these tokens.
type FormFacts = { runs: string[]; byOpponent: Map<string, Set<'W' | 'L' | 'D'>> };
function parseFormFacts(prompt: string): FormFacts | null {
  const start = prompt.indexOf('RECENT FORM');
  if (start < 0) return null;
  const section = prompt.slice(start, prompt.indexOf('\n\n', start) === -1 ? undefined : prompt.indexOf('\n\n', start));
  const runs: string[] = [];
  const byOpponent = new Map<string, Set<'W' | 'L' | 'D'>>();
  for (const line of section.split('\n').slice(1)) {
    const m = line.match(/^\s*.+?:\s*([WLD](?:-[WLD])*)\s*(?:—\s*(.*))?$/);
    if (!m) continue;
    runs.push(m[1].replace(/-/g, ''));
    for (const entry of (m[2] ?? '').split(';')) {
      const e = entry.trim().match(/^(def\.|lost to|drew with)\s+(.+?)\s+\d+\s*[–-]\s*\d+$/);
      if (!e) continue;
      const res: 'W' | 'L' | 'D' = e[1] === 'def.' ? 'W' : e[1] === 'lost to' ? 'L' : 'D';
      const key = e[2].toLowerCase();
      byOpponent.set(key, new Set([...(byOpponent.get(key) ?? []), res]));
    }
  }
  return runs.length > 0 ? { runs, byOpponent } : null;
}
const toNum = (w: string) => parseInt(WORD_NUM[w.toLowerCase()] ?? w, 10);

/**
 * "N straight / consecutive / in a row" must be a run that actually exists in
 * a RECENT FORM string. Closes the ≤5 numeral exemption for this claim class:
 * "4 straight before the Prelim" was invented against a W-W-L-W-W line.
 */
export function validateFormRuns(output: AIPreview, prompt: string): string[] {
  const facts = parseFormFacts(prompt);
  if (!facts) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const runRe = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:straight|consecutive|successive|on the (?:trot|bounce|spin)|in a row)(?:\s+(wins?|victories|losses|defeats))?|\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)[- ](?:game|match)\s+(winning|losing|unbeaten)\s+(?:streak|run)|\b(winning|losing|unbeaten)\s+(?:streak|run)\s+of\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\b(won|lost)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:straight|consecutive|successive|in a row|on the (?:trot|bounce))/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(runRe)) {
    const n = toNum(m[1] ?? m[3] ?? m[6] ?? m[8] ?? '0');
    if (!Number.isFinite(n) || n < 2) continue;
    const kindWord = (m[2] ?? m[4] ?? m[5] ?? m[7] ?? '').toLowerCase();
    const letters: Array<'W' | 'L'> =
      /^(win|victor|won|unbeaten)/.test(kindWord) ? ['W'] : /^(los|defeat)/.test(kindWord) ? ['L'] : ['W', 'L'];
    const exists = facts.runs.some(run => letters.some(ch => run.includes(ch.repeat(n))));
    if (exists) continue;
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`form-run claim "${m[0].slice(0, 50)}" — no such run exists in RECENT FORM (${facts.runs.join(' / ')}); describe only runs that appear in the form strings`);
  }
  return violations;
}

/**
 * A named past result must point the way the form block says. "successive
 * losses to Sydney and Hawthorn" was written against a line reading
 * "def. Hawthorn … lost to Sydney". Only opponents that appear in the RECENT
 * FORM entries are checked (either team's); anything else is out of scope.
 * Past-tense forms only — bare "beat" is skipped as it doubles as a conditional.
 */
export function validateResultDirection(output: AIPreview, prompt: string): string[] {
  const facts = parseFormFacts(prompt);
  if (!facts || facts.byOpponent.size === 0) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const NAME = String.raw`((?:the\s+)?[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})`;
  // GAP = up to three lowercase filler words ("a loss LAST WEEK against Hawthorn").
  const GAP = String.raw`(?:\s+[a-z'’-]+){0,3}`;
  const claimRe = new RegExp(
    String.raw`\b(lost${GAP} to|fell${GAP} to|(?:were |was )?beaten${GAP} by|(?:were |was )?defeated${GAP} by|went down${GAP} to|loss(?:es)?${GAP} (?:to|against)|defeats?${GAP} (?:to|against|by)|defeated|overcame|got past|accounted for|saw off|edged|thrashed|toppled|wins?${GAP} (?:over|against)|victor(?:y|ies)${GAP} (?:over|against))\s+${NAME}(?:(?:,|\s+and)\s+${NAME})?`,
    'g',
  );
  const lossVerb = /^(lost\b|fell\b|(?:were |was )?beaten\b|(?:were |was )?defeated\b.*\bby$|went down\b|loss(?:es)?\b|defeats?\b)/;
  const lookup = (raw: string): Set<'W' | 'L' | 'D'> | undefined => {
    const n = raw.replace(/^the\s+/i, '').replace(/[.,'’]+$/, '').toLowerCase();
    for (const [key, set] of facts.byOpponent) {
      if (key === n || key.startsWith(n + ' ') || n.startsWith(key + ' ')) return set;
    }
    return undefined;
  };
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(claimRe)) {
    const verb = m[1].toLowerCase();
    const claimed: 'W' | 'L' = verb === 'defeated' ? 'W' : lossVerb.test(verb) ? 'L' : 'W';
    for (const name of [m[2], m[3]].filter(Boolean) as string[]) {
      const recorded = lookup(name);
      if (!recorded || recorded.has(claimed)) continue;
      const hit = `${m[1]} ${name}`.toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`result direction "${m[1]} ${name.replace(/[.,]+$/, '')}" contradicts RECENT FORM, which records only ${[...recorded].join('/')} against ${name.replace(/^the\s+/i, '').replace(/[.,]+$/, '')} — state results exactly as the form block gives them`);
    }
  }
  return violations;
}

/**
 * With a HEAD-TO-HEAD block present, the most recent meeting has a stated
 * winner ("Most recently, Brisbane Lions lost" / "… lost in that single
 * meeting"). A sentence that frames a past meeting AND assigns a win/loss to
 * either side must agree with it. Subject detection is by team-name token
 * ("Brisbane"/"Lions"), so nickname-only prose ("the Dockers") is out of scope.
 */
function validateH2HDirection(factual: string, prompt: string): string[] {
  const fx = prompt.match(/^FIXTURE:\s*(.+?)\s+(?:vs?\.?|v)\s+(.+?)\s*$/m);
  const last = prompt.match(/(?:Most recently, |no scores, years or dates are given\): )(.+?) (won|lost|drew)\b/);
  if (!fx || !last || last[2] === 'drew') return [];
  const [, homeName, awayName] = fx;
  const statedTeam = last[1].trim();
  const teamIsHome = homeName.toLowerCase().startsWith(statedTeam.toLowerCase()) || statedTeam.toLowerCase().startsWith(homeName.toLowerCase());
  const team = teamIsHome ? homeName : awayName;
  const opp  = teamIsHome ? awayName : homeName;
  const teamWon = last[2] === 'won';
  const tokens = (n: string) => n.split(/\s+/).filter(w => w.length >= 4).map(w => w.replace(/[^A-Za-z]/g, ''));
  const hasTok = (sentence: string, n: string) => tokens(n).some(t => new RegExp(`\\b${t}\\b`, 'i').test(sentence));
  const cue = /\b(?:last time|most recent(?:ly)?|previous(?:ly)?|earlier this season|regular[- ]season|home-and-away|that (?:single )?meeting|this opponent|these sides|the two sides|in round \d+)\b/i;
  const winRe  = /\b(?:won|beat|beaten|prevailed|defeated|got the better|edged|thrashed|overcame|accounted for|saw off|triumphed)\b/i;
  const lossRe = /\b(?:lost|fell|went down|were beaten|was beaten|were defeated|was defeated|succumbed)\b/i;
  const violations: string[] = [];
  for (const sentence of factual.split(/(?<=[.!?])\s+/)) {
    if (!cue.test(sentence)) continue;
    const subjTeam = hasTok(sentence, team), subjOpp = hasTok(sentence, opp);
    if (subjTeam === subjOpp) continue; // both or neither named: subject ambiguous
    const subject = subjTeam ? team : opp;
    const subjectWon = subjTeam ? teamWon : !teamWon;
    // "X lost to Y" / "X were beaten by Y" → X lost; "X beat/defeated Y" → X won.
    const claimsLoss = lossRe.test(sentence) || /\b(?:beaten|defeated)\s+by\b/i.test(sentence);
    const claimsWin  = !claimsLoss && winRe.test(sentence);
    if (!claimsLoss && !claimsWin) continue;
    if (claimsLoss === !subjectWon) continue;
    violations.push(`head-to-head direction "${sentence.trim().slice(0, 70)}" — the data block says ${team} ${teamWon ? 'won' : 'lost'} the most recent meeting; ${subject} did not ${claimsLoss ? 'lose' : 'win'} it`);
  }
  return violations;
}

/**
 * Any framing of a past meeting between THESE two sides needs a HEAD-TO-HEAD
 * block. With one meeting suppressed (old ≥2 gate), the model invented a
 * regular-season result and reversed the winner.
 */
export function validateHeadToHeadClaims(output: AIPreview, prompt: string): string[] {
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  if (/HEAD-TO-HEAD/.test(prompt)) return validateH2HDirection(factual, prompt);
  const h2hRe = /\b(?:last|previous|earlier|most recent|regular[- ]season|first)\s+(?:meeting|encounter|clash|contest|match-?up)s?\b[^.]{0,60}\b(?:season|these|the two|sides|teams|between)|\bhead[- ]to[- ]head\b|\b(?:lost to|beat|beaten|defeated|overcame|got past|edged|thrashed)\s+(?:this|the same|their|today's|tonight's|saturday's)\s+opponents?\b|\bthe last time (?:these|the two|both) (?:sides|teams|clubs) (?:met|played|clashed)\b|\b(?:met|meeting|meetings|clash(?:es)?)\b[^.]{0,30}\b(?:earlier this season|during the (?:regular|home-and-away) season|in the regular season)\b|\bpsychological (?:edge|hold)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(h2hRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`meeting claim "${m[0].slice(0, 60)}" — the data block has no HEAD-TO-HEAD section for this fixture; do not describe past meetings between these sides`);
  }
  return violations;
}

/**
 * Ground dimensions are never in the data ("the MCG is wider" was invented and
 * is dubious besides — Optus Stadium is longer). No block emits them, so any
 * such claim is unsourced.
 */
export function validateVenueDimensions(output: AIPreview, prompt: string): string[] {
  if (/\bDIMENSIONS\b/.test(prompt)) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const dimRe = /\b(?:ground|oval|pitch|surface|arena|field|stadium|[A-Z][A-Za-z.]+ (?:Stadium|Oval|Park|Arena|Ground))\b[^.]{0,30}\b(?:wider|narrower|longer|shorter|bigger|smaller|larger|dimensions|width|length|expansive|cavernous|tight confines)\b|\b(?:wider|narrower|longer|shorter|larger|bigger|more expansive)\b[^.]{0,25}\b(?:ground|oval|pitch|surface|playing (?:area|field)|dimensions)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(dimRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`venue-dimension claim "${m[0].slice(0, 60)}" — ground dimensions are not in the data; do not characterise the size or shape of the playing surface`);
  }
  return violations;
}

/**
 * Decider-only guards, both fed by the honours/path blocks:
 *  - RARITY: "unprecedented third-straight flag" was written against a block
 *    listing Brisbane's own 2001–03 three-peat. Nothing in the data ranks a
 *    result against history, so rarity framing is always unsourced.
 *  - PATH: with PATH PARITY stated, any "tougher / longer / more tortuous
 *    path" comparison is invented.
 */
export function validateDeciderClaims(output: AIPreview, prompt: string): string[] {
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const violations: string[] = [];
  if (/CLUB HONOURS/.test(prompt)) {
    const rarityRe = /(?<!\b(?:not|hardly|far from|nothing)\s)\b(?:unprecedented|never before|(?:for the )?first(?: [\w-]+){0,3} (?:time )?since\b(?: [\w–-]+){0,4}|first (?:club|team|side) (?:in|to|since)|record[- ]breaking|history[- ]making|rarest|rarely (?:seen|achieved)|only (?:the )?\w+ (?:club|team|side) (?:in|to|ever))\b/gi;
    // "first Grand Final since 2013" is the club's own sourced record when the
    // year is in the block — that is exactly the sentence the honours exist for.
    const promptYears = new Set([...prompt.matchAll(/\b(?:19|20)\d{2}\b/g)].map(y => y[0]));
    const seen = new Set<string>();
    for (const m of factual.matchAll(rarityRe)) {
      const hit = m[0].toLowerCase().trim();
      if (seen.has(hit)) continue;
      const sinceYear = hit.match(/\bsince\b.*?\b((?:19|20)\d{2})\b/);
      if (sinceYear && promptYears.has(sinceYear[1])) continue;
      seen.add(hit);
      const at = factual.indexOf(m[0]);
      const ctx = factual.slice(Math.max(0, at - 40), at + m[0].length + 40).trim();
      violations.push(`rarity claim "${m[0].trim().slice(0, 50)}" (in: "…${ctx}…") — the data ranks nothing against history; state the honours facts as given (a "first since <year>" is fine only when that year is in CLUB HONOURS), never how rare a result would be`);
    }
  }
  if (/PATH PARITY: both sides took the SAME route/.test(prompt)) {
    const pathRe = /\b(?:tougher|harder|longer|more (?:tortuous|arduous|difficult|demanding|gruelling|grueling|taxing|circuitous)|easier|smoother|shorter|more direct|less demanding)\b[^.]{0,40}\b(?:path|route|road|journey|passage|run)\b|\b(?:path|route|road|journey)\b[^.]{0,30}\b(?:tougher|harder|longer|more (?:tortuous|arduous|difficult|demanding|gruelling|grueling)|easier|smoother|shorter|more direct)\b/gi;
    const seen = new Set<string>();
    for (const m of factual.matchAll(pathRe)) {
      const hit = m[0].toLowerCase();
      if (seen.has(hit)) continue;
      seen.add(hit);
      violations.push(`path comparison "${m[0].slice(0, 60)}" — FINALS PATH states both sides took the same route; neither path was tougher or longer`);
    }
  }
  return violations;
}

/**
 * Mid-round finality. When the data block reports the round still being
 * played (counted from the feed's own round identity — never inferred from
 * played counts, which byes confound), a ladder position is a snapshot, not a
 * settlement: "Brisbane sit second" is fine, "Brisbane have locked up second"
 * is not. Says nothing about whether the preview SHOULD discuss the round —
 * that is optional material, not a required talking point.
 */
export function validateProvisionalLadder(output: AIPreview, prompt: string): string[] {
  if (!/ is still being played: \d+ of \d+ matches decided/.test(prompt)) return [];
  const factual = [
    output.context, output.tacticalBattle, output.playerSpotlight, output.verdict,
    ...(output.keyInsights ?? []),
  ].join('  ');
  const finalRe = /\b(?:lock(?:ed)?(?: up| in| away)?|secur(?:e|ed|ing)|clinch(?:ed|ing)?|seal(?:ed|ing)?|guarantee(?:d)?|confirm(?:ed)?|assur(?:e|ed)|cement(?:ed)?|wrapp?(?:ed)? up|book(?:ed)?)\b[^.]{0,40}\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|top[- ]?(?:two|four|five|six|eight|\d+)|minor premiership|the (?:ladder|table) lead|top spot)\b|\b(?:\d{1,2}(?:st|nd|rd|th)|top[- ]?(?:two|four|five|six|eight|\d+))\b[^.]{0,30}\b(?:is|are|was|were) (?:now )?(?:locked|secured|sealed|guaranteed|confirmed|assured|safe)\b/gi;
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const m of factual.matchAll(finalRe)) {
    const hit = m[0].toLowerCase();
    if (seen.has(hit)) continue;
    seen.add(hit);
    violations.push(`settled-position claim "${m[0].slice(0, 60)}" — the round is incomplete (teams still have games in hand); state the position as it stands with matches to come, not as locked or secured`);
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
  'qualifying', 'elimination', 'wildcard', // finals round names ("Elimination Final")
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

/**
 * Player-name whitelist: any name in the prose's player-spotlight or (when player
 * data is absent) all factual fields must appear in the data block's whitelist
 * (lineups, squads, key performers, injury lists, news headlines).
 *
 * Incident A: invented player names in the spotlight field — model used training-
 *   knowledge team rosters when no lineup data was provided for the fixture.
 * Incident B — F1 false positives (commit fea4207): "Group D's" possessive was
 *   parsed as a two-token name candidate and flagged. F1 driver and constructor
 *   names from the championship standings block were not reaching the whitelist.
 *   Fixed: 'group' added to PLAYER_NAME_SAFE_WORDS; single-letter tokens treated as
 *   non-evidence; driver/constructor names now seeded via collectPlayerWhitelist.
 */
/** Venue nouns as a candidate's final word mark it as a place, not a person. */
const VENUE_HEAD_WORDS = new Set([
  'stadium', 'arena', 'park', 'oval', 'ground', 'field', 'dome', 'gardens',
]);

// Every followable team name — a candidate matching one is a TEAM the model may
// legitimately cite from RECENT FORM / HEAD-TO-HEAD past-opponent data, never a
// person. Live refusal: "Manchester City" (a form opponent) flagged as a player
// name because only the two FIXTURE teams were excluded.
const KNOWN_TEAM_NAMES = new Set(TEAMS.map(t => t.name.toLowerCase()));

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
    // A candidate whose HEAD (last) word is a venue noun is a place, never a
    // person — catches colloquial venue forms the VENUE line can't pre-seed
    // ("Amex Stadium" vs "American Express Community Stadium"; live refusal).
    if (VENUE_HEAD_WORDS.has(words[words.length - 1])) continue;
    if (KNOWN_TEAM_NAMES.has(lower)) continue;
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
export function collectViolations(v: AIPreview, prompt: string): string[] {
  return [
    ...validatePointsClaims(v, prompt),
    ...validateFinalsImminence(v, prompt),
    ...validatePhaseStakes(v, prompt),
    ...validateLadderPosition(v, prompt),
    ...validateFinalsSeeding(v, prompt),
    ...validateNarrativeOpener(v, prompt),
    ...validateFinalsRedundancy(v, prompt),
    ...validateAbsenceNarration(v, prompt),
    ...validateRegisterCrutches(v, prompt),
    ...validateSeasonPlacement(v, prompt),
    ...validateFieldOverlap(v, prompt),
    ...validateAbsenceCounts(v, prompt),
    ...validateCricketRegister(v, prompt),
    ...validateSportRegister(v, prompt),
    ...validatePlayerSideClaims(v, prompt),
    ...validateF1ChampionshipClaims(v, prompt),
    ...validatePlayerNames(v, prompt),
    ...validateInventedStatlines(v, prompt),
    ...validateInventedYears(v, prompt),
    ...validateDayCounts(v, prompt),
    ...validateNumeralBinding(v, prompt),
    ...validateVenueFormClaims(v, prompt),
    ...validateDoubleChance(v, prompt),
    ...validateSeriesClaims(v, prompt),
    ...validateProvisionalLadder(v, prompt),
    ...validateFormRuns(v, prompt),
    ...validateResultDirection(v, prompt),
    ...validateHeadToHeadClaims(v, prompt),
    ...validateVenueDimensions(v, prompt),
    ...validateDeciderClaims(v, prompt),
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
  const doGenerate = async (feedback?: string[]): Promise<AIPreview> => {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ];
    // Feedback retry: blind retries reproduce style failures (same prompt →
    // same opener), so the retry names exactly what was rejected and why.
    if (feedback?.length) {
      messages.push({
        role: 'user',
        content:
          'Your previous attempt was REJECTED by automated fact/style checks:\n' +
          feedback.map(f => `- ${f}`).join('\n') +
          '\nRegenerate the complete JSON response. Fix each rejection precisely while keeping every claim consistent with the data block. Do not repeat the rejected phrasing.',
      });
    }
    const response = await ollamaClient.chat.completions.create({
      model:      modelOverride ?? AI_MODEL,
      // Non-compact ceiling is 6000 (headroom for richer future prompts; current
      // previews land well under 1000 tokens so this never costs anything today).
      // compact (2500) is unreachable on the main preview path — generateAndStorePreview
      // always passes compact=false — and is left untouched.
      max_tokens: maxTokensOverride ?? (compact ? 2500 : 6000),
      messages,
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

  aiLog(`validation-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(violations)} — retrying with feedback`);
  try {
    const retry      = await doGenerate(violations);
    const retryViols = collectViolations(retry, prompt);
    if (retryViols.length === 0) {
      aiLog(`retry-ok elapsed=${Date.now() - t0}ms`);
      return { preview: stripUnsourcedMediaWatch(retry, prompt), violations: [] };
    }
    // Style-only residue: previews are generated offline by the heartbeat, so a
    // third attempt is cheap. STYLE violations (register, crutches, placement
    // framing, openers) get one more bite; FACTUAL violations never do.
    const STYLE_PREFIXES = [
      'context opens with a rules recap',
      'register crutch',
      'first-third placement claim',
      'circular placement claim',
      'footy-register term',
      'redundant finals consequence',
      'narrates missing data',
    ];
    const isStyle = (v: string) => STYLE_PREFIXES.some(p => v.startsWith(p)) || / vocabulary — outside this sport/.test(v) || /repeat each other/.test(v);
    // Style-only retry loop — budget 2 extra attempts (4 total). The style-rule
    // count has grown (consequence rule, register nets, placement policy), so a
    // single style retry left too many refusals that pure sampling clears; a
    // FACTUAL violation still ends the run immediately.
    let bestPreview = retryViols.length < violations.length ? retry : result;
    let bestViols   = retryViols.length < violations.length ? retryViols : violations;
    let lastViols   = retryViols;
    const MAX_STYLE_RETRIES = 2;
    for (let i = 0; i < MAX_STYLE_RETRIES && lastViols.every(isStyle); i++) {
      aiLog(`retry-${i + 2} (style-only residue) elapsed=${Date.now() - t0}ms — attempt ${i + 3}`);
      const next      = await doGenerate(lastViols);
      const nextViols = collectViolations(next, prompt);
      if (nextViols.length === 0) {
        aiLog(`retry-${i + 2}-ok elapsed=${Date.now() - t0}ms`);
        return { preview: stripUnsourcedMediaWatch(next, prompt), violations: [] };
      }
      if (nextViols.length < bestViols.length) { bestPreview = next; bestViols = nextViols; }
      lastViols = nextViols;
    }
    // All attempts violate — surface the best attempt AND its remaining
    // violations so the caller can refuse to store (REL-1). We never return a
    // "clean-looking" attempt that silently buries caught hallucinations.
    aiLog(`retry-fail elapsed=${Date.now() - t0}ms violations=${JSON.stringify(bestViols)} — all attempts violate, will not store`);
    return { preview: stripUnsourcedMediaWatch(bestPreview, prompt), violations: bestViols };
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
      // FIRST LOOK: generated before either side's team list is published
      // (AFL name ~Thursday, NRL Tuesday), so the richest personnel content is
      // absent by timing, not by failure. Stamped on the payload so the UI can
      // say so; the 48h/24h regens overwrite it once squads land.
      const stamped: AIPreview = {
        ...preview,
        firstLook: !collectPlayerWhitelist(prompt).hasPlayerData || undefined,
      };
      await upsertPreview(fixture.id, stamped, AI_MODEL, newsFingerprint);
      // Representative games (State of Origin) key per perspective on the display
      // side — upsert the SAME payload under the mirror key(s) so both resolve.
      for (const mirrorId of fixture.mirrorGameIds ?? []) {
        await upsertPreview(mirrorId, stamped, AI_MODEL, newsFingerprint);
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
