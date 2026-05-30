'use client';

/**
 * SSR-aware Supabase BROWSER client (App Router + @supabase/ssr).
 *
 * Stores the auth session in cookies (not localStorage), so the same session is
 * visible to server components / route handlers — the foundation for Phase 2 auth.
 *
 * The `@supabase/ssr` / `@supabase/supabase-js` runtime is **dynamically imported**
 * (only the erased `import type` is static), so it stays OUT of First Load JS — it's
 * only needed post-hydration for the background sync and writes, and is never even
 * fetched when Supabase isn't configured.
 *
 * Returns null when Supabase isn't configured (env vars unset), so the app keeps
 * working at UX parity on localStorage alone until the manual setup is done.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when both public Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON_KEY);
}

// Memoise the promise so concurrent/subsequent callers share one client (and one
// dynamic import). Resolves to null when Supabase isn't configured.
let clientPromise: Promise<SupabaseClient | null> | undefined;

/** Browser client, lazily code-split out of First Load JS. null if unconfigured. */
export function getSupabaseBrowser(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    if (!URL || !ANON_KEY) return null;
    const { createBrowserClient } = await import('@supabase/ssr');
    return createBrowserClient(URL, ANON_KEY);
  })();
  return clientPromise;
}
