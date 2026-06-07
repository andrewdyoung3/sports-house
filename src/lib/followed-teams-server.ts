/**
 * Server-side aggregate: distinct team IDs followed by at least one user.
 *
 * Uses the admin (service_role) Supabase client to bypass RLS and read all
 * user_prefs rows. Fails open (returns empty set) when the admin client is
 * not configured so the cron falls back to generating all fixtures.
 *
 * Call site: warm-cache and poll-reviews routes only.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function getDistinctFollowedTeamIds(): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  if (!admin) return new Set();
  try {
    const { data, error } = await admin.from('user_prefs').select('team_ids');
    if (error || !data) return new Set();
    const ids = new Set<string>();
    for (const row of data) {
      for (const id of (row.team_ids as string[] | null) ?? []) {
        if (id) ids.add(id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}
