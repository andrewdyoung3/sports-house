import type { GameResult } from '@/types';
import { cn } from '@/lib/utils';

interface RecentFormProps {
  results: GameResult[];
}

export function RecentForm({ results }: RecentFormProps) {
  return (
    <div className="flex items-center gap-1.5">
      {results.map((r, i) => (
        <div key={i} className="flex flex-col items-center gap-1 group relative">
          {/* W/L dot */}
          <div
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black transition-transform group-hover:scale-110',
              r.isWin
                ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-700/60'
                : 'bg-red-900/40 text-red-400 border border-red-800/50',
            )}
          >
            {r.isWin ? 'W' : 'L'}
          </div>
          {/* Tooltip on hover */}
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap shadow-xl">
              <p className="text-zinc-300 font-semibold">{r.opponentAbbr}</p>
              <p className={cn('font-black', r.isWin ? 'text-emerald-400' : 'text-red-400')}>
                {r.isWin ? 'W' : 'L'} {r.teamScore}–{r.opponentScore}
              </p>
              <p className="text-zinc-500">{r.isHome ? 'Home' : 'Away'}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
