/**
 * Standard per-sport key-contribution lines for post-match reviews — derived
 * SERVER-SIDE from match data, never LLM-generated (user requirement
 * 2026-09-16: goal scorers/assists for soccer, try scorers for the rugby
 * codes, goal kickers for AFL, a scoring chart for cricket). Attached to the
 * review response as `contributions` and rendered as a strip in the panel.
 *
 * Also here since 2026-09-25: KEY FACTORS, derived the same way. The model's
 * own "key moments" were restatements of the goals the strip already showed,
 * plus one invented bullet ("two goals in short succession to begin the
 * match" for goals at 31' and 45'). Factors are facts the strip does NOT
 * carry: the half-time state, what the team stats say about the method, the
 * manager's reaction (substitutions), and the season-context lines.
 */

import type { MatchStats } from '@/types';
import type { CricScorecardInning } from '@/lib/cricketdata';
import type { MatchReport, TeamStatLine } from '@/lib/match-report';

const statNum = (stats: Array<{ label: string; value: string }>, labels: string[]): number => {
  for (const s of stats) if (labels.includes(s.label)) { const n = parseFloat(s.value); if (!Number.isNaN(n)) return n; }
  return 0;
};
const statRaw = (stats: Array<{ label: string; value: string }>, labels: string[]): string | undefined => {
  for (const s of stats) if (labels.includes(s.label)) return s.value;
  return undefined;
};

export function buildContributions(
  league: string,
  matchStats: MatchStats | null | undefined,
  scoringTimeline: string[] | undefined,
  cricketChart: string[] | undefined,
  extras?: {
    /** Soccer assists in scoring order (match report). */
    assists?: Array<{ name: string; team: string }>;
    /** Rugby league try scorers with side (nrl.com timeline) — used when no player rows exist. */
    tries?:   Array<{ name: string; team: string }>;
  },
): string[] {
  // Cricket: the chart IS the standard format.
  if (league === 'cricket_int' || league === 'bbl') return cricketChart ?? [];

  const out: string[] = [];
  const assists = extras?.assists;

  // NRL without player rows: tries per side from the timeline.
  const hasPlayerRows = !!matchStats?.team?.players?.length || !!matchStats?.opponent?.players?.length;
  if (league === 'nrl' && !hasPlayerRows && extras?.tries?.length) {
    const bySide = new Map<string, Map<string, number>>();
    for (const t of extras.tries) {
      const side = bySide.get(t.team) ?? bySide.set(t.team, new Map()).get(t.team)!;
      side.set(t.name, (side.get(t.name) ?? 0) + 1);
    }
    for (const [side, names] of bySide) {
      out.push(`Tries (${side}): ${[...names.entries()].map(([n, c]) => c > 1 ? `${n} ${c}` : n).join(', ')}`);
    }
  }

  // Soccer: goals with minutes from the derived timeline (authoritative order).
  // Line shape: "31' Name (Team)[ — own goal| — penalty]".
  if (league === 'epl' && scoringTimeline?.length) {
    const byScorer = new Map<string, string[]>();
    for (const line of scoringTimeline) {
      const m = line.match(/^(\d+'(?:\+\d+')?)\s+(.+?)\s+\((.+?)\)(?:\s+—\s+(own goal|penalty))?/);
      if (!m) continue;
      const tag = m[4] === 'own goal' ? ' (og)' : m[4] === 'penalty' ? ' (pen)' : '';
      const key = `${m[2]} (${m[3]})`;
      (byScorer.get(key) ?? byScorer.set(key, []).get(key)!).push(`${m[1]}${tag}`);
    }
    if (byScorer.size > 0) {
      out.push('Goals: ' + [...byScorer.entries()].map(([who, mins]) => `${who} ${mins.join(', ')}`).join('; '));
    }
    if (assists?.length) {
      const byName = new Map<string, number>();
      for (const a of assists) byName.set(`${a.name} (${a.team})`, (byName.get(`${a.name} (${a.team})`) ?? 0) + 1);
      out.push('Assists: ' + [...byName.entries()].map(([who, n]) => n > 1 ? `${who} ${n}` : who).join('; '));
    }
  }

  if (!matchStats) return out;
  for (const [side] of [[matchStats.team], [matchStats.opponent]] as const) {
    if (!side?.players?.length) continue;
    if (league === 'nrl' || league === 'super_rugby' || league === 'rugby_int') {
      const tries = side.players.filter(p => statNum(p.stats, ['T', 'Tries']) > 0)
        .map(p => { const n = statNum(p.stats, ['T', 'Tries']); return n > 1 ? `${p.name} ${n}` : p.name; });
      if (tries.length) out.push(`Tries (${side.teamName}): ${tries.join(', ')}`);
      const kickers = side.players.filter(p => statRaw(p.stats, ['G', 'Goals']) && statNum(p.stats, ['G', 'Goals']) > 0)
        .map(p => `${p.name} ${statRaw(p.stats, ['G', 'Goals'])}`);
      if (kickers.length) out.push(`Goals (${side.teamName}): ${kickers.join(', ')}`);
    }
    if (league === 'afl') {
      const kickers = side.players.filter(p => statRaw(p.stats, ['Goals']) && parseFloat(statRaw(p.stats, ['Goals'])!) > 0)
        .sort((a, b) => parseFloat(statRaw(b.stats, ['Goals'])!) - parseFloat(statRaw(a.stats, ['Goals'])!))
        .map(p => `${p.name} ${statRaw(p.stats, ['Goals'])}`);
      if (kickers.length) out.push(`Goals (${side.teamName}): ${kickers.slice(0, 6).join(', ')}`);
    }
    if (league === 'epl' && !assists?.length) {
      const found = side.players.filter(p => statNum(p.stats, ['A', 'Assists']) > 0)
        .map(p => { const n = statNum(p.stats, ['A', 'Assists']); return n > 1 ? `${p.name} ${n}` : p.name; });
      if (found.length) out.push(`Assists (${side.teamName}): ${found.join(', ')}`);
    }
  }
  return out;
}

