'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  body?: string;
  /** When provided, renders a "Try again" button. */
  onRetry?: () => void;
}

/**
 * Shared error-state block (UX-3): mirrors EmptyState's chrome but signals a
 * failure (rose accent) rather than "nothing here", so an outage is never shown
 * as an empty page. Used by route-level error.tsx boundaries.
 */
export function ErrorState({
  title = 'Something went wrong',
  body  = 'We couldn’t load this page. This is usually temporary — please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="max-w-lg mx-auto px-4 py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-900/40 border border-rose-700/30 flex items-center justify-center mx-auto mb-6">
        <AlertTriangle className="h-8 w-8 text-rose-400" />
      </div>
      <h1 className="text-2xl font-black text-white mb-3">{title}</h1>
      <p className="text-white/55 mb-8 leading-relaxed">{body}</p>
      {onRetry && (
        <Button size="lg" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
