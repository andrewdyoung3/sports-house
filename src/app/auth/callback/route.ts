/**
 * GET /auth/callback
 *
 * The single return target for BOTH redirect-based SIGN-IN flows (Option Y):
 *   • Google OAuth   (signInWithOAuth)
 *   • Email magic-link (signInWithOtp)
 *
 * @supabase/ssr uses PKCE by default, so the provider returns a `?code=…` that we
 * exchange for a session here (a Route Handler CAN write cookies, unlike a Server
 * Component). On success we redirect to a FIXED internal default (`/schedule`); on a
 * real failure (e.g. the user cancels Google consent) we redirect home with an
 * `auth_error` flag.
 *
 * The redirectTo sent to Supabase is deliberately QUERY-LESS (no `?next=`): Supabase
 * matches redirectTo against its allow-list by exact URL, and a query string fails to
 * match → it falls back to the Site URL, bouncing the user to the wrong origin
 * unauthenticated. So the landing page is decided here, not carried in the URL.
 *
 * No link-conflict handling: sign-in never links an identity to the anon user, so the
 * identity_already_exists class cannot occur here anymore.
 *
 * No team merge happens here — on the resulting auth-state change, <PrefsSync/> runs
 * reconcileActiveIdentity (user-prefs.ts), which loads the account's teams (replace,
 * no merge). Guest picks remain a separate device-local space.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error');

  // Fixed, safe internal landing after sign-in (no `next` query — see header note).
  const next = '/schedule';

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
