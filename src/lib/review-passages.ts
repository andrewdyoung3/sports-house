/**
 * PASSAGES — the narrative facts of a match, computed from MATCH EVENTS so the
 * model quotes them instead of deriving them.
 *
 * Why (2026-09-26): with a three-paragraph report the local model was asked to
 * narrate ~30 exact quantities — running scores, minute gaps, who scored the
 * fourth try, the margin at the last change — and made about one new false
 * claim per draft ("levelled at 16-all" when the scores were never level;
 * "two minutes later" for fourteen). Each feedback round fixed one and
 * introduced another. The model does not misremember events; it miscounts
 * while writing. So the counting moves here: opening score, runs of
 * unanswered scores with their scorers and the state before/after, lead
 * changes and true level scores, the half-time and final states, the biggest
 * lead, quick doubles, and — for AFL — the term-by-term story. Every line is
 * true by construction; the prompt tells the model these are the only score
 * states, runs and gaps it may cite.
 */

interface Score { minute: number; side: 'team' | 'opp'; scorer: string; how?: string; h: number; a: number; teamPts: number; oppPts: number }

const ordinal = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n - 1] ?? `${n}th`;
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const surname = (n: string) => n.trim().split(/\s+/).pop() ?? n;

function matchesSide(label: string, name: string, short: string): boolean {
  const l = label.toLowerCase(), n = name.toLowerCase(), s = short.toLowerCase();
  return l === n || l === s || l.includes(s) || s.includes(l) || l.includes(n) || n.includes(l);
}

