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
    const initial = (state.email?.trim().charAt(0) || 'A').toUpperCase();
    return (
      <div className="relative" ref={wrapRef}>
        {/* Phase B · Step 4 — signed-in pill in the design `.sh-nav-myteams` vocabulary;
            opens the EXISTING absolute dropdown (not trapped by the navbar blur).
            Minimises below md: avatar initial + caret; full email returns at md+. */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="sh-nav-myteams max-w-[200px]"
          aria-label={label}
          title={label}
        >
          <span
            className="md:hidden inline-flex items-center justify-center rounded-full flex-shrink-0"
            style={{ width: '22px', height: '22px', background: 'var(--surface-2)', fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="hidden md:block truncate">{label}</span>
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        </button>
        {menuOpen && (
          // Step 6 · 2C — dropdown reskinned to the `.sh-*` surface vocabulary. The
          // navbar is already inside `.sh-theme`, so default tokens resolve. The surface
          // is an opaque dark panel (a `--surface-2` tint layered over `--bg` via a
          // flat gradient) — no backdrop-filter is added; legibility comes from the
          // opaque base + a drop shadow. Position + outside-click handlers unchanged.
          <div
            className="absolute right-0 mt-2 w-56 p-1.5 z-50"
            style={{
              background: 'linear-gradient(var(--surface-2), var(--surface-2)), var(--bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              boxShadow: '0 12px 32px rgba(0,0,0,.45)',
              animation: 'slideDown 0.18s ease-out',
            }}
          >
            <p
              className="px-3 py-2 text-[12px] truncate"
              style={{ color: 'var(--text-3)' }}
              title={label}
            >
              {label}
            </p>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] transition-colors text-[var(--text-2)] hover:text-[var(--text)] hover:bg-white/[0.06]"
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
      {/* Phase B · Step 4 — anonymous "sign in" pill in the design `.sh-nav-myteams`
          vocabulary; still opens the portaled auth modal (trigger unchanged). */}
      <button
        onClick={() => setModalOpen(true)}
        title="Sign in to sync across devices"
        className="sh-nav-myteams"
      >
        <LogIn className="h-4 w-4" />
        <span className="hidden sm:block">Sign in</span>
      </button>
      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
