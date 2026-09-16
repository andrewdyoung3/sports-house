/**
 * Unit tests for the angle engine (src/lib/angle-engine.ts).
 * Run: npx tsx scripts/test-angle-engine.ts
 */
import { deriveAngles, type AngleInput } from '../src/lib/angle-engine';
import type { GameResult } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const g = (isWin: boolean, date: string, isDraw = false): GameResult => ({
  opponent: 'X', opponentAbbr: 'X', isHome: true, isWin, isDraw,
  teamScore: isWin ? 2 : 0, opponentScore: isWin ? 0 : 2, date,
});
const wins = (n: number, lastDate = '2026-09-10') =>
  Array.from({ length: n }, (_, k) => g(true, k === 0 ? lastDate : '2026-08-01'));
const losses = (n: number, lastDate = '2026-09-10') =>
  Array.from({ length: n }, (_, k) => g(false, k === 0 ? lastDate : '2026-08-01'));
const base: AngleInput = { teamName: 'Alpha', opponentName: 'Beta' };
const kinds = (i: AngleInput) => deriveAngles(i).map(a => a.kind);

console.log('streak detection');
check('3 wins → streak', kinds({ ...base, teamForm: wins(3) }).includes('streak'));
check('2 wins → no streak', kinds({ ...base, teamForm: wins(2) }).length === 0);
check('draw breaks streak', kinds({ ...base, teamForm: [g(false, '2026-09-10', true), ...wins(3)] }).length === 0);
check('loss streak detected', deriveAngles({ ...base, teamForm: losses(4) })[0].line.includes('lost 4 straight'));

console.log('streak-vs-slayer');
{
  const a = deriveAngles({ ...base, teamForm: wins(4), headToHead: [{ date: '2026-05-01', teamScore: 10, opponentScore: 20, result: 'L' }] });
  check('team streak + last H2H loss → slayer top', a[0]?.kind === 'streak-vs-slayer');
  check('slayer outranks plain streak', a[0].score > (a.find(x => x.kind === 'streak')?.score ?? 0));
}
check('opp streak + team won last meeting → slayer', kinds({ ...base, opponentForm: wins(3), headToHead: [{ date: '2026-05-01', teamScore: 20, opponentScore: 10, result: 'W' }] }).includes('streak-vs-slayer'));
check('no slayer without matching H2H direction', !kinds({ ...base, teamForm: wins(4), headToHead: [{ date: '2026-05-01', teamScore: 20, opponentScore: 10, result: 'W' }] }).includes('streak-vs-slayer'));

console.log('rest-vs-run');
{
  const i: AngleInput = { ...base, fixtureDateISO: '2026-09-18T09:00Z', teamForm: [g(true, '2026-09-05')], opponentForm: [g(true, '2026-09-12')] };
  const a = deriveAngles(i);
  check('≥6-day differential fires', a.some(x => x.kind === 'rest-vs-run'));
  check('fresh side named first', a.find(x => x.kind === 'rest-vs-run')!.line.startsWith('Alpha'));
}
check('small differential silent', !kinds({ ...base, fixtureDateISO: '2026-09-18T09:00Z', teamForm: [g(true, '2026-09-11')], opponentForm: [g(true, '2026-09-13')] }).includes('rest-vs-run'));

console.log('h2h dominance');
const h2h = (seq: ('W' | 'L' | 'D')[]) => seq.map((r, k) => ({ date: `2026-0${k + 1}-01`, teamScore: 1, opponentScore: 1, result: r }));
check('4 straight H2H wins fires', kinds({ ...base, headToHead: h2h(['W', 'W', 'W', 'W']) }).includes('h2h-dominance'));
check('opponent dominance attributed to Beta', deriveAngles({ ...base, headToHead: h2h(['L', 'L', 'L']) })[0].line.startsWith('Beta'));
check('2-run silent', !kinds({ ...base, headToHead: h2h(['W', 'W', 'L']) }).includes('h2h-dominance'));
check('draw first → silent', !kinds({ ...base, headToHead: h2h(['D', 'W', 'W', 'W']) }).includes('h2h-dominance'));

