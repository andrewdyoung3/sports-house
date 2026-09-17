import { cn } from '@/lib/utils';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// Token-driven (see :root fallbacks in globals.css): primary follows the page
// accent — brand violet by default, the focal team's colour under .sh-theme
// pages that set --accent — so buttons belong to whatever context they sit in.
const variantClasses: Record<Variant, string> = {
  primary:   'text-[var(--on-accent)] bg-[var(--accent)] hover:brightness-110 shadow-lg shadow-black/30',
  secondary: 'bg-[var(--surface-2)] hover:bg-white/12 text-white/90 shadow-sm',
  ghost:     'hover:bg-[var(--surface-2)] text-white/60 hover:text-white',
  outline:   'border border-[var(--border-strong)] hover:border-white/40 text-white/70 hover:text-white hover:bg-[var(--surface)]',
  danger:    'bg-[var(--loss)] hover:brightness-110 text-white shadow-sm',
};

const sizeClasses: Record<Size, string> = {
  sm:  'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md:  'px-4 py-2 text-sm rounded-xl gap-2',
  lg:  'px-6 py-3 text-base rounded-xl gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        // Keyboard focus comes from the global :focus-visible ring (globals.css).
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
