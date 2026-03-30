'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface F1GridEntry {
  position: number;
  driverName: string;
  constructorName: string;
  ergastDriverId: string;
  q1?: string;
  q2?: string;
  q3?: string;
}

const CONSTRUCTOR_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671C6',
  'Ferrari':         '#E8002D',
  'Mercedes':        '#27F4D2',
  'McLaren':         '#FF8000',
  'Aston Martin':    '#229971',
  'Alpine':          '#FF87BC',
  'Williams':        '#64C4FF',
  'Racing Bulls':    '#6692FF',
  'Haas':            '#B6BABD',
  'Kick Sauber':     '#52E252',
};

function lastName(full: string) {
  return full.split(' ').slice(-1)[0];
}

function shortConstructor(name: string) {
  // Abbreviate multi-word names to the last word for grid cells
  return name.split(' ').slice(-1)[0];
}

interface F1StartingGridProps {
  grid: F1GridEntry[];
  /** Ergast driverId of the followed driver, or undefined for constructor/championship follows */
  followedDriverId?: string;
  /** Constructor name followed (for constructor teams) */
  followedConstructorName?: string;
  accentColor: string;
}

export function F1StartingGrid({
  grid,
  followedDriverId,
  followedConstructorName,
  accentColor,
}: F1StartingGridProps) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null);

  const sortedGrid = [...grid].sort((a, b) => a.position - b.position);

  // Pair up into rows: [P1, P2], [P3, P4], ...
  const rows: F1GridEntry[][] = [];
  for (let i = 0; i < sortedGrid.length; i += 2) {
    rows.push(sortedGrid.slice(i, i + 2));
  }

  function isFollowed(entry: F1GridEntry) {
    if (followedDriverId) return entry.ergastDriverId === followedDriverId;
    if (followedConstructorName) return entry.constructorName === followedConstructorName;
    return false;
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-3 flex items-center gap-1.5">
        <span style={{ color: accentColor }}>▦</span>
        Starting Grid
      </p>

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-x-3 mb-1.5 px-1">
        <p className="text-[9px] font-bold uppercase tracking-widest text-white/20">Left side</p>
        <p className="text-[9px] font-bold uppercase tracking-widest text-white/20">Right side</p>
      </div>

      <div className="space-y-1">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-2 gap-x-3">
            {row.map((entry) => {
              const color = CONSTRUCTOR_COLORS[entry.constructorName] ?? '#9CA3AF';
              const followed = isFollowed(entry);
              const hovered  = hoveredPos === entry.position;
              const bestTime = entry.q3 ?? entry.q2 ?? entry.q1;

              return (
                <div
                  key={entry.position}
                  className={cn(
                    'relative flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-default select-none transition-colors duration-150',
                  )}
                  style={{
                    background: followed
                      ? `${color}1A`
                      : hovered
                        ? 'rgba(255,255,255,0.05)'
                        : 'rgba(255,255,255,0.025)',
                    borderLeft: `2.5px solid ${color}`,
                  }}
                  onMouseEnter={() => setHoveredPos(entry.position)}
                  onMouseLeave={() => setHoveredPos(null)}
                >
                  {/* Grid position badge */}
                  <span
                    className={cn(
                      'text-[10px] font-black tabular-nums shrink-0 w-4 text-right',
                      entry.position <= 3 ? 'text-white/75' : 'text-white/30',
                    )}
                  >
                    {entry.position}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-[11px] font-bold leading-none truncate',
                        followed ? 'text-white/90' : 'text-white/65',
                      )}
                    >
                      {hovered ? entry.driverName : lastName(entry.driverName)}
                    </p>
                    <p
                      className="text-[9px] leading-none mt-0.5 truncate"
                      style={{ color: `${color}BB` }}
                    >
                      {hovered && bestTime
                        ? bestTime
                        : shortConstructor(entry.constructorName)}
                    </p>
                  </div>

                  {/* Followed indicator dot */}
                  {followed && (
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-[9px] text-white/20 mt-2 pl-1">
        Hover a driver to see qualifying time · Left = odd positions, Right = even
      </p>
    </div>
  );
}
