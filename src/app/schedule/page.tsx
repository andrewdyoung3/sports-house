'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, Tv, Plus, ChevronDown } from 'lucide-react';

import { getFollowedTeams } from '@/lib/user-prefs';
import { getUpcomingGames } from '@/lib/mock-data';
import { LEAGUES } from '@/lib/teams';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { contrastColor, formatTimeInZone, datekeyInZone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TeamBadge } from '@/components/ui/team-badge';
import { NextGameHero } from '@/components/schedule/next-game-hero';
import { ScheduleCalendar } from '@/components/schedule/schedule-calendar';
import { GameExpandPanel } from '@/components/schedule/game-expand-panel';
import type { Team, UpcomingGame, SportKey } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleEntry = UpcomingGame & { team: Team };

/** Leagues backed by real APIs — all others use deterministic mock data. */
const REAL_DATA_LEAGUES = new Set<string>(['afl', 'epl', 'nrl', 'super_rugby']);

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

// ─── Competition badge ────────────────────────────────────────────────────────

const COMPETITION_STYLE: Record<string, string> = {
  'Champions League': 'text-amber-300 bg-amber-900/40 border-amber-600/40',
  'Europa League':    'text-orange-300 bg-orange-900/40 border-orange-600/40',
  'Conference League':'text-teal-300 bg-teal-900/40 border-teal-600/40',
  'FA Cup':           'text-emerald-300 bg-emerald-900/40 border-emerald-600/40',
  'EFL Cup':          'text-sky-300 bg-sky-900/40 border-sky-600/40',
};
const DEFAULT_COMPETITION_STYLE = 'text-indigo-300 bg-indigo-900/40 border-indigo-600/40';

