'use client';

/**
 * Client-side followed-teams store.
 *
 * Phase 1 persistence model — chosen design (a): **localStorage is an instant
 * read-through cache; Supabase (anonymous identity + RLS) is the durable source
 * of truth, synced behind it.**
 *   • Reads stay SYNCHRONOUS (localStorage) → no loading flash, works offline, and
 *     every existing caller keeps working unchanged.
 *   • Writes go to localStorage immediately, then push to Supabase in the background.
 *   • `syncWithSupabase()` runs once on app load (see components/providers/prefs-sync):
 *     it establishes the anonymous session, migrates first-run localStorage data up,
 *     and restores from Supabase if the local cache is empty.
 *
 * If Supabase isn't configured (env vars unset), everything degrades cleanly to
 * localStorage-only — identical to the previous behaviour.
 */

import type { Team } from '@/types';
import { TEAMS } from '@/lib/teams';
import { getSupabaseBrowser } from '@/lib/supabase/client';

const STORAGE_KEY = 'sports-house:teams';
/** Fired when a background Supabase sync changes the local cache (Phase-2 hook). */
export const PREFS_UPDATED_EVENT = 'sporthouse:prefs-updated';

function isTeam(v: unknown): v is Team {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).shortName === 'string' &&
    typeof (v as Record<string, unknown>).abbreviation === 'string' &&
    typeof (v as Record<string, unknown>).league === 'string' &&
    typeof (v as Record<string, unknown>).primaryColor === 'string' &&
    typeof (v as Record<string, unknown>).secondaryColor === 'string' &&
    typeof (v as Record<string, unknown>).venue === 'string'
  );
}

// ─── Synchronous localStorage cache (unchanged public interface) ────────────────

export function getFollowedTeams(): Team[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(isTeam);
  } catch {
    return [];
  }
}

/** Write the local cache only (no Supabase push). Used by the restore path. */
function writeLocal(teams: Team[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
}

export function saveFollowedTeams(teams: Team[]): void {
  writeLocal(teams);
  // Durable write — fire-and-forget so the UI never waits on the network.
  void pushToSupabase(teams.map(t => t.id));
}

export function isFollowing(teamId: string): boolean {
  return getFollowedTeams().some(t => t.id === teamId);
}

/** Toggle a team and return the updated array. */
export function toggleTeam(team: Team): Team[] {
  const current = getFollowedTeams();
  const exists  = current.some(t => t.id === team.id);
  const updated = exists
    ? current.filter(t => t.id !== team.id)
    : [...current, team];
  saveFollowedTeams(updated);
  return updated;
}

export function clearFollowedTeams(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  void pushToSupabase([]);
}

// ─── Supabase (anonymous identity + RLS) ────────────────────────────────────────

/** Ensure an auth session exists; sign in anonymously if not. Returns the user id. */
async function ensureUserId(): Promise<string | null> {
  const sb = await getSupabaseBrowser();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    console.error('[user-prefs] anonymous sign-in failed', error.message);
    return null;
  }
  return data.session?.user.id ?? null;
}

/** Upsert the followed-team ids to the caller's own RLS-protected row. */
async function pushToSupabase(teamIds: string[]): Promise<void> {
  const sb = await getSupabaseBrowser();
  if (!sb) return;
  try {
    const userId = await ensureUserId();
    if (!userId) return;
    await sb.from('user_prefs').upsert(
      { user_id: userId, team_ids: teamIds, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  } catch (err) {
    // Network/RLS error — localStorage already holds the value, so the UX is unaffected.
    console.error('[user-prefs] Supabase push failed', err);
  }
}

/** Map stored team ids back to full Team objects via the canonical TEAMS list. */
function rehydrate(ids: string[]): Team[] {
  return ids.map(id => TEAMS.find(t => t.id === id)).filter((t): t is Team => Boolean(t));
}

const sameIds = (a: Team[], b: Team[]): boolean => {
  const ka = a.map(t => t.id).sort().join(',');
  const kb = b.map(t => t.id).sort().join(',');
  return ka === kb;
};

/**
 * One-time reconciliation on app load. Idempotent — never clobbers a non-empty
 * local cache with stale remote data:
 *   • remote empty + local non-empty  → migrate local → Supabase (first-run migration)
 *   • remote non-empty + local empty  → restore Supabase → local cache (+ event)
 *   • both non-empty but differ       → active browser wins; push local → Supabase
 *   • both empty                      → nothing
 */
export async function syncWithSupabase(): Promise<void> {
  const sb = await getSupabaseBrowser();
  if (!sb) return;
  try {
    const userId = await ensureUserId();
    if (!userId) return;

    const { data, error } = await sb
      .from('user_prefs')
      .select('team_ids')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { console.error('[user-prefs] Supabase load failed', error.message); return; }

    const remoteTeams = rehydrate((data?.team_ids as string[] | undefined) ?? []);
    const localTeams  = getFollowedTeams();

    if (remoteTeams.length === 0) {
      if (localTeams.length > 0) await pushToSupabase(localTeams.map(t => t.id)); // migrate up
      return;
    }
    if (localTeams.length === 0) {
      writeLocal(remoteTeams); // restore down
      window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
      return;
    }
    if (!sameIds(localTeams, remoteTeams)) {
      await pushToSupabase(localTeams.map(t => t.id)); // active browser wins
    }
  } catch (err) {
    console.error('[user-prefs] sync failed', err);
  }
}
