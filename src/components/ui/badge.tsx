import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'win' | 'loss' | 'neutral' | 'live';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-white/8 text-white/70 border border-white/12',
  win:     'bg-emerald-900/50 text-emerald-400 border border-emerald-800/60',
  loss:    'bg-red-900/40 text-red-400 border border-red-800/50',
  neutral: 'bg-white/6 text-white/50 border border-white/10',
  live:    'bg-red-600 text-white animate-pulse',
};

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