function CompetitionBadge({ name }: { name: string }) {
  const cls = COMPETITION_STYLE[name] ?? DEFAULT_COMPETITION_STYLE;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${cls}`}>
      {name}
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
  onHover: (dateKey: string | null) => void;
  onToggle: () => void;
}

function ScheduleRow({
  game,
  userTz,
  dateKey,
  isHighlighted,
  isExpanded,
  onHover,
  onToggle,
}: ScheduleRowProps) {
  const { team } = game;
  const displayTime = formatTimeInZone(game.date, userTz);

  return (
    <div
      className={[
        'flex items-center gap-3 glass px-4 py-3 cursor-pointer',
        'transition-all duration-200 select-none',
        isExpanded ? 'rounded-t-2xl' : 'rounded-2xl float-hover',
        isHighlighted && !isExpanded ? 'brightness-110' : '',
      ].join(' ')}
      style={{
        borderLeftColor: `${team.primaryColor}70`,
        borderLeftWidth: '2px',
        ...(isHighlighted && !isExpanded
          ? { boxShadow: `0 0 20px ${team.primaryColor}28, inset 0 0 0 1px ${team.primaryColor}22` }
          : {}),
      }}
      onClick={onToggle}
      onMouseEnter={() => onHover(dateKey)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      {/* Team badge */}
      <TeamBadge
        logoUrl={TEAM_LOGOS[team.id]}
        abbreviation={team.abbreviation}
        primaryColor={team.primaryColor}
        size={40}
      />

      {/* Matchup + metadata */}
      <div className="flex-1 min-w-0">
        {/* Matchup */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-white">{team.shortName}</span>
          <span className="text-xs text-white/35">{game.isHome ? 'vs' : 'at'}</span>
          <TeamBadge
            logoUrl={game.opponentLogoUrl}
            abbreviation={game.opponentAbbr}
            primaryColor={game.opponentColor}
            size={22}
            className="rounded-md"
          />
          <span className="text-sm text-white/75">{game.opponent}</span>
          {game.competition && (
            <CompetitionBadge name={game.competition} />
          )}
        </div>

        {/* Venue + broadcast */}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {game.venue && (
            <span className="flex items-center gap-1 text-xs text-white/35">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[160px]">{game.venue}</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-white/35">
            <Tv className="h-3 w-3 shrink-0" />
            {[...game.broadcast, ...game.streaming].join(' · ')}
          </span>
        </div>
      </div>

      {/* Time + home/away + expand toggle */}
      <div className="text-right shrink-0 flex items-center gap-2.5">
        <div>
          <p className="text-sm font-bold" style={{ color: team.primaryColor }}>
            {displayTime}
          </p>
          <p className="text-xs text-white/35 mt-0.5">{game.isHome ? 'Home' : 'Away'}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/25 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
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
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active
          ? muted ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white'
          : 'bg-white/8 text-white/50 hover:text-white hover:bg-white/12'
      }`}
    >
      {label}
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

  const [activeLeague,   setActiveLeague]   = useState<SportKey | 'all'>('all');
  const [homeAwayFilter, setHomeAwayFilter] = useState<'all' | 'home' | 'away'>('all');
  const [gameRangeFilter, setGameRangeFilter] = useState<'all' | 'this_round'>('all');

  // Cross-highlight state: shared between calendar and schedule rows
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);

  // Expanded card state
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Detect browser timezone once on mount
  useEffect(() => {
    try {
      setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // keep default AEST
    }
  }, []);

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

  // League + home/away filters
  const filteredGames = useMemo<ScheduleEntry[]>(() => {
    return allGames.filter(g => {
      if (activeLeague !== 'all' && g.team.league !== activeLeague) return false;
      if (homeAwayFilter === 'home' && !g.isHome) return false;
      if (homeAwayFilter === 'away' &&  g.isHome) return false;
      return true;
    });
  }, [allGames, activeLeague, homeAwayFilter]);

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

  // Only show league tabs for leagues the user actually follows
  const presentLeagues = LEAGUES.filter(l => teams.some(t => t.league === l.id));

  // Calendar interaction handlers
  const handleCalendarHover = useCallback((dk: string | null) => setHoveredDateKey(dk), []);

  const handleDayClick = useCallback((dk: string) => {
    const el = document.getElementById(`date-section-${dk}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Toggle expanded card
  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  if (!loading && teams.length === 0) return <EmptyState />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-2 mb-1">
          <Calendar className="h-6 w-6 text-indigo-400" />
          Your Schedule
        </h1>
        <p className="text-white/40 text-sm">
          {loading
            ? 'Loading fixtures…'
            : `${displayedGames.length} upcoming fixture${displayedGames.length !== 1 ? 's' : ''} · times in your local timezone`}
        </p>
      </div>

      {/* ── Next Game Hero ── */}
      {!loading && displayedGames.length > 0 && (
        <NextGameHero game={displayedGames[0]} userTz={userTz} />
      )}

      {/* ── Two-column layout: schedule list + sidebar ── */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* ── Left column: filters + schedule ── */}
        <div>
          {/* Filters */}
          {!loading && (
            <div className="flex flex-wrap items-center gap-2 mb-8">
              <div className="flex flex-wrap gap-1.5 flex-1">
                <FilterPill label="All"  active={activeLeague === 'all'} onClick={() => setActiveLeague('all')} />
                {presentLeagues.map(l => (
                  <FilterPill
                    key={l.id}
                    label={`${l.icon} ${l.name}`}
                    active={activeLeague === l.id}
                    onClick={() => setActiveLeague(l.id)}
                  />
                ))}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <FilterPill
                  label="This Round"
                  active={gameRangeFilter === 'this_round'}
                  onClick={() => setGameRangeFilter(prev => prev === 'this_round' ? 'all' : 'this_round')}
                  muted
                />
                <div className="w-px bg-white/10 self-stretch" />
                {(['all', 'home', 'away'] as const).map(opt => (
                  <FilterPill
                    key={opt}
                    label={opt === 'all' ? 'All games' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    active={homeAwayFilter === opt}
                    onClick={() => setHomeAwayFilter(opt)}
                    muted
                  />
                ))}
              </div>
            </div>
          )}

          {/* Schedule content */}
          {loading ? (
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
                    <p className="text-sm font-bold text-white/80 shrink-0">
                      {formatDateHeading(representativeDate, dateKey, userTz)}
                    </p>
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-xs text-white/30 shrink-0">
                      {games.length} game{games.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {games.map(game => {
                      const isHighlighted = hoveredDateKey === dateKey;
                      const isExpanded    = expandedId === game.id;

                      return (
                        <div
                          key={game.id}
                          className="rounded-2xl"
                          style={{
                            transition: 'box-shadow 0.15s ease',
                            boxShadow: isHighlighted
                              ? `0 0 28px ${game.team.primaryColor}28`
                              : undefined,
                          }}
                        >
                          <ScheduleRow
                            game={game}
                            userTz={userTz}
                            dateKey={dateKey}
                            isHighlighted={isHighlighted}
                            isExpanded={isExpanded}
                            onHover={handleCalendarHover}
                            onToggle={() => toggleExpand(game.id)}
                          />
                          {isExpanded && <GameExpandPanel game={game} />}
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
          {!loading && (
            <ScheduleCalendar
              games={displayedGames}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={handleDayClick}
            />
          )}

          {/* Followed teams */}
          <FollowedTeamsWidget teams={teams} />

        </aside>
      </div>
    </div>
  );
}
