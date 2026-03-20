'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, Tv, Plus, ChevronDown } from 'lucide-react';

import { getFollowedTeams } from '@/lib/user-prefs';
import { getUpcomingGames } from '@/lib/mock-data';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { TEAMS, LEAGUES } from '@/lib/teams';
import { contrastColor, formatTimeInZone, datekeyInZone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TeamBadge } from '@/components/ui/team-badge';
import { NextGameHero } from '@/components/schedule/next-game-hero';
import { ScheduleCalendar } from '@/components/schedule/schedule-calendar';
import { GameExpandPanel } from '@/components/schedule/game-expand-panel';
import { SportBall } from '@/components/schedule/sport-ball';
import { LeagueTable } from '@/components/schedule/league-table';
import type { StandingRow } from '@/components/schedule/league-table';
import type { Team, UpcomingGame, SportKey } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleEntry = UpcomingGame & { team: Team };

/** Leagues backed by real APIs — all others use deterministic mock data. */
const REAL_DATA_LEAGUES = new Set<string>(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int']);

/** All leagues with browse support (real or mock fixtures + standings). */
const BROWSABLE_LEAGUE_IDS = new Set<string>(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'nba', 'nhl']);

/** Ordered list for the league filter pills. */
const BROWSABLE_LEAGUES = LEAGUES.filter(l => BROWSABLE_LEAGUE_IDS.has(l.id));

/** Build a minimal Team stub for games whose teamId isn't in the TEAMS array. */
function makeFallbackTeam(game: UpcomingGame, league: string): Team {
  const suffix = game.teamId.split('-').slice(1).join(' ');
  return {
    id:             game.teamId,
    name:           suffix || game.teamId,
    shortName:      suffix || game.teamId,
    abbreviation:   (suffix || game.teamId).slice(0, 3).toUpperCase(),
    league:         league as SportKey,
    sport:          'Unknown',
    city:           '',
    country:        '',
    primaryColor:   '#4B5563',
    secondaryColor: '#6B7280',
    venue:          game.venue ?? '',
  };
}

const MOCK_GAMES_PER_TEAM = 10;

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadFixtures(team: Team): Promise<UpcomingGame[]> {
  if (REAL_DATA_LEAGUES.has(team.league)) {
    try {
      const res  = await fetch(`/api/fixtures?league=${team.league}&teamId=${team.id}`);
      const data = res.ok ? await res.json() : [];
      if (Array.isArray(data) && data.length > 0) return data;
    } catch {
      // fall through to mock
    }
  }
  return getUpcomingGames(team, MOCK_GAMES_PER_TEAM);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateHeading(representativeDate: Date, dateKey: string, userTz: string): string {
  const now         = new Date();
  const todayKey    = datekeyInZone(now.toISOString(), userTz);
  const tomorrowKey = datekeyInZone(new Date(now.getTime() + 86_400_000).toISOString(), userTz);

  const full = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz,
    weekday: 'long',
    day:     'numeric',
    month:   'long',
  }).format(representativeDate);

  if (dateKey === todayKey)    return `Today · ${full}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${full}`;
  return full;
}

// ─── Fixture / league badge ───────────────────────────────────────────────────
// Each entry uses exact brand colours and a Unicode symbol that evokes the
// official logo's iconography — no image required.
// \uFE0E (Variation Selector-15) forces text presentation so CSS color applies.

interface BadgeMeta {
  /** Unicode glyph prefix. \uFE0E appended to force text (not emoji) rendering. */
  symbol?: string;
  /** Colour override for the symbol when it differs from the label colour. */
  symbolColor?: string;
  /** Short display label. */
  label: string;
  /** Badge background — official brand colour, darkened for legibility. */
  bg: string;
  /** Label text colour. */
  color: string;
  /** Border colour. */
  border: string;
  /** Kept for the watermark <img> in ScheduleRow — not shown in the badge. */
  logoUrl?: string;
  /** Opacity for the watermark logo — defaults to 0.18 if omitted. */
  logoOpacity?: number;
}

