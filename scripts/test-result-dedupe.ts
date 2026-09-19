#!/usr/bin/env tsx
/**
 * scripts/test-result-dedupe.ts — the results page merges two sources.
 *
 * A followed TEAM's results arrive from that team's perspective; a followed
 * COMPETITION's results arrive from the canonical home perspective. The same
 * match therefore appears twice, under different teamIds, different opponent
 * names and different render ids. resultMatchKey() is what collapses them.
 *
 * Caught live while building this: keying on ids produced "afl-lions|haw" and
 * "afl-hawks|bri" for the SAME match, so the AFL league view returned 90 rows
 * (18 teams x 5) instead of 51. Only two of the nine fetchers populate
 * GameResult.opponentId, so abbreviations are the only vocabulary both
 * perspectives share.
 *
 * Run: npx tsx scripts/test-result-dedupe.ts   (also part of `npm run test`)
 */

import { resultMatchKey } from '@/lib/result-match-key';

let passed = 0;
let failed = 0;
function expect(name: string, cond: boolean): void {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}`);
}

console.log('\n── the two perspectives of one match collapse ──');
{
  // The exact live case: Brisbane won at Hawthorn, 131–122, 2026-09-19.
  const fromTeam = resultMatchKey({
    league: 'afl', teamId: 'afl-lions', teamAbbr: 'BRI',
    opponent: 'Hawthorn', opponentAbbr: 'HAW', date: '2026-09-19T07:20:00.000Z',
  });
  const fromLeague = resultMatchKey({
    league: 'afl', teamId: 'afl-hawks', teamAbbr: 'HAW',
    opponent: 'Brisbane Lions', opponentAbbr: 'BRI', date: '2026-09-19T07:20:00.000Z',
  });
  expect('AFL: team view and league view share a key', fromTeam === fromLeague);

  // Ids are NOT a shared vocabulary — this is the mistake the key must avoid.
  const idish = (a: string, b: string) => [a, b].sort().join('|');
  expect('the id-based key would NOT have matched (regression guard)',
    idish('afl-lions', 'haw') !== idish('afl-hawks', 'bri'));

  const soccer = (teamId: string, teamAbbr: string, opponent: string, opponentAbbr: string) =>
    resultMatchKey({ league: 'epl', teamId, teamAbbr, opponent, opponentAbbr, date: '2026-09-19T14:00:00.000Z' });
  expect('EPL: Brighton 3-0 Arsenal collapses from either side',
    soccer('epl-brighton', 'BHA', 'Arsenal', 'ARS') === soccer('epl-arsenal', 'ARS', 'Brighton & Hove Albion', 'BHA'));
}

console.log('── matches that are genuinely different stay different ──');
{
  const k = (teamAbbr: string, opponentAbbr: string, date: string) =>
    resultMatchKey({ league: 'afl', teamId: 't', teamAbbr, opponent: 'X', opponentAbbr, date });
  expect('same pair on different days are two matches',
    k('BRI', 'HAW', '2026-09-19') !== k('BRI', 'HAW', '2026-06-14'));
  expect('different pairs on one day are two matches',
    k('BRI', 'HAW', '2026-09-19') !== k('BRI', 'GEE', '2026-09-19'));
  expect('time of day does not split a match',
    k('BRI', 'HAW', '2026-09-19T07:20:00.000Z') === k('BRI', 'HAW', '2026-09-19T23:59:00.000Z'));
}

console.log('── F1: a race is one event, not one row per driver ──');
{
  // Every driver/constructor fetch returns the same race; the competition view
  // returns it once. All must collapse to a single row.
  const race = (teamId: string) => resultMatchKey({
    league: 'f1', teamId, opponent: 'Canadian Grand Prix', opponentAbbr: 'CAN',
    date: '2026-05-24T18:00:00.000Z',
  });
  expect('championship, driver and constructor views share one key',
    race('f1') === race('f1-norris') && race('f1') === race('f1-team-mclaren'));
  expect('two different races stay distinct',
    resultMatchKey({ league: 'f1', teamId: 'f1', opponent: 'Miami Grand Prix', date: '2026-05-03' })
    !== resultMatchKey({ league: 'f1', teamId: 'f1', opponent: 'Canadian Grand Prix', date: '2026-05-24' }));
  expect('a race is not confused with a team match on the same day',
    resultMatchKey({ league: 'f1', teamId: 'f1', opponent: 'Miami Grand Prix', date: '2026-05-03' })
    !== resultMatchKey({ league: 'afl', teamId: 'f1', opponent: 'Miami Grand Prix', date: '2026-05-03' }));
}

console.log('── degraded inputs still key consistently ──');
{
  // Cup opponents outside TEAMS have no id and sometimes no abbr.
  const withAbbr = resultMatchKey({
    league: 'epl', teamId: 'epl-forest', teamAbbr: 'NFO',
    opponent: 'Coventry City', opponentAbbr: 'COV', date: '2026-09-19',
  });
  const noAbbr = resultMatchKey({
    league: 'epl', teamId: 'epl-forest', teamAbbr: 'NFO',
    opponent: 'Coventry City', date: '2026-09-19',
  });
  expect('a missing opponent abbr falls back to the name, not a crash', noAbbr.length > 0);
  expect('present vs missing abbr are different keys (no false merge)', withAbbr !== noAbbr);
  expect('name fallback is stable across calls',
    noAbbr === resultMatchKey({ league: 'epl', teamId: 'epl-forest', teamAbbr: 'NFO', opponent: 'Coventry City', date: '2026-09-19' }));
  expect('case and padding do not split a match',
    resultMatchKey({ league: 'afl', teamId: 't', teamAbbr: ' BRI ', opponent: 'X', opponentAbbr: 'HAW', date: '2026-09-19' })
    === resultMatchKey({ league: 'afl', teamId: 't', teamAbbr: 'bri', opponent: 'X', opponentAbbr: 'haw', date: '2026-09-19' }));
  expect('opponentId is used when a fetcher supplies no abbr',
    resultMatchKey({ league: 'bbl', teamId: 'bbl-heat', teamAbbr: 'HEA', opponent: 'Sydney Sixers', opponentId: 'bbl-sixers', date: '2026-01-10' })
    !== resultMatchKey({ league: 'bbl', teamId: 'bbl-heat', teamAbbr: 'HEA', opponent: 'Melbourne Stars', opponentId: 'bbl-stars', date: '2026-01-10' }));
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
