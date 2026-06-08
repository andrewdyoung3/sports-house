// Step 9 — reskinned to the .sh-pip vocabulary from the expand panels.
// Circle dots (w-8 h-8 rounded-full) are replaced with .sh-pip.is-w/.is-l;
// draws use inline amber (same pattern as CompactForm in game-expand-panel).
// Tooltip preserved; zinc colors replaced with .sh-* token values.
import type { GameResult } from '@/types';
import { cn } from '@/lib/utils';

interface RecentFormProps {
  results: GameResult[];
}

export function RecentForm({ results }: RecentFormProps) {
  // Oldest game on the LEFT, most recent on the RIGHT.
  const ordered = [...results].reverse();
  const lastIdx = ordered.length - 1;

  return (
    <div className="flex items-center gap-1.5">
      {ordered.map((r, i) => {
        const isDraw   = r.isDraw === true;
        const label    = isDraw ? 'D' : r.isWin ? 'W' : 'L';
        const isLatest = i === lastIdx;
        const scoreStr = isDraw
          ? `D ${r.teamScore}–${r.opponentScore}`
          : `${r.isWin ? 'W' : 'L'} ${r.teamScore}–${r.opponentScore}`;

        return (
          <div key={i} className="flex flex-col items-center gap-1 group relative">
            {/* W / D / L pip — latest gets a subtle ring */}
            <span
              className={cn(
                'sh-pip',
                isDraw ? 'is-d' : r.isWin ? 'is-w' : 'is-l',
                isLatest && 'ring-1 ring-white/25 ring-offset-1 ring-offset-black/60',
              )}
            >
              {label}
            </span>

            {/* Tooltip — appears above the pip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
              <div
                className="rounded-lg px-3 py-2 text-[11px] whitespace-nowrap shadow-xl"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <p className="font-bold mb-0.5 leading-none" style={{ color: 'var(--text)' }}>
                  {r.opponent}
                </p>
                <p
                  className="font-black leading-none"
                  style={{ color: isDraw ? '#f5c518' : r.isWin ? 'var(--win)' : 'var(--loss)' }}
                >
                  {scoreStr}
                </p>
                <p className="mt-0.5 leading-none" style={{ color: 'var(--text-3)' }}>
                  {r.isHome ? 'Home' : 'Away'}{r.competition ? ` · ${r.competition}` : ''}
                </p>
              </div>
              {/* Arrow */}
              <div
                className="w-2 h-2 rotate-45 mx-auto -mt-1"
                style={{
                  background: 'var(--surface-2)',
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