// ── Primary-league badges ─────────────────────────────────────────────────────
const LEAGUE_BADGE: Record<string, BadgeMeta> = {
  afl: {
    // AFL: navy + gold — no symbol, "AFL" reads cleanly on its own
    label: 'AFL',
    bg: '#001d3d', color: '#f4ac20', border: 'rgba(244,172,32,0.30)',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png',
    logoOpacity: 0.25,
  },
  nrl: {
    // NRL: ◆ (diamond from the NRL shield mark) in brand red on navy
    symbol: '◆\uFE0E', symbolColor: '#e21b23',
    label: 'NRL',
    bg: '#002955', color: '#ffffff', border: 'rgba(226,27,35,0.40)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/rugby-league/500/3.png',
    logoOpacity: 0.18,
  },
  epl: {
    // Premier League: ♛ (queen chess piece = stylised lion) in PL gold on official purple
    symbol: '♛\uFE0E', symbolColor: '#e8a200',
    label: 'Premier League',
    bg: '#38003c', color: '#ffffff', border: 'rgba(255,255,255,0.18)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
    logoOpacity: 0.22,
  },
  super_rugby: {
    // Super Rugby Pacific: "SR" abbreviated, electric blue palette
    label: 'Super Rugby',
    bg: '#0b2a6b', color: '#7eb8ff', border: 'rgba(126,184,255,0.28)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/rugby/500/242041.png',
    logoOpacity: 0.18,
  },
  rugby_int: {
    // International Test rugby: ✦ (four-point star, World Rugby style) on dark slate
    symbol: '✦\uFE0E', symbolColor: '#8899bb',
    label: 'Test Rugby',
    bg: '#0f1a2e', color: '#a0b4cc', border: 'rgba(160,180,204,0.22)',
  },
  nba: {
    // NBA: dark navy + brand red, basketball emoji from league icon
    symbol: '🏀', label: 'NBA',
    bg: '#051828', color: '#c8102e', border: 'rgba(200,16,46,0.35)',
  },
  nhl: {
    // NHL: near-black + icy silver, hockey stick emoji from league icon
    symbol: '🏒', label: 'NHL',
    bg: '#0a0f1a', color: '#c0c8d4', border: 'rgba(192,200,212,0.28)',
  },
};

// ── Cup / European competition badges ─────────────────────────────────────────
const COMPETITION_BADGE: Record<string, BadgeMeta> = {
  'Champions League': {
    // UCL: ★ (the iconic starball mark) in official gold on UCL dark navy
    symbol: '★\uFE0E', symbolColor: '#ffd700',
    label: 'Champions League',
    bg: '#071432', color: '#dce8ff', border: 'rgba(255,215,0,0.30)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
    logoOpacity: 0.42,
  },
  'Europa League': {
    // UEL: ◎ (bullseye / UEL circular motif) in brand orange on dark ground
    symbol: '◎\uFE0E', symbolColor: '#f57320',
    label: 'Europa League',
    bg: '#200e00', color: '#f57320', border: 'rgba(245,115,32,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png',
    logoOpacity: 0.35,
  },
  'Conference League': {
    // UECL: ◉ (inner circle = target / conference identity) in brand teal
    symbol: '◉\uFE0E', symbolColor: '#00c87a',
    label: 'Conference League',
    bg: '#001a10', color: '#00c87a', border: 'rgba(0,200,122,0.32)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png',
    logoOpacity: 0.35,
  },
  'FA Cup': {
    // FA Cup: Three Lions abstracted as ◆ ◆ ◆ is complex — use ✦ on FA red
    symbol: '✦\uFE0E', symbolColor: '#ffffff',
    label: 'FA Cup',
    bg: '#1a0005', color: '#ff2244', border: 'rgba(255,34,68,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',
    logoOpacity: 0.30,
  },
  'EFL Cup': {
    // EFL Cup / Carabao Cup: official green palette, "EFL" abbreviation
    label: 'EFL Cup',
    bg: '#0d1f00', color: '#78be20', border: 'rgba(120,190,32,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',
    logoOpacity: 0.22,
  },
};

