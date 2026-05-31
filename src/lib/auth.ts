'use client';

/**
 * Client auth layer (Option Y — two team spaces, no merge).
 *
 * "Continue with Google / email" always SIGNS IN (signInWithOAuth / signInWithOtp) —
 * never linkIdentity — so the identity_already_exists conflict class cannot occur and
 * there is one path for new and existing accounts alike.
 *
 * There is NO anon→account team merge. The followed-teams cache is owned by the
 * CURRENT identity and RELOADED (replace, never union) on any identity change —
 * see reconcileActiveIdentity (sign-in load) and restoreGuestSession (sign-out
 * restore) in user-prefs.ts. Guest picks and the account's teams are two independent
 * spaces; cross-device sync is the account space loading on every signed-in device.
 */

import { getSupabaseBrowser } from '@/lib/supabase/client';

/**
 * Same-origin callback URL — QUERY-LESS so it exactly matches Supabase's Redirect-URL
 * allow-list entries. Supabase matches redirectTo against the allow-list by exact URL;
 * a trailing "?next=…" fails to match and Supabase falls back to the Site URL (the prod
 * domain), bouncing localhost/prod sign-ins away unauthenticated. The post-sign-in
 * landing is a fixed internal default chosen server-side in /auth/callback instead.
 */
function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
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
 * One path for anon and no-session alike — no updateUser/link step, so the "email
 * already registered" conflict class cannot occur. On return from /auth/callback the
 * account's teams are loaded (replace, no merge) by reconcileActiveIdentity.
 */
export async function continueWithEmail(email: string): Promise<EmailResult> {
  const sb = await getSupabaseBrowser();
  if (!sb) return { ok: false, mode: 'signin', error: 'Sign-in is not configured.' };
  if (!email) return { ok: false, mode: 'signin', error: 'Enter your email address.' };

  const emailRedirectTo = callbackUrl();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo },
  });
  if (error) return { ok: false, mode: 'signin', error: error.message };
  return { ok: true, mode: 'signin' };
}

/**
 * Continue with Google (Option Y — always SIGN IN, never link).
 *
 * Uses signInWithOAuth for anon and no-session alike — one path, no linkIdentity.
 * Because sign-in never attempts to attach Google to the current anon UUID, the
 * identity_already_exists conflict class is eliminated entirely. On return from
 * /auth/callback the account's teams are loaded (replace, no merge) by
 * reconcileActiveIdentity.
 *
 * (Trade-off, recorded under Option Y: signing in does not preserve the anon UUID —
 * the anon row is orphaned. Guest picks survive locally via the guest backup.)
 */
export async function continueWithGoogle(): Promise<{ error?: string }> {
  const sb = await getSupabaseBrowser();
  if (!sb) return { error: 'Sign-in is not configured.' };

  const redirectTo = callbackUrl();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) return { error: error.message };
  return {};
}

// ─── sign-out ────────────────────────────────────────────────────────────────────

/**
 * Sign out. Just ends the session — the SIGNED_OUT handler in <PrefsSync/> runs
 * restoreGuestSession(), which switches the active cache back to the device-local
 * guest picks and re-mints a fresh anonymous session. The account's own user_prefs
 * row is left untouched, so its teams load again on the next sign-in.
 */
export async function signOutToAnon(): Promise<void> {
  const sb = await getSupabaseBrowser();
  if (!sb) return;
  await sb.auth.signOut();
}
