import type { GameResult } from '@/types';
import { cn } from '@/lib/utils';

interface RecentFormProps {
  results: GameResult[];
}

export function RecentForm({ results }: RecentFormProps) {
  return (
    <div className="flex items-center gap-1.5">
      {[...results].reverse().map((r, i) => {
        const isDraw = r.isDraw === true;
        const label  = isDraw ? 'D' : r.isWin ? 'W' : 'L';

        const dotCls = isDraw
          ? 'bg-amber-900/50 text-amber-300 border border-amber-600/50'
          : r.isWin
            ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-700/60'
            : 'bg-red-900/40 text-red-400 border border-red-800/50';

        const scoreCls = isDraw
          ? 'text-amber-300'
          : r.isWin ? 'text-emerald-400' : 'text-red-400';

        const scoreStr = isDraw
          ? `D ${r.teamScore}–${r.opponentScore}`
          : `${r.isWin ? 'W' : 'L'} ${r.teamScore}–${r.opponentScore}`;

        return (
          <div key={i} className="flex flex-col items-center gap-1 group relative">
            {/* W / D / L dot */}
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black transition-transform group-hover:scale-110',
                dotCls,
              )}
            >
              {label}
            </div>

            {/* Tooltip — appears above the dot */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[11px] whitespace-nowrap shadow-xl">
                {/* Opponent name (full) */}
                <p className="text-zinc-200 font-bold mb-0.5 leading-none">{r.opponent}</p>
                {/* Score */}
                <p className={cn('font-black leading-none', scoreCls)}>{scoreStr}</p>
                {/* Home/Away + competition */}
                <p className="text-zinc-500 mt-0.5 leading-none">
                  {r.isHome ? 'Home' : 'Away'}
                  {r.competition ? ` · ${r.competition}` : ''}
                </p>
              </div>
              {/* Tooltip arrow */}
              <div className="w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 mx-auto -mt-1" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
