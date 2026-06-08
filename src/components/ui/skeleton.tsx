import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

// Step 9 — dashboard-only consumer; reskinned to .sh-* token surface.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-lg', className)}
      style={{ background: 'var(--surface-2)' }}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div
      className="rounded-[var(--radius-lg)] overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="px-5 py-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
