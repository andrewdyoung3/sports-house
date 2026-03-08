'use client';

import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Zap, CalendarPlus, Info, Loader2, Newspaper, BarChart2 } from 'lucide-react';
import { getAIPreview, getRecentResults } from '@/lib/mock-data';
import { RecentForm } from '@/components/dashboard/recent-form';
import { cn, ordinal } from '@/lib/utils';
import type { Team, UpcomingGame, GameResult, PreviewContext, TeamStanding } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface GameExpandPanelProps {
  game: ScheduleEntry;
  /** Override outer div className (e.g. to change bottom border-radius). */
  className?: string;
}

/** Leagues with a real /api/results + /api/preview backend. */
const REAL_DATA_LEAGUES = new Set(['afl', 'epl', 'nrl']);

// ── Standings row ─────────────────────────────────────────────────────────────

function StandingRow({
  standing,
  color,
  label,
}: {
  standing: TeamStanding;
  color: string;
  label: string;
}) {
  const record =
    standing.draws > 0
      ? `${standing.wins}W ${standing.draws}D ${standing.losses}L`
      : `${standing.wins}W ${standing.losses}L`;

  const statLine =
    standing.points !== undefined
      ? `${standing.points} pts · F ${standing.goalsFor ?? '—'} A ${standing.goalsAgainst ?? '—'}`
      : standing.percentage !== undefined
        ? `${standing.percentage.toFixed(1)}%`
        : '';

  return (
    <div className="flex items-start gap-2.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
        style={{ background: color + '33', color, border: `1px solid ${color}55` }}
      >
        {standing.position}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-white/80 leading-none truncate">{label}</p>
        <p className="text-[10px] text-white/45 mt-0.5 leading-none">{record} · {standing.played} played</p>
        {statLine && <p className="text-[10px] text-white/30 mt-0.5 leading-none">{statLine}</p>}
      </div>
    </div>
  );
}

// ── News pill ─────────────────────────────────────────────────────────────────

function NewsItem({
  headline,
  description,
  published,
}: {
  headline: string;
  description?: string;
  published?: string;
}) {
  const age = published
    ? (() => {
        const h = Math.floor((Date.now() - new Date(published).getTime()) / 3_600_000);
        return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
      })()
    : '';

  return (
    <li className="text-[11px] leading-tight">
      <p className="text-white/65 font-semibold">{headline}</p>
      {description && <p className="text-white/35 mt-0.5 line-clamp-2">{description}</p>}
      {age && <p className="text-white/20 mt-0.5">{age}</p>}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GameExpandPanel({ game, className }: GameExpandPanelProps) {
  const { team } = game;

  const [results,  setResults]  = useState<GameResult[]>(() => getRecentResults(team, 5));
  const [context,  setContext]  = useState<PreviewContext | null>(null);
  const [loading,  setLoading]  = useState(REAL_DATA_LEAGUES.has(team.league));

  useEffect(() => {
    if (!REAL_DATA_LEAGUES.has(team.league)) return;

    const resultsUrl = `/api/results?league=${team.league}&teamId=${team.id}`;
    const previewUrl = `/api/preview?league=${team.league}&teamId=${team.id}&opponentName=${encodeURIComponent(game.opponent)}&gameId=${encodeURIComponent(game.id)}`;

    Promise.all([
      fetch(resultsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(previewUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([resultsData, ctxData]: [GameResult[] | null, PreviewContext | null]) => {
      if (Array.isArray(resultsData) && resultsData.length > 0) setResults(resultsData);
      if (ctxData && typeof ctxData === 'object') setContext(ctxData);
    }).finally(() => setLoading(false));
  }, [team.id, team.league, game.id, game.opponent]);

  const wins   = results.filter(r => r.isWin).length;
  const draws  = results.filter(r => r.isDraw).length;
  const preview = getAIPreview(team, game.opponent, results, context);

  const formLabel = draws > 0
    ? `${wins}W ${draws}D ${results.length - wins - draws}L`
    : `${wins}/${results.length} wins`;

  const hasStandings = context?.teamStanding || context?.opponentStanding;
  const hasNews = (context?.teamNews?.length ?? 0) > 0 || (context?.opponentNews?.length ?? 0) > 0;
  const hasTips = !!context?.tips;

  return (
    <div
      className={cn('border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 space-y-5 rounded-b-2xl', className)}
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

      {/* ── Form + Standings / Key Factors ── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Recent form */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
            <Trophy className="h-3 w-3" />
            {team.shortName} — Last {results.length}
          </p>

          {loading ? (
            <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading results…
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

        {/* Standings comparison OR key insights fallback */}
        <div>
          {loading ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
                <BarChart2 className="h-3 w-3" />
                Ladder
              </p>
              <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading standings…
              </div>
            </>
          ) : hasStandings ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
                <BarChart2 className="h-3 w-3" />
                Ladder
              </p>
              <div className="space-y-3">
                {context?.teamStanding && (
                  <StandingRow
                    standing={context.teamStanding}
                    color={team.primaryColor}
                    label={team.shortName}
                  />
                )}
                {context?.opponentStanding && (
                  <StandingRow
                    standing={context.opponentStanding}
                    color="#9CA3AF"
                    label={game.opponent}
                  />
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* ── Team News ── (EPL only, when available) */}
      {!loading && hasNews && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
            <Newspaper className="h-3 w-3" />
            Team News
          </p>
          <div className="grid grid-cols-2 gap-5">
            {/* Followed team news */}
            <div>
              {(context?.teamNews?.length ?? 0) > 0 ? (
                <>
                  <p className="text-[10px] text-white/30 mb-1.5 font-semibold">{team.shortName}</p>
                  <ul className="space-y-2">
                    {context!.teamNews!.slice(0, 2).map((n, i) => (
                      <NewsItem key={i} {...n} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[10px] text-white/20">No recent news</p>
              )}
            </div>
            {/* Opponent news */}
            <div>
              {(context?.opponentNews?.length ?? 0) > 0 ? (
                <>
                  <p className="text-[10px] text-white/30 mb-1.5 font-semibold">{game.opponent}</p>
                  <ul className="space-y-2">
                    {context!.opponentNews!.slice(0, 2).map((n, i) => (
                      <NewsItem key={i} {...n} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[10px] text-white/20">No recent news</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AFL Model Tips ── */}
      {!loading && hasTips && context?.tips && (
        <div className="bg-white/4 rounded-xl px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
              Squiggle Models
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-white/80">{context.tips.favouriteTeam}</p>
            <p className="text-[10px] text-white/35">
              {context.tips.tipsFor}/{context.tips.tipsTotal} tips · avg {context.tips.avgMargin} pt margin
            </p>
          </div>
        </div>
      )}

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
