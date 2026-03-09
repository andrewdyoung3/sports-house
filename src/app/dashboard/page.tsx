'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Settings, LayoutGrid } from 'lucide-react';

import { getFollowedTeams, saveFollowedTeams } from '@/lib/user-prefs';
import { LEAGUES } from '@/lib/teams';
import { SportBall } from '@/components/schedule/sport-ball';
import { TeamFeedCard } from '@/components/dashboard/team-feed-card';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import type { Team } from '@/types';

export default function DashboardPage() {
  const [teams, setTeams]       = useState<Team[]>([]);
  const [loading, setLoading]   = useState(true);

  // Load from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    setTeams(getFollowedTeams());
    setLoading(false);
  }, []);

  const handleUnfollow = (teamId: string) => {
    const updated = teams.filter(t => t.id !== teamId);
    setTeams(updated);
    saveFollowedTeams(updated);
  };

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!loading && teams.length === 0) {
    return <EmptyState />;
  }

  // ── Group teams by league for the sidebar ──────────────────────────────────

  const leagueGroups = LEAGUES.map(l => ({
    league: l,
    teams: teams.filter(t => t.league === l.id),
  })).filter(g => g.teams.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-indigo-400" />
            Your Dashboard
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Following {teams.length} team{teams.length !== 1 ? 's' : ''} across{' '}
            {leagueGroups.length} league{leagueGroups.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/onboarding">
          <Button variant="secondary" size="sm" className="gap-1.5 shrink-0">
            <Settings className="h-3.5 w-3.5" />
            Edit Teams
          </Button>
        </Link>
      </div>

      {/* ── Layout: sidebar + feed ── */}
      <div className="flex gap-8">
        {/* Sidebar — team navigator (hidden on mobile) */}
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-24 space-y-6">
            {leagueGroups.map(({ league, teams: lt }) => (
              <div key={league.id}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 mb-2 flex items-center gap-1">
                  <SportBall league={league.id} size={12} /> {league.name}
                </p>
                <ul className="space-y-0.5">
                  {lt.map(team => (
                    <li key={team.id}>
                      <a
                        href={`#team-${team.id}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-all group"
                      >
                        <span
                          className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-black shrink-0 transition-opacity"
                          style={{ backgroundColor: team.primaryColor }}
                        >
                          {team.abbreviation.slice(0, 2)}
                        </span>
                        <span className="truncate">{team.shortName}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="pt-2 border-t border-zinc-800">
              <Link href="/onboarding">
                <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all w-full">
                  <Plus className="h-4 w-4" />
                  Add team
                </button>
              </Link>
            </div>
          </div>
        </aside>

        {/* ── Main feed ── */}
        <div className="flex-1 min-w-0 space-y-6">
          {loading ? (
            // Loading skeletons
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            teams.map(team => (
              <div key={team.id} id={`team-${team.id}`}>
                <TeamFeedCard team={team} onUnfollow={handleUnfollow} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="max-w-lg mx-auto px-4 py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-700/30 flex items-center justify-center mx-auto mb-6">
        <LayoutGrid className="h-8 w-8 text-indigo-400" />
      </div>
      <h1 className="text-2xl font-black text-white mb-3">No teams yet</h1>
      <p className="text-zinc-400 mb-8 leading-relaxed">
        Your dashboard is empty. Select the teams you follow and we&apos;ll build your personalised sports feed.
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
