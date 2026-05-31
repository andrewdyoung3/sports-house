'use client';

import { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, ChevronDown } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { getAuthState, signOutToAnon, type AuthState } from '@/lib/auth';
import { AuthModal } from '@/components/auth/auth-modal';

/**
 * Navbar account entry.
 *   • anonymous / signed-out → a subtle "Sign in" pill that opens the auth modal.
 *   • permanent              → the account email (truncated) + a small dropdown
 *                              holding the email and Sign out.
 *   • unconfigured           → renders nothing (no dead button when Supabase env is unset).
 *
 * Anonymous content access is never gated by this — the modal is strictly opt-in.
 */
export function AccountMenu() {
  const [state, setState] = useState<AuthState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Resolve auth state on mount and keep it live across sign-in/out.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      setState(await getAuthState());
      const sb = await getSupabaseBrowser();
      if (!sb) return;
      const { data } = sb.auth.onAuthStateChange(() => { void getAuthState().then(setState); });
      unsubscribe = () => data.subscription.unsubscribe();
    })();
    return () => unsubscribe?.();
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
    await signOutToAnon();
    // PrefsSync re-mints anon; the auth subscription above refreshes the label.
  }

  // Unconfigured, or state not yet resolved → render nothing (no layout flash, no dead UI).
  if (!state || state.status === 'unconfigured') return null;

  if (state.status === 'permanent') {
    const label = state.email ?? 'Account';
    return (
      <div className="relative" ref={wrapRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/8 transition-all max-w-[180px]"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        </button>
        {menuOpen && (
          <div
            className="glass-strong absolute right-0 mt-2 w-56 rounded-xl p-2 z-50"
            style={{ animation: 'slideDown 0.18s ease-out' }}
          >
            <p className="px-3 py-2 text-xs text-white/40 truncate" title={label}>{label}</p>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/8 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  // anonymous or signed-out → opt-in sign-in pill.
  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all"
      >
        <LogIn className="h-4 w-4" />
        <span className="hidden sm:block">Sign in</span>
      </button>
      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
