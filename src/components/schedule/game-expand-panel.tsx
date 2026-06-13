'use client';

import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Zap, CalendarPlus, Info, Loader2, Newspaper, BarChart2, Shield, User, ArrowUp, ArrowDown, Cloud, ChevronUp, MapPin, Flag } from 'lucide-react';
// mock-data intentionally NOT imported — this component never shows mock results.
import { LeagueTableSh } from '@/components/schedule/league-table-sh';
import type { StandingRow } from '@/types';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { REAL_DATA_LEAGUES } from '@/lib/teams';
import { F1_CIRCUITS, isF1ConstructorTeam, getF1ConstructorName, F1_DRIVER_IDS } from '@/lib/f1-data';
import { F1StartingGrid } from '@/components/schedule/f1-starting-grid';
import { cn, ordinal } from '@/lib/utils';
import { ensureSession } from '@/lib/user-prefs';
import type { Team, UpcomingGame, GameResult, PreviewContext, TeamStanding, AIPreview, WeatherData } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface GameExpandPanelProps {
  game: ScheduleEntry;
  /** Override outer div className (e.g. to change bottom border-radius). */
  className?: string;
  /**
   * Compact mode — used in league-browse view.
   * Requests shorter AI output and hides detailed sections (tactical, spotlight, verdict, news).
   */
  compact?: boolean;
  /** Called with fresh standings whenever the panel fetches them — lets the parent keep its sidebar in sync. */
  onStandingsUpdate?: (rows: StandingRow[]) => void;
  /** Closes the panel via the parent's EXISTING expand toggle (drives the collapse pill).
   *  Optional — when absent (e.g. the F1 hero), the collapse pill is not shown. */
  onCollapse?: () => void;
}

const STANDINGS_ONLY_LEAGUES = new Set(['nhl']);
/** Outdoor sports where weather affects play. */
const OUTDOOR_SPORTS       = new Set(['afl', 'nrl', 'epl', 'super_rugby', 'rugby_int']);

// ── Panel data cache ───────────────────────────────────────────────────────────
// Backed by sessionStorage so it survives navigation (dashboard ↔ schedule).
// In-memory Map is the fast path; sessionStorage is read once on module load
// to seed it, then written on every set().
//
// TTL: entries older than 5 minutes are evicted on read to prevent stale data.

interface PanelData {
  results:    GameResult[];
  oppResults: GameResult[];
  context:    PreviewContext;
  standings:  StandingRow[] | null;
  /** Unix ms — used to evict stale entries. */
  cachedAt:   number;
}

const PANEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches API Cache-Control
const PANEL_SESSION_KEY  = 'panel-data-cache-v4';

/** Seed the in-memory map from sessionStorage (lazy — only parsed on first access). */
function loadPanelSessionCache(): Map<string, PanelData> {
  const map = new Map<string, PanelData>();
  try {
    const raw = sessionStorage.getItem(PANEL_SESSION_KEY);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Record<string, PanelData>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(parsed)) {
      if (now - (entry.cachedAt ?? 0) < PANEL_CACHE_TTL_MS) map.set(id, entry);
    }
  } catch { /* sessionStorage unavailable (SSR guard) or corrupt */ }
  return map;
}

let _panelDataCache: Map<string, PanelData> | null = null;
function panelCache(): Map<string, PanelData> {
  if (!_panelDataCache) _panelDataCache = loadPanelSessionCache();
  return _panelDataCache;
}

function setPanelCache(gameId: string, data: PanelData): void {
  const cache = panelCache();
  cache.set(gameId, data);
  try {
    const obj: Record<string, PanelData> = {};
    cache.forEach((v, k) => { obj[k] = v; });
    sessionStorage.setItem(PANEL_SESSION_KEY, JSON.stringify(obj));
  } catch { /* quota exceeded or SSR */ }
}

function getPanelCache(gameId: string): PanelData | undefined {
  const cache = panelCache();
  const entry = cache.get(gameId);
  if (!entry) return undefined;
  if (Date.now() - (entry.cachedAt ?? 0) >= PANEL_CACHE_TTL_MS) {
    cache.delete(gameId);
    return undefined;
  }
  return entry;
}

// ── Client-side AI preview cache ──────────────────────────────────────────────
// v2: fingerprint-based cache keyed by news content, not time.
// • Immutable context (fixture, standings, form) is stored permanently.
// • Adaptable context (team news, injuries, statements) drives incremental updates.
// • When news is unchanged the cached preview loads instantly with zero API calls.
// • When news changes the old preview is shown immediately while Claude updates
//   it silently in the background — no blank loading state after the first visit.

const PREVIEW_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // evict after 14 days

interface PreviewCache {
  preview: AIPreview;
  /** Sorted hash of news headlines — change triggers a background update. */
  newsFingerprint: string;
  /** When the preview was first generated (for age-based eviction). */
  generatedAt: number;
}

/**
 * Fingerprint the adaptable context so we can detect changes that warrant
 * a background AI re-generation.
 * Covers: news headlines (injury/squad news) + recent form results (scores).
 * A change in either will trigger a silent background update.
 */
function buildFingerprint(
  teamNews:   { headline: string }[] | undefined,
  oppNews:    { headline: string }[] | undefined,
  teamResults: GameResult[],
  oppResults:  GameResult[],
  weather?:    WeatherData | null,
  context?:    PreviewContext | null,
): string {
  const headlines = [
    ...(teamNews ?? []).map(n => n.headline),
    ...(oppNews  ?? []).map(n => n.headline),
  ].sort();
  const formStr = (rs: GameResult[]) =>
    rs.slice(0, 3).map(r => `${r.opponent}:${r.teamScore}-${r.opponentScore}`).join(',');
  // Include weather condition bucket so a change in conditions triggers re-generation
  const weatherKey = weather?.isNotable
    ? `${weather.condition}:${Math.round(weather.windKmh / 15)}:${Math.round(weather.precipMm)}`
    : 'clear';
  // Include squad and injury data — when squads are released or injury status changes, regenerate
  const squadKey = [
    ...(context?.teamSquad ?? []),
    ...(context?.opponentSquad ?? []),
  ].sort().join(',').slice(0, 60);
  const injuryKey = [
    ...(context?.teamInjuryReport ?? []).map(i => `${i.name}:${i.status}`),
    ...(context?.opponentInjuryReport ?? []).map(i => `${i.name}:${i.status}`),
  ].sort().join(',').slice(0, 60);
  const parts = [...headlines, formStr(teamResults), formStr(oppResults), weatherKey, squadKey, injuryKey].join('\x00');
  try { return btoa(encodeURIComponent(parts)).slice(0, 48); }
  catch { return parts.slice(0, 48); }
}

// v45: competition-structure FIXTURE CONTEXT block; bumped to evict stale previews.
const CACHE_KEY = (gameId: string) => `ai-preview-v45:${gameId}`;

function loadPreviewCache(gameId: string): PreviewCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(gameId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PreviewCache;
    if (Date.now() - entry.generatedAt > PREVIEW_MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY(gameId));
      return null;
    }
    return entry;
  } catch { return null; }
}

function savePreviewCache(gameId: string, entry: PreviewCache): void {
  try {
    localStorage.setItem(CACHE_KEY(gameId), JSON.stringify(entry));
  } catch { /* storage full — fail silently */ }
}

/** Generate AI previews only for fixtures within this many days.
 *  Too far out and form, injuries, and selection are all unknowns. */
const AI_PREVIEW_DAYS = 14;

