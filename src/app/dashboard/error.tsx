'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[dashboard] route error', error); }, [error]);
  return <ErrorState title="Couldn’t load your dashboard" onRetry={reset} />;
}
