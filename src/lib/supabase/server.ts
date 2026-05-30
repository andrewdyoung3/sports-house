/**
 * SSR-aware Supabase SERVER client (App Router + @supabase/ssr).
 *
 * Phase 1 does not read prefs server-side (everything runs through the browser
 * client + localStorage cache), so this is scaffolding for Phase 2, where server
 * components / route handlers will read the authenticated session from cookies.
 *
 * Returns null when Supabase isn't configured. Next.js 14: `cookies()` is sync.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseServer(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In Server Components cookies are read-only — setting throws and is safely
        // ignored (token refresh is handled client-side in Phase 1). Route handlers
        // and Server Actions in Phase 2 will be able to persist refreshed cookies.
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only context — ignore */
        }
      },
    },
  });
}