function FixtureBadge({ league, competition }: { league: string; competition?: string }) {
  const meta = competition
    ? (COMPETITION_BADGE[competition] ?? null)
    : (LEAGUE_BADGE[league] ?? null);

  const label    = meta?.label ?? (competition ?? league.toUpperCase());
  const bg       = meta?.bg      ?? 'rgba(255,255,255,0.06)';
  const color    = meta?.color   ?? 'rgba(255,255,255,0.40)';
  const border   = meta?.border  ?? 'rgba(255,255,255,0.12)';

  return (
    <span
      className="inline-flex items-center gap-[3px] text-[10px] font-black uppercase tracking-wide rounded border px-[5px] py-[3px] shrink-0 leading-none"
      style={{ background: bg, color, borderColor: border }}
    >
      {meta?.symbol && (
        <span aria-hidden="true" style={{ color: meta.symbolColor ?? color, fontSize: '8px' }}>
          {meta.symbol}
        </span>
      )}
      {label}
    </span>
  );
}

// ─── Schedule row ─────────────────────────────────────────────────────────────

interface ScheduleRowProps {
  game: ScheduleEntry;
  userTz: string;
  dateKey: string;
  isHighlighted: boolean;
  isExpanded: boolean;
  /** True in league-browse mode when the user follows one of the two teams. */
  isFollowed?: boolean;
  onHover: (dateKey: string | null) => void;
  onToggle: () => void;
}

