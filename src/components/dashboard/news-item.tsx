import type { NewsItem } from '@/types';
import { ExternalLink } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';

const CATEGORY_COLORS = {
  injury:  'text-amber-400',
  trade:   'text-sky-400',
  recap:   'text-emerald-400',
  preview: 'text-indigo-400',
  general: 'text-zinc-400',
};

interface NewsItemProps {
  item: NewsItem;
}

export function NewsCard({ item }: NewsItemProps) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 group hover:bg-zinc-800/50 rounded-xl p-2.5 -mx-2.5 transition-colors"
    >
      {/* Category dot */}
      <div className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', CATEGORY_COLORS[item.category])}
           style={{ backgroundColor: 'currentColor' }} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 group-hover:text-white leading-snug line-clamp-2 transition-colors">
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-zinc-500 font-medium">{item.source}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-600">{timeAgo(item.publishedAt)}</span>
        </div>
      </div>

      <ExternalLink className="h-3.5 w-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 mt-1" />
    </a>
  );
}
