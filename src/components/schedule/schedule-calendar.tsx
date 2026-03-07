'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { datekeyInZone } from '@/lib/utils';
import type { Team, UpcomingGame } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface ScheduleCalendarProps {
  games: ScheduleEntry[];
  userTz: string;
  hoveredDateKey: string | null;
  onHover: (dateKey: string | null) => void;
  onDayClick: (dateKey: string) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function ScheduleCalendar({
  games,
  userTz,
  hoveredDateKey,
  onHover,
  onDayClick,
}: ScheduleCalendarProps) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const todayKey = useMemo(
    () => datekeyInZone(now.toISOString(), userTz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userTz],
  );

  // dateKey → games on that day
  const gamesByDate = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const g of games) {
      const dk = datekeyInZone(g.date, userTz);
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(g);
    }
    return map;
  }, [games, userTz]);

  // 7-column grid: null = blank leading/trailing cell, number = day-of-month
  const calendarDays = useMemo(() => {
    const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  // Construct YYYY-MM-DD matching datekeyInZone's en-CA output
  function dateKeyForDay(day: number): string {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${viewYear}-${mm}-${dd}`;
  }

  function goPrev() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function goNext() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  // Jump forward to the first month that has a game if the current view is empty
  const viewHasGames = calendarDays.some(day => {
    if (day === null) return false;
    return gamesByDate.has(dateKeyForDay(day));
  });

  return (
    <div className="glass rounded-2xl p-4 select-none">

      {/* ── Month navigation ── */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={goPrev}
          className="p-1.5 rounded-lg text-white/35 hover:text-white hover:bg-white/8 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-bold text-white">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={goNext}
          className="p-1.5 rounded-lg text-white/35 hover:text-white hover:bg-white/8 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Day-of-week headers ── */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-[9px] font-semibold text-white/25 text-center py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {calendarDays.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;

          const dk        = dateKeyForDay(day);
          const dayGames  = gamesByDate.get(dk);
          const isToday   = dk === todayKey;
          const isHovered = dk === hoveredDateKey;
          const hasGames  = !!dayGames?.length;

          // Primary color of first game's team for glow
          const glowColor = dayGames?.[0]?.team.primaryColor;

          return (
            <button
              key={dk}
              onClick={() => hasGames && onDayClick(dk)}
              onMouseEnter={() => hasGames && onHover(dk)}
              onMouseLeave={() => onHover(null)}
              disabled={!hasGames}
              className={[
                'relative flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg',
                'text-[11px] font-medium transition-all duration-150',
                hasGames ? 'cursor-pointer' : 'cursor-default',
                isToday
                  ? 'ring-1 ring-white/35 bg-white/10 text-white font-bold'
                  : hasGames
                    ? 'text-white/65 hover:text-white'
                    : 'text-white/20',
                isHovered && hasGames ? 'scale-110' : '',
              ].join(' ')}
              style={isHovered && glowColor
                ? { boxShadow: `0 0 14px ${glowColor}55`, background: `${glowColor}18` }
                : undefined}
              aria-label={hasGames ? `${day} ${MONTH_NAMES[viewMonth]}, ${dayGames!.length} fixture${dayGames!.length > 1 ? 's' : ''}` : undefined}
            >
              <span>{day}</span>

              {/* Team-colour dots — one per game (max 3) */}
              {hasGames && (
                <div className="flex gap-0.5 justify-center">
                  {dayGames!.slice(0, 3).map((g, gi) => (
                    <span
                      key={gi}
                      className="w-1 h-1 rounded-full"
                      style={{ backgroundColor: g.team.primaryColor }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Empty-month nudge ── */}
      {!viewHasGames && (
        <p className="text-[9px] text-white/20 text-center mt-3">
          No fixtures this month
        </p>
      )}

      <p className="text-[9px] text-white/18 text-center mt-3 leading-tight">
        Tap a coloured date to jump to fixture
      </p>
    </div>
  );
}
