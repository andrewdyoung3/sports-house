// Step 9 — reskinned to .sh-tile vocabulary. Left edge driven by --accent (teamColor),
// consistent with .sh-fix / .sh-tile-* conventions. All data preserved; zinc-* removed.
import type { UpcomingGame } from '@/types';
import { Tv } from 'lucide-react';
import { TeamBadge } from '@/components/ui/team-badge';
import { formatGameDate, formatTimeInZone } from '@/lib/utils';
import { wcStageLabel } from '@/lib/world-cup';

interface GameCardProps {
  game: UpcomingGame;
  teamColor: string;
  teamShortName: string;
  compLabel: string;
  userTz: string;
}

export function GameCard({ game, teamColor, teamShortName, compLabel, userTz }: GameCardProps) {
  const dateLabel   = formatGameDate(game.date);
  const displayTime = formatTimeInZone(game.date, userTz);
  const allChannels = [...game.broadcast, ...game.streaming];

  return (
    <div
      className="sh-tile"
      style={{ '--accent': teamColor } as React.CSSProperties}
    >
      {/* Comp row: opponent badge + competition / league label */}
      <div className="sh-tile-comp">
        <TeamBadge
          logoUrl={game.opponentLogoUrl}
          abbreviation={game.opponentAbbr}
          primaryColor={game.opponentColor ?? '#6B7280'}
          size={20}
        />
        <span
          className="sh-comptag"
          style={{ '--c': teamColor } as React.CSSProperties}
        >
          {compLabel}
        </span>
      </div>

      {/* World Cup stage badge */}
      {game.worldCupStage && (
        <div className="mb-1">
          <span
            className="sh-comptag"
            style={{ '--c': 'rgba(255,255,255,0.45)' } as React.CSSProperties}
          >
            {wcStageLabel(game.worldCupStage, game.worldCupGroup)}
          </span>
        </div>
      )}

      {/* Teams row */}
      <div className="sh-tile-teams">
        <span className="sh-tile-name">{teamShortName}</span>
        <span className="sh-tile-sep">{game.isHome ? 'vs' : '@'}</span>
        <span className="sh-tile-name">
          {game.worldCupOpponentTBD ? (game.worldCupOpponentPlaceholder ?? 'TBD') : game.opponentAbbr}
        </span>
      </div>

      {/* Foot: date·time + home/away */}
      <div className="sh-tile-foot">
        <span className="sh-tile-time">{dateLabel} · {displayTime}</span>
        <span className="sh-tile-venue">{game.isHome ? 'Home' : 'Away'}</span>
      </div>

      {/* Broadcast / streaming — preserved */}
      {allChannels.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="sh-meta-item" style={{ fontSize: '11px' }}>
            <Tv size={12} />
          </span>
          {allChannels.map(ch => (
            <span
              key={ch}
              className="sh-comptag"
              style={{ '--c': 'rgba(255,255,255,0.4)' } as React.CSSProperties}
            >
              {ch}
            </span>
          ))}
        </div>
      )}

      {/* Odds — preserved when present */}
      {game.odds && (
        <p className="sh-detail-body-sm" style={{ fontSize: '11px' }}>
          Spread{' '}
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{game.odds.spread}</span>
        </p>
      )}
    </div>
  );
}
