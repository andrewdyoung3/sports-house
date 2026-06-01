'use client';

/**
 * Client-side followed-teams store.
 *
 * Persistence model: **localStorage is an instant read-through cache for the ACTIVE
 * identity; Supabase (per-identity user_prefs row + RLS) is the durable source of
 * truth.** Two independent team spaces — guest (anonymous, device-local) and account
 * (signed-in, synced across devices).
 *   • Reads stay SYNCHRONOUS (localStorage) → no loading flash, works offline.
 *   • Writes go to localStorage immediately, then push to the CURRENT identity's row.
 *   • `reconcileActiveIdentity()` (see components/providers/prefs-sync) RELOADS the
 *     cache from the current identity's row on every auth transition (replace, never
 *     merge); `restoreGuestSession()` switches back to the guest picks on sign-out.
 *
 * If Supabase isn't configured (env vars unset), everything degrades cleanly to
 * localStorage-only — identical to the previous behaviour.
 */

import { useEffect, useState } from 'react';
import type { Team } from '@/types';
import { TEAMS } from '@/lib/teams';
import { getSupabaseBrowser } from '@/lib/supabase/client';

/** The ACTIVE followed-teams cache — owned by whichever identity is currently signed in. */
const STORAGE_KEY = 'sports-house:teams';
/**
 * Device-local backup of the GUEST (anonymous) picks. Two independent team spaces:
 * guest browsing keeps device-local picks here; signing in switches the active cache
 * to the ACCOUNT's teams. This backup lets sign-out restore the guest picks. Only ever
 * written by guest/anon edits + the anon→permanent transition snapshot — never by a
 * signed-in edit — so it can never be polluted with account teams.
 */
const GUEST_BACKUP_KEY = 'sports-house:guest-teams';
/**
 * Tracks whether the active cache currently belongs to an ANONYMOUS identity
 * ('true'/'false'). Persists across the OAuth/magic-link redirect, so on return we can
 * tell an anon→permanent transition (back up guest picks) from a plain returning-
 * permanent load (don't). Owned/updated by reconcileActiveIdentity + restoreGuestSession.
 */
const ACTIVE_IS_ANON_KEY = 'sports-house:active-anon';
/** Fired whenever the active followed-teams cache changes (identity reload, edit, restore). */
export const PREFS_UPDATED_EVENT = 'sporthouse:prefs-updated';

/**
 * React hook: a counter that increments whenever the active followed-teams cache
 * changes (PREFS_UPDATED_EVENT) — fired by reconcileActiveIdentity (sign-in reload),
 * restoreGuestSession (sign-out), and edits. Add it to a page's data-loading effect
 * deps (and reset that effect's accumulators) so the page reflects the now-active set
 * WITHOUT a manual reload, even when the identity reload lands AFTER the page mounted
 * (e.g. signing in from this page via the navbar).
 */
export function usePrefsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    window.addEventListener(PREFS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, bump);
  }, []);
  return version;
}

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

// ─── Guest backup + active-identity markers (device-local) ──────────────────────

function readGuestBackup(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_BACKUP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeGuestBackup(ids: string[]): void {
  if (typeof window !== 'undefined') localStorage.setItem(GUEST_BACKUP_KEY, JSON.stringify(ids));
}

/** 'true' | 'false' | null (null = not yet reconciled this device). */
function getActiveIsAnon(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(ACTIVE_IS_ANON_KEY);
}

function setActiveIsAnon(isAnon: boolean): void {
  if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_IS_ANON_KEY, isAnon ? 'true' : 'false');
}

