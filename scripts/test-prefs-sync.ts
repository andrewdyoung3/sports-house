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

console.log('── the migration exists and is idempotent ──');
{
  const sql = readFileSync('supabase/migrations/0005_user_prefs_league_ids.sql', 'utf8');
  expect('adds league_ids to user_prefs', /alter table public\.user_prefs/i.test(sql) && /league_ids/.test(sql));
  expect('is safe to re-run', /add column if not exists/i.test(sql));
  expect('defaults to an empty array, not null', /not null default '\{\}'/i.test(sql));
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
