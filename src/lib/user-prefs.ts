'use client';

/**
 * Client-side followed-teams AND followed-competitions store.
 *
 * Persistence model: **localStorage is an instant read-through cache for the ACTIVE
 * identity; Supabase (per-identity user_prefs row + RLS) is the durable source of
 * truth.** Two independent spaces — guest (anonymous, device-local) and account
 * (signed-in, synced across devices).
 *
 * Teams (user_prefs.team_ids) and competitions (user_prefs.league_ids, migration
 * 0005) travel together through every path below — one upsert, one reconcile, one
 * guest backup. They used to diverge, with competitions device-local only, which
 * silently dropped them on sign-in, on a new device, or on a different origin
 * while teams returned intact. That hit F1 hardest: a championship follow is
 * usually a user's ONLY F1 follow, so losing it looked like losing the sport.
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
 * Followed LEAGUES (whole-competition follows), as league ids ('afl', 'f1', …).
 * Synced exactly like teams: localStorage is the read-through cache, the
 * user_prefs.league_ids column (migration 0005) is the durable source of truth.
 *
 * These were device-local until a user lost their F1 follow: teams came back
 * from the account row on sign-in while competitions — which for F1 is usually
 * the ONLY follow — silently did not. Every path that moves teams between
 * identities now moves leagues with them.
 */
const LEAGUES_KEY = 'sports-house:leagues';
/** Device-local backup of the GUEST competition follows — the leagues twin of
 *  GUEST_BACKUP_KEY, with the same write rule (guest/anon edits only). */
const GUEST_LEAGUES_BACKUP_KEY = 'sports-house:guest-leagues';

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

/** Write the local league cache only (no push) — the leagues twin of writeLocal. */
function writeLocalLeagues(ids: string[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LEAGUES_KEY, JSON.stringify(ids));
}

function readGuestLeaguesBackup(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_LEAGUES_BACKUP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeGuestLeaguesBackup(ids: string[]): void {
  if (typeof window !== 'undefined') localStorage.setItem(GUEST_LEAGUES_BACKUP_KEY, JSON.stringify(ids));
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

// ─── Followed leagues (whole-competition follows, device-local v1) ─────────────

export function getFollowedLeagues(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LEAGUES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ─── F1 session preference ───────────────────────────────────────────────────
// 'races' (default): races + sprints only. 'all': qualifying + practice too.
// Replaces the older boolean practice toggle; its 'show' value migrates to 'all'.

const F1_SESSIONS_KEY = 'sports-house:f1-sessions';
const LEGACY_F1_PRACTICE_KEY = 'sports-house:f1-practice';

export type F1SessionPref = 'races' | 'all';

export function getF1SessionPref(): F1SessionPref {
  if (typeof window === 'undefined') return 'races';
  try {
    const v = localStorage.getItem(F1_SESSIONS_KEY);
    if (v === 'all' || v === 'races') return v;
    // Legacy migration: the old practice opt-in implied wanting everything.
    if (localStorage.getItem(LEGACY_F1_PRACTICE_KEY) === 'show') {
      localStorage.setItem(F1_SESSIONS_KEY, 'all');
      return 'all';
    }
  } catch { /* default */ }
  return 'races';
}

export function setF1SessionPref(pref: F1SessionPref): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(F1_SESSIONS_KEY, pref);
    window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
  } catch { /* device-local only */ }
}

/**
 * Toggle a whole-competition follow and return the updated id list.
 *
 * Mirrors saveFollowedTeams exactly: local cache first (so the UI is instant),
 * the guest backup when the active identity is anonymous, then a fire-and-forget
 * push to the current identity's row.
 */
export function toggleFollowedLeague(leagueId: string): string[] {
  const current = getFollowedLeagues();
  const updated = current.includes(leagueId)
    ? current.filter(id => id !== leagueId)
    : [...current, leagueId];
  if (typeof window === 'undefined') return updated;

  writeLocalLeagues(updated);
  // Same rule as the teams backup: guest edits only (null = pre-reconcile = guest),
  // so a signed-in edit can never pollute the guest space.
  if (getActiveIsAnon() !== 'false') writeGuestLeaguesBackup(updated);
  window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
  void pushToSupabase(getFollowedTeams().map(t => t.id), updated);
  return updated;
}

/** Toggle a team and return the updated array. */
export function toggleTeam(team: Team): Team[] {
  const current = getFollowedTeams();
  const exists  = current.some(t => t.id === team.id);
  const updated = exists
    ? current.filter(t => t.id !== team.id)
    : [...current, team];
  saveFollowedTeams(updated);
  // When a team is newly followed, fire-and-forget pre-generation so the
  // first preview load hits the cache instead of waiting 30-60s.
  if (!exists) void warmTeamPreviews(team.id, team.league);
  return updated;
}

async function warmTeamPreviews(teamId: string, league: string): Promise<void> {
  try {
    await fetch('/api/warm-team', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ teamId, league }),
    });
  } catch { /* non-fatal */ }
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
async function pushToSupabase(teamIds: string[], leagueIds: string[] = getFollowedLeagues()): Promise<void> {
  const sb = await getSupabaseBrowser();
  if (!sb) return;
  try {
    const userId = await ensureUserId();
    if (!userId) return;
    // Teams and leagues share one row and one upsert: a split write could fail
    // between the two and leave an identity following teams but no competitions.
    const row = { user_id: userId, team_ids: teamIds, updated_at: new Date().toISOString() };
    const { error } = await sb.from('user_prefs').upsert(
      { ...row, league_ids: leagueIds },
      { onConflict: 'user_id' },
    );
    if (!error) return;

    // Deploy-order safety net: if this build reaches a database where migration
    // 0005 has not run yet, the unknown league_ids column would fail the whole
    // upsert and silently stop syncing TEAMS as well. Fall back to the pre-0005
    // shape so team sync survives; competition follows stay device-local until
    // the migration lands.
    if (/league_ids/i.test(error.message)) {
      console.warn('[user-prefs] user_prefs.league_ids missing — run migration 0005; syncing teams only');
      const { error: fallbackError } = await sb.from('user_prefs').upsert(row, { onConflict: 'user_id' });
      if (fallbackError) console.error('[user-prefs] Supabase push failed', fallbackError.message);
      return;
    }
    console.error('[user-prefs] Supabase push failed', error.message);
  } catch (err) {
    // Network/RLS error — localStorage already holds the value, so the UX is unaffected.
    console.error('[user-prefs] Supabase push failed', err);
  }
}

