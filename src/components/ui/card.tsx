import { cn } from '@/lib/utils';
import type { HTMLAttributes, CSSProperties } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Team accent colour: drives the top edge + sets --accent for all descendants. */
  accentColor?: string;
}

// Step 9 — dashboard-only component; reskinned to sh-theme + token surface.
// sh-theme on the root means all Card descendants (section heads, pips, etc.)
// resolve the .sh-* token system. --accent = accentColor lets child .sh-*
// classes read the team colour automatically (icons, quick-dots, etc.).
export function Card({ className, accentColor, style, children, ...props }: CardProps) {
  return (
    <div
      className={cn('sh-theme rounded-[var(--radius-lg)] overflow-hidden', className)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        ...(accentColor ? {
          borderTopColor: accentColor,
          borderTopWidth: '3px',
          '--accent': accentColor,
        } : {}),
        ...style,
      } as CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, style, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 py-4', className)}
      style={{ borderBottom: '1px solid var(--border)', ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardSection({ className, style, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 py-3', className)}
      style={{ borderTop: '1px solid var(--border)', ...style }}
      {...props}
    >
      {children}
    </div>
  );
}
