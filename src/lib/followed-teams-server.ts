/**
 * Server-side aggregate: what at least one user follows — teams AND whole
 * competitions.
 *
 * Uses the admin (service_role) Supabase client to bypass RLS and read all
 * user_prefs rows. Fails open (returns empty sets) when the admin client is
 * not configured so the cron falls back to generating all fixtures.
 *
 * Call sites: the preview heartbeat, the review poller, the coverage report —
 * all of which expand these follows through generationIdsFor() below, so the
 * three cannot disagree about what "followed" covers.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { TEAMS } from '@/lib/teams';

/** The two independent follow spaces, aggregated across all users. */
export interface FollowedSets {
  teamIds: Set<string>;
  leagueIds: Set<string>;
}

export async function getDistinctFollowed(): Promise<FollowedSets> {
  const empty: FollowedSets = { teamIds: new Set(), leagueIds: new Set() };
  const admin = getSupabaseAdmin();
  if (!admin) return empty;
  try {
    let { data, error } = await admin.from('user_prefs').select('team_ids, league_ids');
    // Pre-0005 databases have no league_ids column: read teams rather than
    // nothing, so a pending migration degrades instead of halting generation.
    if (error) ({ data, error } = await admin.from('user_prefs').select('team_ids'));
    if (error || !data) return empty;

    const teamIds = new Set<string>();
    const leagueIds = new Set<string>();
    for (const row of data) {
      for (const id of (row.team_ids as string[] | null) ?? []) if (id) teamIds.add(id);
      for (const id of ((row as { league_ids?: string[] | null }).league_ids) ?? []) if (id) leagueIds.add(id);
    }
    return { teamIds, leagueIds };
  } catch {
    return empty;
  }
}

/** Back-compat wrapper — team follows only. Prefer getDistinctFollowed(). */
export async function getDistinctFollowedTeamIds(): Promise<Set<string>> {
  return (await getDistinctFollowed()).teamIds;
}

/**
 * Expand follows into the GENERATION identities the pipeline iterates.
 *
 * Two translations, both of which exist because display ids are not generation
 * ids (the same reason State of Origin rep teams need a mapping):
 *
 *  - F1 entities are drivers/constructors (`f1_ver`, `f1_ham`) but every F1
 *    fixture carries the synthetic teamId `f1-championship`. Following any
 *    driver — or the championship itself — means the race fixtures are wanted.
 *  - A followed COMPETITION expands to every team in it, so the pipeline covers
 *    the whole round: the caller dedupes by fixture id, so the 18 AFL clubs
 *    collapse to that round's ~9 matches rather than 18 generations.
 */
export function generationIdsFor({ teamIds, leagueIds }: FollowedSets): string[] {
  const ids = new Set<string>();
  for (const id of teamIds) ids.add(id.startsWith('f1_') ? 'f1-championship' : id);
  for (const league of leagueIds) {
    if (league === 'f1') { ids.add('f1-championship'); continue; }
    for (const t of TEAMS) if (t.league === league) ids.add(t.id);
  }
  return Array.from(ids);
}

/** True when any follow — driver, constructor, or the championship — wants F1. */
export function followsF1({ teamIds, leagueIds }: FollowedSets): boolean {
  return leagueIds.has('f1') || Array.from(teamIds).some(id => id.startsWith('f1'));
}

/** Nothing followed at all → callers fall open and generate everything. */
export function followsNothing({ teamIds, leagueIds }: FollowedSets): boolean {
  return teamIds.size === 0 && leagueIds.size === 0;
}
