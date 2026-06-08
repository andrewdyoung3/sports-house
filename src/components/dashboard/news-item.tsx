// Step 9 — zinc-* classes replaced with .sh-* token equivalents.
// Category colors (amber/sky/emerald/indigo) are intentional; only
// the 'general' fallback (zinc-400) is changed to token white/40.
import type { NewsItem } from '@/types';
import { ExternalLink } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';

const CATEGORY_COLORS: Record<string, string> = {
  injury:  'text-amber-400',
  trade:   'text-sky-400',
  recap:   'text-emerald-400',
  preview: 'text-indigo-400',
  general: '[color:var(--text-3)]',
};

interface NewsItemProps {
  item: NewsItem;
}

function safeNewsUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export function NewsCard({ item }: NewsItemProps) {
  const href = safeNewsUrl(item.url);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 group hover:bg-white/[0.05] rounded-xl p-2.5 -mx-2.5 transition-colors"
    >
      {/* Category dot */}
      <div
        className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', CATEGORY_COLORS[item.category] ?? 'text-white/40')}
        style={{ backgroundColor: 'currentColor' }}
      />

      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium leading-snug line-clamp-2 transition-colors"
          style={{ color: 'var(--text-2)' }}
        >
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{item.source}</span>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{timeAgo(item.publishedAt)}</span>
        </div>
      </div>

      <ExternalLink
        className="h-3.5 w-3.5 shrink-0 mt-1 transition-colors group-hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      />
    </a>
  );
}
