#!/usr/bin/env tsx
/**
 * scripts/test-prefs-sync.ts — followed TEAMS and followed COMPETITIONS must
 * travel together.
 *
 * The bug this guards: competitions were device-local while teams were synced
 * to user_prefs. Every identity transition therefore dropped them — sign-in
 * replaced teams from the account row and left leagues behind, a new device or
 * a different origin started with none, and clearing site data lost them for
 * good. F1 is followed as a championship far more often than as a driver, so
 * for F1 fans the only follow they had disappeared.
 *
 * These are source-level assertions rather than behavioural ones: the paths at
 * risk (reconcileActiveIdentity, restoreGuestSession, pushToSupabase) are
 * Supabase- and localStorage-bound, and what actually regresses is someone
 * adding a team path without the league twin beside it. Note that a team-only
 * EDIT (saveFollowedTeams) correctly does NOT rewrite leagues — only the
 * whole-cache replacement paths must handle both.
 *
 * Run: npx tsx scripts/test-prefs-sync.ts   (also part of `npm run test`)
 */

import { readFileSync } from 'fs';
import { TEAMS } from '@/lib/teams';
import { generationIdsFor, followsF1, followsNothing } from '@/lib/followed-teams-server';
import { isF1RaceSession } from '@/lib/f1-data';

