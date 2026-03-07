import type { UpcomingGame } from '@/types';
import { Tv, MapPin, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatGameDate, formatTimeInZone } from '@/lib/utils';

interface GameCardProps {
  game: UpcomingGame;
  teamColor: string;
  userTz: string;
}

export function GameCard({ game, teamColor, userTz }: GameCardProps) {
  const dateLabel   = formatGameDate(game.date);
  const displayTime = formatTimeInZone(game.date, userTz);

  return (
    <div className="flex flex-col gap-3">
      {/* Matchup header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Opponent colored dot */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-black shrink-0"
            style={{ backgroundColor: game.opponentColor }}
          >
            {game.opponentAbbr}
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-100">
              {game.isHome ? 'vs' : '@'} {game.opponentAbbr}
            </p>
            <p className="text-xs text-zinc-500 truncate max-w-[160px]">{game.opponent}</p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-bold" style={{ color: teamColor }}>{dateLabel}</p>
          <p className="text-xs text-zinc-500">{displayTime}</p>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1 text-xs text-zinc-500">
          <MapPin className="h-3 w-3" />
          {game.isHome ? 'Home' : 'Away'}
        </span>
        <span className="flex items-center gap-1 text-xs text-zinc-500">
          <Calendar className="h-3 w-3" />
          {new Intl.DateTimeFormat('en-AU', { timeZone: userTz, month: 'short', day: 'numeric' }).format(new Date(game.date))}
        </span>
        {game.odds && (
          <span className="text-xs text-zinc-500">
            Spread {game.odds.spread}
          </span>
        )}
      </div>

      {/* Where to watch */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
          <Tv className="h-3 w-3" /> Watch:
        </span>
        {game.broadcast.map(ch => (
          <Badge key={ch} variant="neutral">{ch}</Badge>
        ))}
        {game.streaming.map(s => (
          <Badge key={s} className="bg-indigo-900/40 text-indigo-300 border-indigo-800/50">{s}</Badge>
        ))}
      </div>
    </div>
  );
}