function ScheduleRow({
  game,
  userTz,
  dateKey,
  isHighlighted,
  isExpanded,
  isFollowed = false,
  onHover,
  onToggle,
}: ScheduleRowProps) {
  const { team } = game;
  const displayTime = formatTimeInZone(game.date, userTz);

  const teamLogoUrl    = TEAM_LOGOS[team.id];
  const leagueMeta     = game.competition
    ? COMPETITION_BADGE[game.competition]
    : LEAGUE_BADGE[team.league];
  const leagueLogoUrl  = leagueMeta?.logoUrl;
  const leagueLogoOpacity = leagueMeta?.logoOpacity ?? 0.18;

  return (
    <div
      className={[
        'relative overflow-hidden flex items-center gap-4 glass px-4 py-4 cursor-pointer',
        'transition-all duration-300 ease-out select-none',
        isExpanded ? 'rounded-t-2xl' : 'rounded-2xl',
      ].join(' ')}
      style={{
        borderLeftColor: isFollowed ? team.primaryColor : `${team.primaryColor}cc`,
        borderLeftWidth: isFollowed ? '3px' : '3px',
        transition: 'box-shadow 0.4s ease-out',
        boxShadow: isFollowed && !isExpanded
          ? `inset 0 0 0 1px ${team.primaryColor}30, 0 0 32px ${team.primaryColor}28`
          : isHighlighted && !isExpanded
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
      {/* ── Team-colour ambient tint (sits above glass, below content) ── */}
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
          className="absolute top-1/2 -translate-y-1/2 h-[140%] w-auto object-contain pointer-events-none select-none"
          style={{ right: '-8px', opacity: leagueLogoOpacity }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* ── Team badge — oversized with neon glow ── */}
      <div
        className="relative shrink-0 z-10"
        style={{ filter: `drop-shadow(0 0 16px ${team.primaryColor}66)` }}
      >
        <TeamBadge
          logoUrl={teamLogoUrl}
          abbreviation={team.abbreviation}
          primaryColor={team.primaryColor}
          size={52}
        />
      </div>

      {/* ── Matchup + metadata ── */}
      <div className="flex-1 min-w-0 relative z-10">
        {/* Primary line: team vs opponent */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[15px] font-black tracking-tight text-white/85 leading-none">
            {team.shortName}
          </span>
          <span className="text-[11px] font-medium text-white/30">
            {game.isHome ? 'vs' : '@'}
          </span>
          <TeamBadge
            logoUrl={game.opponentLogoUrl}
            abbreviation={game.opponentAbbr}
            primaryColor={game.opponentColor}
            size={24}
            className="rounded-md"
          />
          <span className="text-[13px] font-semibold text-white/70 leading-none">
            {game.opponent}
          </span>
          <FixtureBadge league={team.league} competition={game.competition} />
          {isFollowed && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 leading-none"
              style={{
                background: `${team.primaryColor}22`,
                color:      team.primaryColor,
                border:     `1px solid ${team.primaryColor}44`,
              }}
            >
              ★ Following
            </span>
          )}
        </div>

        {/* Secondary line: venue + broadcast */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {game.venue && (
            <span className="flex items-center gap-1 text-[11px] text-white/30">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[150px]">{game.venue}</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-white/30">
            <Tv className="h-3 w-3 shrink-0" />
            {[...game.broadcast, ...game.streaming].join(' · ')}
          </span>
        </div>
      </div>

      {/* ── Time + chevron ── */}
      <div className="text-right shrink-0 flex items-center gap-2 relative z-10">
        <div>
          <p className="text-[17px] font-bold leading-none tabular-nums text-white/85">
            {displayTime}
          </p>
          <p className="text-[10px] font-medium text-white/30 mt-0.5 uppercase tracking-wide">
            {game.isHome ? 'Home' : 'Away'}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/20 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ScheduleSkeleton() {
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
        <Calendar className="h-8 w-8 text-indigo-400" />
      </div>
      <h1 className="text-2xl font-black text-white mb-3">No schedule yet</h1>
      <p className="text-white/55 mb-8 leading-relaxed">
        Select teams to follow and your upcoming fixtures will appear here.
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

// ─── FilterPill ───────────────────────────────────────────────────────────────

function FilterPill({
  label, active, onClick, muted = false,
}: {
  label: string; active: boolean; onClick: () => void; muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
        active
          ? muted ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white'
          : 'bg-white/8 text-white/50 hover:text-white hover:bg-white/12'
      }`}
    >
      {label}
    </button>
  );
}

// ─── TeamFilterPill ────────────────────────────────────────────────────────────

function TeamFilterPill({
  label, logoUrl, primaryColor, league, active, onClick,
}: {
  label: string; logoUrl?: string; primaryColor?: string; league?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0"
      style={active && primaryColor ? {
        background: `${primaryColor}22`,
        color: primaryColor,
        border: `1px solid ${primaryColor}55`,
        boxShadow: `0 0 12px ${primaryColor}30`,
      } : active ? {
        background: 'rgba(99,102,241,0.25)',
        color: 'white',
        border: '1px solid rgba(99,102,241,0.5)',
      } : {
        background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.45)',
        border: '1px solid transparent',
      }}
    >
      {logoUrl && (
        <img
          src={logoUrl}
          alt=""
          className="w-4 h-4 object-contain shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {label}
      {league && <SportBall league={league} size={11} />}
    </button>
  );
}

// ─── LeagueFilterPill ─────────────────────────────────────────────────────────

function LeagueFilterPill({
  leagueId, active, onClick,
}: {
  leagueId: string; active: boolean; onClick: () => void;
}) {
  const meta = LEAGUE_BADGE[leagueId];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0"
      style={active ? {
        background:  meta?.bg     ?? 'rgba(99,102,241,0.25)',
        color:       meta?.color  ?? 'white',
        border:      `1px solid ${meta?.border ?? 'rgba(99,102,241,0.5)'}`,
        boxShadow:   `0 0 14px ${meta?.bg ?? '#6366f1'}55`,
      } : {
        background: 'rgba(255,255,255,0.06)',
        color:      'rgba(255,255,255,0.45)',
        border:     '1px solid transparent',
      }}
    >
      {meta?.symbol && (
        <span aria-hidden="true" style={{ color: meta.symbolColor ?? meta.color, fontSize: meta.symbol.codePointAt(0)! > 0xffff ? '11px' : '8px' }}>
          {meta.symbol}
        </span>
      )}
      {meta?.label ?? leagueId.toUpperCase()}
    </button>
  );
}

// ─── Followed-teams sidebar widget ────────────────────────────────────────────

function FollowedTeamsWidget({ teams }: { teams: Team[] }) {
  if (teams.length === 0) return null;
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">
        Following
      </p>
      <div className="flex flex-wrap gap-2">
        {teams.map(team => (
          <div key={team.id} className="relative group">
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={44}
              className="rounded-xl"
            />
            {/* Name tooltip */}
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md
                         text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100
                         pointer-events-none transition-opacity duration-150 z-20"
              style={{
                background: `${team.primaryColor}dd`,
                color: contrastColor(team.primaryColor),
              }}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [teams,    setTeams]    = useState<Team[]>([]);
  const [allGames, setAllGames] = useState<ScheduleEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [userTz,   setUserTz]   = useState('Australia/Brisbane');

  const [activeTeamId,    setActiveTeamId]    = useState<string>('all');
  const [activeLeagueId,  setActiveLeagueId]  = useState<string | null>(null);
  const [leagueGames,     setLeagueGames]     = useState<ScheduleEntry[]>([]);
  const [leagueLoading,   setLeagueLoading]   = useState(false);
  const [homeAwayFilter,  setHomeAwayFilter]  = useState<'all' | 'home' | 'away'>('all');
  const [gameRangeFilter, setGameRangeFilter] = useState<'all' | 'this_round'>('all');
  const [standings,       setStandings]       = useState<StandingRow[] | null>(null);

  // Cross-highlight state: shared between calendar and schedule rows
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);

  // Expanded card state
  const [expandedId,      setExpandedId]      = useState<string | null>(null);
  const [everExpandedIds, setEverExpandedIds] = useState<Set<string>>(new Set());

  // Calendar click — temporary glow on the clicked date's fixtures
  const [clickedDateKey, setClickedDateKey] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect browser timezone once on mount
  useEffect(() => {
    try {
      setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // keep default AEST
    }
  }, []);

  // Resolve which league's standings to show. Memoised so the fetch below only
  // re-runs when the resolved league actually changes — not on every card expand.
  const standingsLeague = useMemo((): string | null => {
    const league = activeLeagueId
      ?? (activeTeamId !== 'all' ? teams.find(t => t.id === activeTeamId)?.league ?? null : null)
      ?? allGames.find(g => g.id === expandedId)?.team.league
      ?? null;
    return league && REAL_DATA_LEAGUES.has(league) ? league : null;
  }, [activeLeagueId, activeTeamId, expandedId, teams, allGames]);

  // Fetch standings when the resolved league changes (not on every expand/collapse).
  useEffect(() => {
    if (!standingsLeague) { setStandings(null); return; }
    setStandings(null);
    fetch(`/api/standings?league=${standingsLeague}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: StandingRow[]) => setStandings(rows.length > 0 ? rows : null))
      .catch(() => setStandings(null));
  }, [standingsLeague]);

  // Fetch all fixtures for a league when the user activates league-browse mode.
  useEffect(() => {
    if (!activeLeagueId) { setLeagueGames([]); return; }
    setLeagueLoading(true);
    setExpandedId(null);
    fetch(`/api/league-fixtures?league=${activeLeagueId}`)
      .then(r => r.ok ? r.json() : [])
      .then((games: UpcomingGame[]) => {
        const entries: ScheduleEntry[] = games.map(g => {
          const team = TEAMS.find(t => t.id === g.teamId) ?? makeFallbackTeam(g, activeLeagueId);
          return { ...g, team };
        });
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setLeagueGames(entries);
      })
      .catch(() => {})
      .finally(() => setLeagueLoading(false));
  }, [activeLeagueId]);

  useEffect(() => {
    const followed = getFollowedTeams();
    setTeams(followed);

    if (followed.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      followed.map(async (team): Promise<ScheduleEntry[]> => {
        const games = await loadFixtures(team);
        return games.map(g => ({ ...g, team }));
      }),
    ).then(results => {
      const sorted = results
        .flat()
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setAllGames(sorted);
      setLoading(false);
    });
  }, []);

  // IDs of teams the user follows — used both for standings highlighting and
  // for the "following" badge on league-browse rows.
  const followedTeamIds = useMemo(() => {
    const ids = teams.map(t => t.id);
    const eg = [...allGames, ...leagueGames].find(g => g.id === expandedId);
    if (eg?.opponentId) ids.push(eg.opponentId);
    return new Set(ids);
  }, [teams, expandedId, allGames, leagueGames]);

  const isLeagueMode = activeLeagueId !== null;

  // In league-browse mode: show all league games (home/away filter still applies).
  // In team mode: show followed-team games filtered by active team pill.
  const filteredGames = useMemo<ScheduleEntry[]>(() => {
    const source = isLeagueMode ? leagueGames : allGames;
    return source.filter(g => {
      if (!isLeagueMode && activeTeamId !== 'all' && g.team.id !== activeTeamId) return false;
      if (homeAwayFilter === 'home' && !g.isHome) return false;
      if (homeAwayFilter === 'away' &&  g.isHome) return false;
      return true;
    });
  }, [isLeagueMode, leagueGames, allGames, activeTeamId, homeAwayFilter]);

  // "This Round": 7 days from the first upcoming game in the current filtered set.
  // One game per (team, competition) pair — prevents cup + league double-ups.
  const displayedGames = useMemo<ScheduleEntry[]>(() => {
    if (gameRangeFilter !== 'this_round' || filteredGames.length === 0) {
      return filteredGames;
    }
    const roundStart = new Date(filteredGames[0].date);
    const roundEnd   = new Date(roundStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const seen = new Set<string>();
    return filteredGames.filter(g => {
      if (new Date(g.date) >= roundEnd) return false;
      const key = `${g.team.id}:${g.competition ?? g.team.league}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredGames, gameRangeFilter]);

  // Group by calendar date in the user's timezone
  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; representativeDate: Date; games: ScheduleEntry[] }[] = [];
    for (const game of displayedGames) {
      const dateKey = datekeyInZone(game.date, userTz);
      const last = groups[groups.length - 1];
      if (last?.dateKey === dateKey) {
        last.games.push(game);
      } else {
        groups.push({ dateKey, representativeDate: new Date(game.date), games: [game] });
      }
    }
    return groups;
  }, [displayedGames, userTz]);

  // Hero game: in league mode, prefer a followed team's next fixture.
  const heroGame = useMemo(() => {
    if (displayedGames.length === 0) return null;
    if (!isLeagueMode) return displayedGames[0];
    return (
      displayedGames.find(g =>
        followedTeamIds.has(g.team.id) ||
        (g.opponentId != null && followedTeamIds.has(g.opponentId)),
      ) ?? displayedGames[0]
    );
  }, [displayedGames, isLeagueMode, followedTeamIds]);

  // Calendar interaction handlers
  const handleCalendarHover = useCallback((dk: string | null) => setHoveredDateKey(dk), []);

  const handleDayClick = useCallback((dk: string) => {
    const el = document.getElementById(`date-section-${dk}`);
    if (el) {
      // Offset by navbar height + breathing room so the section heading is visible
      const y = el.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    // Flash a glow on that date's fixtures for 2.5 s
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    setClickedDateKey(dk);
    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
  }, []);

  // Toggle expanded card
  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    setEverExpandedIds(prev => { const next = new Set(prev); next.add(id); return next; });
  }, []);

  if (!loading && !isLeagueMode && teams.length === 0) return <EmptyState />;

  const activeLoading = isLeagueMode ? leagueLoading : loading;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white/90 flex items-center gap-2 mb-1">
          <Calendar className="h-6 w-6 text-indigo-400" />
          {isLeagueMode
            ? `${BROWSABLE_LEAGUES.find(l => l.id === activeLeagueId)?.fullName ?? 'League'} — All Fixtures`
            : 'Your Schedule'}
        </h1>
        {activeLoading && <p className="text-white/40 text-sm">Loading fixtures…</p>}
      </div>

      {/* ── Next Game Hero ── */}
      {!activeLoading && heroGame && (
        <NextGameHero game={heroGame} userTz={userTz} />
      )}

      {/* ── Two-column layout: schedule list + sidebar ── */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* ── Left column: filters + schedule ── */}
        <div>
          {/* Filters */}
          {!activeLoading && (
            <div className="mb-8 space-y-3">

              {/* Row 1: My teams */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-1.5">My Teams</p>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <TeamFilterPill
                    label="All"
                    active={!isLeagueMode && activeTeamId === 'all'}
                    onClick={() => { setActiveLeagueId(null); setActiveTeamId('all'); }}
                  />
                  {teams.map(team => (
                    <TeamFilterPill
                      key={team.id}
                      label={team.abbreviation}
                      logoUrl={TEAM_LOGOS[team.id]}
                      primaryColor={team.primaryColor}
                      league={team.league}
                      active={!isLeagueMode && activeTeamId === team.id}
                      onClick={() => { setActiveLeagueId(null); setActiveTeamId(team.id); }}
                    />
                  ))}
                </div>
              </div>

              {/* Row 2: Browse by league */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-1.5">Browse League</p>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {BROWSABLE_LEAGUES.map(league => (
                    <LeagueFilterPill
                      key={league.id}
                      leagueId={league.id}
                      active={activeLeagueId === league.id}
                      onClick={() => {
                        setActiveLeagueId(prev => prev === league.id ? null : league.id);
                        setActiveTeamId('all');
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Row 3: Secondary filters */}
              <div className="flex gap-1.5 items-center">
                <FilterPill
                  label="This Round"
                  active={gameRangeFilter === 'this_round'}
                  onClick={() => setGameRangeFilter(prev => prev === 'this_round' ? 'all' : 'this_round')}
                  muted
                />
                {!isLeagueMode && (
                  <>
                    <div className="w-px h-4 bg-white/10" />
                    {(['all', 'home', 'away'] as const).map(opt => (
                      <FilterPill
                        key={opt}
                        label={opt === 'all' ? 'All games' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                        active={homeAwayFilter === opt}
                        onClick={() => setHomeAwayFilter(opt)}
                        muted
                      />
                    ))}
                  </>
                )}
              </div>

            </div>
          )}

          {/* Schedule content */}
          {activeLoading ? (
            <ScheduleSkeleton />
          ) : displayedGames.length === 0 ? (
            <div className="text-center py-20 text-white/40">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No fixtures match this filter.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ dateKey, representativeDate, games }) => (
                <section key={dateKey} id={`date-section-${dateKey}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-[13px] font-black uppercase tracking-[0.12em] text-white/75 shrink-0">
                      {formatDateHeading(representativeDate, dateKey, userTz)}
                    </p>
                    <div className="flex-1 h-px bg-white/12" />
                    <span className="text-[10px] font-semibold text-white/40 shrink-0 uppercase tracking-wide">
                      {games.length} {games.length !== 1 ? 'fixtures' : 'fixture'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {games.map(game => {
                      const isHighlighted = hoveredDateKey === dateKey;
                      const isExpanded    = expandedId === game.id;
                      // In league mode, highlight rows where the user follows either team.
                      const isFollowed    = isLeagueMode && (
                        followedTeamIds.has(game.team.id) ||
                        (game.opponentId != null && followedTeamIds.has(game.opponentId))
                      );

                      return (
                        <div
                          key={game.id}
                          className="rounded-2xl"
                          style={{
                            transition: 'box-shadow 0.4s ease-out',
                            boxShadow: clickedDateKey === dateKey
                              ? `0 0 48px ${game.team.primaryColor}70, 0 0 0 1px ${game.team.primaryColor}50`
                              : isHighlighted
                                ? `0 0 28px ${game.team.primaryColor}30`
                                : undefined,
                          }}
                        >
                          <ScheduleRow
                            game={game}
                            userTz={userTz}
                            dateKey={dateKey}
                            isHighlighted={isHighlighted}
                            isExpanded={isExpanded}
                            isFollowed={isFollowed}
                            onHover={handleCalendarHover}
                            onToggle={() => toggleExpand(game.id)}
                          />
                          {everExpandedIds.has(game.id) && (
                            <div style={{ display: isExpanded ? 'block' : 'none' }}>
                              <GameExpandPanel game={game} compact={isLeagueMode} />
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

        {/* ── Right column: sticky sidebar ── */}
        <aside className="hidden lg:block sticky top-20 space-y-4 mt-0">

          {/* Calendar */}
          {!activeLoading && (
            <ScheduleCalendar
              games={displayedGames}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={handleDayClick}
            />
          )}

          {/* League standings — shown in league-browse mode, when a team is selected, or when a card is expanded */}
          {!activeLoading && standings && (isLeagueMode || activeTeamId !== 'all' || expandedId !== null) && (
            <LeagueTable
              league={(
                activeLeagueId
                  ?? (activeTeamId !== 'all' ? teams.find(t => t.id === activeTeamId)?.league : undefined)
                  ?? [...allGames, ...leagueGames].find(g => g.id === expandedId)?.team.league
              ) as SportKey}
              rows={standings}
              followedTeamIds={followedTeamIds}
            />
          )}

          {/* Followed teams — always show in league mode so user sees who they follow */}
          <FollowedTeamsWidget teams={teams} />

        </aside>
      </div>
    </div>
  );
}
