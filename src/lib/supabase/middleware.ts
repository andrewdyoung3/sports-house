/**
 * Writable SSR Supabase client for the EDGE MIDDLEWARE (and, conceptually, any
 * place that needs to persist refreshed auth cookies onto a NextResponse).
 *
 * The read-only `getSupabaseServer()` (server.ts) can only READ cookies from a
 * Server Component; it cannot write refreshed tokens back. The middleware runs on
 * every navigation and IS allowed to mutate the response, so this is where token
 * refresh actually lands — the missing Phase-2 foundation that lets server route
 * handlers (and the AI gating in PR 2) read a fresh session.
 *
 * IMPORTANT — this REFRESHES an existing session only. It calls `getUser()`, which
 * validates/refreshes the current cookie session if there is one and writes the
 * rotated tokens back. It NEVER calls `signInAnonymously()` — anonymous identities
 * are minted exclusively on the client (see user-prefs.ts), so there is no
 * server-side double-mint and no anon/refresh loop.
 *
 * No-ops cleanly (passes the request straight through) when Supabase isn't
 * configured, matching the rest of the app's degrade-to-localStorage behaviour.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // Supabase unconfigured → pass through untouched.

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror onto the request (for any downstream read in this pass) and onto a
        // freshly-cloned response (what the browser actually receives).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh-only. Do NOT insert code between createServerClient and getUser(), and
  // do NOT mint a session here — getUser() returns null for session-less visitors
  // and triggers no write, so anonymous visitors stay client-minted.
  await supabase.auth.getUser();

  return response;
}
