'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Zap, TrendingUp, Loader2, Newspaper,
  Users, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Team, GameResult, AIReview, MatchStats, TeamMatchStats, SportKey } from '@/types';
import { LeagueTable } from '@/components/schedule/league-table';
import type { StandingRow } from '@/components/schedule/league-table';

type ResultEntry = GameResult & { team: Team; id: string };

interface ResultExpandPanelProps {
  result: ResultEntry;
  className?: string;
}

const REAL_DATA_LEAGUES   = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);
const STATS_LEAGUES       = new Set(['nrl', 'epl', 'super_rugby', 'rugby_int']);

// ── Cache helpers ─────────────────────────────────────────────────────────────
// Both review and match-stats are immutable — no TTL needed.

const REVIEW_CACHE_KEY = (id: string) => `ai-review-v2:${id}`;
const STATS_CACHE_KEY  = (id: string) => `match-stats-v1:${id}`;

function loadJSON<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; }
  catch { return null; }
}
function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ── AI loading card ───────────────────────────────────────────────────────────

const AI_TAGLINES = [
  'Reviewing the match tape…',
  'Analysing the stats…',
  'Consulting the pundits…',
  'Checking the highlights…',
  'Reading the post-match notes…',
];

function AILoadingCard({ color }: { color: string }) {
  const [idx,     setIdx]     = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const cycle = setInterval(() => {
      setVisible(false);
      timeoutId = setTimeout(() => { setIdx(i => (i + 1) % AI_TAGLINES.length); setVisible(true); }, 300);
    }, 2400);
    return () => { clearInterval(cycle); clearTimeout(timeoutId); };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <div className="relative w-8 h-8">
        <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ backgroundColor: color }} />
        <div className="absolute inset-1 rounded-full animate-pulse" style={{ backgroundColor: color + '55' }} />
        <Newspaper className="absolute inset-0 m-auto h-4 w-4" style={{ color }} />
      </div>
      <p
        className="text-[11px] font-semibold text-white/40 tracking-wide transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {AI_TAGLINES[idx]}
      </p>
    </div>
  );
}

// ── Player stats section ──────────────────────────────────────────────────────

function PlayerStatsPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-white/6 rounded-md px-1.5 py-0.5">
      <span className="text-white/35">{label}</span>
      <span className="text-white/75 font-bold">{value}</span>
    </span>
  );
}

