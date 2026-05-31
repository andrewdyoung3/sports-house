'use client';

import { useEffect } from 'react';
import { reconcileActiveIdentity, restoreGuestSession } from '@/lib/user-prefs';
import { getSupabaseBrowser } from '@/lib/supabase/client';

/**
 * Invisible app-load bootstrap + auth-state wiring. No-ops when Supabase isn't
 * configured (the app runs at parity on localStorage alone).
 *
 * Two independent team spaces, driven off `onAuthStateChange`:
 *
 *  • INITIAL_SESSION / SIGNED_IN → ONE serialized reconcile (reconcileInFlight makes
 *      the INITIAL_SESSION + SIGNED_IN double-fire JOIN a single run, not race). It
 *      RELOADS the active cache from the current identity's store (replace, never
 *      merge): a permanent session loads the account's teams; an anon session runs the
 *      Phase-1 local↔row reconcile. This is the first authoritative action on the
 *      transition, so no stale cache can be pushed onto a freshly-switched account row.
 *  • SIGNED_OUT → restoreGuestSession(): switch the active cache back to the device-
 *      local guest picks and re-mint a fresh anonymous session.
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
        try { await reconcileActiveIdentity(); }
        finally { reconcileInFlight = null; }
      })();
      return reconcileInFlight;
    };

    void (async () => {
      const sb = await getSupabaseBrowser();
      if (!sb || cancelled) {
        // Unconfigured: localStorage-only, nothing to bootstrap.
        if (!sb) void reconcileActiveIdentity(); // safe no-op; keeps parity if env added later
        return;
      }

      const { data } = sb.auth.onAuthStateChange((event) => {
        if (cancelled) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          void reconcile();
        } else if (event === 'SIGNED_OUT') {
          void restoreGuestSession(); // restore guest picks + re-mint a fresh anon session
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    })();

    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  return null;
}
