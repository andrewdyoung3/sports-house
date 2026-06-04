'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Zap, TrendingUp, Loader2, Newspaper,
  Users, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ensureSession } from '@/lib/user-prefs';
import type { Team, GameResult, AIReview, MatchStats, TeamMatchStats, SportKey, StandingRow } from '@/types';
import { LeagueTableSh } from '@/components/schedule/league-table-sh';

type ResultEntry = GameResult & { team: Team; id: string };

interface ResultExpandPanelProps {
  result: ResultEntry;
  className?: string;
  /** Closes the panel via the parent's existing expand toggle (drives the collapse pill). */
  onCollapse?: () => void;
}

const REAL_DATA_LEAGUES   = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);
const STATS_LEAGUES       = new Set(['nrl', 'epl', 'super_rugby', 'rugby_int']);

// ── Cache helpers ─────────────────────────────────────────────────────────────

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
        className="text-[11px] font-semibold tracking-wide transition-opacity duration-300"
        style={{ color: 'var(--text-3)', opacity: visible ? 1 : 0 }}
      >
        {AI_TAGLINES[idx]}
      </p>
    </div>
  );
}

// ── Player stats section ──────────────────────────────────────────────────────

function PlayerStatsPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-1.5 py-0.5"
      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
    >
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

function TeamStatsPanel({ data, accentColor }: { data: TeamMatchStats; accentColor: string }) {
  const firstName = data.teamName.split(' ')[0];

  return (
    <div className="min-w-0">
      <p
        className="text-[10px] font-black uppercase tracking-widest mb-2 truncate"
        style={{ color: accentColor }}
      >
        {firstName}
      </p>

      {data.aggStats.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {data.aggStats.map((s, i) => (
            <PlayerStatsPill key={i} label={s.label} value={s.value} />
          ))}
        </div>
      )}

      {data.players.length > 0 ? (
        <div className="space-y-1.5">
          {data.players.map((p, i) => (
            <div key={i} className="flex items-start gap-1.5 min-w-0">
              {p.position && (
                <span
                  className="text-[9px] font-black uppercase w-6 shrink-0 text-right leading-[1.6] tabular-nums"
                  style={{ color: 'var(--text-3)' }}
                >
                  {p.position.slice(0, 3)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold leading-none truncate mb-0.5" style={{ color: 'var(--text-2)' }}>
                  {p.name}
                </p>
                <div className="flex flex-wrap gap-0.5">
                  {p.stats.map((s, j) => (
                    <span key={j} className="text-[9px] font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>
                      {s.label}:{s.value}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] italic" style={{ color: 'var(--text-3)' }}>No player data</p>
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
    // Step 8b — reskinned to .sh-detail-section; toggle button adopts .sh-detail-head
    // styling with a trailing chevron, matching the panel's section vocabulary.
    <div className="sh-detail-section">
      <button
        onClick={handleToggle}
        className="sh-detail-head w-full cursor-pointer"
        style={{ marginBottom: isOpen ? 12 : 0 }}
      >
        <Users className="sh-icon h-[13px] w-[13px]" />
        Player Stats
        <ChevronDown
          className={cn('h-3 w-3 ml-auto transition-transform duration-200', isOpen ? 'rotate-180' : '')}
          style={{ color: 'var(--text-3)' }}
        />
      </button>

      {isOpen && (
        <div style={{ animation: 'slideDown 0.18s ease-out' }}>
          {loading && (
            <div className="flex items-center gap-1.5 text-[11px] py-2" style={{ color: 'var(--text-3)' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading player stats…
            </div>
          )}

          {!loading && notFound && (
            <p className="text-[11px] italic py-1" style={{ color: 'var(--text-3)' }}>
              Player stats not available for this game.
            </p>
          )}

          {!loading && stats && (
            <div className="grid grid-cols-2 gap-4">
              <TeamStatsPanel data={stats.team}     accentColor={primaryColor} />
              <TeamStatsPanel data={stats.opponent} accentColor="#6B7280" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResultExpandPanel({ result, className, onCollapse }: ResultExpandPanelProps) {
  const { team } = result;
  const isRealLeague   = REAL_DATA_LEAGUES.has(team.league);
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
      .then(async (rows: StandingRow[] | null) => {
        if (Array.isArray(rows) && rows.length > 0) setStandings(rows);

        if (hasCachedReviewRef.current) { setAiLoading(false); return; }

        const teamRow = rows?.find(r => r.teamId === team.id);
        const oppRow  = rows?.find(r => r.name?.toLowerCase().includes(result.opponent.toLowerCase().slice(0, 6)));

        await ensureSession();
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

  return (
    // Step 8b — sh-theme + --accent so the .sh-detail-* tokens resolve against this
    // panel's feature team (it renders as a sibling of the result row, outside any
    // team-coloured ancestor). Pattern mirrors game-expand-panel (two-team path).
    <div
      className={cn('sh-theme border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 space-y-5 rounded-b-2xl', className)}
      style={{ animation: 'slideDown 0.22s ease-out', '--accent': team.primaryColor } as React.CSSProperties}
    >
      {/* ── Collapse pill — wired to the results page toggle (when provided) ── */}
      {onCollapse && (
        <button
          type="button"
          className="sh-detail-collapse"
          onClick={e => { e.stopPropagation(); onCollapse(); }}
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Collapse
        </button>
      )}

      {/* ── AI loading card ── */}
      {aiLoading && isRealLeague && (
        <AILoadingCard color={team.primaryColor} />
      )}

      {/* ── Match Report (summary + fallback) ── */}
      {!aiLoading && (
        <div>
          <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Match Report</div>
          {aiReview?.summary ? (
            <p className="sh-detail-body">{aiReview.summary}</p>
          ) : (
            <p className="sh-detail-body" style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>
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

      {/* ── Key Factors → Quick Take bullets ── */}
      {!aiLoading && aiReview?.keyMoments && aiReview.keyMoments.length > 0 && (
        <div>
          <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Key Factors</div>
          <ul className="sh-quick-list">
            {aiReview.keyMoments.map((m, i) => (
              <li key={i} className="sh-quick-bullet"><span className="sh-quick-dot" />{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Going Forward → .sh-verdict blockquote ── */}
      {!aiLoading && aiReview?.verdict && (
        <blockquote className="sh-verdict">
          <span className="sh-verdict-label">
            <TrendingUp className="sh-icon h-[11px] w-[11px]" />Going Forward
          </span>
          {aiReview.verdict}
        </blockquote>
      )}

      {/* ── League Table — swapped to LeagueTableSh (shared LeagueTable untouched) ── */}
      {standings && standings.length > 0 && (
        <LeagueTableSh
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