// ─── Key factors (derived) ───────────────────────────────────────────────────

/** Stat pairs worth a bullet, per sport: label as the block renders it → how to say it. */
const FACTOR_STATS: Record<string, Array<{ label: string; noun: string; minGap: number; pct?: boolean }>> = {
  epl: [
    { label: 'Possession %',    noun: 'possession',      minGap: 10, pct: true },
    { label: 'Shots on target', noun: 'shots on target', minGap: 2 },
    { label: 'Shots',           noun: 'shots',           minGap: 5 },
    { label: 'Corners',         noun: 'corners',         minGap: 4 },
  ],
  nrl: [
    { label: 'Line breaks',    noun: 'line breaks',        minGap: 3 },
    { label: 'Missed tackles', noun: 'missed tackles',     minGap: 10 },
    { label: 'Comp %',         noun: 'completion rate',    minGap: 8, pct: true },
    { label: 'Run metres',     noun: 'run metres',         minGap: 150 },
    { label: 'Tackle breaks',  noun: 'tackle breaks',      minGap: 12 },
    { label: 'Poss %',         noun: 'possession',         minGap: 8, pct: true },
    { label: 'Errors',         noun: 'errors',             minGap: 4 },
    { label: 'Pens',           noun: 'penalties conceded', minGap: 3 },
  ],
  afl: [
    { label: 'Scoring shots',         noun: 'scoring shots',         minGap: 4 },
    { label: 'Inside 50s',            noun: 'inside 50s',            minGap: 8 },
    { label: 'Contested possessions', noun: 'contested possessions', minGap: 10 },
    { label: 'Clearances',            noun: 'clearances',            minGap: 6 },
    { label: 'Disposals',             noun: 'disposals',             minGap: 40 },
    { label: 'Tackles',               noun: 'tackles',               minGap: 15 },
  ],
  super_rugby: [
    { label: 'Poss %',   noun: 'possession', minGap: 8, pct: true },
    { label: 'Terr %',   noun: 'territory',  minGap: 8, pct: true },
  ],
};
FACTOR_STATS.rugby_int = FACTOR_STATS.super_rugby;