/** Parse soccer GOAL lines and rugby Try / Penalty Goal / Field Goal lines into scores with the running state. */
function parseScores(events: string[], teamName: string, opponent: string, teamShort: string, oppShort: string): { scores: Score[]; ht?: { teamPts: number; oppPts: number }; homeIsTeam: boolean | null } {
  const scores: Score[] = [];
  let ht: { teamPts: number; oppPts: number } | undefined;
  let homeIsTeam: boolean | null = null;
  const sideOf = (label: string): 'team' | 'opp' | null =>
    matchesSide(label, teamName, teamShort) ? 'team' : matchesSide(label, opponent, oppShort) ? 'opp' : null;
  for (const line of events) {
    const htM = line.match(/^HT — (.+?) (\d+)–(\d+) (.+)$/);
    if (htM) {
      const hs = sideOf(htM[1]);
      if (hs) { homeIsTeam = hs === 'team'; ht = hs === 'team' ? { teamPts: +htM[2], oppPts: +htM[3] } : { teamPts: +htM[3], oppPts: +htM[2] }; }
      continue;
    }
    // Soccer: "31' GOAL Brighton — Pascal Gross, right footed shot from outside the box (assist X) [Brighton 1–0 Arsenal]"
    let m = line.match(/^(\d+)'(?:\+\d+')? GOAL (.+?) — ([^,\[(]+?)(?: \(own goal\))?(?:, ([^\[]+?))?\s*(?:\((assist [^)]*)\))?\s*\[(.+?) (\d+)–(\d+) (.+?)\]$/);
    if (m) {
      const side = sideOf(m[2]); if (!side) continue;
      const hIsTeam = sideOf(m[6]) === 'team'; homeIsTeam = hIsTeam;
      const h = +m[7], a = +m[8];
      const how = [m[4]?.trim(), m[5]?.replace(/^assist /, 'assist ')].filter(Boolean).join(', ');
      scores.push({ minute: +m[1], side, scorer: m[3].trim(), how: how || undefined, h, a, teamPts: hIsTeam ? h : a, oppPts: hIsTeam ? a : h });
      continue;
    }
    // Rugby: "17' Try Roosters — Mark Nawaqanitawase — Dolphins 0, Roosters 4"
    m = line.match(/^(\d+)' (Try|Penalty Goal|Field Goal) (.+?) — (.+?) — (.+?) (\d+), (.+?) (\d+)$/);
    if (m) {
      const side = sideOf(m[3]); if (!side) continue;
      const hIsTeam = sideOf(m[5]) === 'team'; homeIsTeam = hIsTeam;
      const h = +m[6], a = +m[8];
      scores.push({ minute: +m[1], side, scorer: m[4].trim(), how: m[2] === 'Try' ? undefined : m[2].toLowerCase(), h, a, teamPts: hIsTeam ? h : a, oppPts: hIsTeam ? a : h });
    }
  }
  return { scores, ht, homeIsTeam };
}

export function buildPassages(input: {
  league: string;
  matchEvents?: string[];
  teamName: string; opponent: string; teamShort: string; opponentShort: string;
  teamScore: number; opponentScore: number;
}): string[] {
  const { league, matchEvents, teamName, opponent, teamShort, opponentShort, teamScore, opponentScore } = input;
  if (!matchEvents?.length) return [];
  if (league === 'afl') return aflPassages(matchEvents, teamName, opponent, teamShort, opponentShort, teamScore, opponentScore);

  const soccer = league === 'epl';
  const unit = soccer ? 'goal' : 'try';
  const units = soccer ? 'goals' : 'tries';
  const name = (s: 'team' | 'opp') => s === 'team' ? teamShort : opponentShort;
  const state = (s: Score) => `${teamShort} ${s.teamPts}–${s.oppPts} ${opponentShort}`;
  // "Isaako and Isaako" → "Isaako (2)".
  const scorerList = (run: Score[]): string => {
    const counts = new Map<string, number>();
    for (const s of run) counts.set(surname(s.scorer), (counts.get(surname(s.scorer)) ?? 0) + 1);
    return list([...counts.entries()].map(([n, c]) => c > 1 ? `${n} (${c})` : n));
  };
  const { scores, ht } = parseScores(matchEvents, teamName, opponent, teamShort, opponentShort);
  if (scores.length === 0) return [];
  const out: string[] = [];

  // Opening score.
  const first = scores[0];
  out.push(`${name(first.side)} scored first: ${first.scorer} on ${first.minute}'${first.how ? ` (${first.how})` : ''}.`);

  // Runs of unanswered scores (≥2), with scorers and the state before/after.
  let i = 0;
  while (i < scores.length) {
    let j = i;
    while (j + 1 < scores.length && scores[j + 1].side === scores[i].side) j++;
    const n = j - i + 1;
    if (n >= 2) {
      const run = scores.slice(i, j + 1);
      const before = i > 0 ? scores[i - 1] : null;
      const beforeState = `${teamShort} ${before?.teamPts ?? 0}–${before?.oppPts ?? 0} ${opponentShort}`;
      const last = run[run.length - 1];
      const pts = run[0].side === 'team' ? last.teamPts - (before?.teamPts ?? 0) : last.oppPts - (before?.oppPts ?? 0);
      const span = last.minute - run[0].minute;
      const ptsNote = soccer ? '' : ` — ${pts} unanswered points`;
      out.push(`${name(run[0].side)} scored ${n} unanswered ${units} between ${run[0].minute}' and ${last.minute}'${span <= 10 ? ` (${n} in ${Math.max(1, span)} minutes)` : ''} — ${scorerList(run)}${ptsNote} — from ${beforeState} to ${state(last)}.`);
    }
    i = j + 1;
  }

  // Level scores and lead changes (true ones only).
  let prevLeader: 'team' | 'opp' | null = null;
  for (const s of scores) {
    const leader: 'team' | 'opp' | null = s.teamPts === s.oppPts ? null : s.teamPts > s.oppPts ? 'team' : 'opp';
    if (leader === null) out.push(`${s.scorer}'s ${unit} on ${s.minute}' levelled it at ${s.teamPts}–${s.oppPts}.`);
    else if (prevLeader !== null && prevLeader !== leader) out.push(`${s.scorer}'s ${unit} on ${s.minute}' put ${name(leader)} ahead, ${state(s)}.`);
    prevLeader = leader;
  }

  // Gaps between consecutive scores — the "N minutes later" the model kept inventing.
  for (let k = 1; k < scores.length; k++) {
    const a = scores[k - 1], b = scores[k];
    const gap = b.minute - a.minute;
    out.push(`${surname(b.scorer)}'s ${unit} (${b.minute}') came ${gap <= 0 ? 'moments' : `${gap} minute${gap === 1 ? '' : 's'}`} after ${surname(a.scorer)}'s (${a.minute}')${a.side !== b.side ? ' — a reply' : ''}.`);
  }

  // Substitutions per side, from the event lines.
  const subs = new Map<string, string[]>();
  for (const line of matchEvents) {
    const m = line.match(/^(\S+) Substitution (.+?) — (.+?) on(?: for (.+?))?$/);
    if (!m) continue;
    const label = matchesSide(m[2], teamName, teamShort) ? teamShort : matchesSide(m[2], opponent, opponentShort) ? opponentShort : m[2];
    (subs.get(label) ?? subs.set(label, []).get(label)!).push(`${m[1]} ${surname(m[3])}${m[4] ? ` for ${surname(m[4])}` : ''}`);
  }
  for (const [label, arr] of subs) out.push(`${label} made ${arr.length} substitution${arr.length === 1 ? '' : 's'}: ${arr.join(', ')}.`);

  // Half-time, second-half split, final.
  if (ht) {
    const lead = ht.teamPts === ht.oppPts ? 'level' : ht.teamPts > ht.oppPts ? `${teamShort} led by ${ht.teamPts - ht.oppPts}` : `${opponentShort} led by ${ht.oppPts - ht.teamPts}`;
    out.push(`Half-time: ${teamShort} ${ht.teamPts}–${ht.oppPts} ${opponentShort} (${lead}).`);
    const t2 = teamScore - ht.teamPts, o2 = opponentScore - ht.oppPts;
    const firstHalf = scores.filter(s => s.minute <= 45 && (s.teamPts <= ht.teamPts && s.oppPts <= ht.oppPts));
    const secondHalf = scores.filter(s => !firstHalf.includes(s));
    const cnt = (arr: Score[], side: 'team' | 'opp') => arr.filter(s => s.side === side).length;
    out.push(soccer
      ? `Second half: ${teamShort} ${t2}–${o2} ${opponentShort} (first half ${cnt(firstHalf, 'team')}–${cnt(firstHalf, 'opp')}).`
      : `Second half: ${teamShort} ${t2}–${o2} ${opponentShort} on points; tries ${cnt(secondHalf, 'team')}–${cnt(secondHalf, 'opp')} (first half ${cnt(firstHalf, 'team')}–${cnt(firstHalf, 'opp')}).`);
  }

  // Biggest lead.
  let big: Score | null = null;
  for (const s of scores) if (!big || Math.abs(s.teamPts - s.oppPts) > Math.abs(big.teamPts - big.oppPts)) big = s;
  if (big && big.teamPts !== big.oppPts) {
    const leader = big.teamPts > big.oppPts ? 'team' : 'opp';
    out.push(`${name(leader)}'s biggest lead was ${Math.abs(big.teamPts - big.oppPts)} (${state(big)} after ${big.minute}').`);
  }

  const last = scores[scores.length - 1];
  out.push(`Last score: ${last.scorer} on ${last.minute}'; final ${teamShort} ${teamScore}–${opponentScore} ${opponentShort}.`);
  return out;
}

/** AFL: the term-by-term story from the Q-lines. */
function aflPassages(events: string[], teamName: string, opponent: string, teamShort: string, opponentShort: string, teamScore: number, opponentScore: number): string[] {
  type Q = { n: number; tg: number; tb: number; tp: number; og: number; ob: number; op: number; tcum: number; ocum: number };
  const qs: Q[] = [];
  const sideOf = (label: string): 'team' | 'opp' | null =>
    matchesSide(label, teamName, teamShort) ? 'team' : matchesSide(label, opponent, opponentShort) ? 'opp' : null;
  for (const line of events) {
    const m = line.match(/^Q(\d) — (.+?) (\d+)\.(\d+) \((\d+)\) v (.+?) (\d+)\.(\d+) \((\d+)\) in the term; (.+?) (\d+)\.(\d+) \((\d+)\) – (\d+)\.(\d+) \((\d+)\) (.+?) after/);
    if (!m) continue;
    const hs = sideOf(m[2]), as = sideOf(m[6]);
    if (!hs || !as) continue;
    const home = { g: +m[3], b: +m[4], p: +m[5], cum: +m[13] }, away = { g: +m[7], b: +m[8], p: +m[9], cum: +m[16] };
    const t = hs === 'team' ? home : away, o = hs === 'team' ? away : home;
    qs.push({ n: +m[1], tg: t.g, tb: t.b, tp: t.p, og: o.g, ob: o.b, op: o.p, tcum: t.cum, ocum: o.cum });
  }
  if (qs.length === 0) return [];
  const out: string[] = [];
  const changes = ['quarter-time', 'half-time', 'three-quarter time', 'the final siren'];
  let prevMargin = 0;
  for (const q of qs) {
    const margin = q.tcum - q.ocum;
    const termWinner = q.tp === q.op ? null : q.tp > q.op ? teamShort : opponentShort;
    const termLine = termWinner
      ? `${termWinner} won the ${ordinal(q.n)} term ${q.tp > q.op ? `${q.tg}.${q.tb} (${q.tp}) to ${q.og}.${q.ob} (${q.op})` : `${q.og}.${q.ob} (${q.op}) to ${q.tg}.${q.tb} (${q.tp})`}`
      : `The ${ordinal(q.n)} term was even, ${q.tg}.${q.tb} (${q.tp}) apiece`;
    const at = margin === 0 ? `scores level at ${changes[q.n - 1]}` : `${margin > 0 ? teamShort : opponentShort} led by ${Math.abs(margin)} at ${changes[q.n - 1]} (${teamShort} ${q.tcum}–${q.ocum} ${opponentShort})`;
    out.push(`${termLine}; ${at}.`);
    if (q.n > 1 && Math.sign(prevMargin) !== 0 && Math.sign(margin) !== 0 && Math.sign(prevMargin) !== Math.sign(margin)) {
      const swingSide = margin > 0 ? teamShort : opponentShort;
      out.push(`The lead changed in the ${ordinal(q.n)} term: ${swingSide} turned a ${Math.abs(prevMargin)}-point deficit into a ${Math.abs(margin)}-point lead.`);
    }
    prevMargin = margin;
  }
  const tif = events.find(l => l.startsWith('Time in front:'));
  if (tif) out.push(`${tif}.`);
  out.push(`Final: ${teamShort} ${teamScore}–${opponentScore} ${opponentShort}.`);
  return out;
}
