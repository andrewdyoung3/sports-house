/**
 * GET /auth/callback
 *
 * The single return target for BOTH redirect-based SIGN-IN flows (Option Y):
 *   • Google OAuth   (signInWithOAuth)
 *   • Email magic-link (signInWithOtp)
 *
 * @supabase/ssr uses PKCE by default, so the provider returns a `?code=…` that we
 * exchange for a session here (a Route Handler CAN write cookies, unlike a Server
 * Component). On success we redirect to the sanitised `next` path; on a real failure
 * (e.g. the user cancels Google consent) we redirect home with an `auth_error` flag.
 *
 * No link-conflict handling: sign-in never links an identity to the anon user, so the
 * identity_already_exists class cannot occur here anymore.
 *
 * The actual anon→signed-in MERGE does NOT happen here — it runs client-side in
 * <PrefsSync/> on the resulting auth-state change (see lib/auth.ts applyPendingMerge),
 * because the team set to merge lives in the client's localStorage, not the DB.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error');

  // Only ever redirect to a same-origin relative path (defend against open redirect).
  const rawNext = searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  // Honour Vercel's forwarded host in prod/preview; use the literal origin locally.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;

  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/?auth_error=${encodeURIComponent(reason)}`);

  if (oauthError) return fail(oauthError);
  if (!code) return fail('missing_code');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fail('not_configured');

  // Collect cookies the exchange wants to set, then attach them to whichever
  // response we ultimately return (built after we know success/failure + target).
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          pending.push({ name, value, options: options as Record<string, unknown> }),
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  const response = NextResponse.redirect(`${base}${next}`);
  pending.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}
