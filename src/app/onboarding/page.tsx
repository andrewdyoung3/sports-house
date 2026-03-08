'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Search } from 'lucide-react';

import { LEAGUES, filterTeams } from '@/lib/teams';
import { getFollowedTeams, saveFollowedTeams } from '@/lib/user-prefs';
import { TeamSelectorCard } from '@/components/onboarding/team-selector-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { SportKey, Team } from '@/types';

export default function OnboardingPage() {
  const router = useRouter();

  const [activeSport, setActiveSport] = useState<SportKey | 'all'>('all');
  const [query, setQuery]             = useState('');
  const [selected, setSelected]       = useState<Team[]>([]);

  // Pre-populate with any teams already saved so additions don't wipe existing selections
  useEffect(() => {
    const existing = getFollowedTeams();
    if (existing.length > 0) setSelected(existing);
  }, []);

  const filteredTeams = useMemo(
    () => filterTeams(activeSport === 'all' ? 'all' : activeSport, query),
    [activeSport, query],
  );

  const toggleTeam = useCallback((team: Team) => {
    setSelected(prev =>
      prev.some(t => t.id === team.id)
        ? prev.filter(t => t.id !== team.id)
        : [...prev, team],
    );
  }, []);

  const isSelected = (id: string) => selected.some(t => t.id === id);

  const handleFinish = () => {
    saveFollowedTeams(selected);
    router.push('/schedule');
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 pt-10 pb-32">

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">Which teams do you follow?</h1>
          <p className="text-white/55">Select as many as you like across any sport. You can update this any time.</p>
        </div>

        {/* Sport filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-none">
          {[{ id: 'all' as const, name: 'All', icon: '🏆' }, ...LEAGUES].map(league => (
            <button
              key={league.id}
              onClick={() => { setActiveSport(league.id); setQuery(''); }}
              className={[
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all',
                activeSport === league.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40'
                  : 'bg-white/8 text-white/50 hover:bg-white/12 hover:text-white',
              ].join(' ')}
            >
              <span>{league.icon}</span>
              {league.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6 max-w-md">
          <Input
            icon
            placeholder="Search teams, cities…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {/* Team grid */}
        {filteredTeams.length === 0 ? (
          <div className="text-center py-16 text-white/40">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No teams match &ldquo;{query}&rdquo;</p>
            <p className="text-sm mt-1">Try a different name or clear the search</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredTeams.map(team => (
              <TeamSelectorCard
                key={team.id}
                team={team}
                selected={isSelected(team.id)}
                onToggle={toggleTeam}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-black/40 backdrop-blur-xl border-t border-white/10 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">

          {/* Selected team chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0">
            {selected.length === 0 ? (
              <p className="text-sm text-white/35 whitespace-nowrap">No teams selected yet</p>
            ) : (
              <>
                <span className="text-sm font-semibold text-white/75 whitespace-nowrap shrink-0">
                  {selected.length} team{selected.length !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-1 overflow-x-auto">
                  {selected.slice(0, 6).map(t => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg shrink-0 text-white"
                      style={{ backgroundColor: t.primaryColor }}
                    >
                      {t.abbreviation}
                      <button
                        onClick={() => toggleTeam(t)}
                        className="opacity-70 hover:opacity-100 ml-0.5"
                        aria-label={`Remove ${t.shortName}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  {selected.length > 6 && (
                    <span className="text-xs text-white/40 px-1 py-1 shrink-0">+{selected.length - 6} more</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Confirm button */}
          <Button
            size="md"
            disabled={selected.length === 0}
            onClick={handleFinish}
            className="gap-2 shrink-0"
          >
            <Check className="h-4 w-4" />
            Add / Select Teams
          </Button>
        </div>
      </div>
    </div>
  );
}
