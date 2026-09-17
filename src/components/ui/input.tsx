import { cn } from '@/lib/utils';
import { type InputHTMLAttributes, forwardRef } from 'react';
import { Search } from 'lucide-react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, ...props }, ref) => (
    <div className="relative w-full">
      {icon && (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-3)] pointer-events-none" />
      )}
      <input
        ref={ref}
        className={cn(
          'w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-3)]',
          'rounded-xl px-3 py-2.5 text-sm outline-none',
          'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-soft)] transition-all duration-150',
          icon && 'pl-9',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Input.displayName = 'Input';
