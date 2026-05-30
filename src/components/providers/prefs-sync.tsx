'use client';

import { useEffect } from 'react';
import { syncWithSupabase } from '@/lib/user-prefs';

/**
 * Invisible app-load bootstrap. Runs ONCE: establishes the anonymous Supabase
 * session, migrates first-run localStorage data up, and restores from Supabase if
 * the local cache is empty. No-ops when Supabase isn't configured.
 *
 * Mounted in the root layout so it runs app-wide, exactly once, with no per-
 * navigation Supabase round-trip.
 */
export function PrefsSync() {
  useEffect(() => {
    void syncWithSupabase();
  }, []);
  return null;
}
