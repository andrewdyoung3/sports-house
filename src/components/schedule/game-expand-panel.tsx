'use client';

import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Zap, CalendarPlus, Info, Loader2, Newspaper, BarChart2, Shield, User, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { getAIPreview, getRecentResults } from '@/lib/mock-data';
import { LeagueTable } from '@/components/schedule/league-table';
import type { StandingRow } from '@/components/schedule/league-table';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { cn, ordinal } from '@/lib/utils';
import type { Team, UpcomingGame, GameResult, PreviewContext, TeamStanding, AIPreview, SportKey } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface GameExpandPanelProps {
  game: ScheduleEntry;
  /** Override outer div className (e.g. to change bottom border-radius). */
  className?: string;
}

/** Leagues with a real /api/results + /api/preview backend. */
const REAL_DATA_LEAGUES = new Set(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int']);

// ── Client-side AI preview cache ──────────────────────────────────────────────
// Persists results in localStorage for 6 hours so closing/reopening a card
// or refreshing the page doesn't re-call Claude.

const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Generate AI previews only for fixtures within this many days.
 *  Too far out and form, injuries, and selection are all unknowns. */
const AI_PREVIEW_DAYS = 14;

function loadCachedPreview(gameId: string): AIPreview | null {
  try {
    const raw = localStorage.getItem(`ai-preview:${gameId}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: AIPreview; ts: number };
    if (Date.now() - ts > AI_CACHE_TTL_MS) {
      localStorage.removeItem(`ai-preview:${gameId}`);
      return null;
    }
    return data;
  } catch {
    return null; // localStorage unavailable (SSR or private mode)
  }
}

function saveCachedPreview(gameId: string, preview: AIPreview): void {
  try {
    localStorage.setItem(`ai-preview:${gameId}`, JSON.stringify({ data: preview, ts: Date.now() }));
  } catch {
    // Storage full or unavailable — fail silently
  }
}

// ── Standings row ─────────────────────────────────────────────────────────────

function StandingRow({
  standing,
  color,
  label,
  trend,
}: {
  standing: TeamStanding;
  color: string;
  label: string;
  trend?: 'up' | 'down' | 'same' | null;
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
      {/* Position circle with last-result trend badge */}
      <div className="relative shrink-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black"
          style={{ background: color + '33', color, border: `1px solid ${color}55` }}
        >
          {standing.position}
        </div>
        {trend && (
          <div className="absolute -bottom-0.5 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center bg-black/70">
            {trend === 'up'   && <ArrowUp   className="h-2.5 w-2.5 text-emerald-400" />}
            {trend === 'down' && <ArrowDown className="h-2.5 w-2.5 text-red-400" />}
            {trend === 'same' && <Minus     className="h-2.5 w-2.5 text-amber-400" />}
          </div>
        )}
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

// ── Compact form (W/D/L circles) ──────────────────────────────────────────────

function CompactForm({ results }: { results: GameResult[] }) {
  if (results.length === 0) {
    return <p className="text-[10px] text-white/25 italic">No results yet</p>;
  }
  return (
    <div className="flex gap-1 flex-wrap">
      {results.map((r, i) => {
        const isDraw   = r.isDraw === true;
        const outcome  = isDraw ? 'D' : r.isWin ? 'W' : 'L';
        const badgeCls = isDraw
          ? 'bg-amber-400/20 text-amber-300 border border-amber-600/30'
          : r.isWin
            ? 'bg-emerald-400/20 text-emerald-400 border border-emerald-600/30'
            : 'bg-red-400/20 text-red-400 border border-red-700/30';
        return (
          <span key={i} className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0', badgeCls)}>
            {outcome}
          </span>
        );
      })}
    </div>
  );
}

// ── Team logo thumbnail ────────────────────────────────────────────────────────

function LogoThumb({ src, abbr }: { src?: string; abbr: string }) {
  return (
    <div className="w-4 h-4 rounded-sm overflow-hidden bg-white/5 shrink-0 flex items-center justify-center">
      {src
        ? <img src={src} alt="" className="w-full h-full object-contain" />
        : <span className="text-[7px] font-bold text-white/40">{abbr.slice(0, 2)}</span>
      }
    </div>
  );
}

// ── Trend helper ──────────────────────────────────────────────────────────────

/** Derives position-change trend from the full standings array for a given teamId.
 *  Returns null when: no standings loaded, team not found, or no rankChange data. */
function getTrend(
  standings: StandingRow[] | null,
  teamId: string | undefined,
): 'up' | 'down' | 'same' | null {
  if (!standings || !teamId) return null;
  const row = standings.find(s => s.teamId === teamId);
  if (!row || row.rankChange === undefined) return null;
  if (row.rankChange > 0) return 'up';
  if (row.rankChange < 0) return 'down';
  return 'same';
}

// ── Main component ────────────────────────────────────────────────────────────

export function GameExpandPanel({ game, className }: GameExpandPanelProps) {
  const { team } = game;

  // AI only makes sense for imminent fixtures — too much changes further out.
  const daysUntilGame = (new Date(game.date).getTime() - Date.now()) / 86_400_000;
  const aiEnabled     = REAL_DATA_LEAGUES.has(team.league) && daysUntilGame <= AI_PREVIEW_DAYS;

  const [results,    setResults]    = useState<GameResult[]>(() => getRecentResults(team, 5));
  const [oppResults, setOppResults] = useState<GameResult[]>(() =>
    getRecentResults({ id: `opp-${game.opponentAbbr}`, league: team.league } as Team, 5),
  );
  const [context,   setContext]   = useState<PreviewContext | null>(null);
  const [standings, setStandings] = useState<StandingRow[] | null>(null);
  const [loading,   setLoading]   = useState(REAL_DATA_LEAGUES.has(team.league));
  const [aiPreview, setAiPreview] = useState<AIPreview | null>(
    () => aiEnabled ? loadCachedPreview(game.id) : null,
  );
  const [aiLoading, setAiLoading] = useState<boolean>(
    () => aiEnabled && loadCachedPreview(game.id) === null,
  );

  useEffect(() => {
    if (!REAL_DATA_LEAGUES.has(team.league)) return;

    const resultsUrl  = `/api/results?league=${team.league}&teamId=${team.id}`;
    const previewUrl  = `/api/preview?league=${team.league}&teamId=${team.id}&opponentName=${encodeURIComponent(game.opponent)}&gameId=${encodeURIComponent(game.id)}`;
    const standingsUrl = `/api/standings?league=${team.league}`;
    const oppUrl      = game.opponentId
      ? `/api/results?league=${team.league}&teamId=${game.opponentId}`
      : null;

    Promise.all([
      fetch(resultsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(previewUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      oppUrl ? fetch(oppUrl).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      fetch(standingsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([resultsData, ctxData, oppData, standingsData]: [GameResult[] | null, PreviewContext | null, GameResult[] | null, StandingRow[] | null]) => {
      // Capture live values before state updates (for the chained AI call)
      const liveResults    = Array.isArray(resultsData) && resultsData.length > 0 ? resultsData : results;
      const liveOppResults = Array.isArray(oppData)     && oppData.length > 0     ? oppData     : oppResults;
      const liveContext    = ctxData && typeof ctxData === 'object'                ? ctxData     : {};

      if (Array.isArray(resultsData)  && resultsData.length > 0)  setResults(resultsData);
      if (ctxData && typeof ctxData === 'object')                  setContext(ctxData);
      if (Array.isArray(oppData)      && oppData.length > 0)       setOppResults(oppData);
      if (Array.isArray(standingsData) && standingsData.length > 0) setStandings(standingsData);
      setLoading(false);

      // Don't generate AI previews for distant fixtures — too much can change.
      if (!aiEnabled) {
        setAiLoading(false);
        return;
      }

      // Check localStorage before hitting the API — avoids any Claude call if
      // the same fixture was already previewed within the last 6 hours.
      const cached = loadCachedPreview(game.id);
      if (cached) {
        setAiPreview(cached);
        setAiLoading(false);
        return;
      }

      // Cache miss — call Claude, then persist the result locally.
      fetch('/api/ai-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league:       team.league,
          teamId:       team.id,
          teamName:     team.name,
          opponentName: game.opponent,
          gameId:       game.id,
          competition:  game.competition,
          context:      liveContext,
          teamResults:  liveResults,
          oppResults:   liveOppResults,
        }),
      })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then((aiData: AIPreview | null) => {
          if (aiData) {
            setAiPreview(aiData);
            saveCachedPreview(game.id, aiData);
          }
        })
        .finally(() => setAiLoading(false));
    }).catch(() => {
      setLoading(false);
      setAiLoading(false);
    });
  }, [team.id, team.league, game.id, game.opponent, game.opponentId]);

  const wins   = results.filter(r => r.isWin).length;
  const draws  = results.filter(r => r.isDraw).length;
  const preview = getAIPreview(team, game.opponent, results, context);

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
        {aiLoading ? (
          <div className="space-y-1.5 animate-pulse">
            <div className="h-2.5 bg-white/8 rounded w-full" />
            <div className="h-2.5 bg-white/8 rounded w-11/12" />
            <div className="h-2.5 bg-white/8 rounded w-4/5" />
          </div>
        ) : (
          <p className="text-sm text-white/65 leading-relaxed">
            {aiPreview?.context ?? preview.content}
          </p>
        )}
      </div>

      {/* ── Tactical Battle (AI only) ── */}
      {!aiLoading && aiPreview && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
            <Shield className="h-3 w-3" style={{ color: team.primaryColor }} />
            Tactical Battle
          </p>
          <p className="text-sm text-white/65 leading-relaxed">{aiPreview.tacticalBattle}</p>
        </div>
      )}

      {/* ── Form + Standings / Key Factors ── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Recent form — both teams */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2.5">
            <Trophy className="h-3 w-3" />
            Recent Form
          </p>

          {loading ? (
            <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading results…
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <LogoThumb src={TEAM_LOGOS[team.id]} abbr={team.abbreviation} />
                  <span className="text-[10px] text-white/50 font-semibold truncate">{team.shortName}</span>
                </div>
                <CompactForm results={results} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <LogoThumb src={game.opponentLogoUrl} abbr={game.opponentAbbr} />
                  <span className="text-[10px] text-white/50 font-semibold truncate" title={game.opponent}>
                    {game.opponent}
                  </span>
                </div>
                <CompactForm results={oppResults} />
              </div>
            </div>
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
                    trend={!game.competition ? getTrend(standings, team.id) : null}
                  />
                )}
                {context?.opponentStanding && (
                  <StandingRow
                    standing={context.opponentStanding}
                    color="#9CA3AF"
                    label={game.opponent}
                    trend={!game.competition ? getTrend(standings, game.opponentId) : null}
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
                {(aiPreview?.keyInsights ?? preview.keyInsights).map((ins, i) => (
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

      {/* ── Full league table ── */}
      {!loading && standings && (
        <LeagueTable
          league={team.league as SportKey}
          rows={standings}
          followedTeamIds={new Set([team.id, ...(game.opponentId ? [game.opponentId] : [])])}
        />
      )}

      {/* ── Player Spotlight + Verdict (AI only) ── */}
      {!aiLoading && aiPreview && (
        <div className="grid grid-cols-2 gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
              <User className="h-3 w-3" />
              Spotlight
            </p>
            <p className="text-[11px] text-white/55 leading-relaxed">{aiPreview.playerSpotlight}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3 w-3" />
              Verdict
            </p>
            <p className="text-[11px] text-white/55 leading-relaxed">{aiPreview.verdict}</p>
          </div>
        </div>
      )}

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
