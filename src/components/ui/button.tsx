import { cn } from '@/lib/utils';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:   'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 shadow-sm',
  ghost:     'hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100',
  outline:   'border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/50',
  danger:    'bg-red-700 hover:bg-red-600 text-white shadow-sm',
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
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
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
