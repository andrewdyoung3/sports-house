import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-zinc-800', className)}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
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
      <div className="px-5 py-3 border-t border-zinc-800/60 space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