export function saveFollowedTeams(teams: Team[]): void {
  writeLocal(teams);
  // Guest edits also keep the guest backup current (so a later sign-in→sign-out restores
  // them). Only when the active identity is anonymous — a signed-in edit must NEVER touch
  // the guest backup (treat null = pre-reconcile = guest). This is the one write path, so
  // the backup can only ever hold guest picks.
  if (getActiveIsAnon() !== 'false') writeGuestBackup(teams.map(t => t.id));
  // Durable write to the CURRENT identity's row — fire-and-forget so the UI never waits.
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

// ─── Supabase (per-identity row + RLS) ──────────────────────────────────────────

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

/**
 * Resolve once a Supabase auth session (and its cookie) is established on this device,
 * minting an anonymous one if none exists. Thin wrapper over the existing anon-mint path
 * (`ensureUserId`, no prefs write). The AI-route callers `await` this BEFORE their gated
 * fetch so the auth cookie is guaranteed present — closing the brand-new-visitor cold-start
 * race where the first AI call could otherwise fire before the anon session is minted.
 * Resolves cleanly (no-op) when Supabase isn't configured.
 */
export async function ensureSession(): Promise<void> {
  await ensureUserId();
}

/**
 * Upsert the followed-team ids to the CURRENT identity's own RLS-protected row.
 *
 * `ensureUserId()` always resolves to the active session's uid, so this can only ever
 * write the current identity's row — there is no cross-identity push. (The old
 * "active-browser-wins" cross-identity push that could clobber a foreign row is gone;
 * identity changes are handled by reconcileActiveIdentity's REPLACE, never a push.)
 */
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
 * Reconcile the active followed-teams cache for the CURRENT identity. Driven by
 * <PrefsSync/> on INITIAL_SESSION / SIGNED_IN (serialized there via reconcileInFlight).
 *
 * CORE INVARIANT: the cache is owned by the current identity; on an identity change it
 * is RELOADED from that identity's store (REPLACE — never merge/union). There is no
 * cross-identity push: the only writes here are within a single (anon) identity.
 *
 *  • PERMANENT (signed-in) session → REPLACE the cache with the account's user_prefs
 *    row exactly (empty row → empty list). On the anon→permanent transition, snapshot
 *    the outgoing guest picks to the guest backup first, so sign-out can restore them.
 *    NEVER pushes the (possibly stale anon) cache to the account row.
 *  • ANONYMOUS session → Phase-1 reconcile between localStorage and the anon row. A
 *    local→row push here only ever targets the SAME anon identity's own row, so it
 *    cannot clobber an account.
 */
export async function reconcileActiveIdentity(): Promise<void> {
  const sb = await getSupabaseBrowser();
  if (!sb) return;
  try {
    // Ensure a session exists (mint anon if none — the zero-friction guest default).
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) { console.error('[user-prefs] anonymous sign-in failed', error.message); return; }
      session = data.session;
    }
    if (!session?.user) return;

    const userId  = session.user.id;
    const isAnon  = session.user.is_anonymous ?? false;

    const { data, error } = await sb
      .from('user_prefs')
      .select('team_ids')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { console.error('[user-prefs] load failed', error.message); return; }
    const remoteTeams = rehydrate((data?.team_ids as string[] | undefined) ?? []);

    if (!isAnon) {
      // PERMANENT — REPLACE the cache with the account row (no merge, no push).
      if (getActiveIsAnon() === 'true') {
        // anon→permanent transition: preserve the outgoing guest picks for sign-out.
        writeGuestBackup(getFollowedTeams().map(t => t.id));
      }
      writeLocal(remoteTeams); // replace, even if empty (empty account → empty list)
      setActiveIsAnon(false);
      window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
      return;
    }

    // ANONYMOUS — Phase-1 reconcile (same identity throughout → safe to push local→row).
    setActiveIsAnon(true);
    const localTeams = getFollowedTeams();
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
      await pushToSupabase(localTeams.map(t => t.id)); // active browser wins (SAME anon identity)
    }
  } catch (err) {
    console.error('[user-prefs] reconcile failed', err);
  }
}

// ─── Sign-out → restore the guest team space ────────────────────────────────────

/**
 * On SIGNED_OUT: switch the active cache back to the device-local GUEST picks, then
 * re-mint a fresh anonymous session and write the guest picks to its row.
 *
 * The cache is REPLACED with the guest backup FIRST (before re-minting), so the
 * signed-out account's teams are cleared from the local view immediately and no
 * subsequent reconcile can push them onto the new anon row. The signed-in account's
 * own row is left untouched — its teams return on the next sign-in (loaded fresh).
 */
export async function restoreGuestSession(): Promise<void> {
  const guest = rehydrate(readGuestBackup());
  writeLocal(guest);          // replace account teams with guest picks (no backup → empty)
  setActiveIsAnon(true);
  window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));

  const sb = await getSupabaseBrowser();
  if (!sb) return;
  const { error } = await sb.auth.signInAnonymously(); // fresh guest identity
  if (error) { console.error('[user-prefs] re-anon after sign-out failed', error.message); return; }
  // Write the restored guest picks to the fresh anon row (its SIGNED_IN also triggers
  // reconcileActiveIdentity, which is idempotent with this write).
  await pushToSupabase(guest.map(t => t.id));
}