let passed = 0;
let failed = 0;
function expect(name: string, cond: boolean): void {
  if (cond) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}`);
}

const src = readFileSync('src/lib/user-prefs.ts', 'utf8');

/** Body of a top-level function declaration, to the next top-level declaration. */
function body(name: string): string {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  if (start < 0) return '';
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n\/\*\*/);
  return end < 0 ? rest : rest.slice(0, end);
}

console.log('\n── the durable write carries both ──');
{
  const push = body('pushToSupabase');
  expect('pushToSupabase found', push.length > 0);
  expect('upserts league_ids alongside team_ids',
    /league_ids:\s*leagueIds/.test(push) && /team_ids:\s*teamIds/.test(push));
  expect('one upsert, not a second round-trip that can half-fail',
    (push.match(/\.upsert\(/g) ?? []).length <= 2); // primary + pre-0005 fallback
  expect('degrades to teams-only when league_ids does not exist yet',
    /league_ids/i.test(push) && /fallback/i.test(push));
}

console.log('── identity transitions replace both caches ──');
{
  // Sign-in: the account row REPLACES the local cache. Leaving leagues out here
  // is precisely what stranded the F1 follow.
  const reconcile = body('reconcileActiveIdentity');
  expect('reconcileActiveIdentity found', reconcile.length > 0);
  expect('reads league_ids from the row', /select\('team_ids, league_ids'\)/.test(reconcile));
  expect('replaces the local league cache', /writeLocalLeagues\(/.test(reconcile));
  expect('backs up guest leagues on the anon→permanent transition',
    /writeGuestLeaguesBackup\(/.test(reconcile));
  expect('backs up guest teams and guest leagues together',
    /writeGuestBackup\([\s\S]{0,60}?\);\s*\n\s*writeGuestLeaguesBackup\(/.test(reconcile));
  expect('pushes leagues when the active browser wins',
    /pushToSupabase\([\s\S]{0,60}?localLeagues\)/.test(reconcile));
  expect('emptiness is judged on teams AND leagues, not teams alone',
    /remoteEmpty/.test(reconcile) && /localEmpty/.test(reconcile));

  // Sign-out: the guest space comes back — both halves of it.
  const restore = body('restoreGuestSession');
  expect('restoreGuestSession found', restore.length > 0);
  expect('restores the guest league backup', /readGuestLeaguesBackup\(\)/.test(restore));
  expect('writes the restored leagues locally', /writeLocalLeagues\(guestLeagues\)/.test(restore));
  expect('pushes the restored leagues to the fresh anon row',
    /pushToSupabase\([\s\S]{0,60}?guestLeagues\)/.test(restore));
}

console.log('── a competition edit behaves like a team edit ──');
{
  const toggle = body('toggleFollowedLeague');
  const save   = body('saveFollowedTeams');
  expect('toggleFollowedLeague found', toggle.length > 0);
  expect('writes the local cache first (instant UI)', /writeLocalLeagues\(updated\)/.test(toggle));
  expect('keeps the guest backup current, guest-only',
    /getActiveIsAnon\(\) !== 'false'/.test(toggle) && /writeGuestLeaguesBackup\(updated\)/.test(toggle));
  expect('pushes durably, fire-and-forget', /void pushToSupabase\(/.test(toggle));
  expect('fires PREFS_UPDATED_EVENT so open pages re-render',
    /PREFS_UPDATED_EVENT/.test(toggle));
  expect('mirrors the guest-backup rule saveFollowedTeams uses',
    /getActiveIsAnon\(\) !== 'false'/.test(save) && /getActiveIsAnon\(\) !== 'false'/.test(toggle));
  // A team-only edit must NOT rewrite the league cache — that would be a
  // different bug (an unrelated edit clobbering competition follows).
  expect('saveFollowedTeams does not overwrite the league cache',
    !/writeLocalLeagues\(/.test(save));
}

console.log('── a followed competition generates the whole competition ──');
{
  const sets = (teams: string[], leagues: string[]) =>
    ({ teamIds: new Set(teams), leagueIds: new Set(leagues) });

  const aflClubs = TEAMS.filter(t => t.league === 'afl').length;
  const aflIds = generationIdsFor(sets([], ['afl']));
  expect('an AFL competition follow expands to every AFL club',
    aflIds.length === aflClubs && aflIds.includes('afl-lions') && aflIds.includes('afl-dockers'));
  expect('it does not leak teams from other competitions',
    aflIds.every(id => TEAMS.find(t => t.id === id)?.league === 'afl'));

  // F1 fixtures all carry the synthetic teamId, so every kind of F1 follow must
  // resolve to it — otherwise a championship follower generates nothing.
  expect('an F1 competition follow resolves to the championship identity',
    generationIdsFor(sets([], ['f1'])).join() === 'f1-championship');
  expect('an F1 driver follow resolves the same way',
    generationIdsFor(sets(['f1_ver'], [])).join() === 'f1-championship');
  expect('a driver AND the championship collapse to one id',
    generationIdsFor(sets(['f1_ver', 'f1_ham'], ['f1'])).join() === 'f1-championship');

  expect('a team already covered by its competition is not duplicated',
    generationIdsFor(sets(['afl-lions'], ['afl'])).length === aflClubs);
  expect('team and competition follows union rather than replace',
    generationIdsFor(sets(['nrl-broncos'], ['afl'])).length === aflClubs + 1);
  expect('non-F1 team ids pass through untranslated',
    generationIdsFor(sets(['afl-lions'], [])).join() === 'afl-lions');

  expect('F1 is detected from a competition follow (not just drivers)',
    followsF1(sets([], ['f1'])) && followsF1(sets(['f1_ham'], [])));
  expect('F1 is not falsely detected', !followsF1(sets(['afl-lions'], ['afl'])));
  // Fail-open drives "generate everything", so a competition-only follower must
  // NOT look like an empty follow set.
  expect('a competition-only follower does not read as following nothing',
    !followsNothing(sets([], ['f1'])) && followsNothing(sets([], [])));
}

console.log('── an F1 weekend generates the race, not every session ──');
{
  expect('the race is previewable', isF1RaceSession('Race'));
  expect('a sprint is race-tier too', isF1RaceSession('Sprint'));
  expect('practice is not', !isF1RaceSession('Practice 1') && !isF1RaceSession('Practice 3'));
  expect('qualifying is not', !isF1RaceSession('Qualifying'));
  expect('sprint qualifying is qualifying-tier, not a race', !isF1RaceSession('Sprint Qualifying'));
  expect('a missing label is treated as previewable (non-F1 leagues)', isF1RaceSession(undefined));

  // The pipeline must apply it, or a followed F1 competition generates an FP1
  // preview and ~5x the work per round.
  const gen = readFileSync('scripts/generate-previews.ts', 'utf8');
  expect('generate-previews filters support sessions out of the candidate set',
    /league === 'f1' && !isF1RaceSession\(/.test(gen));
  // And the schedule must read the SAME rule, not a second inline regex.
  const sched = readFileSync('src/app/schedule/page.tsx', 'utf8');
  expect('the schedule uses the shared rule, not its own copy',
    /isF1RaceSession\(/.test(sched) && !/\/\^\(Practice\|Qualifying/.test(sched));
}

console.log('── every consumer expands follows the same way ──');
{
  // Three call sites walk the followed set; if one forgets the expansion, a
  // competition follow silently covers less than the others.
  for (const f of [
    'scripts/generate-previews.ts',
    'src/app/api/cron/poll-reviews/route.ts',
    'scripts/coverage-report.ts',
  ]) {
    const src2 = readFileSync(f, 'utf8');
    expect(`${f.split('/').pop()} uses the shared expansion`,
      /generationIdsFor\(/.test(src2) && !/getDistinctFollowedTeamIds\(/.test(src2));
  }
}

console.log('── the migration exists and is idempotent ──');
{
  const sql = readFileSync('supabase/migrations/0005_user_prefs_league_ids.sql', 'utf8');
  expect('adds league_ids to user_prefs', /alter table public\.user_prefs/i.test(sql) && /league_ids/.test(sql));
  expect('is safe to re-run', /add column if not exists/i.test(sql));
  expect('defaults to an empty array, not null', /not null default '\{\}'/i.test(sql));
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
