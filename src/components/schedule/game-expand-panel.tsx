'use client';

import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Zap, CalendarPlus, Info, Loader2 } from 'lucide-react';
import { getAIPreview, getRecentResults } from '@/lib/mock-data';
import { RecentForm } from '@/components/dashboard/recent-form';
import type { Team, UpcomingGame, GameResult } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface GameExpandPanelProps {
  game: ScheduleEntry;
}

/** Leagues with a real /api/results backend; all others use mock data. */
const REAL_DATA_LEAGUES = new Set(['afl', 'epl']);

export function GameExpandPanel({ game }: GameExpandPanelProps) {
  const { team } = game;

  const [results, setResults] = useState<GameResult[]>(() => getRecentResults(team, 5));
  const [loadingResults, setLoadingResults] = useState(REAL_DATA_LEAGUES.has(team.league));

  useEffect(() => {
    if (!REAL_DATA_LEAGUES.has(team.league)) return;

    fetch(`/api/results?league=${team.league}&teamId=${team.id}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: GameResult[] | null) => {
        if (Array.isArray(data) && data.length > 0) setResults(data);
      })
      .catch(() => { /* keep mock on error */ })
      .finally(() => setLoadingResults(false));
  }, [team.id, team.league]);

  // These re-derive whenever results state changes (mock → real)
  const wins   = results.filter(r => r.isWin).length;
  const draws  = results.filter(r => r.isDraw).length;
  const preview = getAIPreview(team, game.opponent, results);

  const formLabel = draws > 0
    ? `${wins}W ${draws}D ${results.length - wins - draws}L`
    : `${wins}/${results.length} wins`;

  return (
    <div
      className="border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 space-y-5 rounded-b-2xl"
      style={{ animation: 'slideDown 0.22s ease-out' }}
    >
      {/* ── Match Preview ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
          <Zap className="h-3 w-3" style={{ color: team.primaryColor }} />
          Match Preview
        </p>
        <p className="text-sm text-white/65 leading-relaxed">{preview.content}</p>
      </div>

      {/* ── Form + Key Factors ── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Recent form */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
            <Trophy className="h-3 w-3" />
            {team.shortName} — Last {results.length}
          </p>

          {loadingResults ? (
            <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading real results…
            </div>
          ) : (
            <>
              <RecentForm results={results} />
              <p className="text-[10px] text-white/30 mt-1.5">
                {formLabel} · hover for details
              </p>
            </>
          )}
        </div>

        {/* Key insights */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
            <TrendingUp className="h-3 w-3" />
            Key Factors
          </p>
          <ul className="space-y-1.5">
            {preview.keyInsights.map((ins, i) => (
              <li key={i} className="text-[11px] text-white/55 flex items-start gap-1.5 leading-tight">
                <span
                  className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                  style={{ backgroundColor: team.primaryColor }}
                />
                {ins}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Footer: odds + add-to-calendar ── */}
      <div className="flex items-center justify-between pt-3 border-t border-white/6">
        {game.odds ? (
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/30">
              <Info className="h-3 w-3" />
              Lines
            </span>
            <span className="text-xs text-white/55">
              Spread <span className="text-white font-bold ml-1">{game.odds.spread}</span>
            </span>
            <span className="text-xs text-white/55">
              O/U <span className="text-white font-bold ml-1">{game.odds.overUnder}</span>
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-white/20">
            {game.venue || 'Venue TBC'}
          </span>
        )}

        <button
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/35 hover:text-white/70 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/8"
          onClick={e => { e.stopPropagation(); }}
          title="Add to calendar (coming soon)"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Add to calendar
        </button>
      </div>
    </div>
  );
}
