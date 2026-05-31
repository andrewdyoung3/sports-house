'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { continueWithEmail, continueWithGoogle } from '@/lib/auth';

/**
 * Opt-in sign-in / sign-up modal. A `.glass-strong` card over an obsidian backdrop,
 * matching the app's design system. There is no "sign up vs sign in" choice — one
 * action per method (see lib/auth.ts); anonymous browsing is never interrupted by
 * this — it only ever opens from the navbar account entry.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'redirecting' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Reset transient state whenever the modal is (re)opened.
  useEffect(() => {
    if (open) { setPhase('idle'); setMessage(''); }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portal to <body> so the fixed overlay is positioned relative to the VIEWPORT.
  // The navbar (this modal's React parent) has `backdrop-blur` → a backdrop-filter,
  // which makes the navbar the containing block for any `position: fixed` descendant.
  // Rendered in place, `inset-0` resolved to the 56px navbar box, so the card was
  // clipped at the top (the "Continue with Google" row sat above the viewport).
  if (!open || typeof document === 'undefined') return null;

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setPhase('sending');
    const res = await continueWithEmail(email.trim());
    if (!res.ok) { setPhase('error'); setMessage(res.error ?? 'Something went wrong. Try again.'); return; }
    setPhase('sent');
    setMessage('Check your inbox for a sign-in link.');
  }

  async function handleGoogle() {
    setPhase('redirecting');
    const res = await continueWithGoogle();
    // On success the browser redirects to Google; we only land here on an error.
    if (res.error) { setPhase('error'); setMessage(res.error); }
  }

  const busy = phase === 'sending' || phase === 'redirecting';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to SportHouse"
    >
      {/* Full-height flex wrapper centres the card and lets the overlay scroll if the
          card is taller than the viewport; the card also caps its own height. */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="glass-strong rounded-2xl w-full max-w-sm p-6 relative max-h-[calc(100dvh-2rem)] overflow-y-auto"
          style={{ animation: 'slideDown 0.2s ease-out' }}
          onClick={(e) => e.stopPropagation()}
        >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-semibold text-white tracking-tight">Sign in to SportHouse</h2>
        <p className="text-sm text-white/50 mt-1 mb-5">
          Sync your followed teams across all your devices. Your account keeps its own team
          list — your guest picks stay on this device and return when you sign out.
        </p>

        {phase === 'sent' ? (
          <div className="flex flex-col items-center text-center py-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mb-3" />
            <p className="text-white font-medium">{message}</p>
            <p className="text-sm text-white/50 mt-1">Open it on this device to finish signing in.</p>
          </div>
        ) : (
          <>
            {/* Google */}
            <button
              onClick={handleGoogle}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-medium transition-colors disabled:opacity-50"
            >
              {phase === 'redirecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleGlyph />}
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-4">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-white/30">or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* Email magic-link */}
            <form onSubmit={handleEmail} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={busy}
                  className="w-full h-11 pl-9 pr-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-white/25 transition-colors disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f97316 100%)' }}
              >
                {phase === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Email me a link
              </button>
            </form>
          </>
        )}

        {phase === 'error' && (
          <p className="text-sm text-rose-400 mt-4 text-center">{message}</p>
        )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Inline Google "G" — lucide ships no brand glyphs. */
function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
