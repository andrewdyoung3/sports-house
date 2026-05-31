'use client';

/**
 * Phase-2 client auth layer — the link / sign-in / merge / sign-out logic.
 *
 * Design rules (from the Phase-2 plan, refined by the build prompt):
 *  • The UI never asks the user to self-classify "sign up" vs "sign in." There is
 *    one action per method; this module branches internally:
 *      – currently ANONYMOUS → CONVERT-IN-PLACE (UUID-preserving): updateUser/linkIdentity.
 *      – that identity already maps to a permanent account (CONFLICT) → fall back
 *        to SIGN-IN for the same identity (signInWithOtp / signInWithOAuth).
 *      – no session at all → SIGN-IN directly.
 *  • THE MERGE is one invariant, not per-flow: before any auth that can switch the
 *    uid, capture (a) the current anon uid and (b) the followed teams FROM THE LOCAL
 *    CACHE (never a DB read — after the switch RLS hides the old row and we ship no
 *    service-role key). After the session settles, if the surviving uid differs from
 *    the captured uid, set-union the captured teams into the permanent row. If the
 *    uid is unchanged (convert-in-place), it is a no-op.
 *
 * The capture is stashed in localStorage (not sessionStorage) so it survives a
 * magic-link that opens in a DIFFERENT TAB of the same browser — sessionStorage is
 * per-tab and would be lost there. A short TTL + clear-after-apply keeps it from
 * ever applying stale. (This refines the plan's sessionStorage choice.)
 */

import { getSupabaseBrowser } from '@/lib/supabase/client';
import {
  getCurrentUserId,
  getFollowedTeams,
  mergeFollowedTeams,
  resetLocalForSignOut,
} from '@/lib/user-prefs';

// ─── pending-merge capture (survives the redirect round-trip) ───────────────────

const PENDING_MERGE_KEY = 'sporthouse:pending-merge';
const PENDING_TTL_MS = 15 * 60 * 1000; // 15 min — long enough for an email click.

interface PendingMerge {
  preAuthUid: string | null; // the anon uid at the moment auth was initiated
  teamIds: string[];         // followed teams captured from localStorage (NOT the DB)
  ts: number;
}

/** Snapshot the current (anon) uid + local team ids before initiating auth. */
async function capturePendingMerge(): Promise<void> {
  if (typeof window === 'undefined') return;
  const preAuthUid = await getCurrentUserId();
  const teamIds = getFollowedTeams().map(t => t.id);
  const payload: PendingMerge = { preAuthUid, teamIds, ts: Date.now() };
  localStorage.setItem(PENDING_MERGE_KEY, JSON.stringify(payload));
}

function readPendingMerge(): PendingMerge | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_MERGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMerge;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > PENDING_TTL_MS) { clearPendingMerge(); return null; }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingMerge(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(PENDING_MERGE_KEY);
}

/**
 * True iff a still-valid pending merge exists that targets a DIFFERENT identity than
 * `currentUid` — i.e. an anon→permanent switch is mid-flight and the local cache may
 * still hold the pre-switch (anon) set. Consumed by user-prefs' steady-state
 * write-through so it refuses to push that anon-only set over the just-switched
 * account row. Read-only beyond readPendingMerge's own TTL self-expiry.
 */
export function hasForeignPendingMerge(currentUid: string | null): boolean {
  const pending = readPendingMerge();
  if (!pending) return false;
  return pending.preAuthUid !== currentUid;
}

/** Same-origin callback URL, carrying the path to return to after the round-trip. */
function callbackUrl(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

// ─── auth state ─────────────────────────────────────────────────────────────────

export type AuthStatus = 'anonymous' | 'permanent' | 'signed-out' | 'unconfigured';
export interface AuthState {
  status: AuthStatus;
  email: string | null;
}

/** Resolve the current auth state via getUser() (revalidates the JWT, not just the cookie). */
export async function getAuthState(): Promise<AuthState> {
  const sb = await getSupabaseBrowser();
  if (!sb) return { status: 'unconfigured', email: null };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { status: 'signed-out', email: null };
  if (user.is_anonymous) return { status: 'anonymous', email: null };
  return { status: 'permanent', email: user.email ?? null };
}

// ─── sign-up / sign-in (one action per method) ──────────────────────────────────

export interface EmailResult {
  ok: boolean;
  /** Always 'signin' under Option Y — a magic link to the existing/new account ('link' retired). */
  mode: 'link' | 'signin';
  error?: string;
}

/**
 * Continue with email (Option Y — always SIGN IN, never link).
 *
 * Sends a magic link via signInWithOtp (creating the account if the email is new).
 * One path for anon and no-session alike — there is no updateUser/link step, so the
 * "email already registered" conflict class cannot occur. capturePendingMerge()
 * snapshots the current anon teams BEFORE the redirect; on return from /auth/callback
 * the surviving (signed-in) uid differs from the captured anon uid, so applyPendingMerge
 * unions those teams into the signed-in account's row (new or existing).
 */
export async function continueWithEmail(email: string): Promise<EmailResult> {
  const sb = await getSupabaseBrowser();
  if (!sb) return { ok: false, mode: 'signin', error: 'Sign-in is not configured.' };
  if (!email) return { ok: false, mode: 'signin', error: 'Enter your email address.' };

  await capturePendingMerge();
  const emailRedirectTo = callbackUrl();

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo },
  });
  if (error) { clearPendingMerge(); return { ok: false, mode: 'signin', error: error.message }; }
  return { ok: true, mode: 'signin' };
}

