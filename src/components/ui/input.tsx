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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
      )}
      <input
        ref={ref}
        className={cn(
          'w-full bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500',
          'rounded-xl px-3 py-2.5 text-sm outline-none',
          'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all duration-150',
          icon && 'pl-9',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Input.displayName = 'Input';
