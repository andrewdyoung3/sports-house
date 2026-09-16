/**
 * Standard per-sport key-contribution lines for post-match reviews — derived
 * SERVER-SIDE from match data, never LLM-generated (user requirement
 * 2026-09-16: goal scorers/assists for soccer, try scorers for the rugby
 * codes, goal kickers for AFL, a scoring chart for cricket). Attached to the
 * review response as `contributions` and rendered as a strip in the panel.
 */

import type { MatchStats } from '@/types';
import type { CricScorecardInning } from '@/lib/cricketdata';

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
): string[] {
  // Cricket: the chart IS the standard format.
  if (league === 'cricket_int' || league === 'bbl') return cricketChart ?? [];

  const out: string[] = [];

  // Soccer: goals with minutes from the derived timeline (authoritative order).
  if (league === 'epl' && scoringTimeline?.length) {
    const byScorer = new Map<string, string[]>();
    for (const line of scoringTimeline) {
      const m = line.match(/^(\d+'(?:\+\d+')?)\s+(.+?)\s+\((.+?)\)/);
      if (!m) continue;
      const key = `${m[2]} (${m[3]})`;
      (byScorer.get(key) ?? byScorer.set(key, []).get(key)!).push(m[1]);
    }
    if (byScorer.size > 0) {
      out.push('Goals: ' + [...byScorer.entries()].map(([who, mins]) => `${who} ${mins.join(', ')}`).join('; '));
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
    if (league === 'epl') {
      const assists = side.players.filter(p => statNum(p.stats, ['A', 'Assists']) > 0)
        .map(p => { const n = statNum(p.stats, ['A', 'Assists']); return n > 1 ? `${p.name} ${n}` : p.name; });
      if (assists.length) out.push(`Assists (${side.teamName}): ${assists.join(', ')}`);
    }
  }
  return out;
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
