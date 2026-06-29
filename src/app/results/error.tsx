'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function ResultsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[results] route error', error); }, [error]);
  return <ErrorState title="Couldn’t load results" onRetry={reset} />;
}