console.log('absence cluster');
check('4 vs 1 outs fires', kinds({ ...base, teamAbsenceCount: 4, opponentAbsenceCount: 1 }).includes('absence-cluster'));
check('3 vs 3 silent (no gap)', !kinds({ ...base, teamAbsenceCount: 3, opponentAbsenceCount: 3 }).includes('absence-cluster'));
check('2 vs 0 silent (below floor)', !kinds({ ...base, teamAbsenceCount: 2, opponentAbsenceCount: 0 }).includes('absence-cluster'));

console.log('market upset');
check('favourite below on table fires', kinds({ ...base, marketFavouriteIsTeam: true, teamPosition: 9, opponentPosition: 3 }).includes('market-upset'));
check('favourite above on table silent', !kinds({ ...base, marketFavouriteIsTeam: true, teamPosition: 2, opponentPosition: 8 }).includes('market-upset'));

console.log('venue bias');
check('chase 62% fires', kinds({ ...base, venueChaseWinPct: 62 }).includes('venue-bias'));
check('defend 38% fires with inverted pct', deriveAngles({ ...base, venueChaseWinPct: 38 })[0].line.includes('62%'));
check('50% silent', !kinds({ ...base, venueChaseWinPct: 50 }).includes('venue-bias'));

console.log('venue fortress / graveyard');
const vr = (w: number, d: number, l: number) => ({ venue: 'M.C.G.', wins: w, draws: d, losses: l });
check('6W-2L at venue → fortress', deriveAngles({ ...base, teamVenueRecord: vr(6, 0, 2) })[0]?.kind === 'venue-fortress');
check('fortress line counts games', deriveAngles({ ...base, teamVenueRecord: vr(6, 0, 2) })[0].line.includes('won 6 of 8'));
check('1W-5L opponent → graveyard for Beta', deriveAngles({ ...base, opponentVenueRecord: vr(1, 0, 5) })[0]?.line.startsWith('Beta'));
check('3 games at venue silent (below floor)', kinds({ ...base, teamVenueRecord: vr(3, 0, 0) }).length === 0);
check('50% record silent', kinds({ ...base, teamVenueRecord: vr(3, 0, 3) }).length === 0);

console.log('table collision + thirds gating');
check('1v2 final third fires', kinds({ ...base, seasonThird: 3, teamPosition: 1, opponentPosition: 2 }).includes('table-collision'));
check('1v2 FIRST third silent (thirds policy)', !kinds({ ...base, seasonThird: 1, teamPosition: 1, opponentPosition: 2 }).includes('table-collision'));
check('1v2 second third silent', !kinds({ ...base, seasonThird: 2, teamPosition: 1, opponentPosition: 2 }).includes('table-collision'));
check('adjacent mid-table final third fires low', kinds({ ...base, seasonThird: 3, teamPosition: 6, opponentPosition: 7 }).includes('table-collision'));
check('no seasonThird (finals/cup) → silent', !kinds({ ...base, teamPosition: 1, opponentPosition: 2 }).includes('table-collision'));

console.log('ranking & cap');
{
  const a = deriveAngles({
    ...base, fixtureDateISO: '2026-09-18T09:00Z',
    teamForm: wins(5, '2026-09-04'), opponentForm: losses(4, '2026-09-13'),
    headToHead: h2h(['L', 'L', 'L', 'L']),
    teamAbsenceCount: 4, opponentAbsenceCount: 0,
    seasonThird: 3, teamPosition: 1, opponentPosition: 2,
  });
  check('capped at 3', a.length === 3);
  check('sorted descending', a[0].score >= a[1].score && a[1].score >= a[2].score);
  check('slayer wins the crowded board', a[0].kind === 'streak-vs-slayer');
}
check('empty input → empty', deriveAngles(base).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