/** Map stored team ids back to full Team objects via the canonical TEAMS list. */
function rehydrate(ids: string[]): Team[] {
  return ids.map(id => TEAMS.find(t => t.id === id)).filter((t): t is Team => Boolean(t));
}

/** Order-insensitive equality for league id lists — the leagues twin of sameIds. */
const sameLeagues = (a: string[], b: string[]): boolean =>
  [...a].sort().join(',') === [...b].sort().join(',');

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

    let { data, error } = await sb
      .from('user_prefs')
      .select('team_ids, league_ids')
      .eq('user_id', userId)
      .maybeSingle();
    // Same pre-0005 tolerance as the push path — read teams rather than nothing.
    if (error && /league_ids/i.test(error.message)) {
      ({ data, error } = await sb
        .from('user_prefs')
        .select('team_ids')
        .eq('user_id', userId)
        .maybeSingle());
    }
    if (error) { console.error('[user-prefs] load failed', error.message); return; }
    const remoteTeams   = rehydrate((data?.team_ids as string[] | undefined) ?? []);
    const remoteLeagues = (data?.league_ids as string[] | undefined) ?? [];

    if (!isAnon) {
      // PERMANENT — REPLACE the cache with the account row (no merge, no push).
      if (getActiveIsAnon() === 'true') {
        // anon→permanent transition: preserve the outgoing guest picks for sign-out.
        writeGuestBackup(getFollowedTeams().map(t => t.id));
        writeGuestLeaguesBackup(getFollowedLeagues());
      }
      writeLocal(remoteTeams);         // replace, even if empty (empty account → empty list)
      writeLocalLeagues(remoteLeagues); // competitions follow the same REPLACE rule
      setActiveIsAnon(false);
      window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
      return;
    }

    // ANONYMOUS — Phase-1 reconcile (same identity throughout → safe to push local→row).
    setActiveIsAnon(true);
    const localTeams   = getFollowedTeams();
    const localLeagues = getFollowedLeagues();
    // Teams and leagues are reconciled as ONE preference set. Branching on teams
    // alone would drop a competition-only follower's picks: with no teams, the
    // "local is empty" branch would overwrite their leagues with the remote row.
    const remoteEmpty = remoteTeams.length === 0 && remoteLeagues.length === 0;
    const localEmpty  = localTeams.length === 0 && localLeagues.length === 0;

    if (remoteEmpty) {
      if (!localEmpty) await pushToSupabase(localTeams.map(t => t.id), localLeagues); // migrate up
      return;
    }
    if (localEmpty) {
      writeLocal(remoteTeams);          // restore down
      writeLocalLeagues(remoteLeagues);
      window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));
      return;
    }
    if (!sameIds(localTeams, remoteTeams) || !sameLeagues(localLeagues, remoteLeagues)) {
      // active browser wins (SAME anon identity)
      await pushToSupabase(localTeams.map(t => t.id), localLeagues);
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
  const guest        = rehydrate(readGuestBackup());
  const guestLeagues = readGuestLeaguesBackup();
  writeLocal(guest);                    // replace account teams with guest picks (no backup → empty)
  writeLocalLeagues(guestLeagues);      // and the guest competition follows
  setActiveIsAnon(true);
  window.dispatchEvent(new Event(PREFS_UPDATED_EVENT));

  const sb = await getSupabaseBrowser();
  if (!sb) return;
  const { error } = await sb.auth.signInAnonymously(); // fresh guest identity
  if (error) { console.error('[user-prefs] re-anon after sign-out failed', error.message); return; }
  // Write the restored guest picks to the fresh anon row (its SIGNED_IN also triggers
  // reconcileActiveIdentity, which is idempotent with this write).
  await pushToSupabase(guest.map(t => t.id), guestLeagues);
}
