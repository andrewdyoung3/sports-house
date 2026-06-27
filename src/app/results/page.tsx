'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Trophy, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { getFollowedTeams, usePrefsVersion } from '@/lib/user-prefs';
// mock-data intentionally NOT imported — results page only shows real API data.
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { TEAMS, REAL_DATA_LEAGUES } from '@/lib/teams';
import { contrastColor, datekeyInZone, smoothScrollTo } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamBadge } from '@/components/ui/team-badge';
import { ResultExpandPanel } from '@/components/results/result-expand-panel';
import type { Team, GameResult, SportKey } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultEntry = GameResult & { team: Team; id: string };

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
  'State of Origin':  { bg: '#1a0000', color: '#F5A623', label: 'SOO',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png', logoOpacity: 0.18, logoHeight: '98%' },
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

// Step 8 — emits .sh-comptag, matching the schedule's FixtureBadge vocabulary.
function ResultBadge({ league, competition }: { league: string; competition?: string }) {
  const baseComp = competition?.startsWith('State of Origin') ? 'State of Origin' : competition;
  const meta  = baseComp ? (COMPETITION_BADGE[baseComp] ?? null) : (LEAGUE_BADGE[league] ?? null);
  const label = meta?.label ?? (competition ?? league.toUpperCase());
  const color = meta?.color ?? 'rgba(255,255,255,0.40)';
  return (
    <span className="sh-comptag" style={{ '--c': color } as React.CSSProperties}>{label}</span>
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

  const isDraw     = result.isDraw === true;
  const scoreColor = isDraw ? '#f59e0b' : result.isWin ? '#34d399' : '#f87171';

  const dateStr = new Date(result.date).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', timeZone: userTz,
  });

  // League / competition watermark metadata (kept for visual layering inside .sh-fix)
  const baseComp = result.competition?.startsWith('State of Origin') ? 'State of Origin' : result.competition;
  const leagueMeta        = (baseComp ? COMPETITION_BADGE[baseComp] : undefined) ?? LEAGUE_BADGE[team.league];
  const leagueLogoUrl     = leagueMeta?.logoUrl;
  const leagueLogoOpacity = leagueMeta?.logoOpacity ?? 0.18;
  const leagueLogoBlend   = leagueMeta?.logoBlend;
  const leagueLogoFilter  = leagueMeta?.logoFilter;
  const leagueLogoHeight  = leagueMeta?.logoHeight;
  // Logo center: translateX(50%) makes `right: 49px` the CENTER anchor for any aspect ratio.
  const LOGO_CENTER_RIGHT = '49px';

  // ── Step 8 — F1 gate: keep the original render for F1 results ─────────────────
  // The two-team .sh-fix path below handles all other leagues (AFL, NRL, EPL, cricket…).
  if (team.league === 'f1') {
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
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(105deg, ${team.primaryColor}10 0%, transparent 40%)` }} />
        {teamLogoUrl && (
          <img src={teamLogoUrl} alt="" aria-hidden="true" width={100} height={100}
            className="absolute top-1/2 -translate-y-1/2 h-[150%] w-auto object-contain pointer-events-none select-none"
            style={{ right: '88px', opacity: 0.10 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        {leagueLogoUrl && (
          <img src={leagueLogoUrl} alt="" aria-hidden="true" width={100} height={100}
            className="absolute top-1/2 -translate-y-1/2 translate-x-1/2 w-auto object-contain pointer-events-none select-none origin-center"
            style={{
              right: LOGO_CENTER_RIGHT, height: leagueLogoHeight ?? '140%', opacity: leagueLogoOpacity,
              ...(leagueLogoBlend  ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}),
              ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}),
            }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        <div className="relative shrink-0 z-10 self-center" style={{ filter: `drop-shadow(0 0 16px ${team.primaryColor}66)` }}>
          <TeamBadge logoUrl={teamLogoUrl} abbreviation={team.abbreviation} primaryColor={team.primaryColor} size={52} logoFilter={teamLogoFilter} />
        </div>
        <div className="flex-1 min-w-0 relative z-10">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[17px] font-semibold text-white/70 leading-none">{team.shortName}</span>
            <span className="text-[14px] font-medium text-white/30">{result.isHome ? 'vs' : '@'}</span>
            <TeamBadge logoUrl={result.opponentLogoUrl} abbreviation={result.opponentAbbr} primaryColor="#6B7280" size={30} className="rounded-md" logoFilter={TEAM_LOGO_FILTERS[result.opponentId ?? '']} />
            <span className="text-[17px] font-semibold text-white/70 leading-none">{result.opponent}</span>
            <ResultBadge league={team.league} competition={result.competition} />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <OutcomeBadge result={result} />
            <span className="text-[11px] text-white/30">{dateStr}</span>
            {result.isHome ? <span className="text-[10px] text-white/20">Home</span> : <span className="text-[10px] text-white/20">Away</span>}
          </div>
        </div>
        <div className="text-right shrink-0 flex items-center gap-2 relative z-10">
          <p className="text-[19px] font-black leading-none tabular-nums" style={{ color: result.f1Position ? f1PositionColor(result.f1Position) : scoreColor }}>
            {result.f1Position ?? `${result.teamScore}–${result.opponentScore}`}
          </p>
          <ChevronDown className={`h-4 w-4 text-white/20 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>
    );
  }

  // ── Step 8 — two-team path: .sh-fix card (mirrors the schedule's ScheduleRow) ─
  const hasCricketScore = !!result.cricketScore;

  // W/L/D outcome chip
  const outcomeChipClass = 'sh-result-outcome' + (isDraw ? '' : result.isWin ? ' is-win' : ' is-loss');
  const outcomeLabel     = isDraw ? 'D' : result.isWin ? 'W' : 'L';
  // Draw uses inline amber (no .is-draw CSS class exists in the design)
  const drawChipStyle = isDraw
    ? { color: '#f59e0b', background: 'rgba(245,158,11,0.18)', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.4)' }
    : undefined;

  // Score class: feature team's score gets win color, opponent gets muted
  const teamScoreClass = isDraw ? undefined : (result.isWin ? 'is-win-score' : 'is-loss-score');
  const oppScoreClass  = isDraw ? undefined : (result.isWin ? 'is-loss-score' : 'is-win-score');
  const drawScoreStyle = isDraw ? { color: '#f59e0b' } : undefined;

  // Three-tier opponent name: same logic as ScheduleRow (shortName substitution first,
  // compact font only as last resort when display name is still long after substitution).
  const SHORTNAME_THRESHOLD = 14;
  const oppTeam = result.opponentId ? TEAMS.find(t => t.id === result.opponentId) : undefined;
  const oppDisplayName = result.opponent.length > SHORTNAME_THRESHOLD && oppTeam
    ? (oppTeam.name.length < result.opponent.length ? oppTeam.name : oppTeam.shortName)
    : result.opponent;
  const longerDisplayLen = Math.max(team.shortName?.length ?? 0, oppDisplayName.length);
  const nameSize         = longerDisplayLen > 11 ? { fontSize: '14px' } : undefined;

  return (
    <article
      className={'sh-fix' + (isExpanded ? ' is-open' : '')}
      style={{ '--accent': team.primaryColor } as React.CSSProperties}
      onClick={onToggle}
      onMouseEnter={() => onHover(dateKey)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      {/* Team watermark — logo inside wrapper when available, text fallback otherwise */}
      <div className="sh-fix-wm" aria-hidden="true">
        {teamLogoUrl
          ? <img src={teamLogoUrl} alt="" aria-hidden="true" draggable={false} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : team.shortName.toUpperCase()
        }
      </div>

      {/* League/competition logo watermark — absolute, unaffected by the flex layout */}
      {leagueLogoUrl && (
        <img
          src={leagueLogoUrl} alt="" aria-hidden="true" width={100} height={100}
          className="absolute top-1/2 -translate-y-1/2 translate-x-1/2 w-auto object-contain pointer-events-none select-none origin-center max-lg:scale-[0.7] lg:scale-[1.3]"
          style={{
            right: LOGO_CENTER_RIGHT, height: leagueLogoHeight ?? '140%', opacity: leagueLogoOpacity,
            ...(leagueLogoBlend  ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}),
            ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}),
          }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Feature badge: left column (direct flex item on the article) */}
      <span className="sh-fix-badge-f">
        <TeamBadge logoUrl={teamLogoUrl} abbreviation={team.abbreviation} primaryColor={team.primaryColor} size={56} logoFilter={teamLogoFilter} />
      </span>

      {/* Text column: main row + sub row, so the sub aligns under names */}
      <div className="sh-fix-text">
        <div className="sh-fix-main">
          {/* Teams + inline score.
              Outer .sh-fix-teams wraps so only the trailing comp pill can drop to a new line;
              inner span keeps the matchup unit (both teams + score) on one nowrap unit. */}
          <div className="sh-fix-teams" style={{ flexWrap: 'wrap', rowGap: '6px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'nowrap', minWidth: 0 }}>
              <span className="sh-fix-name" style={nameSize}>{team.shortName}</span>

              {/* Standard score (two numbers, split by win/loss colour) */}
              {!hasCricketScore && (
                <span className="sh-result-score-inline">
                  <span className={teamScoreClass} style={drawScoreStyle}>{result.teamScore}</span>
                  <span className="sh-fix-sep">–</span>
                  <span className={oppScoreClass}  style={drawScoreStyle}>{result.opponentScore}</span>
                </span>
              )}

              {/* Cricket score (smaller text, dot separator; scores include overs notation) */}
              {hasCricketScore && (
                <span className="sh-result-score-inline" style={{ fontSize: '13px', letterSpacing: 0 }}>
                  <span className={teamScoreClass} style={drawScoreStyle}>{result.cricketScore}</span>
                  {result.cricketOppScore && (
                    <><span className="sh-fix-sep">·</span>
                    <span className={oppScoreClass} style={drawScoreStyle}>{result.cricketOppScore}</span></>
                  )}
                </span>
              )}

              {/* Opponent badge: 40px circle (bumped from 32 for clearer hierarchy) */}
              <TeamBadge logoUrl={result.opponentLogoUrl} abbreviation={result.opponentAbbr} primaryColor="#6B7280" size={40} logoFilter={TEAM_LOGO_FILTERS[result.opponentId ?? '']} />
              <span className="sh-fix-name" style={nameSize}>{oppDisplayName}</span>
            </span>

            {/* Competition badge */}
            <ResultBadge league={team.league} competition={result.competition} />

            {/* Cricket format label (Test / ODI / T20) — matches schedule's cricket pill */}
            {result.cricketFormat && (
              <span className="sh-comptag" style={{ '--c': result.cricketFormat === 'test' ? '#e2a84b' : result.cricketFormat === 'odi' ? '#60a5fa' : '#a78bfa' } as React.CSSProperties}>
                {result.cricketFormat === 'test' ? 'Test' : result.cricketFormat.toUpperCase()}
              </span>
            )}
          </div>

          {/* Right slot: outcome chip + home/away tag + chevron */}
          <div className="sh-fix-time">
            <span className={outcomeChipClass} style={drawChipStyle}>{outcomeLabel}</span>
            <span className={'sh-tag-venue is-' + (result.isHome ? 'home' : 'away')}>
              {result.isHome ? 'Home' : 'Away'}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              style={{ color: 'var(--text-3)' }}
            />
          </div>
        </div>

        {/* Sub-row: date + cricket result text (no venue — GameResult has no venue field) */}
        <div className="sh-fix-sub">
          <span className="sh-meta-item">{dateStr}</span>
          {result.cricketResult && (
            <span className="sh-meta-item">
              <span className="truncate" style={{ maxWidth: '200px' }} title={result.cricketResult}>{result.cricketResult}</span>
            </span>
          )}
        </div>
      </div>
    </article>
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
    // Step 8 — glass → sh-card for the token surface; internal hover/glow logic unchanged.
    <div className="sh-card select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-white/8 transition-colors" style={{ color: 'var(--text-3)' }} aria-label="Previous month">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-white/8 transition-colors" style={{ color: 'var(--text-3)' }} aria-label="Next month">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-[9px] font-semibold text-center py-0.5" style={{ color: 'var(--text-3)' }}>{d}</div>
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
      <div className="mt-3 pt-3 overflow-hidden transition-all duration-200" style={{ minHeight: '2.5rem', borderTop: '1px solid var(--border)' }}>
        {previewResults.length > 0 ? (
          <div style={{ animation: 'slideDown 0.18s ease-out' }}>
            <p className="text-[9px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
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
          <p className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-3)' }}>
            {viewHasResults ? 'Hover a date · click to jump' : 'No results this month'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

// Step 8 — reskinned to .sh-chip (mirrors the schedule's TeamFilterPill).
// Active chip self-colours by subject: --accent set inline from the team's primaryColor;
// "All" chip has no primaryColor → keeps the inherited default accent.
function TeamFilterPill({
  label, logoUrl, logoFilter, primaryColor, active, onClick,
}: {
  label: string; logoUrl?: string; logoFilter?: string; primaryColor?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={'sh-chip' + (active ? ' is-active' : '')}
      style={active && primaryColor ? ({ '--accent': primaryColor } as React.CSSProperties) : undefined}
    >
      {logoUrl && (
        <img src={logoUrl} alt="" width={15} height={15} className="w-[15px] h-[15px] object-contain shrink-0"
          style={logoFilter ? { filter: logoFilter } : undefined}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      {label}
    </button>
  );
}

// ─── Followed teams widget ────────────────────────────────────────────────────

// Step 8 — reskinned to .sh-card.sh-following (mirrors the schedule's FollowedTeamsWidget).
// The hover tooltip per badge is preserved; the "Add teams" action becomes the .sh-edit-link
// in the card head (matching the schedule's "Edit" affordance).
function FollowedTeamsWidget({ teams }: { teams: Team[] }) {
  if (teams.length === 0) return null;
  return (
    <div className="sh-card sh-following">
      <div className="sh-card-head">
        <span className="sh-card-head-label">Following</span>
        <Link href="/onboarding" className="sh-edit-link">Edit</Link>
      </div>
      <div className="sh-follow-grid">
        {teams.map(team => (
          <div key={team.id} className="sh-follow-item relative group">
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              logoFilter={TEAM_LOGO_FILTERS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={42}
              className="rounded-xl"
            />
            {/* Hover tooltip — preserved; styled with team accent for recognition */}
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-20"
              style={{ background: `${team.primaryColor}dd`, color: contrastColor(team.primaryColor) }}
            >
              {team.shortName}
            </div>
          </div>
        ))}
      </div>
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
          <div className="h-4 w-52 rounded animate-pulse mb-3" style={{ background: 'var(--border)' }} />
          <div className="space-y-2">
            {[0, 1].map(j => (
              <div key={j} className="h-[72px] rounded-xl animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [allResults, setAllResults] = useState<ResultEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [userTz,     setUserTz]     = useState('Australia/Brisbane');
  const prefsVersion = usePrefsVersion(); // bumps when followed teams change (e.g. post-sign-in merge)

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
    afterClose?.();                                    // scroll starts immediately alongside the slide
    setTimeout(() => setCalendarOpen(false), 420);    // unmount after CSS transition completes
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

  // UX-5: when navigated here with a #result-date-* hash (from the schedule calendar's
  // past-day click), scroll to that date once results have loaded — the anchor does not
  // exist until then, so native hash scrolling on load can't reach it.
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#result-date-')) return;
    const dk = hash.slice('#result-date-'.length);
    const t = setTimeout(() => {
      const el = document.getElementById(`result-date-${dk}`);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 88;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 100);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    // Reset accumulator so a followed-teams change (prefsVersion, e.g. the post-sign-in
    // anon→permanent union) refetches the EXACT new set instead of layering onto the old one.
    setAllResults([]);
    setLoading(true);

    const followed = getFollowedTeams();

    // Auto-inject QLD Maroons (State of Origin) whenever any NRL club team is followed
    const hasNRLClub  = followed.some(t => t.league === 'nrl' && t.id !== 'nrl-maroons' && t.id !== 'nrl-blues');
    const hasMaroons  = followed.some(t => t.id === 'nrl-maroons');
    const maroonsTeam = !hasMaroons && hasNRLClub
      ? TEAMS.find(t => t.id === 'nrl-maroons')
      : undefined;
    const teamsToFetch = maroonsTeam ? [...followed, maroonsTeam] : followed;

    setTeams(teamsToFetch);

    if (teamsToFetch.length === 0) { setLoading(false); return; }

    let active = true;
    let remaining = teamsToFetch.length;
    teamsToFetch.forEach(async (team) => {
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
  }, [prefsVersion]);

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

  if (!loading && teams.length === 0) return (
    <EmptyState
      icon={Trophy}
      title="No results yet"
      body="Select teams to follow and your recent results will appear here."
    />
  );

  // Step 8 — sh-theme with NO inline --accent override; default tokens govern the page
  // chrome. Per-card accent is set per .sh-fix card (each result row drives its own colour).
  return (
    <div className="sh-theme max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2 mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
          <Trophy className="h-6 w-6" style={{ color: 'var(--accent)' }} />
          Your Results
        </h1>
        {loading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading results…</p>}
      </div>

      {/* Two-column layout */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* Left: filters + results list */}
        {/* min-w-0: let the 1fr grid track shrink below its content's intrinsic width so the
            My-Teams pill row below scrolls within overflow-x-auto instead of stretching the
            whole page when many teams are followed. */}
        <div className="min-w-0">
          {/* Team filter — Step 8: reskinned to .sh-filters.sh-card / .sh-chips / .sh-chip.
              Single group (My Teams) only — results has no comp or view-toggle filters.
              Horizontal scroll preserved (overrides .sh-chips flex-wrap:wrap) so a
              large followed-teams list scrolls rather than stretching the column. */}
          {!loading && teams.length > 1 && (
            <div className="sh-filters sh-card">
              <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>My Teams</p>
              <div className="sh-chips">
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
            <div className="text-center py-20" style={{ color: 'var(--text-3)' }}>
              <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No results yet for this team.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ dateKey, representativeDate, results: dayResults }) => (
                <section key={dateKey} id={`result-date-${dateKey}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-[13px] font-black uppercase tracking-[0.12em] shrink-0" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-head)' }}>
                      {formatDateHeading(representativeDate, userTz)}
                    </p>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-[10px] font-semibold shrink-0 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
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
                          style={{
                            borderRadius: 'var(--radius)',
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
                              <ResultExpandPanel
                                result={result}
                                onCollapse={() => toggleExpand(result.id)}
                              />
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
          {/* Sheet — slides up on open, down on close. sh-theme so the inner
              ResultsCalendar's .sh-card tokens resolve outside the page wrapper. */}
          <div
            className={[
              'sh-theme fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl border-t bg-[#0e0e18] px-4 pt-4 pb-8 max-h-[85vh] overflow-y-auto',
              'transition-transform duration-[420ms] ease-out',
              calendarVisible ? 'translate-y-0' : 'translate-y-full',
            ].join(' ')}
            style={{ borderTopColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Calendar</p>
              <button
                onClick={() => closeCalendar()}
                className="transition-colors p-1 hover:text-[var(--text)]"
                style={{ color: 'var(--text-3)' }}
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
