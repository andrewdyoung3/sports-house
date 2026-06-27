'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

export default function ScheduleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[schedule] route error', error); }, [error]);
  return <ErrorState title="Couldn’t load your schedule" onRetry={reset} />;
}
