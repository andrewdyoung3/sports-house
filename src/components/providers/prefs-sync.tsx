'use client';

import { useEffect } from 'react';
import { syncWithSupabase, resetLocalForSignOut } from '@/lib/user-prefs';
import { applyPendingMerge } from '@/lib/auth';
import { getSupabaseBrowser } from '@/lib/supabase/client';

/**
 * Invisible app-load bootstrap + auth-state wiring. No-ops when Supabase isn't
 * configured (the app runs at parity on localStorage alone).
 *
 * Everything is driven off `onAuthStateChange` so a single code path covers first
 * load, the post-callback return from a redirect flow, and live sign-out:
 *
 *  • INITIAL_SESSION / SIGNED_IN → ONE serialized reconcile per auth transition:
 *      applyPendingMerge() first; run syncWithSupabase() ONLY when nothing was merged.
 *      - `onAuthStateChange` double-fires (INITIAL_SESSION + SIGNED_IN). A single
 *        in-flight guard (`reconcileInFlight`) makes the second firing JOIN the first
 *        run instead of launching a competing closure — no parallel reconcile.
 *      - When applyPendingMerge performs a cross-identity union it returns true and we
 *        SKIP syncWithSupabase entirely for this cycle: the merge already wrote the
 *        union to both remote and local, so the "active-browser-wins" push can't run
 *        and clobber the just-switched account row.
 *      - On a normal visit there's no pending merge → applyPendingMerge returns false
 *        → syncWithSupabase runs (mints anon on first load, then reconciles local↔remote)
 *        — exactly the Phase-1 behaviour.
 *  • SIGNED_OUT → clear the local cache and re-mint a fresh anonymous session
 *      (the single place re-anon happens — see signOutToAnon in lib/auth.ts).
 */
export function PrefsSync() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    // One reconcile per transition: a concurrent firing joins this promise.
    let reconcileInFlight: Promise<void> | null = null;

    const reconcile = (): Promise<void> => {
      if (reconcileInFlight) return reconcileInFlight;
      reconcileInFlight = (async () => {
        try {
          const merged = await applyPendingMerge(); // atomic claim/clear; true iff it unioned
          if (!merged) await syncWithSupabase();     // suppress the overwrite during the merge cycle
        } finally {
          reconcileInFlight = null;
        }
      })();
      return reconcileInFlight;
    };

    void (async () => {
      const sb = await getSupabaseBrowser();
      if (!sb || cancelled) {
        // Unconfigured: localStorage-only, nothing to bootstrap.
        if (!sb) void syncWithSupabase(); // safe no-op; keeps parity if env added later
        return;
      }

      const { data } = sb.auth.onAuthStateChange((event) => {
        if (cancelled) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          void reconcile();
        } else if (event === 'SIGNED_OUT') {
          void (async () => {
            resetLocalForSignOut();          // clean slate — no team bleed on shared machines
            await sb.auth.signInAnonymously(); // fresh empty anon (fires INITIAL/SIGNED_IN → resync)
          })();
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    })();

    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  return null;
}
