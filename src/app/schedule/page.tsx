'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, Tv, Plus } from 'lucide-react';

import { getFollowedTeams } from '@/lib/user-prefs';
import { getUpcomingGames } from '@/lib/mock-data';
import { LEAGUES } from '@/lib/teams';
import { contrastColor } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Team, UpcomingGame, SportKey } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleEntry = UpcomingGame & { team: Team };

/** Leagues backed by real APIs — all others use deterministic mock data. */
const REAL_DATA_LEAGUES = new Set<string>(['afl', 'epl']);

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

function formatDateHeading(date: Date): string {
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const full = date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
  });

  if (date.toDateString() === today.toDateString())    return `Today · ${full}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${full}`;
  return full;
}

// ─── Schedule row ─────────────────────────────────────────────────────────────

function ScheduleRow({ game }: { game: ScheduleEntry }) {
  const { team } = game;
  const textOnColor = contrastColor(team.primaryColor);

  return (
    <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors">
      {/* Team badge */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0"
        style={{ backgroundColor: team.primaryColor, color: textOnColor }}
      >
        {team.abbreviation.slice(0, 3)}
      </div>

      {/* Matchup + metadata */}
      <div className="flex-1 min-w-0">
        {/* Matchup */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-zinc-100">{team.shortName}</span>
          <span className="text-xs text-zinc-600">{game.isHome ? 'vs' : 'at'}</span>
          <div
            className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-black text-white shrink-0"
            style={{ backgroundColor: game.opponentColor }}
          >
            {game.opponentAbbr.slice(0, 2)}
          </div>
          <span className="text-sm text-zinc-300">{game.opponent}</span>
        </div>

        {/* Venue + broadcast */}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {game.venue && (
            <span className="flex items-center gap-1 text-xs text-zinc-600">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[160px]">{game.venue}</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-zinc-600">
            <Tv className="h-3 w-3 shrink-0" />
            {[...game.broadcast, ...game.streaming].join(' · ')}
          </span>
        </div>
      </div>

      {/* Time + home/away */}
      <div className="text-right shrink-0">
        <p className="text-sm font-bold" style={{ color: team.primaryColor }}>
          {game.time}
        </p>
        <p className="text-xs text-zinc-600 mt-0.5">{game.isHome ? 'Home' : 'Away'}</p>
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
          <div className="h-4 w-52 bg-zinc-800 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {[0, 1].map(j => (
              <div key={j} className="h-[72px] bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
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
      <p className="text-zinc-400 mb-8 leading-relaxed">
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
          ? muted ? 'bg-zinc-600 text-white' : 'bg-indigo-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
      }`}
    >
      {label}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [teams,    setTeams]    = useState<Team[]>([]);
  const [allGames, setAllGames] = useState<ScheduleEntry[]>([]);
  const [loading,  setLoading]  = useState(true);

  const [activeLeague,   setActiveLeague]   = useState<SportKey | 'all'>('all');
  const [homeAwayFilter, setHomeAwayFilter] = useState<'all' | 'home' | 'away'>('all');

  useEffect(() => {
    const followed = getFollowedTeams();
    setTeams(followed);

    if (followed.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch real data for supported leagues, mock for everything else
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

  // Group by calendar date
  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; date: Date; games: ScheduleEntry[] }[] = [];
    for (const game of filteredGames) {
      const dateKey = game.date.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last?.dateKey === dateKey) {
        last.games.push(game);
      } else {
        groups.push({ dateKey, date: new Date(game.date), games: [game] });
      }
    }
    return groups;
  }, [filteredGames]);

  // Only show league tabs for leagues the user actually follows
  const presentLeagues = LEAGUES.filter(l => teams.some(t => t.league === l.id));

  if (!loading && teams.length === 0) return <EmptyState />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white flex items-center gap-2 mb-1">
          <Calendar className="h-6 w-6 text-indigo-400" />
          Your Schedule
        </h1>
        <p className="text-zinc-500 text-sm">
          {loading
            ? 'Loading fixtures…'
            : `${filteredGames.length} upcoming fixture${filteredGames.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* ── Filters ── */}
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

      {/* ── Content ── */}
      {loading ? (
        <ScheduleSkeleton />
      ) : filteredGames.length === 0 ? (
        <div className="text-center py-20 text-zinc-500">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No fixtures match this filter.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedByDate.map(({ dateKey, date, games }) => (
            <section key={dateKey}>
              <div className="flex items-center gap-3 mb-3">
                <p className="text-sm font-bold text-zinc-200 shrink-0">
                  {formatDateHeading(date)}
                </p>
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-xs text-zinc-600 shrink-0">
                  {games.length} game{games.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {games.map(game => (
                  <ScheduleRow key={game.id} game={game} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