function TeamStatsPanel({ data, accentColor }: { data: TeamMatchStats; accentColor: string }) {
  const firstName = data.teamName.split(' ')[0];

  return (
    <div className="min-w-0">
      {/* Team name */}
      <p
        className="text-[10px] font-black uppercase tracking-widest mb-2 truncate"
        style={{ color: accentColor }}
      >
        {firstName}
      </p>

      {/* Aggregate stats — compact pill row */}
      {data.aggStats.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {data.aggStats.map((s, i) => (
            <PlayerStatsPill key={i} label={s.label} value={s.value} />
          ))}
        </div>
      )}

      {/* Player list */}
      {data.players.length > 0 ? (
        <div className="space-y-1.5">
          {data.players.map((p, i) => (
            <div key={i} className="flex items-start gap-1.5 min-w-0">
              {/* Position tag */}
              {p.position && (
                <span className="text-[9px] font-black uppercase text-white/20 w-6 shrink-0 text-right leading-[1.6] tabular-nums">
                  {p.position.slice(0, 3)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-white/70 leading-none truncate mb-0.5">{p.name}</p>
                <div className="flex flex-wrap gap-0.5">
                  {p.stats.map((s, j) => (
                    <span key={j} className="text-[9px] font-bold text-white/40 tabular-nums">
                      {s.label}:{s.value}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-white/20 italic">No player data</p>
      )}
    </div>
  );
}

interface PlayerStatsSectionProps {
  result: ResultEntry;
  primaryColor: string;
}

function PlayerStatsSection({ result, primaryColor }: PlayerStatsSectionProps) {
  const [isOpen,   setIsOpen]   = useState(false);
  const [stats,    setStats]    = useState<MatchStats | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [notFound, setNotFound] = useState(false);

  function handleToggle() {
    if (isOpen) { setIsOpen(false); return; }
    setIsOpen(true);

    // Already loaded or gave up
    if (stats || notFound) return;

    setLoading(true);
    const cached = loadJSON<MatchStats>(STATS_CACHE_KEY(result.id));
    if (cached) { setStats(cached); setLoading(false); return; }

    const params = new URLSearchParams({
      league:        result.team.league,
      teamId:        result.team.id,
      date:          result.date,
      teamScore:     String(result.teamScore),
      opponentScore: String(result.opponentScore),
    });
    if (result.competition) params.set('competition', result.competition);

    fetch(`/api/match-stats?${params}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .catch(() => null)
      .then((data: MatchStats | null) => {
        if (data) {
          setStats(data);
          saveJSON(STATS_CACHE_KEY(result.id), data);
        } else {
          setNotFound(true);
        }
      })
      .finally(() => setLoading(false));
  }

  return (
    <div className="pt-3 border-t border-white/6">
      {/* Toggle button */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/35 hover:text-white/60 transition-colors group"
      >
        <Users className="h-3 w-3" />
        Player Stats
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            isOpen ? 'rotate-180' : '',
          )}
        />
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="mt-3" style={{ animation: 'slideDown 0.18s ease-out' }}>
          {loading && (
            <div className="flex items-center gap-1.5 text-white/25 text-[11px] py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading player stats…
            </div>
          )}

          {!loading && notFound && (
            <p className="text-[11px] text-white/20 italic py-1">
              Player stats not available for this game.
            </p>
          )}

          {!loading && stats && (
            <div className="grid grid-cols-2 gap-4">
              <TeamStatsPanel
                data={stats.team}
                accentColor={primaryColor}
              />
              <TeamStatsPanel
                data={stats.opponent}
                accentColor="#6B7280"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResultExpandPanel({ result, className }: ResultExpandPanelProps) {
  const { team } = result;
  const isRealLeague  = REAL_DATA_LEAGUES.has(team.league);
  const hasStatsLeague = STATS_LEAGUES.has(team.league);

  const [aiReview,  setAiReview]  = useState<AIReview | null>(null);
  const [aiLoading, setAiLoading] = useState(isRealLeague);
  const [standings, setStandings] = useState<StandingRow[] | null>(null);
  const hasCachedReviewRef = useRef(false);

  // ── Immediate cache read on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!isRealLeague) { setAiLoading(false); return; }
    const cached = loadJSON<AIReview>(REVIEW_CACHE_KEY(result.id));
    if (cached) { setAiReview(cached); setAiLoading(false); hasCachedReviewRef.current = true; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch standings + generate AI review ──────────────────────────────────
  useEffect(() => {
    if (!isRealLeague) return;

    fetch(`/api/standings?league=${team.league}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((rows: StandingRow[] | null) => {
        if (Array.isArray(rows) && rows.length > 0) setStandings(rows);

        if (hasCachedReviewRef.current) { setAiLoading(false); return; }

        const teamRow = rows?.find(r => r.teamId === team.id);
        const oppRow  = rows?.find(r => r.name?.toLowerCase().includes(result.opponent.toLowerCase().slice(0, 6)));

        fetch('/api/ai-review', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId:           result.id,
            league:           team.league,
            teamName:         team.name,
            opponent:         result.opponent,
            teamScore:        result.teamScore,
            opponentScore:    result.opponentScore,
            isHome:           result.isHome,
            date:             result.date,
            competition:      result.competition,
            teamPosition:     teamRow?.position,
            teamPlayed:       teamRow?.played,
            opponentPosition: oppRow?.position,
            opponentPlayed:   oppRow?.played,
          }),
        })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
          .then((review: AIReview | null) => {
            if (review) {
              setAiReview(review);
              saveJSON(REVIEW_CACHE_KEY(result.id), review);
            }
          })
          .finally(() => setAiLoading(false));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id, team.league, team.id]);

  const followedTeamIdsSet = useMemo(() => new Set([team.id]), [team.id]);

  const outcomeColor = result.isDraw
    ? '#f59e0b'
    : result.isWin
      ? '#34d399'
      : '#f87171';

  return (
    <div
      className={cn('border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 space-y-5 rounded-b-2xl', className)}
      style={{ animation: 'slideDown 0.22s ease-out' }}
    >
      {/* ── AI loading ── */}
      {aiLoading && isRealLeague && (
        <AILoadingCard color={team.primaryColor} />
      )}

      {/* ── Match Review ── */}
      {!aiLoading && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
            <Zap className="h-3 w-3" style={{ color: team.primaryColor }} />
            Match Review
          </p>
          {aiReview?.summary ? (
            <p className="text-sm text-white/65 leading-relaxed">{aiReview.summary}</p>
          ) : (
            <p className="text-sm text-white/35 italic leading-relaxed">
              {result.isWin
                ? `${team.shortName} won ${result.teamScore}–${result.opponentScore} ${result.isHome ? 'at home' : 'away'}.`
                : result.isDraw
                  ? `${team.shortName} drew ${result.teamScore}–${result.opponentScore}.`
                  : `${team.shortName} lost ${result.teamScore}–${result.opponentScore}.`
              }
            </p>
          )}
        </div>
      )}

      {/* ── Key Factors ── */}
      {!aiLoading && aiReview?.keyMoments && aiReview.keyMoments.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
            <Zap className="h-3 w-3" style={{ color: team.primaryColor }} />
            Key Factors
          </p>
          <ul className="space-y-1.5">
            {aiReview.keyMoments.map((m, i) => (
              <li key={i} className="text-[12px] text-white/65 flex items-start gap-2 leading-snug">
                <span
                  className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                  style={{ backgroundColor: outcomeColor }}
                />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Going Forward ── */}
      {!aiLoading && aiReview?.verdict && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3 w-3" />
            Going Forward
          </p>
          <p className="text-[11px] text-white/55 leading-relaxed">{aiReview.verdict}</p>
        </div>
      )}

      {/* ── League Table ── */}
      {standings && standings.length > 0 && (
        <LeagueTable
          league={team.league as SportKey}
          rows={standings}
          followedTeamIds={followedTeamIdsSet}
        />
      )}

      {/* ── Player Stats (collapsible) ── */}
      {hasStatsLeague && (
        <PlayerStatsSection result={result} primaryColor={team.primaryColor} />
      )}
    </div>
  );
}
