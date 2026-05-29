import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  /** Lucide icon component shown in the glass chrome. */
  icon: LucideIcon;
  title: string;
  body: string;
  /** Tailwind colour class for the body paragraph — varies by page palette. */
  bodyClassName?: string;
}

/**
 * Shared empty-state block: glass icon chrome, heading, body copy, and a
 * "Choose Your Teams" CTA linking to onboarding. Used by the schedule and
 * dashboard pages. The CTA is identical across call sites; only the icon,
 * title, body, and body colour vary.
 */
export function EmptyState({ icon: Icon, title, body, bodyClassName = 'text-white/55' }: EmptyStateProps) {
  return (
    <div className="max-w-lg mx-auto px-4 py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-700/30 flex items-center justify-center mx-auto mb-6">
        <Icon className="h-8 w-8 text-indigo-400" />
      </div>
      <h1 className="text-2xl font-black text-white mb-3">{title}</h1>
      <p className={`${bodyClassName} mb-8 leading-relaxed`}>
        {body}
      </p>
      <Link href="/onboarding">
        <Button size="lg" className="gap-2">
          <Plus className="h-4 w-4" />
          Choose Your Teams
        </Button>
      </Link>
    </div>
  );
}
