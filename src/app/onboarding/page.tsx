'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, X, Search } from 'lucide-react';

import { LEAGUES, TEAMS, filterTeams } from '@/lib/teams';
import { saveFollowedTeams } from '@/lib/user-prefs';
import { TeamSelectorCard } from '@/components/onboarding/team-selector-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { SportKey, Team } from '@/types';

type Step = 1 | 2;

export default function OnboardingPage() {
  const router = useRouter();

  // UI state
  const [step, setStep]           = useState<Step>(1);
  const [activeSport, setActiveSport] = useState<SportKey | 'all'>('all');
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState<Team[]>([]);

  // Derived: filtered team list
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

  // Step 2: confirm and navigate to dashboard
  const handleFinish = () => {
    saveFollowedTeams(selected);
    router.push('/dashboard');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Progress bar */}
      <div className="fixed top-14 left-0 right-0 z-40 h-0.5 bg-zinc-800">
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: step === 1 ? '50%' : '100%' }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-10 pb-32">
        {step === 1 ? (
          <Step1
            activeSport={activeSport}
            setActiveSport={setActiveSport}
            query={query}
            setQuery={setQuery}
            filteredTeams={filteredTeams}
            isSelected={isSelected}
            toggleTeam={toggleTeam}
          />
        ) : (
          <Step2
            selected={selected}
            toggleTeam={toggleTeam}
          />
        )}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Selected team chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              {selected.length === 0 ? (
                <p className="text-sm text-zinc-500 whitespace-nowrap">No teams selected yet</p>
              ) : (
                <>
                  <span className="text-sm font-semibold text-zinc-300 whitespace-nowrap shrink-0">
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
                      <span className="text-xs text-zinc-500 px-1 py-1 shrink-0">+{selected.length - 6} more</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {step === 2 && (
              <Button variant="ghost" size="md" onClick={() => setStep(1)}>
                ← Back
              </Button>
            )}
            {step === 1 ? (
              <Button
                size="md"
                disabled={selected.length === 0}
                onClick={() => setStep(2)}
                className="gap-2"
              >
                Review ({selected.length})
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="md"
                disabled={selected.length === 0}
                onClick={handleFinish}
                className="gap-2"
              >
                <Check className="h-4 w-4" />
                Go to Dashboard
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Browse & Select ───────────────────────────────────────────────────

interface Step1Props {
  activeSport: SportKey | 'all';
  setActiveSport: (s: SportKey | 'all') => void;
  query: string;
  setQuery: (q: string) => void;
  filteredTeams: Team[];
  isSelected: (id: string) => boolean;
  toggleTeam: (t: Team) => void;
}

function Step1({ activeSport, setActiveSport, query, setQuery, filteredTeams, isSelected, toggleTeam }: Step1Props) {
  return (
    <>
      {/* Heading */}
      <div className="mb-8">
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-2">Step 1 of 2</p>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">Which teams do you follow?</h1>
        <p className="text-zinc-400">Select as many as you like. You can change this any time.</p>
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
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100',
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
        <div className="text-center py-16 text-zinc-500">
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
    </>
  );
}

// ─── Step 2: Review Selection ─────────────────────────────────────────────────

function Step2({ selected, toggleTeam }: { selected: Team[]; toggleTeam: (t: Team) => void }) {
  // Group by league for display
  const byLeague = LEAGUES.map(league => ({
    league,
    teams: selected.filter(t => t.league === league.id),
  })).filter(g => g.teams.length > 0);

  return (
    <>
      <div className="mb-8">
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-2">Step 2 of 2</p>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">Confirm your teams</h1>
        <p className="text-zinc-400">
          You&apos;re following <strong className="text-white">{selected.length} team{selected.length !== 1 ? 's' : ''}</strong>.
          Click any team to remove it.
        </p>
      </div>

      {selected.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <p className="font-medium">No teams selected</p>
          <p className="text-sm mt-1">Go back to choose at least one team</p>
        </div>
      ) : (
        <div className="space-y-8">
          {byLeague.map(({ league, teams }) => (
            <div key={league.id}>
              <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>{league.icon}</span> {league.fullName}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {teams.map(team => (
                  <TeamSelectorCard
                    key={team.id}
                    team={team}
                    selected
                    onToggle={toggleTeam}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
