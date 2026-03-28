'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console in dev so we can diagnose the root cause
    console.error('[SportHouse] Page render error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-900/30 border border-red-700/30 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">Something went wrong</h2>
        <p className="text-white/45 text-sm mb-6 leading-relaxed">
          This page hit an unexpected error. Try refreshing — it usually clears up on its own.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 border border-white/12 text-sm font-semibold text-white/70 hover:text-white hover:bg-white/12 transition-all"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary className="text-[11px] text-white/25 cursor-pointer hover:text-white/45 transition-colors">
              Error details
            </summary>
            <pre className="mt-2 p-3 bg-black/40 border border-white/8 rounded-xl text-[10px] text-red-300/70 overflow-auto leading-relaxed whitespace-pre-wrap">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
