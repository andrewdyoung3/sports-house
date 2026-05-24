'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Trophy, Plus, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { getFollowedTeams } from '@/lib/user-prefs';
// mock-data intentionally NOT imported — results page only shows real API data.
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { contrastColor, datekeyInZone, smoothScrollTo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TeamBadge } from '@/components/ui/team-badge';
import { ResultExpandPanel } from '@/components/results/result-expand-panel';
import type { Team, GameResult, SportKey } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultEntry = GameResult & { team: Team; id: string };

const REAL_DATA_LEAGUES = new Set<string>(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'f1', 'bbl', 'cricket_int']);
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ─── ID synthesis ─────────────────────────────────────────────────────────────

function makeResultId(teamId: string, result: GameResult): string {
  const dateStr = result.date.slice(0, 10);
  const oppSlug = result.opponent.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  return `${teamId}-${dateStr}-vs-${oppSlug}`;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadResults(team: Team): Promise<ResultEntry[]> {
  if (!REAL_DATA_LEAGUES.has(team.league)) return [];
  try {
    const res  = await fetch(`/api/results?league=${team.league}&teamId=${team.id}`);
    const data = res.ok ? await res.json() : [];
    if (Array.isArray(data) && data.length > 0) {
      return data.map((r: GameResult) => ({ ...r, team, id: makeResultId(team.id, r) }));
    }
  } catch { /* network error — return empty */ }
  return [];
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

interface ResultBadgeMeta {
  bg: string;
  color: string;
  label: string;
  /** URL for the watermark logo shown in the result row background. */
  logoUrl?: string;
  /** Opacity for the watermark (default 0.18). */
  logoOpacity?: number;
  /** CSS mix-blend-mode for the watermark — 'screen' dissolves dark backgrounds. */
  logoBlend?: string;
  /** CSS filter applied to the watermark logo. */
  logoFilter?: string;
  /** Override the default h-[140%] height for this logo's watermark. */
  logoHeight?: string;
}

const COMPETITION_BADGE: Record<string, ResultBadgeMeta> = {
  'Champions League': { bg: '#071432', color: '#dce8ff', label: 'UCL',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png', logoOpacity: 0.68, logoBlend: 'screen' },
  'Europa League':    { bg: '#200e00', color: '#f57320', label: 'UEL',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png', logoOpacity: 0.56, logoBlend: 'screen' },
  'Conference League': { bg: '#001a10', color: '#00c87a', label: 'UECL',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png', logoOpacity: 0.56, logoBlend: 'screen' },
  'FA Cup':           { bg: '#1a0005', color: '#ff2244', label: 'FA Cup',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png', logoOpacity: 0.47, logoBlend: 'screen' },
  'EFL Cup':          { bg: '#0d1f00', color: '#78be20', label: 'EFL Cup',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png', logoOpacity: 0.43, logoBlend: 'screen' },
};

const LEAGUE_BADGE: Record<string, ResultBadgeMeta> = {
  afl:         { bg: '#001d3d', color: '#f4ac20',  label: 'AFL',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png', logoOpacity: 0.10 },
  nrl:         { bg: '#002955', color: '#ffffff',  label: 'NRL',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png', logoOpacity: 0.27, logoHeight: '98%' },
  epl:         { bg: '#38003c', color: '#ffffff',  label: 'PL',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', logoOpacity: 0.11, logoFilter: 'brightness(0) invert(1)' },
  super_rugby: { bg: '#0b2a6b', color: '#7eb8ff',  label: 'SR',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', logoOpacity: 0.18, logoHeight: '110%' },
  rugby_int:   { bg: '#0f1a2e', color: '#a0b4cc',  label: 'Test' },
  f1:          { bg: '#1a0000', color: '#E8002D',  label: 'F1',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png', logoOpacity: 0.15 },
  bbl:         { bg: '#001428', color: '#d917a5',  label: 'BBL' },
  cricket_int: { bg: '#0a1a00', color: '#78be20',  label: 'INT' },
};

function ResultBadge({ league, competition }: { league: string; competition?: string }) {
  const meta = competition ? (COMPETITION_BADGE[competition] ?? null) : (LEAGUE_BADGE[league] ?? null);
  const label  = meta?.label ?? (competition ?? league.toUpperCase());
  const bg     = meta?.bg    ?? 'rgba(255,255,255,0.06)';
  const color  = meta?.color ?? 'rgba(255,255,255,0.40)';
  return (
    <span
      className="inline-flex items-center text-[10px] font-black uppercase tracking-wide rounded border px-[5px] py-[3px] shrink-0 leading-none"
      style={{ background: bg, color, borderColor: `${color}44` }}
    >
      {label}
    </span>
  );
}

// ─── Outcome badge ────────────────────────────────────────────────────────────

function f1PositionColor(pos: string): string {
  if (pos === 'P1') return '#FFD700'; // gold
  if (pos === 'P2') return '#C0C0C0'; // silver
  if (pos === 'P3') return '#CD7F32'; // bronze
  const n = parseInt(pos.replace('P', ''), 10);
  if (!isNaN(n) && n <= 10) return '#34d399'; // points
  if (!isNaN(n)) return '#9ca3af'; // outside points
  return '#f87171'; // DNF / DNS / DSQ etc.
}

function cricketFormatLabel(fmt?: string): string {
  if (fmt === 'test') return 'Test';
  if (fmt === 'odi')  return 'ODI';
  if (fmt === 't20')  return 'T20';
  return '';
}

function OutcomeBadge({ result }: { result: ResultEntry }) {
  if (result.f1Position) {
    const color = f1PositionColor(result.f1Position);
    const isPos = /^P\d+$/.test(result.f1Position);
    return (
      <span
        className="inline-flex items-center justify-center rounded-md px-1.5 h-5 text-[10px] font-black border shrink-0 leading-none tabular-nums"
        style={{ color, borderColor: `${color}55`, background: `${color}18` }}
      >
        {result.f1Position}
      </span>
    );
  }
  // Cricket: show result text or W/D/L
  if (result.cricketFormat) {
    const isDraw = result.isDraw === true;
    const label  = isDraw ? 'D' : result.isWin ? 'W' : 'L';
    const cls    = isDraw
      ? 'bg-amber-400/20 text-amber-300 border-amber-600/30'
      : result.isWin
        ? 'bg-emerald-400/20 text-emerald-400 border-emerald-600/30'
        : 'bg-red-400/20 text-red-400 border-red-700/30';
    const fmtLabel = cricketFormatLabel(result.cricketFormat);
    return (
      <div className="flex items-center gap-1">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${cls} shrink-0`}>
          {label}
        </span>
        {fmtLabel && (
          <span className="text-[9px] font-bold text-white/30 uppercase tracking-wider">{fmtLabel}</span>
        )}
      </div>
    );
  }
  // Existing W/D/L badge
  const isDraw = result.isDraw === true;
  const label  = isDraw ? 'D' : result.isWin ? 'W' : 'L';
  const cls    = isDraw
    ? 'bg-amber-400/20 text-amber-300 border-amber-600/30'
    : result.isWin
      ? 'bg-emerald-400/20 text-emerald-400 border-emerald-600/30'
      : 'bg-red-400/20 text-red-400 border-red-700/30';
  return (
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${cls} shrink-0`}>
      {label}
    </span>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

interface ResultRowProps {
  result: ResultEntry;
  userTz: string;
  dateKey: string;
  isHighlighted: boolean;
  isExpanded: boolean;
  onHover: (dateKey: string | null) => void;
  onToggle: () => void;
}

function ResultRow({
  result, userTz, dateKey, isHighlighted, isExpanded, onHover, onToggle,
}: ResultRowProps) {
  const { team } = result;
  const teamLogoUrl    = TEAM_LOGOS[team.id];
  const teamLogoFilter = TEAM_LOGO_FILTERS[team.id];

  const isDraw = result.isDraw === true;
  const scoreColor = isDraw ? '#f59e0b' : result.isWin ? '#34d399' : '#f87171';

  const dateStr = new Date(result.date).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short',
    timeZone: userTz,
  });

  // League / competition watermark metadata
  const leagueMeta      = (result.competition ? COMPETITION_BADGE[result.competition] : undefined)
    ?? LEAGUE_BADGE[team.league];
  const leagueLogoUrl     = leagueMeta?.logoUrl;
  const leagueLogoOpacity = leagueMeta?.logoOpacity ?? 0.18;
  const leagueLogoBlend   = leagueMeta?.logoBlend;
  const leagueLogoFilter  = leagueMeta?.logoFilter;
  const leagueLogoHeight  = leagueMeta?.logoHeight;
  // Auto-compute right from height to align logo midpoints at ~49px from the right edge.
  // Formula: right = 49 - (heightPercent × 0.42) px
  const leagueLogoRight = (() => {
    const h = leagueMeta?.logoHeight ?? '140%';
    if (h.endsWith('%')) return `${49 - parseFloat(h) * 0.42}px`;
    return '-10px';
  })();

  return (
    <div
      className={[
        'relative overflow-hidden flex items-center gap-4 glass px-4 py-4 cursor-pointer min-h-[84px]',
        'transition-all duration-300 ease-out select-none',
        isExpanded ? 'rounded-t-2xl' : 'rounded-2xl',
      ].join(' ')}
      style={{
        borderLeftColor: `${team.primaryColor}cc`,
        borderLeftWidth: '3px',
        boxShadow: isHighlighted && !isExpanded
          ? `inset 0 0 0 1px ${team.primaryColor}28, 0 0 40px ${team.primaryColor}22`
          : undefined,
      }}
      onClick={onToggle}
      onMouseEnter={() => onHover(dateKey)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      {/* Team-colour ambient tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(105deg, ${team.primaryColor}10 0%, transparent 40%)` }}
      />

      {/* ── Background watermarks ── */}
      {teamLogoUrl && (
        <img
          src={teamLogoUrl}
          alt=""
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 h-[150%] w-auto object-contain pointer-events-none select-none"
          style={{ right: '88px', opacity: 0.10 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {leagueLogoUrl && (
        <img
          src={leagueLogoUrl}
          alt=""
          aria-hidden="true"
          className={[
            'absolute top-1/2 -translate-y-1/2 w-auto object-contain pointer-events-none select-none origin-center',
            team.league !== 'f1' ? 'max-lg:scale-[0.7] lg:scale-[1.3]' : '',
          ].join(' ')}
          style={{
            right: leagueLogoRight,
            height: leagueLogoHeight ?? '140%',
            opacity: leagueLogoOpacity,
            ...(leagueLogoBlend  ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}),
            ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}),
          }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Team badge */}
      <div className="relative shrink-0 z-10 self-center" style={{ filter: `drop-shadow(0 0 16px ${team.primaryColor}66)` }}>
        <TeamBadge
          logoUrl={teamLogoUrl}
          abbreviation={team.abbreviation}
          primaryColor={team.primaryColor}
          size={52}
          logoFilter={teamLogoFilter}
        />
      </div>

      {/* Matchup */}
      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[17px] font-semibold text-white/70 leading-none">
            {team.shortName}
          </span>
          <span className="text-[14px] font-medium text-white/30">
            {result.isHome ? 'vs' : '@'}
          </span>
          <TeamBadge
            logoUrl={result.opponentLogoUrl}
            abbreviation={result.opponentAbbr}
            primaryColor="#6B7280"
            size={30}
            className="rounded-md"
            logoFilter={TEAM_LOGO_FILTERS[result.opponentId ?? '']}
          />
          <span className="text-[17px] font-semibold text-white/70 leading-none">
            {result.opponent}
          </span>
          <ResultBadge league={team.league} competition={result.competition} />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <OutcomeBadge result={result} />
          <span className="text-[11px] text-white/30">{dateStr}</span>
          {result.isHome
            ? <span className="text-[10px] text-white/20">Home</span>
            : <span className="text-[10px] text-white/20">Away</span>
          }
          {result.cricketResult && (
            <span className="text-[10px] text-white/30 truncate max-w-[140px]" title={result.cricketResult}>
              {result.cricketResult}
            </span>
          )}
        </div>
      </div>

      {/* Score / F1 position + chevron */}
      <div className="text-right shrink-0 flex items-center gap-2 relative z-10">
        <div>
          {result.f1Position ? (
            <p className="text-[19px] font-black leading-none tabular-nums" style={{ color: f1PositionColor(result.f1Position) }}>
              {result.f1Position}
            </p>
          ) : result.cricketScore ? (
            <div className="text-right">
              <p className="text-[13px] font-black leading-none tabular-nums" style={{ color: scoreColor }}>
                {result.cricketScore}
              </p>
              {result.cricketOppScore && (
                <p className="text-[11px] font-semibold leading-none text-white/40 mt-0.5">
                  {result.cricketOppScore}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[19px] font-black leading-none tabular-nums" style={{ color: scoreColor }}>
              {result.teamScore}–{result.opponentScore}
            </p>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/20 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>
    </div>
  );
}

// ─── Results calendar ─────────────────────────────────────────────────────────

interface ResultsCalendarProps {
  results: ResultEntry[];
  userTz: string;
  hoveredDateKey: string | null;
  onHover: (dateKey: string | null) => void;
  onDayClick: (dateKey: string) => void;
}

function ResultsCalendar({ results, userTz, hoveredDateKey, onHover, onDayClick }: ResultsCalendarProps) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const todayKey = useMemo(() => datekeyInZone(now.toISOString(), userTz), [userTz]);

  const resultsByDate = useMemo(() => {
    const map = new Map<string, ResultEntry[]>();
    for (const r of results) {
      const dk = datekeyInZone(r.date, userTz);
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(r);
    }
    return map;
  }, [results, userTz]);

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

  const viewHasResults = calendarDays.some(day => day !== null && resultsByDate.has(dateKeyForDay(day)));
  const previewResults = hoveredDateKey ? (resultsByDate.get(hoveredDateKey) ?? []) : [];

  return (
    <div className="glass rounded-2xl p-4 select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={goPrev} className="p-1.5 rounded-lg text-white/35 hover:text-white hover:bg-white/8 transition-colors" aria-label="Previous month">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-bold text-white">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button onClick={goNext} className="p-1.5 rounded-lg text-white/35 hover:text-white hover:bg-white/8 transition-colors" aria-label="Next month">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-[9px] font-semibold text-white/25 text-center py-0.5">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {calendarDays.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;

          const dk        = dateKeyForDay(day);
          const dayResults = resultsByDate.get(dk);
          const isToday   = dk === todayKey;
          const isHovered = dk === hoveredDateKey;
          const hasResults = !!dayResults?.length;
          const dotColor  = dayResults?.[0]?.team.primaryColor;

          return (
            <button
              key={dk}
              onClick={() => hasResults && onDayClick(dk)}
              onMouseEnter={() => hasResults && onHover(dk)}
              onMouseLeave={() => onHover(null)}
              disabled={!hasResults}
              className={[
                'relative flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg',
                'text-[11px] font-medium transition-all duration-150',
                hasResults ? 'cursor-pointer' : 'cursor-default',
                isToday
                  ? 'ring-1 ring-white/35 bg-white/10 text-white font-bold'
                  : hasResults
                    ? 'text-white/65 hover:text-white'
                    : 'text-white/20',
                isHovered && hasResults ? 'scale-110' : '',
              ].join(' ')}
              style={isHovered && dotColor
                ? { boxShadow: `0 0 14px ${dotColor}55`, background: `${dotColor}18` }
                : undefined}
            >
              <span>{day}</span>
              {hasResults && (
                <div className="flex gap-0.5 justify-center">
                  {dayResults!.slice(0, 3).map((r, ri) => {
                    const c = r.f1Position
                      ? f1PositionColor(r.f1Position)
                      : r.isDraw === true ? '#f59e0b' : r.isWin ? '#34d399' : '#f87171';
                    return <span key={ri} className="w-1 h-1 rounded-full" style={{ backgroundColor: c }} />;
                  })}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Hover preview */}
      <div className="mt-3 pt-3 border-t border-white/10 overflow-hidden transition-all duration-200" style={{ minHeight: '2.5rem' }}>
        {previewResults.length > 0 ? (
          <div style={{ animation: 'slideDown 0.18s ease-out' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-2">
              {new Date(previewResults[0].date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
            <div className="space-y-2">
              {previewResults.map(r => {
                const isDraw = r.isDraw === true;
                const scoreColor = r.f1Position
                  ? f1PositionColor(r.f1Position)
                  : isDraw ? '#f59e0b' : r.isWin ? '#34d399' : '#f87171';
                return (
                  <div key={r.id} className="flex items-center gap-1.5" style={{ borderLeft: `2px solid ${r.team.primaryColor}60`, paddingLeft: '6px' }}>
                    <TeamBadge logoUrl={TEAM_LOGOS[r.team.id]} logoFilter={TEAM_LOGO_FILTERS[r.team.id]} abbreviation={r.team.abbreviation} primaryColor={r.team.primaryColor} size={20} className="rounded-md shrink-0" />
                    <span className="text-[11px] font-bold text-white leading-none">{r.team.shortName}</span>
                    <span className="text-[10px] text-white/35">{r.isHome ? 'vs' : 'at'}</span>
                    <span className="text-[11px] text-white/70 flex-1 min-w-0 truncate">{r.opponent}</span>
                    <span className="text-[11px] font-black shrink-0" style={{ color: scoreColor }}>
                      {r.f1Position ?? `${r.teamScore}–${r.opponentScore}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[9px] text-white/18 text-center leading-tight">
            {viewHasResults ? 'Hover a date · click to jump' : 'No results this month'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function TeamFilterPill({
  label, logoUrl, logoFilter, primaryColor, active, onClick,
}: {
  label: string; logoUrl?: string; logoFilter?: string; primaryColor?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0"
      style={active && primaryColor ? {
        background: `${primaryColor}22`, color: primaryColor,
        border: `1px solid ${primaryColor}55`, boxShadow: `0 0 12px ${primaryColor}30`,
      } : active ? {
        background: 'rgba(99,102,241,0.25)', color: 'white', border: '1px solid rgba(99,102,241,0.5)',
      } : {
        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', border: '1px solid transparent',
      }}
    >
      {logoUrl && (
        <img src={logoUrl} alt="" className="w-4 h-4 object-contain shrink-0"
          style={logoFilter ? { filter: logoFilter } : undefined}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      {label}
    </button>
  );
}

// ─── Followed teams widget ────────────────────────────────────────────────────

function FollowedTeamsWidget({ teams }: { teams: Team[] }) {
  if (teams.length === 0) return null;
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">Following</p>
      <div className="flex flex-wrap gap-2">
        {teams.map(team => (
          <div key={team.id} className="relative group">
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              logoFilter={TEAM_LOGO_FILTERS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={44}
              className="rounded-xl"
            />
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-20"
              style={{ background: `${team.primaryColor}dd`, color: contrastColor(team.primaryColor) }}
            >
              {team.shortName}
            </div>
          </div>
        ))}
      </div>
      <Link href="/onboarding" className="block mt-3">
        <button className="text-[10px] font-semibold text-white/25 hover:text-white/60 transition-colors flex items-center gap-1">
          <Plus className="h-3 w-3" />
          Add teams
        </button>
      </Link>
    </div>
  );
}

// ─── Date heading ─────────────────────────────────────────────────────────────

function formatDateHeading(date: Date, userTz: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(date);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map(i => (
        <div key={i}>
          <div className="h-4 w-52 bg-white/8 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {[0, 1].map(j => (
              <div key={j} className="h-[72px] bg-white/5 border border-white/8 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="max-w-lg mx-auto px-4 py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-700/30 flex items-center justify-center mx-auto mb-6">
        <Trophy className="h-8 w-8 text-indigo-400" />
      </div>
      <h1 className="text-2xl font-black text-white mb-3">No results yet</h1>
      <p className="text-white/55 mb-8 leading-relaxed">
        Select teams to follow and your recent results will appear here.
      </p>
      <Link href="/onboarding">
        <Button size="lg" className="gap-2">
          <Plus className="h-4 w-4" />
          Choose Your Teams
        </Button>
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [allResults, setAllResults] = useState<ResultEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [userTz,     setUserTz]     = useState('Australia/Brisbane');

  const [activeTeamId,   setActiveTeamId]   = useState<string>('all');
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [everExpandedIds, setEverExpandedIds] = useState<Set<string>>(new Set());

  // Mobile calendar bottom sheet — opened by the navbar Calendar button via custom event
  const [calendarOpen,   setCalendarOpen]   = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  const openCalendar = useCallback(() => {
    setCalendarOpen(true);
    // Wait for the DOM node to mount, then trigger the slide-up transition
    requestAnimationFrame(() => requestAnimationFrame(() => setCalendarVisible(true)));
  }, []);

  const closeCalendar = useCallback((afterClose?: () => void) => {
    setCalendarVisible(false);
    // Fire the scroll/action callback slightly before the slide finishes so
    // the scroll start and the sheet disappearance feel simultaneous.
    if (afterClose) setTimeout(afterClose, 350);
    // Unmount after the CSS transition fully completes.
    setTimeout(() => setCalendarOpen(false), 420);
  }, []);

  useEffect(() => {
    const handler = () => openCalendar();
    window.addEventListener('sporthouse:open-calendar', handler);
    return () => window.removeEventListener('sporthouse:open-calendar', handler);
  }, [openCalendar]);

  const [clickedDateKey, setClickedDateKey] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch {}
  }, []);

  useEffect(() => {
    const followed = getFollowedTeams();
    setTeams(followed);

    if (followed.length === 0) { setLoading(false); return; }

    let active = true;
    let remaining = followed.length;
    followed.forEach(async (team) => {
      try {
        const entries = await loadResults(team);
        if (active) {
          setAllResults(prev => {
            const seen = new Set(prev.map(r => r.id));
            const merged = [...prev, ...entries.filter(r => !seen.has(r.id))];
            return merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          });
        }
      } finally {
        remaining -= 1;
        if (remaining === 0) setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const filteredResults = useMemo<ResultEntry[]>(() => {
    if (activeTeamId === 'all') return allResults;
    return allResults.filter(r => r.team.id === activeTeamId);
  }, [allResults, activeTeamId]);

  // Group by date in user timezone (reverse-chronological)
  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; representativeDate: Date; results: ResultEntry[] }[] = [];
    for (const result of filteredResults) {
      const dateKey = datekeyInZone(result.date, userTz);
      const last = groups[groups.length - 1];
      if (last?.dateKey === dateKey) {
        last.results.push(result);
      } else {
        groups.push({ dateKey, representativeDate: new Date(result.date), results: [result] });
      }
    }
    return groups;
  }, [filteredResults, userTz]);

  const handleCalendarHover = useCallback((dk: string | null) => setHoveredDateKey(dk), []);

  const handleDayClick = useCallback((dk: string) => {
    const el = document.getElementById(`result-date-${dk}`);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    setClickedDateKey(dk);
    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    setEverExpandedIds(prev => { const next = new Set(prev); next.add(id); return next; });
  }, []);

  if (!loading && teams.length === 0) return <EmptyState />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white/90 flex items-center gap-2 mb-1">
          <Trophy className="h-6 w-6 text-indigo-400" />
          Your Results
        </h1>
        {loading && <p className="text-white/40 text-sm">Loading results…</p>}
      </div>

      {/* Two-column layout */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* Left: filters + results list */}
        <div>
          {/* Team filter pills */}
          {!loading && teams.length > 1 && (
            <div className="mb-6">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-1.5">My Teams</p>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TeamFilterPill
                  label="All"
                  active={activeTeamId === 'all'}
                  onClick={() => setActiveTeamId('all')}
                />
                {teams.map(team => (
                  <TeamFilterPill
                    key={team.id}
                    label={team.abbreviation}
                    logoUrl={TEAM_LOGOS[team.id]}
                    logoFilter={TEAM_LOGO_FILTERS[team.id]}
                    primaryColor={team.primaryColor}
                    active={activeTeamId === team.id}
                    onClick={() => setActiveTeamId(team.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Results content */}
          {loading ? (
            <ResultsSkeleton />
          ) : filteredResults.length === 0 ? (
            <div className="text-center py-20 text-white/40">
              <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No results yet for this team.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ dateKey, representativeDate, results: dayResults }) => (
                <section key={dateKey} id={`result-date-${dateKey}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white/50 shrink-0">
                      {formatDateHeading(representativeDate, userTz)}
                    </p>
                    <div className="flex-1 h-px bg-white/8" />
                    <span className="text-[10px] font-semibold text-white/25 shrink-0 uppercase tracking-wide">
                      {dayResults.length} {dayResults.length !== 1 ? 'results' : 'result'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {dayResults.map(result => {
                      const isHighlighted = hoveredDateKey === dateKey;
                      const isExpanded    = expandedId === result.id;

                      return (
                        <div
                          key={result.id}
                          className="rounded-2xl"
                          style={{
                            transition: 'box-shadow 0.4s ease-out',
                            boxShadow: clickedDateKey === dateKey
                              ? `0 0 48px ${result.team.primaryColor}70, 0 0 0 1px ${result.team.primaryColor}50`
                              : isHighlighted
                                ? `0 0 28px ${result.team.primaryColor}30`
                                : undefined,
                          }}
                        >
                          <ResultRow
                            result={result}
                            userTz={userTz}
                            dateKey={dateKey}
                            isHighlighted={isHighlighted}
                            isExpanded={isExpanded}
                            onHover={handleCalendarHover}
                            onToggle={() => toggleExpand(result.id)}
                          />
                          {everExpandedIds.has(result.id) && (
                            <div style={{ display: isExpanded ? 'block' : 'none' }}>
                              <ResultExpandPanel result={result} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <aside className="hidden lg:block sticky top-20 space-y-4 mt-0">
          {!loading && (
            <ResultsCalendar
              results={filteredResults}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={handleDayClick}
            />
          )}
          <FollowedTeamsWidget teams={teams} />
        </aside>
      </div>

      {/* ── Mobile calendar bottom sheet ── */}
      {calendarOpen && (
        <>
          {/* Backdrop — fades in/out with the sheet */}
          <div
            className={[
              'fixed inset-0 z-50 lg:hidden bg-black/60 backdrop-blur-sm',
              'transition-opacity duration-[420ms] ease-out',
              calendarVisible ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            onClick={() => closeCalendar()}
          />
          {/* Sheet — slides up on open, down on close */}
          <div
            className={[
              'fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl border-t border-white/10 bg-[#0e0e18] px-4 pt-4 pb-8 max-h-[85vh] overflow-y-auto',
              'transition-transform duration-[420ms] ease-out',
              calendarVisible ? 'translate-y-0' : 'translate-y-full',
            ].join(' ')}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white/80">Calendar</p>
              <button
                onClick={() => closeCalendar()}
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!loading && (
              <ResultsCalendar
                results={filteredResults}
                userTz={userTz}
                hoveredDateKey={hoveredDateKey}
                onHover={handleCalendarHover}
                onDayClick={(dk) => {
                  closeCalendar(() => {
                    const el = document.getElementById(`result-date-${dk}`);
                    if (el) {
                      const y = el.getBoundingClientRect().top + window.scrollY - 88;
                      smoothScrollTo(Math.max(0, y), 750);
                    }
                    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                    setClickedDateKey(dk);
                    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
                  });
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
