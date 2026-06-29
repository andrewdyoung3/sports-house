'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Settings, LayoutGrid } from 'lucide-react';

import { getFollowedTeams, saveFollowedTeams, PREFS_UPDATED_EVENT } from '@/lib/user-prefs';
import { LEAGUES } from '@/lib/teams';
import { contrastColor } from '@/lib/utils';
import { SportBall } from '@/components/schedule/sport-ball';
import { TeamFeedCard } from '@/components/dashboard/team-feed-card';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { Team } from '@/types';

export default function DashboardPage() {
  const [teams, setTeams]       = useState<Team[]>([]);
  const [loading, setLoading]   = useState(true);

  // Load from localStorage after hydration (avoids SSR mismatch), then stay live:
  // a background sync/merge (e.g. the anon→permanent UNION after sign-in) updates the
  // cache and fires PREFS_UPDATED_EVENT, so the dashboard reflects the merged union
  // with NO manual reload.
  useEffect(() => {
    const refresh = () => setTeams(getFollowedTeams());
    refresh();
    setLoading(false);
    window.addEventListener(PREFS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, refresh);
  }, []);

  const handleUnfollow = (teamId: string) => {
    const updated = teams.filter(t => t.id !== teamId);
    setTeams(updated);
    saveFollowedTeams(updated);
  };

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!loading && teams.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No teams yet"
        body="Your dashboard is empty. Select the teams you follow and we'll build your personalised sports feed."
      />
    );
  }

  // ── Group teams by league for the sidebar ──────────────────────────────────

  const leagueGroups = LEAGUES.map(l => ({
    league: l,
    teams: teams.filter(t => t.league === l.id),
  })).filter(g => g.teams.length > 0);

  // Step 9 — sh-theme wraps the page chrome; default --accent (#9b6bff) governs the
  // sidebar and header. Each TeamFeedCard Card sets its own --accent via accentColor.
  return (
    <div className="sh-theme max-w-7xl mx-auto px-4 py-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
            <LayoutGrid className="h-6 w-6" style={{ color: 'var(--accent)' }} />
            Your Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
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
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                  <SportBall league={league.id} size={12} /> {league.name}
                </p>
                <ul className="space-y-0.5">
                  {lt.map(team => (
                    <li key={team.id}>
                      <a
                        href={`#team-${team.id}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm hover:text-white/85 hover:bg-white/[0.06] transition-all group"
                        style={{ color: 'var(--text-2)' }}
                      >
                        <span
                          className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black shrink-0 transition-opacity"
                          style={{ backgroundColor: team.primaryColor, color: contrastColor(team.primaryColor) }}
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

            <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <Link href="/onboarding">
                <button
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm hover:text-white/70 hover:bg-white/[0.06] transition-all w-full"
                  style={{ color: 'var(--text-3)' }}
                >
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

