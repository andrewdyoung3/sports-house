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
    <div className="sh-card sh-cal select-none">

      {/* ── Month navigation ── */}
      <div className="sh-cal-head">
        <button className="sh-cal-nav" onClick={goPrev} aria-label="Previous month">
          <ChevronLeft size={14} />
        </button>
        <span className="sh-cal-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className="sh-cal-nav" onClick={goNext} aria-label="Next month">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* ── Day-of-week headers ── */}
      <div className="sh-cal-grid sh-cal-dow">
        {DAY_LABELS.map(d => (
          <span key={d} className="sh-cal-dowcell">{d}</span>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      <div className="sh-cal-grid">
        {calendarDays.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} className="sh-cal-cell is-empty" />;

          const dk          = dateKeyForDay(day);
          const dayGames    = gamesByDate.get(dk);
          const dayPast     = pastByDate.get(dk);
          const isToday     = dk === todayKey;
          const isHovered   = dk === hoveredDateKey;
          const hasUpcoming = !!dayGames?.length;
          const hasPast     = !!dayPast?.length;
          const hasActivity = hasUpcoming || hasPast;

          // Hover glow keeps its existing TEAM-colour source (preserves the feed↔calendar highlight).
          const glowColor = hasUpcoming
            ? dayGames![0].team.primaryColor
            : hasPast
              ? dayPast![0].team.primaryColor
              : undefined;
          // Team-coloured day dots (kept, not neutralised); upcoming = solid, past = dimmed.
          const dots = hasUpcoming ? dayGames! : hasPast ? dayPast! : [];

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
              className={'sh-cal-cell' + (isToday ? ' is-today' : '')}
              style={{
                cursor: hasActivity ? 'pointer' : 'default',
                transition: 'transform .15s, box-shadow .15s, background .15s, color .15s',
                ...(isHovered && hasActivity ? { transform: 'scale(1.1)' } : {}),
                ...(isHovered && glowColor ? { boxShadow: `0 0 14px ${glowColor}55`, background: `${glowColor}18` } : {}),
                ...(!hasActivity && !isToday ? { color: 'var(--text-3)', opacity: 0.55 } : {}),
              }}
              aria-label={
                hasUpcoming
                  ? `${day} ${MONTH_NAMES[viewMonth]}, ${dayGames!.length} fixture${dayGames!.length > 1 ? 's' : ''}`
                  : hasPast
                    ? `${day} ${MONTH_NAMES[viewMonth]}, ${dayPast!.length} result${dayPast!.length > 1 ? 's' : ''}`
                    : undefined
              }
            >
              {day}
              {dots.length > 0 && (
                <span style={{ position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '2px' }}>
                  {dots.slice(0, 3).map((g, gi) => (
                    <span
                      key={gi}
                      style={{
                        width: '4px', height: '4px', borderRadius: '50%',
                        backgroundColor: g.team.primaryColor,
                        opacity: hasUpcoming ? 1 : 0.5,
                        // hairline so team dots stay visible on the accent-filled today cell
                        ...(isToday ? { boxShadow: '0 0 0 1px rgba(255,255,255,0.7)' } : {}),
                      }}
                    />
                  ))}
                </span>
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