function statPairs(
  team: TeamStatLine[] | undefined,
  opp:  TeamStatLine[] | undefined,
  league: string,
  teamShort: string,
  oppShort: string,
): string[] {
  if (!team?.length || !opp?.length) return [];
  const out: string[] = [];
  for (const f of FACTOR_STATS[league] ?? []) {
    const a = statNum(team, [f.label]), b = statNum(opp, [f.label]);
    if (!a && !b) continue;
    if (Math.abs(a - b) < f.minGap) continue;
    // "Led" is right for volume stats; for errors / missed tackles / penalties the
    // side with MORE is the one at fault, so phrase it as conceding.
    const fault = /^(errors|missed tackles|penalties conceded)$/.test(f.noun);
    const lead = a > b ? teamShort : oppShort;
    const fmt = (n: number) => f.pct ? `${Math.round(n)}%` : String(n);
    out.push(fault
      ? `${lead} ${f.noun === 'errors' ? 'made' : f.noun === 'missed tackles' ? 'missed' : 'conceded'} ${f.noun === 'missed tackles' ? 'tackles' : f.noun === 'errors' ? 'errors' : 'penalties'} ${fmt(Math.max(a, b))}–${fmt(Math.min(a, b))}`
      : `${lead} led ${f.noun} ${fmt(Math.max(a, b))}–${fmt(Math.min(a, b))}`);
  }
  return out;
}

/**
 * Derived key factors, most telling first, capped at 4. Empty when the data
 * gives nothing beyond the scoreline (the route then keeps the model's own).
 */