/**
 * Continue with Google (Option Y — always SIGN IN, never link).
 *
 * Uses signInWithOAuth for anon and no-session alike — one path, no linkIdentity.
 * Because sign-in never attempts to attach Google to the current anon UUID, the
 * identity_already_exists conflict class is eliminated entirely. capturePendingMerge()
 * snapshots the anon teams before the redirect; applyPendingMerge unions them into the
 * signed-in account's row (new or existing) on return from /auth/callback.
 *
 * (Trade-off, recorded under Option Y: conversion no longer preserves the anon UUID —
 * the anon row is orphaned and the teams carry via the merge instead.)
 */
export async function continueWithGoogle(): Promise<{ error?: string }> {
  const sb = await getSupabaseBrowser();
  if (!sb) return { error: 'Sign-in is not configured.' };

  await capturePendingMerge();
  const redirectTo = callbackUrl();

  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) { clearPendingMerge(); return { error: error.message }; }
  return {};
}

// ─── merge + sign-out (called from <PrefsSync/> auth-state handler) ──────────────

/**
 * The MERGE invariant. Run on SIGNED_IN / INITIAL_SESSION (it self-guards on the
 * presence of a captured pending-merge, so it is a cheap no-op on ordinary loads).
 * Returns `true` iff it actually performed a cross-identity union — the caller uses
 * that to SUPPRESS the steady-state `syncWithSupabase()` push during the merge cycle.
 *
 *  • surviving uid === captured pre-auth uid  → convert-in-place; the same row is
 *    already owned by this UUID → NO-OP (returns false; ordinary reconcile is safe).
 *  • surviving uid !== captured pre-auth uid  → sign-in switched identities; union
 *    the captured (local-sourced) teams into the permanent account's row (returns true).
 *
 * This single path covers BOTH a plain sign-in and the conflict→sign-in fallback —
 * a team followed in a throwaway anon session before signing in survives either way.
 *
 * ATOMICITY. `onAuthStateChange` double-fires (INITIAL_SESSION + SIGNED_IN). To stop
 * competing runs we CLAIM the work synchronously by assigning `mergeInFlight` BEFORE
 * any `await`: a concurrent caller joins that same promise instead of re-reading the
 * token. The token is CLEARED only AFTER `mergeFollowedTeams()` has persisted the
 * union — so no runner can ever observe "no pending merge" while the union is still
 * in flight and fall through to the overwrite path.
 */
let mergeInFlight: Promise<boolean> | null = null;

export async function applyPendingMerge(): Promise<boolean> {
  if (mergeInFlight) return mergeInFlight; // join the in-flight claim — never run in parallel

  const pending = readPendingMerge();
  if (!pending) return false;

  // Synchronous claim: no `await` between the token read above and this assignment,
  // so a re-fire is guaranteed to see `mergeInFlight` set and join it.
  mergeInFlight = (async (): Promise<boolean> => {
    try {
      const survivingUid = await getCurrentUserId();
      if (!survivingUid) return false;            // no session yet — LEAVE token for a later transition
      if (survivingUid === pending.preAuthUid) {  // convert-in-place → same row, no union needed
        clearPendingMerge();
        return false;
      }
      await mergeFollowedTeams(pending.teamIds);   // read remote → UNION → upsert → writeLocal → event
      clearPendingMerge();                          // finalize ONLY after the union has persisted
      return true;
    } finally {
      mergeInFlight = null;
    }
  })();

  return mergeInFlight;
}

/**
 * Sign out → fresh anonymous slate.
 *
 * Clears the LOCAL teams cache immediately (so nothing of the signed-out user
 * lingers on a shared machine), then ends the session. The fresh anonymous session
 * is re-minted by the SIGNED_OUT handler in <PrefsSync/> — kept in one place so
 * there is no double-mint. The permanent account's remote row is untouched, so the
 * teams return on next sign-in.
 */
export async function signOutToAnon(): Promise<void> {
  const sb = await getSupabaseBrowser();
  resetLocalForSignOut();
  if (!sb) return;
  await sb.auth.signOut();
}
