'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { datekeyInZone, formatTimeInZone } from '@/lib/utils';
import { TeamBadge } from '@/components/ui/team-badge';
import { TEAM_LOGOS } from '@/lib/team-logos';
import type { Team, UpcomingGame, GameResult } from '@/types';

type ScheduleEntry  = UpcomingGame & { team: Team };
type PastResultEntry = GameResult  & { team: Team };

interface ScheduleCalendarProps {
  games: ScheduleEntry[];
  userTz: string;
  hoveredDateKey: string | null;
  onHover: (dateKey: string | null) => void;
  onDayClick: (dateKey: string) => void;
  /** Historical results (up to ~2 months back). Days with results get W/L/D dots
   *  and navigate to /results#result-date-{dateKey} on click. */
  pastResults?: PastResultEntry[];
  /** Called when the user clicks a past-results day (parent handles navigation). */
  onPastDayClick?: (dateKey: string) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];


/** Parse a YYYY-MM-DD key into a short label like "Tue 18 Mar" */
function labelFromDateKey(dk: string): string {
  const [y, m, d] = dk.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
  }).format(new Date(y, m - 1, d, 12));
}

export function ScheduleCalendar({
  games,
  userTz,
  hoveredDateKey,
  onHover,
  onDayClick,
  pastResults = [],
  onPastDayClick,
}: ScheduleCalendarProps) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const todayKey = useMemo(
    () => datekeyInZone(now.toISOString(), userTz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userTz],
  );

  // dateKey → upcoming fixtures
  const gamesByDate = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const g of games) {
      const dk = datekeyInZone(g.date, userTz);
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(g);
    }
    return map;
  }, [games, userTz]);

  // dateKey → past results
  const pastByDate = useMemo(() => {
    const map = new Map<string, PastResultEntry[]>();
    for (const r of pastResults) {
      const dk = datekeyInZone(r.date, userTz);
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(r);
    }
    return map;
  }, [pastResults, userTz]);

  // 7-column grid: null = blank leading/trailing cell, number = day-of-month
  const calendarDays = useMemo(() => {
    const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

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

  const viewHasActivity = calendarDays.some(day => {
    if (day === null) return false;
    const dk = dateKeyForDay(day);
    return gamesByDate.has(dk) || pastByDate.has(dk);
  });

  // Preview panel — driven by hoveredDateKey from parent
  const previewGames   = hoveredDateKey ? (gamesByDate.get(hoveredDateKey) ?? []) : [];
  const previewPast    = hoveredDateKey ? (pastByDate.get(hoveredDateKey)  ?? []) : [];

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

          const dk          = dateKeyForDay(day);
          const dayGames    = gamesByDate.get(dk);
          const dayPast     = pastByDate.get(dk);
          const isToday     = dk === todayKey;
          const isHovered   = dk === hoveredDateKey;
          const hasUpcoming = !!dayGames?.length;
          const hasPast     = !!dayPast?.length;
          const hasActivity = hasUpcoming || hasPast;

          // Glow always uses team primary colour
          const glowColor = hasUpcoming
            ? dayGames![0].team.primaryColor
            : hasPast
              ? dayPast![0].team.primaryColor
              : undefined;

          return (
            <button
              key={dk}
              onClick={() => {
                if (hasUpcoming) onDayClick(dk);
                else if (hasPast) onPastDayClick?.(dk);
              }}
              onMouseEnter={() => hasActivity && onHover(dk)}
              onMouseLeave={() => onHover(null)}
              disabled={!hasActivity}
              className={[
                'relative flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg',
                'text-[11px] font-medium transition-all duration-150',
                hasActivity ? 'cursor-pointer' : 'cursor-default',
                isToday
                  ? 'ring-1 ring-white/35 bg-white/10 text-white font-bold'
                  : hasUpcoming
                    ? 'text-white/65 hover:text-white'
                    : hasPast
                      ? 'text-white/40 hover:text-white/70'
                      : 'text-white/20',
                isHovered && hasActivity ? 'scale-110' : '',
              ].join(' ')}
              style={isHovered && glowColor
                ? { boxShadow: `0 0 14px ${glowColor}55`, background: `${glowColor}18` }
                : undefined}
              aria-label={
                hasUpcoming
                  ? `${day} ${MONTH_NAMES[viewMonth]}, ${dayGames!.length} fixture${dayGames!.length > 1 ? 's' : ''}`
                  : hasPast
                    ? `${day} ${MONTH_NAMES[viewMonth]}, ${dayPast!.length} result${dayPast!.length > 1 ? 's' : ''}`
                    : undefined
              }
            >
              <span>{day}</span>
              {/* Upcoming fixture dots — team primary colour */}
              {hasUpcoming && (
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
              {/* Past game dots — team primary colour, slightly dimmed */}
              {!hasUpcoming && hasPast && (
                <div className="flex gap-0.5 justify-center">
                  {dayPast!.slice(0, 3).map((r, ri) => (
                    <span
                      key={ri}
                      className="w-1 h-1 rounded-full opacity-50"
                      style={{ backgroundColor: r.team.primaryColor }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Hover preview panel ── */}
      <div
        className="mt-3 pt-3 border-t border-white/10 overflow-hidden transition-all duration-200"
        style={{ minHeight: '2.5rem' }}
      >
        {(previewGames.length > 0 || previewPast.length > 0) ? (
          <div style={{ animation: 'slideDown 0.18s ease-out' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-2">
              {labelFromDateKey(hoveredDateKey!)}
            </p>

            {/* Upcoming fixtures */}
            {previewGames.length > 0 && (
              <div className="space-y-2">
                {previewGames.map(game => (
                  <div
                    key={game.id}
                    className="flex items-center gap-1.5"
                    style={{ borderLeft: `2px solid ${game.team.primaryColor}60`, paddingLeft: '6px' }}
                  >
                    <TeamBadge
                      logoUrl={TEAM_LOGOS[game.team.id]}
                      abbreviation={game.team.abbreviation}
                      primaryColor={game.team.primaryColor}
                      size={20}
                      className="rounded-md shrink-0"
                    />
                    <span className="text-[11px] font-bold text-white leading-none">
                      {game.team.shortName}
                    </span>
                    <span className="text-[10px] text-white/35 leading-none">
                      {game.isHome ? 'vs' : 'at'}
                    </span>
                    <TeamBadge
                      logoUrl={game.opponentLogoUrl}
                      abbreviation={game.opponentAbbr}
                      primaryColor={game.opponentColor}
                      size={20}
                      className="rounded-md shrink-0"
                    />
                    <span className="text-[11px] text-white/70 leading-none flex-1 min-w-0 truncate">
                      {game.opponent}
                    </span>
                    <span
                      className="text-[10px] font-bold shrink-0 leading-none"
                      style={{ color: game.team.primaryColor }}
                    >
                      {formatTimeInZone(game.date, userTz)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Past games — matchup only, no result shown */}
            {previewPast.length > 0 && (
              <div className="space-y-2 mt-1">
                {previewPast.map((r, ri) => (
                  <div
                    key={ri}
                    className="flex items-center gap-1.5"
                    style={{ borderLeft: `2px solid ${r.team.primaryColor}60`, paddingLeft: '6px' }}
                  >
                    <TeamBadge
                      logoUrl={TEAM_LOGOS[r.team.id]}
                      abbreviation={r.team.abbreviation}
                      primaryColor={r.team.primaryColor}
                      size={20}
                      className="rounded-md shrink-0"
                    />
                    <span className="text-[11px] font-bold text-white leading-none">
                      {r.team.shortName}
                    </span>
                    <span className="text-[10px] text-white/35 leading-none">
                      {r.isHome ? 'vs' : 'at'}
                    </span>
                    <TeamBadge
                      logoUrl={r.opponentLogoUrl}
                      abbreviation={r.opponentAbbr}
                      primaryColor={r.team.primaryColor}
                      size={20}
                      className="rounded-md shrink-0"
                    />
                    <span className="text-[11px] text-white/70 leading-none flex-1 min-w-0 truncate">
                      {r.opponent}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[9px] text-white/18 text-center leading-tight">
            {viewHasActivity ? 'Hover a date · click to jump' : 'No fixtures this month'}
          </p>
        )}
      </div>
    </div>
  );
}