// ── Standings row ─────────────────────────────────────────────────────────────

function StandingRow({
  standing,
  label,
  trend,
}: {
  standing: TeamStanding;
  color?: string;
  label: string;
  trend?: 'up' | 'down' | 'same' | null;
}) {
  const record =
    standing.draws > 0
      ? `${standing.wins}W ${standing.draws}D ${standing.losses}L`
      : `${standing.wins}W ${standing.losses}L`;

  // Compact points/percentage label for the mini-ladder row (drop the verbose F/A line).
  const ptsLabel =
    standing.points !== undefined
      ? `${standing.points} pts`
      : standing.percentage !== undefined
        ? `${standing.percentage.toFixed(1)}%`
        : '';

  return (
    <div className="sh-detail-ladder-row">
      <span className="sh-l-pos">{standing.position}</span>
      {trend === 'up'   && <ArrowUp   className="h-3 w-3 text-emerald-400 shrink-0" />}
      {trend === 'down' && <ArrowDown className="h-3 w-3 text-red-400 shrink-0" />}
      <span className="sh-l-name" title={label}>{label}</span>
      <span className="sh-l-record">{record}</span>
      {ptsLabel && <span className="sh-l-pts">{ptsLabel}</span>}
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
  // Oldest game on the LEFT, most recent on the RIGHT.
  const ordered = [...results].reverse();
  const lastIdx = ordered.length - 1;
  return (
    <div className="flex gap-1 flex-wrap">
      {ordered.map((r, i) => {
        const isDraw   = r.isDraw === true;
        const outcome  = isDraw ? 'D' : r.isWin ? 'W' : 'L';
        const isLatest = i === lastIdx;
        const scoreCls = isDraw ? 'text-amber-300' : r.isWin ? 'text-emerald-400' : 'text-red-400';
        const scoreStr = isDraw
          ? `D ${r.teamScore}–${r.opponentScore}`
          : `${r.isWin ? 'W' : 'L'} ${r.teamScore}–${r.opponentScore}`;
        return (
          <div key={i} className="relative group shrink-0">
            {/* W / D / L pip (design vocabulary; draw keeps an amber tint) */}
            <span
              className={cn(
                'sh-pip',
                isDraw ? 'is-d' : r.isWin ? 'is-w' : 'is-l',
                isLatest && 'ring-1 ring-white/25 ring-offset-1 ring-offset-black/60',
              )}
            >
              {outcome}
            </span>
            {/* Hover tooltip */}
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[10px] whitespace-nowrap shadow-xl">
                <p className="text-zinc-200 font-bold leading-none mb-0.5">{r.opponent}</p>
                <p className={cn('font-black leading-none', scoreCls)}>{scoreStr}</p>
                <p className="text-zinc-500 mt-0.5 leading-none">
                  {r.isHome ? 'Home' : 'Away'}
                  {r.competition ? ` · ${r.competition}` : ''}
                </p>
              </div>
              <div className="w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 mx-auto -mt-1" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Team logo thumbnail ────────────────────────────────────────────────────────

function LogoThumb({ src, abbr }: { src?: string; abbr: string }) {
  return (
    <div className="w-6 h-6 rounded-md overflow-hidden bg-white/5 shrink-0 flex items-center justify-center">
      {src
        ? <img src={src} alt="" className="w-full h-full object-contain" />
        : <span className="text-[9px] font-bold text-white/40">{abbr.slice(0, 2)}</span>
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

// ── AI loading card ───────────────────────────────────────────────────────────

const AI_TAGLINES = [
  'Sending out the journalists…',
  'Briefing the pundits…',
  'Reviewing the match tape…',
  'Reading the form guide…',
  'Consulting the analysts…',
  'Checking the team sheets…',
  'Calling the press box…',
  'Sharpening the pencils…',
];

function AILoadingCard({ color }: { color: string }) {
  const [idx,     setIdx]     = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % AI_TAGLINES.length);
        setVisible(true);
      }, 380); // 380ms > duration-300 (300ms) so the fade fully completes before text swap
    }, 2400);
    return () => clearInterval(cycle);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      {/* Pulsing dot ring */}
      <div className="relative w-8 h-8">
        <div
          className="absolute inset-0 rounded-full animate-ping opacity-20"
          style={{ backgroundColor: color }}
        />
        <div
          className="absolute inset-1 rounded-full animate-pulse"
          style={{ backgroundColor: color + '55' }}
        />
        <Newspaper
          className="absolute inset-0 m-auto h-4 w-4"
          style={{ color }}
        />
      </div>
      {/* Cycling tagline */}
      <p
        className="text-[11px] font-semibold text-white/40 tracking-wide transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {AI_TAGLINES[idx]}
      </p>
    </div>
  );
}

// ── F1 circuit expand panel ────────────────────────────────────────────────────

function F1ExpandPanel({ game, className, onCollapse }: { game: ScheduleEntry; className?: string; onCollapse?: () => void }) {
  const { team } = game;
  const circuitId = game.opponentId ?? '';
  const circuit   = F1_CIRCUITS[circuitId];

  const isConstructorFollow    = isF1ConstructorTeam(team.id);
  const followedConstructorName = getF1ConstructorName(team);

  const [driverStandings, setDriverStandings] = useState<StandingRow[] | null>(null);
  const [constructorStandings, setConstructorStandings] = useState<StandingRow[] | null>(null);
  const [loadingStandings, setLoadingStandings] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [gridData, setGridData] = useState<PreviewContext['f1QualifyingGrid'] | null>(null);

  // ── AI race preview state ─────────────────────────────────────────────────
  const [aiPreview,  setAiPreview]  = useState<AIPreview | null>(null);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiUpdating, setAiUpdating] = useState(false);
  const [aiError,    setAiError]    = useState(false);

  useEffect(() => {
    setLoadingStandings(true);
    Promise.all([
      fetch('/api/standings?league=f1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/standings?league=f1&type=constructors').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([drivers, constructors]) => {
      if (Array.isArray(drivers) && drivers.length > 0) setDriverStandings(drivers);
      if (Array.isArray(constructors) && constructors.length > 0) setConstructorStandings(constructors);
      setLoadingStandings(false);
    });
  }, []);

  // ── AI race preview fetch — re-generates when qualifying grid becomes available ──
  useEffect(() => {
    const sessionType = game.competition ?? 'Race';
    if (!['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying'].includes(sessionType)) return;

    // Shared cache key across all sessions in the same round
    const roundKey = game.id.replace(/-(race|qualifying|sprint.*|fp\d|sprintq)$/i, '');
    const cacheKey = `ai-preview-f1-v2:${roundKey}`;

    type F1Cache = { preview: AIPreview; generatedAt: number; qualifyingFingerprint: string };

    // Show cached preview immediately while we check for updates
    let cachedEntry: F1Cache | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as F1Cache;
        if (Date.now() - parsed.generatedAt < 14 * 24 * 60 * 60 * 1000) {
          cachedEntry = parsed;
          setAiPreview(parsed.preview);
        }
      }
    } catch { /* ignore */ }

    // Always fetch context to detect when qualifying completes
    const parts = game.id.split('-');
    const roundNumber = parseInt(parts[1]) || undefined;

    const params = new URLSearchParams({
      league:      'f1',
      teamId:      team.id,
      gameId:      game.id,
      raceName:    game.opponent,
      circuitName: game.venue ?? '',
      sessionType,
      ...(roundNumber ? { roundNumber: String(roundNumber) } : {}),
    });

    if (!cachedEntry) setAiLoading(true);

    fetch(`/api/preview?${params}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(async (context: PreviewContext | null) => {
        if (!context) {
          if (!cachedEntry) { setAiLoading(false); setAiError(true); }
          return;
        }

        // Surface qualifying grid to the UI regardless of cache state
        if (context.f1QualifyingGrid?.length) {
          setGridData(context.f1QualifyingGrid);
        }

        // Qualifying fingerprint: top-5 drivers' ergast IDs, empty string if no grid yet
        const qFingerprint = context.f1QualifyingGrid?.length
          ? context.f1QualifyingGrid.slice(0, 5).map(g => g.ergastDriverId).join(',')
          : '';

        // Cache hit with matching fingerprint — nothing to do
        if (cachedEntry && cachedEntry.qualifyingFingerprint === qFingerprint) {
          setAiLoading(false);
          return;
        }

        // Qualifying newly available — update silently in background, keeping old preview visible
        if (cachedEntry && qFingerprint) setAiUpdating(true);

        try {
          // Guarantee an auth session (mint anon if needed) before the gated AI fetch.
          await ensureSession();
          const aiRes = await fetch('/api/ai-preview', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              gameId:       roundKey,
              league:       'f1',
              teamName:     team.name,
              opponentName: game.opponent,
              teamResults:  [],
              oppResults:   [],
              context,
            }),
          });

          const rawData = aiRes.ok ? await aiRes.json() : null;
          // Only accept responses with actual content — { preparing: true } is a
          // Supabase miss signal. Treat it as null; don't set aiError (not a failure).
          const preview: AIPreview | null = rawData?.context ? rawData as AIPreview : null;
          if (preview) {
            setAiPreview(preview);
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                preview,
                generatedAt:          Date.now(),
                qualifyingFingerprint: qFingerprint,
              } satisfies F1Cache));
            } catch { /* storage full */ }
          } else if (!rawData && !cachedEntry) {
            // Only show error for genuine failures (non-ok response / network error),
            // not for a preparing miss (rawData truthy but no context).
            setAiError(true);
          }
        } catch {
          if (!cachedEntry) setAiError(true);
        } finally {
          setAiLoading(false);
          setAiUpdating(false);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.opponent, game.venue, game.competition, team.id, team.name]);

  // Constructor color map for the standings table
  const CONSTRUCTOR_COLORS_MAP: Record<string, string> = {
    'Red Bull Racing': '#3671C6',
    'Ferrari':         '#E8002D',
    'Mercedes':        '#27F4D2',
    'McLaren':         '#FF8000',
    'Aston Martin':    '#229971',
    'Alpine':          '#FF87BC',
    'Williams':        '#64C4FF',
    'Racing Bulls':    '#6692FF',
    'Haas':            '#B6BABD',
    'Kick Sauber':     '#52E252',
  };

  return (
    <div
      // Step 7 — F1 panel now joins the `.sh-detail-*` editorial system: `sh-theme` makes
      // the design tokens resolve and `--accent` is driven by the followed F1 entity's
      // colour (e.g. #E8002D for the Formula 1 championship follow, the constructor's
      // colour for constructor follows). No backdrop-filter; bg + animation unchanged.
      className={cn('sh-theme border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 space-y-5 rounded-b-2xl', className)}
      style={{ animation: 'slideDown 0.22s ease-out', '--accent': team.primaryColor } as React.CSSProperties}
    >
      {/* ── Collapse pill — drives the feed's EXISTING expand toggle (Step 7). Absent for
          the old F1 hero mount, which keeps its own external "Collapse" toggle. ── */}
      {onCollapse && (
        <button
          type="button"
          className="sh-detail-collapse"
          onClick={(e) => { e.stopPropagation(); onCollapse(); }}
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Collapse
        </button>
      )}

      {/* Circuit map */}
      {circuit && !imgError && (
        <div className="rounded-xl overflow-hidden">
          <img
            src={circuit.mapUrl}
            alt={`${circuit.name} circuit map`}
            className="w-full h-auto object-contain"
            onError={() => setImgError(true)}
          />
        </div>
      )}

      {/* Starting grid — shown for Race sessions once qualifying is complete.
          Panel-local component (no off-limits consumer) → wrapped in a `.sh-detail-section`
          shell; its own head was restyled to `.sh-detail-head`. Constructor-coloured rows
          are intentional F1 branding and are preserved. */}
      {game.competition === 'Race' && gridData && gridData.length > 0 && (
        <div className="sh-detail-section">
          <F1StartingGrid
            grid={gridData}
            followedDriverId={
              !isConstructorFollow && team.id !== 'f1-championship'
                ? (F1_DRIVER_IDS[team.id] ?? undefined)
                : undefined
            }
            followedConstructorName={isConstructorFollow ? followedConstructorName ?? undefined : undefined}
            accentColor={team.primaryColor}
          />
        </div>
      )}

      {/* ── AI Race Preview — Race/Qualifying/Sprint sessions only. Mapped to the same
          vocabulary as the two-team panel: context → Match Preview, keyInsights → Quick
          Take, tacticalBattle → Field Form (F1's label), playerSpotlight + verdict →
          .sh-detail-two. ── */}
      {(['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying'].includes(game.competition ?? '')) && (
        <>
          {aiLoading ? (
            <AILoadingCard color={team.primaryColor} />
          ) : aiError ? (
            <p className="text-[11px] text-white/25 italic">Preview unavailable</p>
          ) : aiPreview?.context ? (
            <>
              {/* context → Match Preview */}
              {aiPreview.context && (
                <div>
                  <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Match Preview</div>
                  {aiUpdating && (
                    <p className="text-[9px] text-white/20 uppercase tracking-widest flex items-center gap-1 mb-1.5">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      Updating with qualifying…
                    </p>
                  )}
                  <p className="sh-detail-body">{aiPreview.context}</p>
                </div>
              )}
              {/* keyInsights → Quick Take (rendered for F1 for the first time — the data was
                  always returned by the preview API; the old F1 panel just didn't show it) */}
              {aiPreview.keyInsights && aiPreview.keyInsights.length > 0 && (
                <div>
                  <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Quick Take</div>
                  <ul className="sh-quick-list">
                    {aiPreview.keyInsights.map((ins, i) => (
                      <li key={i} className="sh-quick-bullet"><span className="sh-quick-dot" />{ins}</li>
                    ))}
                  </ul>
                </div>
              )}
              {/* tacticalBattle → Field Form */}
              {aiPreview.tacticalBattle && (
                <div>
                  <div className="sh-detail-head"><Shield className="sh-icon h-[13px] w-[13px]" />Field Form</div>
                  <p className="sh-detail-body">{aiPreview.tacticalBattle}</p>
                </div>
              )}
              {/* playerSpotlight + verdict → side-by-side editorial block */}
              {(aiPreview.playerSpotlight || aiPreview.verdict) && (
                <div className="sh-detail-two">
                  <div className="sh-detail-section">
                    <div className="sh-detail-head"><User className="sh-icon h-[13px] w-[13px]" />Spotlight</div>
                    {aiPreview.playerSpotlight ? (
                      (() => {
                        // Same em-dash split as the two-team panel: "Name — reason".
                        const sep = aiPreview.playerSpotlight.search(/ [—–-] /);
                        if (sep === -1) {
                          return <p className="sh-detail-body-sm">{aiPreview.playerSpotlight}</p>;
                        }
                        const name  = aiPreview.playerSpotlight.slice(0, sep);
                        const blurb = aiPreview.playerSpotlight.slice(sep).replace(/^ [—–-] /, '');
                        return (
                          <>
                            <div className="sh-spotlight-name">
                              <LogoThumb src={TEAM_LOGOS[team.id]} abbr={team.abbreviation} />
                              {name}
                            </div>
                            <p className="sh-detail-body-sm">{blurb}</p>
                          </>
                        );
                      })()
                    ) : (
                      <p className="text-[11px] text-white/25 italic">No spotlight available</p>
                    )}
                  </div>
                  {aiPreview.verdict && (
                    <div className="sh-detail-section" style={{ padding: 0 }}>
                      <blockquote className="sh-verdict">
                        <span className="sh-verdict-label"><TrendingUp className="sh-icon h-[11px] w-[11px]" />Verdict</span>
                        {aiPreview.verdict}
                      </blockquote>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-[11px] text-white/30 italic">Preview being prepared…</p>
          )}
        </>
      )}

      {/* Circuit info */}
      <div className="sh-detail-section">
        {circuit ? (
          <>
            <div className="sh-detail-head">
              <Info className="sh-icon h-[13px] w-[13px]" />
              {circuit.name}
              <span style={{ color: 'var(--text-3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {circuit.country}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div className="sh-detail-body-sm">
                <span style={{ color: 'var(--text-3)' }}>Length</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 8 }}>{circuit.length}</span>
              </div>
              <div className="sh-detail-body-sm">
                <span style={{ color: 'var(--text-3)' }}>Laps</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 8 }}>{circuit.laps}</span>
              </div>
              <div className="sh-detail-body-sm col-span-2">
                <span style={{ color: 'var(--text-3)' }}>Lap record</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 8 }}>{circuit.lapRecord}</span>
              </div>
              <div className="sh-detail-body-sm col-span-2">
                <span style={{ color: 'var(--text-3)' }}>DRS zones</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, marginLeft: 8 }}>{circuit.drsZones}</span>
                <span style={{ color: 'var(--text-3)' }}> — {circuit.drsDescription}</span>
              </div>
            </div>
            <p className="sh-detail-body-sm" style={{ marginTop: 8 }}>{circuit.description}</p>
          </>
        ) : (
          <p className="sh-detail-body-sm">
            {game.opponent}{game.venue ? ` · ${game.venue}` : ''}
          </p>
        )}
      </div>

      {/* Drivers' Championship standings — local restyle to the .sh-detail-ladder
          vocabulary (NOT the shared LeagueTable, which isn't used here and whose single
          F1 column set can't carry the constructor column + per-row colours + highlight). */}
      <div className="sh-detail-section">
        <div className="sh-detail-head"><Trophy className="sh-icon h-[13px] w-[13px]" />Drivers&apos; Championship</div>
        {loadingStandings ? (
          <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading standings…
          </div>
        ) : driverStandings && driverStandings.length > 0 ? (
          <div>
            {driverStandings.slice(0, 15).map((row, i) => {
              const constructorColor = CONSTRUCTOR_COLORS_MAP[row.constructorName ?? ''] ?? '#9CA3AF';
              // Highlight: followed driver → match by teamId; followed constructor → match all their drivers
              const isHighlighted = isConstructorFollow
                ? row.constructorName === followedConstructorName
                : row.teamId === team.id;
              return (
                <div
                  key={i}
                  className="sh-detail-ladder-row"
                  style={isHighlighted ? { borderLeft: '2px solid var(--accent)', paddingLeft: 6, background: 'color-mix(in oklab, var(--accent) 8%, transparent)' } : undefined}
                >
                  <span className="sh-l-pos">{row.position}</span>
                  <span className="text-[10px] font-black shrink-0 w-7 truncate" style={{ color: constructorColor }}>
                    {row.name.split(' ').map((w: string) => w[0]).join('').slice(0, 3).toUpperCase()}
                  </span>
                  <span className="sh-l-name">{row.name}</span>
                  <span className="sh-l-record truncate max-w-[80px]">{row.constructorName}</span>
                  <span className="sh-l-pts">
                    {row.points ?? 0}<span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-3)' }}>pts</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="sh-detail-body-sm" style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>Season standings not yet available</p>
        )}
      </div>

      {/* Constructors' Championship standings — same local ladder restyle */}
      <div className="sh-detail-section">
        <div className="sh-detail-head"><Trophy className="sh-icon h-[13px] w-[13px]" />Constructors&apos; Championship</div>
        {loadingStandings ? (
          <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading standings…
          </div>
        ) : constructorStandings && constructorStandings.length > 0 ? (
          <div>
            {constructorStandings.map((row, i) => {
              const constructorColor = (row as any).primaryColor ?? CONSTRUCTOR_COLORS_MAP[row.name] ?? '#9CA3AF';
              // Highlight: followed constructor → match by teamId or name; followed driver → match their constructor
              const isHighlighted = isConstructorFollow
                ? row.teamId === team.id || row.name === followedConstructorName
                : row.name === followedConstructorName;
              return (
                <div
                  key={i}
                  className="sh-detail-ladder-row"
                  style={isHighlighted ? { borderLeft: '2px solid var(--accent)', paddingLeft: 6, background: 'color-mix(in oklab, var(--accent) 8%, transparent)' } : undefined}
                >
                  <span className="sh-l-pos">{row.position}</span>
                  <span className="text-[10px] font-black shrink-0 w-7 truncate" style={{ color: constructorColor }}>
                    {row.name.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="sh-l-name">{row.name}</span>
                  <span className="sh-l-record">{row.wins > 0 ? `${row.wins}W` : ''}</span>
                  <span className="sh-l-pts">
                    {row.points ?? 0}<span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-3)' }}>pts</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="sh-detail-body-sm" style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>Season standings not yet available</p>
        )}
      </div>

      {/* Footer — circuit/venue meta + disabled "coming soon" add-to-calendar placeholder
          (the F1 button never had a handler; restyled to match the two-team .sh-addcal). */}
      <div className="sh-detail-foot">
        <span className="sh-meta-item">
          <MapPin className="sh-icon h-[13px] w-[13px]" />
          {circuit?.name || game.venue || 'Circuit TBC'}
        </span>
        <button
          className="sh-addcal"
          disabled
          onClick={e => { e.stopPropagation(); }}
          title="Add to calendar (coming soon)"
        >
          <CalendarPlus className="sh-icon h-3.5 w-3.5" />
          Add to calendar
        </button>
      </div>
    </div>
  );
}

// ── World Cup group browser ───────────────────────────────────────────────────

export const WC_GROUP_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L'] as const;

export interface WcGroupBrowserProps {
  standings: StandingRow[];
  /** Controlled active group. When omitted the component manages its own state. */
  activeGroup?: string;
  onGroupChange?: (g: string) => void;
  followedTeamId: string;
  /** The followed team's own group — used as the default selection and ring highlight. */
  teamGroup?: string;
  compact?: boolean;
}

export function WcGroupBrowser({
  standings,
  activeGroup: controlledGroup,
  onGroupChange,
  followedTeamId,
  teamGroup,
  compact = false,
}: WcGroupBrowserProps) {
  const [internalGroup, setInternalGroup] = useState<string>(teamGroup ?? 'A');

  // When teamGroup becomes known (async load), snap the uncontrolled default to it.
  useEffect(() => {
    if (controlledGroup === undefined && teamGroup) setInternalGroup(teamGroup);
  }, [teamGroup, controlledGroup]);

  const activeGroup = controlledGroup ?? internalGroup;
  const handleGroupChange = (g: string) => {
    setInternalGroup(g);
    onGroupChange?.(g);
  };

  // If group labels are absent (stale sessionStorage cache), derive from array index.
  // ESPN returns groups A–L in order, 4 teams each.
  const rowsWithGroup: StandingRow[] = standings.every(r => !r.group)
    ? standings.map((r, i) => ({ ...r, group: WC_GROUP_LETTERS[Math.floor(i / 4)] as string }))
    : standings;

  const availableGroups = WC_GROUP_LETTERS.filter(g => rowsWithGroup.some(r => r.group === g));
  const groups = availableGroups.length > 0 ? availableGroups : [...WC_GROUP_LETTERS];

  const rows = rowsWithGroup.filter(r => r.group === activeGroup);

  return (
    <div className="space-y-2">
      {/* Group selector pills */}
      <div className="flex flex-wrap gap-1">
        {groups.map(g => {
          const isTeamGroup = g === teamGroup;
          const isActive    = g === activeGroup;
          return (
            <button
              key={g}
              onClick={() => handleGroupChange(g)}
              className={cn(
                'px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors',
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70',
                isTeamGroup && !isActive && 'ring-1 ring-white/25',
              )}
            >
              {g}
            </button>
          );
        })}
      </div>

      {/* 4-team mini table */}
      {rows.length > 0 ? (
        <div className="space-y-0.5">
          {/* Header row */}
          <div className="flex items-center text-[9px] font-semibold uppercase tracking-wider text-white/25 px-2 pb-0.5">
            <span className="w-5 shrink-0">#</span>
            <span className="flex-1">Team</span>
            <span className="w-5 text-right">W</span>
            <span className="w-5 text-right">D</span>
            <span className="w-5 text-right">L</span>
            <span className="w-8 text-right">GD</span>
            <span className="w-8 text-right font-bold">Pts</span>
          </div>
          {rows.map((row) => {
            const isMine = !!row.teamId && row.teamId === followedTeamId;
            const gd = (row.goalsFor ?? 0) - (row.goalsAgainst ?? 0);
            return (
              <div
                key={row.name}
                className={cn(
                  'flex items-center text-[11px] leading-none py-1.5 px-2 rounded-lg',
                  isMine ? 'bg-white/8 text-white/90 font-semibold' : 'text-white/55',
                )}
              >
                <span className="w-5 shrink-0 tabular-nums font-bold text-white/40">{row.position}</span>
                <span className="flex-1 truncate">{row.name}</span>
                <span className="w-5 tabular-nums text-right">{row.wins}</span>
                <span className="w-5 tabular-nums text-right">{row.draws}</span>
                <span className="w-5 tabular-nums text-right">{row.losses}</span>
                <span className="w-8 tabular-nums text-right text-white/35">
                  {gd >= 0 ? '+' : ''}{gd}
                </span>
                <span className="w-8 tabular-nums text-right font-bold text-white/80">{row.points ?? 0}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-white/25 italic px-2">Group {activeGroup} data unavailable</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Wrapper: routes F1 to its own panel before any hooks are called in the inner component.
export function GameExpandPanel(props: GameExpandPanelProps) {
  if (props.game.team.league === 'f1') {
    // Forward onCollapse so the F1 feed rows get the collapse pill (Step 7). The old F1
    // hero mounts without onCollapse → no in-panel pill there (its card has its own
    // external toggle). onStandingsUpdate is intentionally not forwarded — the F1 panel
    // fetches its own driver + constructor standings and syncs no sidebar.
    return <F1ExpandPanel game={props.game} className={props.className} onCollapse={props.onCollapse} />;
  }
  return <GameExpandPanelInner {...props} />;
}

function GameExpandPanelInner({ game, className, compact = false, onStandingsUpdate, onCollapse }: GameExpandPanelProps) {
  const { team } = game;

  // AI only makes sense for imminent fixtures — too much changes further out.
  const daysUntilGame = (new Date(game.date).getTime() - Date.now()) / 86_400_000;
  const aiEnabled     = REAL_DATA_LEAGUES.has(team.league) && daysUntilGame <= AI_PREVIEW_DAYS;

  // Start with empty arrays — real data arrives from /api/results.
  // Never use mock data: if the API returns nothing, show "Data unavailable".
  const [results,    setResults]    = useState<GameResult[]>([]);
  const [oppResults, setOppResults] = useState<GameResult[]>([]);
  const [context,   setContext]   = useState<PreviewContext | null>(null);
  const [standings, setStandings] = useState<StandingRow[] | null>(null);
  const [loading,   setLoading]   = useState(REAL_DATA_LEAGUES.has(team.league) || STANDINGS_ONLY_LEAGUES.has(team.league));
  // Plain defaults — localStorage is unavailable during SSR so we never read it
  // in useState. A separate mount-effect reads it instantly on the client.
  const [aiPreview,  setAiPreview]  = useState<AIPreview | null>(null);
  const [aiLoading,  setAiLoading]  = useState(aiEnabled);
  const [aiUpdating, setAiUpdating] = useState(false);
  const [weather,    setWeather]    = useState<WeatherData | null>(null);
  // Mobile tab — 'preview' | 'table'. Desktop always shows full content.
  const [activeTab,    setActiveTab]    = useState<'preview' | 'table'>('preview');
  // World Cup group browser — active group letter (A–L).
  const [activeWcGroup, setActiveWcGroup] = useState<string>(game.worldCupGroup ?? 'A');

  // Fetch weather independently — not tied to the panel-data cache so it always
  // runs even when results/standings are served from sessionStorage.
  // Window: 72h (3-day forecasts are reliable; beyond that accuracy drops off).
  const hoursUntilGame = daysUntilGame * 24;
  const weatherEnabled = OUTDOOR_SPORTS.has(team.league) && hoursUntilGame <= 72 && !!game.venue;

  useEffect(() => {
    if (!weatherEnabled) return;
    fetch(`/api/weather?venue=${encodeURIComponent(game.venue!)}&date=${encodeURIComponent(game.date)}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((data: WeatherData | null) => { if (data) setWeather(data); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherEnabled, game.venue, game.date]);

  // ── Immediate cache read on mount ─────────────────────────────────────────
  // Runs client-side only. Reads both caches before any API round-trips so the
  // panel shows full content instantly when another instance already loaded it.
  useEffect(() => {
    // Panel data (results, context, standings) — populated by any prior instance
    const mem = getPanelCache(`${game.id}:${team.id}`);
    if (mem) {
      setResults(mem.results);
      setOppResults(mem.oppResults);
      setContext(mem.context);
      setStandings(mem.standings);
      setLoading(false);
    }

    // AI preview — persisted in localStorage across sessions
    if (!aiEnabled) { setAiLoading(false); return; }
    const aiCached = loadPreviewCache(game.id);
    if (aiCached) {
      setAiPreview(aiCached.preview);
      setAiLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const isStandingsOnly = STANDINGS_ONLY_LEAGUES.has(team.league);
    if (!REAL_DATA_LEAGUES.has(team.league) && !isStandingsOnly) return;

    // Fast path: panel data was pre-loaded by another instance (e.g. the hero card).
    // State is already set by the mount effect; just ensure AI loading clears.
    if (getPanelCache(`${game.id}:${team.id}`)) {
      if (!isStandingsOnly) setAiLoading(false);
      return;
    }

    // Standings-only leagues (NBA, NHL): fetch just the preview context for standings,
    // skip results, AI preview, and league standings table.
    if (isStandingsOnly) {
      const previewUrl = `/api/preview?league=${team.league}&teamId=${team.id}&opponentName=${encodeURIComponent(game.opponent)}&gameId=${encodeURIComponent(game.id)}`;
      fetch(previewUrl).then(r => r.ok ? r.json() : null).catch(() => null)
        .then((ctxData: PreviewContext | null) => {
          if (ctxData && typeof ctxData === 'object') {
            setContext(ctxData);
            setPanelCache(`${game.id}:${team.id}`, {
              results, oppResults, context: ctxData, standings: null, cachedAt: Date.now(),
            });
          }
          setLoading(false);
        });
      return;
    }

    const resultsUrl  = `/api/results?league=${team.league}&teamId=${team.id}`;
    const wcParams = team.league === 'world_cup'
      ? `${game.worldCupStage ? `&worldCupStage=${encodeURIComponent(game.worldCupStage)}` : ''}${game.worldCupGroup ? `&worldCupGroup=${encodeURIComponent(game.worldCupGroup)}` : ''}`
      : '';
    const previewUrl  = `/api/preview?league=${team.league}&teamId=${team.id}&opponentName=${encodeURIComponent(game.opponent)}&gameId=${encodeURIComponent(game.id)}${game.competition ? `&competition=${encodeURIComponent(game.competition)}` : ''}${wcParams}`;
    const standingsUrl = `/api/standings?league=${team.league}`;
    // Known opponent (opponentId set) → always use the fast league+teamId path, even for
    // playoff/cup games where competition is set. Cross-league name lookup is only for EPL
    // cup fixtures where the opponent is from a lower division (opponentId absent).
    const oppUrl = game.opponentId
      ? `/api/results?league=${team.league}&teamId=${game.opponentId}`
      : game.opponent
        ? `/api/results?teamName=${encodeURIComponent(game.opponent)}`
        : null;

    Promise.all([
      fetch(resultsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(previewUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      oppUrl ? fetch(oppUrl).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      fetch(standingsUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(async ([resultsData, ctxData, oppData, standingsData]: [GameResult[] | null, PreviewContext | null, GameResult[] | null, StandingRow[] | null]) => {
      // Capture live values before state updates (for the chained AI call)
      const liveResults    = Array.isArray(resultsData) && resultsData.length > 0 ? resultsData : results;
      const liveOppResults = Array.isArray(oppData)     && oppData.length > 0     ? oppData     : oppResults;
      const liveContext    = ctxData && typeof ctxData === 'object'                ? ctxData     : {};

      if (Array.isArray(resultsData)  && resultsData.length > 0)  setResults(resultsData);
      if (ctxData && typeof ctxData === 'object')                  setContext(ctxData);
      if (Array.isArray(oppData)      && oppData.length > 0)       setOppResults(oppData);
      if (Array.isArray(standingsData) && standingsData.length > 0) {
        setStandings(standingsData);
        onStandingsUpdate?.(standingsData);
      }
      setLoading(false);

      // Persist to sessionStorage so other instances — including across navigation — skip fetching.
      setPanelCache(`${game.id}:${team.id}`, {
        results:    liveResults,
        oppResults: liveOppResults,
        context:    liveContext as PreviewContext,
        standings:  Array.isArray(standingsData) && standingsData.length > 0 ? standingsData : null,
        cachedAt:   Date.now(),
      });

      if (!aiEnabled) {
        setAiLoading(false);
        return;
      }

      // Fingerprint the adaptable news context.
      const liveCtx     = liveContext as PreviewContext;
      const fingerprint = buildFingerprint(liveCtx.teamNews, liveCtx.opponentNews, liveResults, liveOppResults, weather, liveContext as PreviewContext);
      const cached      = loadPreviewCache(game.id);

      if (cached) {
        // Show cached preview immediately — user sees content at once.
        setAiPreview(cached.preview);
        setAiLoading(false);

        if (cached.newsFingerprint === fingerprint) {
          // News unchanged — nothing to do.
          return;
        }

        // News has changed — update silently in background while old preview stays visible.
        setAiUpdating(true);
      }
      // If no cache: aiLoading is already true → show skeleton.

      // Guarantee an auth session (mint anon if needed) before the gated AI fetch.
      // Race with a 5 s timeout: if Supabase auth is unreachable the spinner must not
      // hang forever — proceed without a session (route will return 401 → aiData null →
      // finally fires → setAiLoading(false)).
      await Promise.race([
        ensureSession(),
        new Promise<void>(resolve => setTimeout(resolve, 5000)),
      ]);
      fetch('/api/ai-preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league:          team.league,
          teamId:          team.id,
          teamName:        team.name,
          opponentName:    game.opponent,
          gameId:          game.id,
          competition:     game.competition,
          compact,
          venue:           game.venue,
          isHome:          game.isHome,
          opponentId:      game.opponentId,
          context:         liveContext,
          teamResults:     liveResults,
          oppResults:      liveOppResults,
          weather:         weather,
          // Pass existing preview + fingerprint so the API can do a targeted update.
          previousPreview: cached?.preview,
          newsFingerprint: cached ? fingerprint : undefined,
        }),
      })
        .then(r => { if (!r.ok) console.error(`[ai-preview] HTTP ${r.status} for ${team.league}/${team.id}`); return r.ok ? r.json() : null; })
        .catch((e) => { console.error('[ai-preview] fetch error', e); return null; })
        .then((aiData: AIPreview | null) => {
          // Only accept a response with actual content — { preparing: true } is a
          // Supabase miss signal, not a valid preview. Don't cache it.
          if (aiData?.context) {
            setAiPreview(aiData);
            savePreviewCache(game.id, {
              preview:         aiData,
              newsFingerprint: fingerprint,
              generatedAt:     cached?.generatedAt ?? Date.now(),
            });
          }
        })
        .finally(() => {
          setAiLoading(false);
          setAiUpdating(false);
        });
    }).catch(() => {
      setLoading(false);
      setAiLoading(false);
    });
  }, [team.id, team.league, game.id, game.opponent, game.opponentId]);

  const wins   = results.filter(r => r.isWin).length;
  const draws  = results.filter(r => r.isDraw).length;

  const hasStandings = context?.teamStanding || context?.opponentStanding;
  const hasNews = (context?.teamNews?.length ?? 0) > 0 || (context?.opponentNews?.length ?? 0) > 0;
  const hasTips = !!context?.tips;

  const isWorldCup = team.league === 'world_cup';
  const hasTable = standings && standings.length > 0;

  return (
    <div
      className={cn('sh-theme border-t border-white/8 bg-black/20 px-4 pt-4 pb-5 rounded-b-2xl', className)}
      style={{ animation: 'slideDown 0.22s ease-out', '--accent': team.primaryColor } as React.CSSProperties}
    >
      {/* ── Mobile tab bar — Preview / Table (or Groups for WC) ── */}
      {hasTable && (
        <div className="flex lg:hidden gap-0 border-b border-white/8 -mx-4 px-4 mb-4">
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'flex-1 py-2 text-xs font-semibold tracking-wide transition-colors border-b-2',
              activeTab === 'preview'
                ? 'text-white border-white/70'
                : 'text-white/35 border-transparent hover:text-white/60',
            )}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={cn(
              'flex-1 py-2 text-xs font-semibold tracking-wide transition-colors border-b-2',
              activeTab === 'table'
                ? 'text-white border-white/70'
                : 'text-white/35 border-transparent hover:text-white/60',
            )}
          >
            {isWorldCup ? 'Groups' : 'Table'}
          </button>
        </div>
      )}

      {/* ── Table tab (mobile only) ── */}
      {hasTable && activeTab === 'table' && (
        <div className="lg:hidden">
          {isWorldCup ? (
            <WcGroupBrowser
              standings={standings!}
              activeGroup={activeWcGroup}
              onGroupChange={setActiveWcGroup}
              followedTeamId={team.id}
              teamGroup={game.worldCupGroup}
            />
          ) : (
            <LeagueTableSh
              league={team.league as import('@/types').SportKey}
              rows={standings!}
              followedTeamIds={new Set([team.id])}
            />
          )}
        </div>
      )}

      {/* ── Main content — single centred column, hidden on mobile when table tab active ── */}
      <div className={cn(hasTable && activeTab === 'table' ? 'hidden' : '')}>
      <div className="max-w-[65ch] mx-auto space-y-5">

      {/* ── Collapse pill — drives the parent's EXISTING expand toggle (Phase B · Step 5) ── */}
      {onCollapse && (
        <button
          type="button"
          className="sh-detail-collapse"
          onClick={(e) => { e.stopPropagation(); onCollapse(); }}
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Collapse
        </button>
      )}

      {/* ── AI loading card — replaces Match Preview + Quick Take skeletons ── */}
      {aiLoading && aiEnabled && (
        <AILoadingCard color={team.primaryColor} />
      )}

      {/* ── Match Preview (AI only — never shown for leagues / dates without AI support) ── */}
      {aiEnabled && !aiLoading && (
        aiPreview?.context ? (
          <div>
            <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Match Preview</div>
            {aiUpdating && (
              <p className="text-[9px] text-white/20 uppercase tracking-widest flex items-center gap-1 mb-1.5">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Refreshing with latest news…
              </p>
            )}
            <p className="sh-detail-body">{aiPreview.context}</p>
          </div>
        ) : (
          <p className="text-[11px] text-white/30 italic">Preview being prepared…</p>
        )
      )}

      {/* ── Quick Take (AI only) ── */}
      {!aiLoading && aiPreview?.keyInsights && aiPreview.keyInsights.length > 0 && (
        <div>
          <div className="sh-detail-head"><Zap className="sh-icon h-[13px] w-[13px]" />Quick Take</div>
          <ul className="sh-quick-list">
            {aiPreview.keyInsights.map((ins, i) => (
              <li key={i} className="sh-quick-bullet"><span className="sh-quick-dot" />{ins}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Tactical Battle (AI only, full mode) ── */}
      {!compact && !aiLoading && aiPreview && (
        <div>
          <div className="sh-detail-head"><Shield className="sh-icon h-[13px] w-[13px]" />Tactical Battle</div>
          <p className="sh-detail-body">{aiPreview.tacticalBattle}</p>
        </div>
      )}

      {/* ── Form + Standings + Weather grid (below narrative) ── */}
      {(() => {
        const isCricket = team.league === 'cricket_int' || team.league === 'bbl';
        const twoMonthsBefore = new Date(new Date(game.date).getTime() - 60 * 24 * 60 * 60 * 1000);
        const formResults    = isCricket ? results.filter(r => new Date(r.date) >= twoMonthsBefore)    : results;
        const formOppResults = isCricket ? oppResults.filter(r => new Date(r.date) >= twoMonthsBefore) : oppResults;
        // Show form while loading (skeleton) or when results exist for either team
        const showFormSection = loading || formResults.length > 0 || formOppResults.length > 0;
        // Show secondary widget while panel data loads, when non-KF data exists, while AI
        // is generating (Key Factors may arrive), or when keyInsights actually arrived
        const hasNonKFData = !!context?.competitionStage
          || (standings != null && standings.length > 0 && isWorldCup)
          || ((context?.worldCup?.groupTable?.length ?? 0) > 0)
          || (hasStandings && !game.competition);
        const showSecondary = loading || hasNonKFData || aiLoading
          || (aiPreview?.keyInsights?.length ?? 0) > 0;
        const colCount = (showFormSection ? 1 : 0) + (showSecondary ? 1 : 0) + (weather ? 1 : 0);
        if (colCount === 0) return null;
        return (
      <div className="sh-detail-cols sh-widget-row" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>

        {/* Recent form — both teams */}
        {showFormSection && (
        <div className="sh-detail-section">
          <p className="sh-detail-head">
            <Trophy className="h-3 w-3" />
            Recent Form
          </p>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[0, 1].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-2.5 w-14 rounded-full bg-white/10" />
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map(j => (
                      <div key={j} className="h-4 w-5 rounded bg-white/10" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <LogoThumb src={TEAM_LOGOS[team.id]} abbr={team.abbreviation} />
                  <span className="text-[12px] text-white/70 font-semibold truncate">{team.shortName}</span>
                </div>
                <CompactForm results={formResults} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <LogoThumb src={game.opponentLogoUrl} abbr={game.opponentAbbr} />
                  <span className="text-[12px] text-white/70 font-semibold truncate" title={game.opponent}>
                    {game.opponent}
                  </span>
                </div>
                <CompactForm results={formOppResults} />
              </div>
            </div>
          )}
        </div>
        )}

        {/* Standings / Cup Stage / Key Factors */}
        {showSecondary && (
        <div className="sh-detail-section">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-2.5 w-20 rounded-full bg-white/10" />
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-white/10" />
                <div className="h-2 w-4/5 rounded-full bg-white/10" />
                <div className="h-2 w-3/5 rounded-full bg-white/10" />
              </div>
            </div>
          ) : context?.competitionStage ? (
            // ── Cup / European competition ─────────────────────────────────
            <>
              <p className="sh-detail-head">
                <Trophy className="h-3 w-3" />
                {game.competition}
              </p>
              {context.competitionStage.isGroupPhase ? (
                // Group / league phase — show standings table
                <div className="space-y-3">
                  {context.competitionStage.groupName && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-white/25">
                      {context.competitionStage.groupName}
                    </p>
                  )}
                  {context.competitionStage.teamStanding && (
                    <StandingRow
                      standing={context.competitionStage.teamStanding}
                      label={team.shortName}
                      trend={null}
                    />
                  )}
                  {context.competitionStage.opponentStanding && (
                    <StandingRow
                      standing={context.competitionStage.opponentStanding}
                      label={game.opponent}
                      trend={null}
                    />
                  )}
                  {!context.competitionStage.teamStanding && !context.competitionStage.opponentStanding && (
                    <p className="text-[12px] font-black text-white/75">
                      {context.competitionStage.roundName}
                    </p>
                  )}
                </div>
              ) : (
                // Knockout stage — show round name prominently, no table
                <div className="bg-white/4 rounded-xl px-3 py-3.5">
                  <p className="text-[14px] font-black text-white/85 leading-none">
                    {context.competitionStage.roundName || game.competition}
                  </p>
                  <p className="text-[10px] text-white/35 mt-1.5 leading-snug">
                    {team.shortName} · {game.opponent}
                  </p>
                </div>
              )}
            </>
          ) : standings && standings.length > 0 && isWorldCup ? (
            // ── World Cup: full group browser (desktop) ────────────────────
            <>
              <p className="sh-detail-head">
                <Trophy className="h-3 w-3" />
                Group Standings
              </p>
              <WcGroupBrowser
                standings={standings}
                activeGroup={activeWcGroup}
                onGroupChange={setActiveWcGroup}
                followedTeamId={team.id}
                teamGroup={game.worldCupGroup}
                compact
              />
              {context?.worldCup?.advancementScenario && activeWcGroup === (game.worldCupGroup ?? context.worldCup.group) && (
                <p className="text-[10px] text-white/35 mt-2 leading-snug">
                  {context.worldCup.advancementScenario}
                </p>
              )}
              {game.worldCupOpponentTBD && (
                <p className="text-[10px] text-amber-400/70 mt-1.5 leading-snug font-semibold">
                  Opponent TBD — bracket not yet finalised
                </p>
              )}
            </>
          ) : context?.worldCup?.groupTable && context.worldCup.groupTable.length > 0 ? (
            // ── World Cup group table fallback (before standings load) ─────
            <>
              <p className="sh-detail-head">
                <Trophy className="h-3 w-3" />
                {context.worldCup.stage === 'group'
                  ? `Group ${context.worldCup.group ?? ''} Standings`
                  : `Round: ${game.worldCupStage ?? context.worldCup.stage}`}
              </p>
              <div className="space-y-1 mt-0.5">
                {context.worldCup.groupTable.map((row) => {
                  const isTeam = row.teamName === team.shortName || row.teamName === game.opponent || row.teamId === team.id;
                  return (
                    <div
                      key={row.teamName}
                      className={[
                        'flex items-center justify-between text-[11px] leading-none py-1 px-2 rounded-lg',
                        isTeam ? 'bg-white/8 text-white/90' : 'text-white/50',
                      ].join(' ')}
                    >
                      <span className="font-bold tabular-nums w-4 shrink-0">{row.position}.</span>
                      <span className="flex-1 truncate mx-1.5 font-semibold">{row.teamName}</span>
                      <span className="tabular-nums font-bold text-white/80">{row.points}pts</span>
                      <span className="tabular-nums text-white/35 ml-2 w-10 text-right">
                        {row.wins}W {row.draws}D {row.losses}L
                      </span>
                      <span className="tabular-nums text-white/35 ml-2 w-8 text-right">
                        {row.goalDifference >= 0 ? '+' : ''}{row.goalDifference}
                      </span>
                    </div>
                  );
                })}
              </div>
              {context.worldCup.advancementScenario && (
                <p className="text-[10px] text-white/35 mt-2 leading-snug">
                  {context.worldCup.advancementScenario}
                </p>
              )}
              {game.worldCupOpponentTBD && (
                <p className="text-[10px] text-amber-400/70 mt-1.5 leading-snug font-semibold">
                  Opponent TBD — bracket not yet finalised
                </p>
              )}
            </>
          ) : hasStandings && !game.competition ? (
            // ── Regular league ladder (primary league games only) ──────────
            <>
              <p className="sh-detail-head">
                <BarChart2 className="h-3 w-3" />
                Ladder
              </p>
              <div className="space-y-3">
                {context?.teamStanding && (
                  <StandingRow
                    standing={context.teamStanding}
                    label={team.shortName}
                    trend={getTrend(standings, team.id)}
                  />
                )}
                {context?.opponentStanding && (
                  <StandingRow
                    standing={context.opponentStanding}
                    label={game.opponent}
                    trend={getTrend(standings, game.opponentId)}
                  />
                )}
              </div>
            </>
          ) : aiLoading ? (
            // ── Key Factors — AI still generating, wait before showing anything ──
            <div className="space-y-2 animate-pulse">
              <div className="h-2.5 w-20 rounded-full bg-white/10" />
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-white/10" />
                <div className="h-2 w-4/5 rounded-full bg-white/10" />
                <div className="h-2 w-3/5 rounded-full bg-white/10" />
              </div>
            </div>
          ) : (
            // ── Key Factors — only reached when keyInsights are present ────
            <>
              <p className="sh-detail-head">
                <TrendingUp className="h-3 w-3" />
                Key Factors
              </p>
              <ul className="space-y-1.5">
                {aiPreview?.keyInsights?.map((ins, i) => (
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
        )}

        {/* Local Weather Forecast — kept as the 3rd cell when present (never dropped) */}
        {weather && (
          <div className="sh-detail-section">
            <p className="sh-detail-head">
              <Cloud className="h-3 w-3" />
              Local Weather Forecast
            </p>
            <div className="space-y-1.5">
              <p className="text-[13px] font-bold text-white/80 leading-none">
                {weather.icon} {weather.description}
              </p>
              <p className="text-[10px] text-white/40 leading-none">{weather.tempC}°C</p>
              {(weather.precipMm > 0.5 || weather.precipProbability > 40) && (
                <p className="text-[10px] text-white/40 leading-none">
                  {weather.precipProbability}% rain{weather.precipMm > 0.5 ? ` · ${weather.precipMm}mm` : ''}
                </p>
              )}
              {weather.windKmh > 25 && (
                <p className="text-[10px] text-white/40 leading-none">{weather.windKmh} km/h wind</p>
              )}
            </div>
          </div>
        )}
      </div>
        );
      })()}


      {/* ── Player Spotlight + Verdict (AI only, full mode) ── */}
      {!compact && !aiLoading && aiPreview && (
        <div className="sh-detail-two">
          <div className="sh-detail-section">
            <div className="sh-detail-head"><User className="sh-icon h-[13px] w-[13px]" />Spotlight</div>
            {aiPreview.playerSpotlight ? (
              (() => {
                // Step 6 · 2B — restore the name / blurb split: the model emits
                // "Name — one-line reason". Split on a spaced em/en/hyphen dash; the
                // name becomes a badge + bold lockup, the remainder the blurb. When no
                // delimiter is present, fall back to a flat body string.
                const sep = aiPreview.playerSpotlight.search(/ [—–-] /);
                if (sep === -1) {
                  return <p className="sh-detail-body-sm">{aiPreview.playerSpotlight}</p>;
                }
                const name  = aiPreview.playerSpotlight.slice(0, sep);
                const blurb = aiPreview.playerSpotlight.slice(sep).replace(/^ [—–-] /, '');
                return (
                  <>
                    <div className="sh-spotlight-name">
                      <LogoThumb src={TEAM_LOGOS[team.id]} abbr={team.abbreviation} />
                      {name}
                    </div>
                    <p className="sh-detail-body-sm">{blurb}</p>
                  </>
                );
              })()
            ) : (
              <p className="text-[11px] text-white/25 italic">No spotlight available</p>
            )}
          </div>
          {aiPreview.verdict && (
            <div className="sh-detail-section" style={{ padding: 0 }}>
              <blockquote className="sh-verdict">
                <span className="sh-verdict-label"><TrendingUp className="sh-icon h-[11px] w-[11px]" />Verdict</span>
                {aiPreview.verdict}
              </blockquote>
            </div>
          )}
        </div>
      )}

      {/* ── Team News ── (EPL only, when available; hidden in compact mode) */}
      {!compact && !loading && hasNews && (
        <div>
          <p className="sh-detail-head">
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
      <div className="sh-detail-foot">
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
          <span className="sh-meta-item">
            <MapPin className="sh-icon h-[13px] w-[13px]" />
            {game.venue || 'Venue TBC'}
          </span>
        )}

        {/* Add to calendar — no handler yet; disabled "coming soon" placeholder (restyled). */}
        <button
          className="sh-addcal"
          disabled
          onClick={e => { e.stopPropagation(); }}
          title="Add to calendar (coming soon)"
        >
          <CalendarPlus className="sh-icon h-3.5 w-3.5" />
          Add to calendar
        </button>
      </div>

      </div>{/* end centred column */}
      </div>{/* end visibility wrapper */}
    </div>
  );
}
