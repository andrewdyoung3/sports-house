import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Highlight the top edge in a custom color (used for team branding). */
  accentColor?: string;
}

export function Card({ className, accentColor, style, children, ...props }: CardProps) {
  return (
    <div
      className={cn('bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden', className)}
      style={{
        ...(accentColor ? { borderTopColor: accentColor, borderTopWidth: '2px' } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4 border-b border-zinc-800', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardSection({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-3 border-t border-zinc-800/60', className)} {...props} />;
}