export function buildKeyFactors(input: {
  league:        string;
  teamName:      string;
  opponent:      string;
  teamShort:     string;
  opponentShort: string;
  teamScore:     number;
  opponentScore: number;
  report?:       MatchReport;
  /** Event lines when there is no ESPN report (nrl.com timeline) — read for the HT line. */
  matchEvents?:  string[];
  matchStats?:   MatchStats | null;
  seasonFacts?:  string[];
}): string[] {
  const { league, report, matchStats, teamShort, opponentShort } = input;
  // Event lines name sides as the source spells them (ESPN displayName, nrl.com
  // nickname), so match loosely against our full and short names.
  const sameSide = (label: string, full: string, shortName: string): boolean => {
    const l = label.toLowerCase(), f = full.toLowerCase(), s = shortName.toLowerCase();
    return l === f || l === s || l.includes(s) || s.includes(l) || l.includes(f) || f.includes(l);
  };
  const short = (labelA: string, labelB: string, pickA: boolean): string => {
    const label = pickA ? labelA : labelB;
    if (sameSide(label, input.teamName, teamShort)) return teamShort;
    if (sameSide(label, input.opponent, opponentShort)) return opponentShort;
    return label;
  };
  const shortOf = (full: string) => full === input.teamName ? teamShort : full === input.opponent ? opponentShort : full;
  const out: string[] = [];

  // Half-time state (any sport whose events carry "HT — Home h–a Away"), and
  // the second-half split when one side owned it.
  const events = report?.events?.length ? report.events : input.matchEvents ?? [];
  const ht = events.find(l => l.startsWith('HT — '))?.match(/^HT — (.+?) (\d+)–(\d+) (.+)$/);
  if (ht) {
    const [, h, hs, as, a] = ht;
    const hn = Number(hs), an = Number(as);
    out.push(hn === an
      ? `Level ${hn}–${an} at half-time`
      : `${short(h, a, hn > an)} led ${Math.max(hn, an)}–${Math.min(hn, an)} at half-time`);
    // Which of the HT names is the perspective team decides the split's direction.
    const homeIsTeam = sameSide(h, input.teamName, input.teamShort);
    const teamHT = homeIsTeam ? hn : an, oppHT = homeIsTeam ? an : hn;
    const t2 = input.teamScore - teamHT, o2 = input.opponentScore - oppHT;
    if (t2 >= 0 && o2 >= 0 && (t2 + o2) > 0) {
      const unit = league === 'epl' ? 3 : 12;
      if (Math.abs(t2 - o2) >= unit || (Math.min(t2, o2) === 0 && Math.max(t2, o2) >= unit / 2)) {
        out.push(`${t2 > o2 ? teamShort : opponentShort} won the second half ${Math.max(t2, o2)}–${Math.min(t2, o2)}`);
      }
    }
  }

  // Where the goals came from (soccer report).
  if (report?.events?.length) {
    const goals = report.events.filter(l => /^\S+ GOAL /.test(l));
    const outside = goals.filter(l => /from outside the box|from (?:long|distance)|from (?:2[0-9]|3[0-9]) yards/i.test(l)).length;
    if (outside >= 2) out.push(`${outside} of the ${goals.length} goals came from outside the box`);
    const setPiece = goals.filter(l => /following a (?:corner|set piece|free kick)/i.test(l)).length;
    if (setPiece >= 2) out.push(`${setPiece} goals from set pieces`);
    const fastBreak = goals.filter(l => /following a fast break/i.test(l)).length;
    if (fastBreak >= 1 && goals.length >= 2) out.push(`${fastBreak === 1 ? 'One goal' : `${fastBreak} goals`} came on the counter`);

    // Manager reaction: a multiple substitution inside 5' of conceding.
    const subs = report.events.filter(l => /^\S+ Substitution /.test(l));
    const minute = (l: string) => Number(l.match(/^(\d+)'/)?.[1] ?? NaN);
    for (const g of goals) {
      const gm = minute(g);
      const concededBy = g.includes(`GOAL ${input.opponent}`) ? input.teamName : g.includes(`GOAL ${input.teamName}`) ? input.opponent : null;
      if (!concededBy) continue;
      const reaction = subs.filter(s => s.includes(`Substitution ${concededBy}`) && minute(s) >= gm && minute(s) - gm <= 5);
      if (reaction.length >= 2) {
        const names = reaction.map(s => s.match(/— (.+?) on/)?.[1]).filter(Boolean);
        // "[Home 3–0 Away]" → the conceding side's view of the score.
        const sc = g.match(/\[(.+?) (\d+)–(\d+) (.+?)\]$/);
        let state = 'behind';
        if (sc) {
          const [, h, hs, as] = sc;
          const mineFirst = h === concededBy;
          const a = Number(mineFirst ? hs : as), b = Number(mineFirst ? as : hs);
          state = a < b ? `${a}–${b} down` : a > b ? `${a}–${b} up` : `level at ${a}–${b}`;
        }
        out.push(`${shortOf(concededBy)} made ${reaction.length} changes within ${minute(reaction[0]) - gm || 1}' of going ${state} (${names.join(', ')})`);
        break;
      }
    }
    const reds = report.events.filter(l => /^\S+ Red card /.test(l));
    for (const r of reds) out.push(r.replace(/^(\S+) Red card — (.+?) \((.+?)\).*$/, (_m, min, who, team) => `${shortOf(team)} down to ten from ${min} (${who} sent off)`));
  }

  // Team-stat gaps: what the method looked like.
  const teamStats = matchStats?.team?.aggStats?.length ? matchStats.team.aggStats : report?.teamStats?.team;
  const oppStats  = matchStats?.opponent?.aggStats?.length ? matchStats.opponent.aggStats : report?.teamStats?.opponent;
  out.push(...statPairs(teamStats, oppStats, league, teamShort, opponentShort).slice(0, 2));

  // Season context: the one line that changes how the result reads.
  const sf = input.seasonFacts ?? [];
  const pick = sf.find(l => /first defeat of the season/i.test(l))
    ?? sf.find(l => /ends .* run of/i.test(l))
    ?? sf.find(l => /most (?:goals|points) .* conceded/i.test(l))
    ?? sf.find(l => /extends .* run to/i.test(l));
  if (pick) out.push(pick.replace(/^This (?:result|defeat) /, '').replace(/^ends/, 'Ends').replace(/^extends/, 'Extends').replace(/ \(this season\)\.?$/, '').replace(/\.$/, ''));

  return out.slice(0, 4);
}

/** Cricket scoring chart from a cricketdata scorecard: top batters + best bowling per innings. */
export function buildCricketChart(scorecard: CricScorecardInning[] | null | undefined): string[] {
  if (!scorecard?.length) return [];
  const out: string[] = [];
  for (const inn of scorecard) {
    const label = (inn.inning ?? 'Innings').replace(/ inning.*$/i, '');
    const bats = (inn.batting ?? [])
      .filter(b => (b.r ?? 0) > 0 || (b.b ?? 0) > 0)
      .sort((a, b) => (b.r ?? 0) - (a.r ?? 0))
      .slice(0, 3)
      .map(b => `${b.batsman?.name ?? '?'} ${b.r ?? 0}${b.b ? ` (${b.b})` : ''}`);
    if (bats.length) out.push(`${label} — batting: ${bats.join(', ')}`);
    const bowls = (inn.bowling ?? [])
      .filter(b => (b.w ?? 0) > 0)
      .sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || (a.r ?? 99) - (b.r ?? 99))
      .slice(0, 2)
      .map(b => `${b.bowler?.name ?? '?'} ${b.w}/${b.r}${b.o ? ` (${b.o})` : ''}`);
    if (bowls.length) out.push(`${label} — bowling: ${bowls.join(', ')}`);
  }
  return out;
}
