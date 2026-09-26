'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Trophy, ChevronDown, X } from 'lucide-react';

import { getFollowedTeams, getFollowedLeagues, usePrefsVersion } from '@/lib/user-prefs';
// mock-data intentionally NOT imported — results page only shows real API data.
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { TEAMS, LEAGUES, REAL_DATA_LEAGUES } from '@/lib/teams';
import { contrastColor, datekeyInZone, smoothScrollTo } from '@/lib/utils';
import { accentVars } from '@/lib/team-ink';
import { leagueBrandAccent } from '@/lib/league-brand';
import { resultMatchKey, makeResultId } from '@/lib/result-match-key';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamBadge } from '@/components/ui/team-badge';
import { ResultExpandPanel } from '@/components/results/result-expand-panel';
import { CompetitionWatermark } from '@/components/schedule/competition-watermark';
import { ScheduleCalendar } from '@/components/schedule/schedule-calendar';
import { useRouter } from 'next/navigation';
import type { Team, GameResult, SportKey, UpcomingGame } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultEntry = GameResult & {
  team: Team;
  id: string;
  /** True when the row came from a followed COMPETITION rather than a followed team.
   *  A followed team's match arrives from both fetches, so the merge prefers the
   *  team-sourced copy — it reads from the side the user actually follows. */
  fromLeague?: boolean;
};

/** Perspective-independent match identity — shared with /api/results so the two
 *  cannot drift. See lib/result-match-key.ts for why abbreviations, not ids. */
const matchKey = (r: ResultEntry): string =>
  resultMatchKey({ ...r, league: r.team.league, teamId: r.team.id, teamAbbr: r.team.abbreviation });

// ─── Data fetching ────────────────────────────────────────────────────────────

/**
 * Stand-in Team for a result that belongs to a COMPETITION rather than to a
 * team the user follows. Used for F1, where the followed unit is the
 * championship and a race is one event, not one row per driver.
 */
function competitionTeam(leagueId: string): Team {
  const league = LEAGUES.find(l => l.id === leagueId);
  const badge  = LEAGUE_BADGE[leagueId];
  return {
    id:            leagueId,
    name:          league?.fullName ?? leagueId.toUpperCase(),
    shortName:     league?.name ?? leagueId.toUpperCase(),
    abbreviation:  badge?.label ?? leagueId.slice(0, 3).toUpperCase(),
    league:        leagueId as SportKey,
    sport:         league?.sport ?? '',
    city:          '',
    country:       league?.country ?? '',
    primaryColor:  badge?.color ?? '#9b6bff',
    secondaryColor: badge?.bg ?? '#9b6bff',
    venue:         '',
  } as Team;
}

/**
 * Every result in a followed competition. Teams already followed individually
 * are fetched separately; the caller dedupes by result id so a match is never
 * listed twice.
 */
async function loadLeagueResults(leagueId: string): Promise<ResultEntry[]> {
  if (!REAL_DATA_LEAGUES.has(leagueId)) return [];
  try {
    const res  = await fetch(`/api/results?league=${leagueId}&scope=league`);
    const data = res.ok ? await res.json() : [];
    if (!Array.isArray(data)) return [];
    return data.map((r: GameResult & { teamId?: string }) => {
      const team = TEAMS.find(t => t.id === r.teamId) ?? competitionTeam(leagueId);
      return { ...r, team, id: makeResultId(team.id, r), fromLeague: true };
    });
  } catch { /* network error — return empty */ }
  return [];
}

async function loadResults(team: Team): Promise<ResultEntry[]> {
  if (!REAL_DATA_LEAGUES.has(team.league)) return [];
  try {
    const res  = await fetch(`/api/results?league=${team.league}&teamId=${team.id}`);
    const data = res.ok ? await res.json() : [];
    if (Array.isArray(data) && data.length > 0) {
      return data.map((r: GameResult) => ({ ...r, team, id: makeResultId(team.id, r) }));
    }
  } catch { /* network error — return empty */ }
  return [];
}

/**
 * Upcoming fixtures for the calendar — the same data the schedule page's
 * calendar shows, so the calendar is one calendar wherever it is opened.
 * Background-loaded; never gates the results list.
 */
async function loadUpcomingForTeam(team: Team): Promise<(UpcomingGame & { team: Team })[]> {
  if (!REAL_DATA_LEAGUES.has(team.league)) return [];
  try {
    const res  = await fetch(`/api/fixtures?league=${team.league}&teamId=${team.id}`);
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data.map((g: UpcomingGame) => ({ ...g, team })) : [];
  } catch { return []; }
}
async function loadUpcomingForLeague(leagueId: string): Promise<(UpcomingGame & { team: Team })[]> {
  if (!REAL_DATA_LEAGUES.has(leagueId)) return [];
  try {
    const res  = await fetch(`/api/league-fixtures?league=${leagueId}`);
    const data = res.ok ? await res.json() : [];
    if (!Array.isArray(data)) return [];
    return data.map((g: UpcomingGame) => ({ ...g, team: TEAMS.find(t => t.id === g.teamId) ?? competitionTeam(leagueId) }));
  } catch { return []; }
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

interface ResultBadgeMeta {
  bg: string;
  color: string;
  label: string;
  /** URL for the watermark logo shown in the result row background. */
  logoUrl?: string;
  /** Opacity for the watermark (default 0.18). */
  logoOpacity?: number;
  /** CSS mix-blend-mode for the watermark — 'screen' dissolves dark backgrounds. */
  logoBlend?: string;
  /** CSS filter applied to the watermark logo. */
  logoFilter?: string;
  /** Override the default h-[140%] height for this logo's watermark. */
  logoHeight?: string;
}

const COMPETITION_BADGE: Record<string, ResultBadgeMeta> = {
  'Champions League': { bg: '#071432', color: '#dce8ff', label: 'UCL', },
  'Europa League':    { bg: '#200e00', color: '#f57320', label: 'UEL', },
  'Conference League': { bg: '#001a10', color: '#00c87a', label: 'UECL', },
  'FA Cup':           { bg: '#1a0005', color: '#ff2244', label: 'FA Cup', },
  'EFL Cup':          { bg: '#0d1f00', color: '#78be20', label: 'EFL Cup', },
  'State of Origin':  { bg: '#1a0000', color: '#F5A623', label: 'SOO', },
};

const LEAGUE_BADGE: Record<string, ResultBadgeMeta> = {
  afl:         { bg: '#001d3d', color: '#f4ac20',  label: 'AFL', },
  nrl:         { bg: '#002955', color: '#ffffff',  label: 'NRL', },
  epl:         { bg: '#38003c', color: '#ffffff',  label: 'PL', },
  super_rugby: { bg: '#0b2a6b', color: '#7eb8ff',  label: 'SR', },
  rugby_int:   { bg: '#0f1a2e', color: '#a0b4cc',  label: 'Test', logoHeight: '78%' },
  f1:          { bg: '#1a0000', color: '#E8002D',  label: 'F1', },
  bbl:         { bg: '#001428', color: '#d917a5',  label: 'BBL', },
  cricket_int: { bg: '#0a1a00', color: '#78be20',  label: 'INT', logoHeight: '78%' },
};

// Step 8 — emits .sh-comptag, matching the schedule's FixtureBadge vocabulary.
function ResultBadge({ league, competition }: { league: string; competition?: string }) {
  const baseComp = competition?.startsWith('State of Origin') ? 'State of Origin' : competition;
  const meta  = baseComp ? (COMPETITION_BADGE[baseComp] ?? null) : (LEAGUE_BADGE[league] ?? null);
  const label = meta?.label ?? (competition ?? league.toUpperCase());
  const color = meta?.color ?? 'var(--text-3)';
  return (
    <span className="sh-comptag" style={{ '--c': color } as React.CSSProperties}>{label}</span>
  );
}

// ─── Outcome badge ────────────────────────────────────────────────────────────

function f1PositionColor(pos: string): string {
  if (pos === 'P1') return '#FFD700'; // gold
  if (pos === 'P2') return '#C0C0C0'; // silver
  if (pos === 'P3') return '#CD7F32'; // bronze
  const n = parseInt(pos.replace('P', ''), 10);
  if (!isNaN(n) && n <= 10) return '#34d399'; // points
  if (!isNaN(n)) return '#9ca3af'; // outside points
  return '#f87171'; // DNF / DNS / DSQ etc.
}

function cricketFormatLabel(fmt?: string): string {
  if (fmt === 'test') return 'Test';
  if (fmt === 'odi')  return 'ODI';
  if (fmt === 't20')  return 'T20';
  return '';
}

function OutcomeBadge({ result }: { result: ResultEntry }) {
  if (result.f1Position) {
    const color = f1PositionColor(result.f1Position);
    const isPos = /^P\d+$/.test(result.f1Position);
    return (
      <span
        className="inline-flex items-center justify-center rounded-md px-1.5 h-5 text-[10px] font-black border shrink-0 leading-none tabular-nums"
        style={{ color, borderColor: `${color}55`, background: `${color}18` }}
      >
        {result.f1Position}
      </span>
    );
  }
  // Cricket: show result text or W/D/L
  if (result.cricketFormat) {
    const isDraw = result.isDraw === true;
    const label  = isDraw ? 'D' : result.isWin ? 'W' : 'L';
    const cls    = isDraw
      ? 'bg-amber-400/20 text-amber-300 border-amber-600/30'
      : result.isWin
        ? 'bg-emerald-400/20 text-emerald-400 border-emerald-600/30'
        : 'bg-red-400/20 text-red-400 border-red-700/30';
    const fmtLabel = cricketFormatLabel(result.cricketFormat);
    return (
      <div className="flex items-center gap-1">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${cls} shrink-0`}>
          {label}
        </span>
        {fmtLabel && (
          <span className="text-[9px] font-bold text-white/30 uppercase tracking-wider">{fmtLabel}</span>
        )}
      </div>
    );
  }
  // Existing W/D/L badge
  const isDraw = result.isDraw === true;
  const label  = isDraw ? 'D' : result.isWin ? 'W' : 'L';
  const cls    = isDraw
    ? 'bg-amber-400/20 text-amber-300 border-amber-600/30'
    : result.isWin
      ? 'bg-emerald-400/20 text-emerald-400 border-emerald-600/30'
      : 'bg-red-400/20 text-red-400 border-red-700/30';
  return (
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black border ${cls} shrink-0`}>
      {label}
    </span>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

interface ResultRowProps {
  result: ResultEntry;
  userTz: string;
  dateKey: string;
  isHighlighted: boolean;
  isExpanded: boolean;
  onHover: (dateKey: string | null) => void;
  onToggle: () => void;
}

function ResultRow({
  result, userTz, dateKey, isHighlighted, isExpanded, onHover, onToggle,
}: ResultRowProps) {
  const { team } = result;
  const teamLogoUrl    = TEAM_LOGOS[team.id];
  const teamLogoFilter = TEAM_LOGO_FILTERS[team.id];

  const isDraw     = result.isDraw === true;
  const scoreColor = isDraw ? '#f59e0b' : result.isWin ? '#34d399' : '#f87171';

  const dateStr = new Date(result.date).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', timeZone: userTz,
  });

  // League / competition watermark metadata (kept for visual layering inside .sh-fix)
  const baseComp = result.competition?.startsWith('State of Origin') ? 'State of Origin' : result.competition;
  // Per-mark override (watermarks.ts) — wide marks pull left to avoid clipping.

  // ── Step 8 — F1 gate: keep the original render for F1 results ─────────────────
  // The two-team .sh-fix path below handles all other leagues (AFL, NRL, EPL, cricket…).
  if (team.league === 'f1') {
    // Shares the design-system .sh-fix card with every other league (see the
    // schedule row note) — only the inner layout is F1-specific.
    return (
      <div
        className={'sh-fix cursor-pointer select-none' + (isExpanded ? ' is-open' : '')}
        style={{
          ...accentVars(team.primaryColor),
          minHeight: '84px',
          boxShadow: isHighlighted && !isExpanded
            ? `inset 0 0 0 1px ${team.primaryColor}28, 0 0 40px ${team.primaryColor}22`
            : undefined,
        } as React.CSSProperties}
        onClick={onToggle}
        onMouseEnter={() => onHover(dateKey)}
        onMouseLeave={() => onHover(null)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(105deg, ${team.primaryColor}10 0%, transparent 40%)` }} />
        {/* F1 mark is already card-sized — no responsive scale. */}
        <CompetitionWatermark competition={baseComp} league={team.league} scale={1} />
        <div className="relative shrink-0 z-10 self-center" style={{ filter: `drop-shadow(0 0 16px ${team.primaryColor}66)` }}>
          <TeamBadge logoUrl={teamLogoUrl} abbreviation={team.abbreviation} primaryColor={team.primaryColor} size={52} logoFilter={teamLogoFilter} />
        </div>
        <div className="flex-1 min-w-0 relative z-10">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[17px] font-semibold text-white/70 leading-none">{team.shortName}</span>
            <span className="text-[13px] font-bold tracking-wide relative top-[0.12em]" style={{ color: 'var(--text-2)' }}>{result.isHome ? 'vs' : 'at'}</span>
            <TeamBadge logoUrl={result.opponentLogoUrl} abbreviation={result.opponentAbbr} primaryColor="#6B7280" size={30} className="rounded-md" logoFilter={TEAM_LOGO_FILTERS[result.opponentId ?? '']} />
            <span className="text-[17px] font-semibold text-white/70 leading-none">{result.opponent}</span>
            <ResultBadge league={team.league} competition={result.competition} />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <OutcomeBadge result={result} />
            <span className="text-[11px] text-white/30">{dateStr}</span>
            {result.isHome ? <span className="text-[10px] text-white/20">Home</span> : <span className="text-[10px] text-white/20">Away</span>}
          </div>
        </div>
        <div className="text-right shrink-0 flex items-center gap-2 relative z-10">
          <p className="text-[19px] font-black leading-none tabular-nums" style={{ color: result.f1Position ? f1PositionColor(result.f1Position) : scoreColor }}>
            {result.f1Position ?? `${result.teamScore}–${result.opponentScore}`}
          </p>
          <ChevronDown className={`h-4 w-4 text-white/20 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>
    );
  }

  // ── Two-team path: the schedule's ScheduleRow skeleton exactly, with the
  //    kick-off time's slot taken by the score. Same crest size (54), same
  //    21px names, same nowrap units so long pairings wrap at the separator,
  //    same sub-row of pills; on mobile .sh-fix-main stacks the score line
  //    under the teams just as the schedule stacks its time line.
  const hasCricketScore = !!result.cricketScore;

  // W/L/D outcome chip
  const outcomeChipClass = 'sh-result-outcome' + (isDraw ? ' is-draw' : result.isWin ? ' is-win' : ' is-loss');
  const outcomeLabel     = isDraw ? 'D' : result.isWin ? 'W' : 'L';

  // Score halves: the winner's number in the win colour, the loser's muted.
  const teamScoreClass = isDraw ? 'is-draw-score' : (result.isWin ? 'is-win-score' : 'is-loss-score');
  const oppScoreClass  = isDraw ? 'is-draw-score' : (result.isWin ? 'is-loss-score' : 'is-win-score');

  // Cricket: "272/9 (49.5/50 ov, target 272)" is a sentence, not a score. The
  // slot shows "272/9 · 271/8"; the overs/target detail and the result line
  // go to the sub-row where the schedule keeps its venue and TV.
  const compactCricket = (v?: string) => (v ? v.replace(/\s*\([^)]*\)\s*$/, '').trim() : undefined);
  const cricketDetail  = [result.cricketScore, result.cricketOppScore]
    .map(v => v?.match(/\(([^)]*)\)\s*$/)?.[1])
    .filter(Boolean)
    .join(' · ');

  // Opponent display name: prefer the club's own name when the feed's label is long
  // (mirrors ScheduleRow); the type stays 21px everywhere and wraps at the separator.
  const SHORTNAME_THRESHOLD = 14;
  const oppTeam = result.opponentId ? TEAMS.find(t => t.id === result.opponentId) : undefined;
  const oppDisplayName = result.opponent.length > SHORTNAME_THRESHOLD && oppTeam
    ? (oppTeam.name.length < result.opponent.length ? oppTeam.name : oppTeam.shortName)
    : result.opponent;
  const nameSize = { fontSize: '21px' } as React.CSSProperties;
  const cricketColor = result.cricketFormat === 'test' ? '#e2a84b' : result.cricketFormat === 'odi' ? '#60a5fa' : '#a78bfa';

  return (
    <article
      className={'sh-fix' + (isExpanded ? ' is-open' : '')}
      style={accentVars(team.primaryColor) as React.CSSProperties}
      onClick={onToggle}
      onMouseEnter={() => onHover(dateKey)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      {/* Competition watermark — falls back to the sport ball on a dead CDN. */}
      <CompetitionWatermark competition={baseComp} league={team.league} />

      <div className="sh-fix-text">
        <div className="sh-fix-main">
          {/* Two nowrap units (crest + name) so a long pairing wraps at the
              separator rather than shrinking the type — identical to the schedule. */}
          <div className="sh-fix-teams" style={{ flexWrap: 'wrap', rowGap: '6px', columnGap: '10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', flexWrap: 'nowrap', minWidth: 0 }}>
              <TeamBadge logoUrl={teamLogoUrl} abbreviation={team.abbreviation} primaryColor={team.primaryColor} size={54} logoFilter={teamLogoFilter} />
              <span className="sh-fix-name" style={nameSize}>{team.shortName}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', flexWrap: 'nowrap', minWidth: 0 }}>
              <span className="sh-fix-sep">{result.isHome ? 'vs' : 'at'}</span>
              <TeamBadge logoUrl={result.opponentLogoUrl} abbreviation={result.opponentAbbr} primaryColor="#6B7280" size={54} logoFilter={TEAM_LOGO_FILTERS[result.opponentId ?? '']} />
              <span className="sh-fix-name" style={nameSize}>{oppDisplayName}</span>
            </span>
          </div>

          {/* The time slot, holding the score: big tabular figures like the
              kick-off time, then the W/L/D chip, the Home/Away tag and the chevron. */}
          <div className="sh-fix-time">
            {!hasCricketScore ? (
              <span className="sh-result-score">
                <span className={teamScoreClass}>{result.teamScore}</span>
                <span className="sh-fix-sep">–</span>
                <span className={oppScoreClass}>{result.opponentScore}</span>
              </span>
            ) : (
              <span className="sh-result-score is-cricket">
                <span className={teamScoreClass}>{compactCricket(result.cricketScore)}</span>
                {result.cricketOppScore && (
                  <><span className="sh-fix-sep">·</span>
                  <span className={oppScoreClass}>{compactCricket(result.cricketOppScore)}</span></>
                )}
              </span>
            )}
            <span className={outcomeChipClass}>{outcomeLabel}</span>
            <span className={'sh-tag-venue is-' + (result.isHome ? 'home' : 'away')}>
              {result.isHome ? 'Home' : 'Away'}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              style={{ color: 'var(--text-3)' }}
            />
          </div>
        </div>

        {/* Sub-row: competition pill (as the schedule), cricket format, and the
            cricket result/overs where the schedule shows venue and TV. The date
            is already the day header, so it is not repeated here. */}
        <div className="sh-fix-sub">
          {team.league !== 'cricket_int' && (
            <ResultBadge league={team.league} competition={result.competition} />
          )}
          {result.cricketFormat && (
            <span className="sh-comptag" style={{ '--c': cricketColor } as React.CSSProperties}>
              {cricketFormatLabel(result.cricketFormat)}
            </span>
          )}
          {result.cricketResult && (
            <span className="sh-meta-item"><span className="truncate" style={{ maxWidth: '260px' }} title={result.cricketResult}>{result.cricketResult}</span></span>
          )}
          {cricketDetail && (
            <span className="sh-meta-item" style={{ color: 'var(--text-3)' }}><span className="truncate" style={{ maxWidth: '260px' }}>{cricketDetail}</span></span>
          )}
        </div>
      </div>
    </article>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

// Step 8 — reskinned to .sh-chip (mirrors the schedule's TeamFilterPill).
// Active chip self-colours by subject: --accent set inline from the team's primaryColor;
// "All" chip has no primaryColor → keeps the inherited default accent.
function TeamFilterPill({
  label, logoUrl, logoFilter, primaryColor, active, onClick,
}: {
  label: string; logoUrl?: string; logoFilter?: string; primaryColor?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={'sh-chip' + (active ? ' is-active' : '')}
      style={active && primaryColor ? (accentVars(primaryColor) as React.CSSProperties) : undefined}
    >
      {logoUrl && (
        <img loading="lazy" decoding="async" src={logoUrl} alt="" width={15} height={15} className="w-[15px] h-[15px] object-contain shrink-0"
          style={logoFilter ? { filter: logoFilter } : undefined}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      {label}
    </button>
  );
}

// ─── Followed teams widget ────────────────────────────────────────────────────

// Step 8 — reskinned to .sh-card.sh-following (mirrors the schedule's FollowedTeamsWidget).
// The hover tooltip per badge is preserved; the "Add teams" action becomes the .sh-edit-link
// in the card head (matching the schedule's "Edit" affordance).
function FollowedTeamsWidget({ teams }: { teams: Team[] }) {
  if (teams.length === 0) return null;
  return (
    <div className="sh-card sh-following">
      <div className="sh-card-head">
        <span className="sh-card-head-label">Following</span>
        <Link href="/onboarding" className="sh-edit-link">Edit</Link>
      </div>
      <div className="sh-follow-grid">
        {teams.map(team => (
          <div key={team.id} className="sh-follow-item relative group">
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              logoFilter={TEAM_LOGO_FILTERS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={42}
              className="rounded-xl"
            />
            {/* Hover tooltip — preserved; styled with team accent for recognition */}
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-20"
              style={{ background: `${team.primaryColor}dd`, color: contrastColor(team.primaryColor) }}
            >
              {team.shortName}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Date heading ─────────────────────────────────────────────────────────────

function formatDateHeading(date: Date, userTz: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(date);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map(i => (
        <div key={i}>
          <div className="h-4 w-52 rounded animate-pulse mb-3" style={{ background: 'var(--border)' }} />
          <div className="space-y-2">
            {[0, 1].map(j => (
              <div key={j} className="h-[72px] rounded-xl animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [allResults, setAllResults] = useState<ResultEntry[]>([]);
  /** Upcoming fixtures for the shared calendar (results + fixtures in one view). */
  const [upcoming, setUpcoming] = useState<(UpcomingGame & { team: Team })[]>([]);
  const router = useRouter();
  const [loading,    setLoading]    = useState(true);
  const [userTz,     setUserTz]     = useState('Australia/Brisbane');
  const prefsVersion = usePrefsVersion(); // bumps when followed teams change (e.g. post-sign-in merge)

  const [activeTeamId,   setActiveTeamId]   = useState<string>('all');
  /** Competition filter — set by a competition pill, cleared by any team pill. */
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [followedLeagues, setFollowedLeagues] = useState<string[]>([]);
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [everExpandedIds, setEverExpandedIds] = useState<Set<string>>(new Set());

  // Mobile calendar bottom sheet — opened by the navbar Calendar button via custom event
  const [calendarOpen,   setCalendarOpen]   = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  const openCalendar = useCallback(() => {
    setCalendarOpen(true);
    // Wait for the DOM node to mount, then trigger the slide-up transition
    requestAnimationFrame(() => requestAnimationFrame(() => setCalendarVisible(true)));
  }, []);

  const closeCalendar = useCallback((afterClose?: () => void) => {
    setCalendarVisible(false);
    afterClose?.();                                    // scroll starts immediately alongside the slide
    setTimeout(() => setCalendarOpen(false), 420);    // unmount after CSS transition completes
  }, []);

  useEffect(() => {
    const handler = () => openCalendar();
    window.addEventListener('sporthouse:open-calendar', handler);
    return () => window.removeEventListener('sporthouse:open-calendar', handler);
  }, [openCalendar]);

  const [clickedDateKey, setClickedDateKey] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch {}
  }, []);

  // UX-5: when navigated here with a #result-date-* hash (from the schedule calendar's
  // past-day click), scroll to that date once results have loaded — the anchor does not
  // exist until then, so native hash scrolling on load can't reach it.
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#result-date-')) return;
    const dk = hash.slice('#result-date-'.length);
    const t = setTimeout(() => {
      const el = document.getElementById(`result-date-${dk}`);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 88;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 100);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    // Reset accumulator so a followed-teams change (prefsVersion, e.g. the post-sign-in
    // anon→permanent union) refetches the EXACT new set instead of layering onto the old one.
    setAllResults([]);
    setUpcoming([]);
    setLoading(true);

    const followed = getFollowedTeams();

    // Auto-inject QLD Maroons (State of Origin) whenever any NRL club team is followed
    const hasNRLClub  = followed.some(t => t.league === 'nrl' && t.id !== 'nrl-maroons' && t.id !== 'nrl-blues');
    const hasMaroons  = followed.some(t => t.id === 'nrl-maroons');
    const maroonsTeam = !hasMaroons && hasNRLClub
      ? TEAMS.find(t => t.id === 'nrl-maroons')
      : undefined;
    const teamsToFetch = maroonsTeam ? [...followed, maroonsTeam] : followed;

    setTeams(teamsToFetch);

    // Competitions followed as a whole (onboarding's "Follow the whole
    // competition") contribute every match in the competition — the way F1 is
    // almost always followed, and the reason this page used to be empty for
    // those users. Leagues already covered by a followed team are still
    // fetched: the follow means "all of it", not "the ones I have a team in".
    const leaguesToFetch = getFollowedLeagues();
    setFollowedLeagues(leaguesToFetch);

    if (teamsToFetch.length === 0 && leaguesToFetch.length === 0) { setLoading(false); return; }

    let active = true;
    let remaining = teamsToFetch.length + leaguesToFetch.length;

    const absorb = (entries: ResultEntry[]) => {
      if (!active) return;
      setAllResults(prev => {
        // Dedupe on match identity, not render id: the same match reaches us
        // from the followed team (their perspective) and from the competition
        // (canonical home perspective) under two different ids.
        const byMatch = new Map<string, ResultEntry>();
        for (const r of [...prev, ...entries]) {
          const k = matchKey(r);
          const existing = byMatch.get(k);
          if (!existing || (existing.fromLeague && !r.fromLeague)) byMatch.set(k, r);
        }
        return [...byMatch.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      });
    };

    const done = () => { remaining -= 1; if (remaining === 0) setLoading(false); };

    teamsToFetch.forEach(async (team) => {
      try { absorb(await loadResults(team)); } finally { done(); }
    });

    // Upcoming fixtures for the calendar — background, deduped by fixture id,
    // future only (a just-finished match belongs to the results side).
    const absorbUpcoming = (games: (UpcomingGame & { team: Team })[]) => {
      if (!active || games.length === 0) return;
      const nowMs = Date.now();
      setUpcoming(prev => {
        const seen = new Set(prev.map(g => g.id));
        const fresh = games.filter(g => !seen.has(g.id) && new Date(g.date).getTime() > nowMs);
        return fresh.length ? [...prev, ...fresh].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) : prev;
      });
    };
    teamsToFetch.forEach(team => { loadUpcomingForTeam(team).then(absorbUpcoming); });
    leaguesToFetch.forEach(id => { loadUpcomingForLeague(id).then(absorbUpcoming); });
    leaguesToFetch.forEach(async (leagueId) => {
      try { absorb(await loadLeagueResults(leagueId)); } finally { done(); }
    });
    return () => { active = false; };
  }, [prefsVersion]);

  const filteredResults = useMemo<ResultEntry[]>(() => {
    // A competition filter is league-wide: it includes results that arrived via a
    // followed TEAM in that competition, not only the competition-sourced rows.
    if (activeLeagueId) return allResults.filter(r => r.team.league === activeLeagueId);
    if (activeTeamId === 'all') return allResults;
    return allResults.filter(r => r.team.id === activeTeamId);
  }, [allResults, activeTeamId, activeLeagueId]);

  // The calendar's upcoming side follows the same team / competition filter.
  const filteredUpcoming = useMemo(() => {
    if (activeLeagueId) return upcoming.filter(g => g.team.league === activeLeagueId);
    if (activeTeamId === 'all') return upcoming;
    return upcoming.filter(g => g.team.id === activeTeamId);
  }, [upcoming, activeTeamId, activeLeagueId]);

  // A future day in the calendar opens the schedule at that date.
  const handleUpcomingDayClick = useCallback((dk: string) => {
    router.push(`/schedule#date-section-${dk}`);
  }, [router]);

  // Group by date in user timezone (reverse-chronological)
  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; representativeDate: Date; results: ResultEntry[] }[] = [];
    for (const result of filteredResults) {
      const dateKey = datekeyInZone(result.date, userTz);
      const last = groups[groups.length - 1];
      if (last?.dateKey === dateKey) {
        last.results.push(result);
      } else {
        groups.push({ dateKey, representativeDate: new Date(result.date), results: [result] });
      }
    }
    return groups;
  }, [filteredResults, userTz]);

  const handleCalendarHover = useCallback((dk: string | null) => setHoveredDateKey(dk), []);

  const handleDayClick = useCallback((dk: string) => {
    const el = document.getElementById(`result-date-${dk}`);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    setClickedDateKey(dk);
    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    setEverExpandedIds(prev => { const next = new Set(prev); next.add(id); return next; });
  }, []);

  if (!loading && teams.length === 0 && allResults.length === 0) return (
    <EmptyState
      icon={Trophy}
      title="No results yet"
      body="Select teams to follow and your recent results will appear here."
    />
  );

  // Step 8 — sh-theme with NO inline --accent override; default tokens govern the page
  // chrome. Per-card accent is set per .sh-fix card (each result row drives its own colour).
  return (
    <div className="sh-theme max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2 mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-head)' }}>
          <Trophy className="h-6 w-6" style={{ color: 'var(--accent)' }} />
          Your Results
        </h1>
        {loading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading results…</p>}
      </div>

      {/* Two-column layout */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* Left: filters + results list */}
        {/* min-w-0: let the 1fr grid track shrink below its content's intrinsic width so the
            My-Teams pill row below scrolls within overflow-x-auto instead of stretching the
            whole page when many teams are followed. */}
        <div className="min-w-0">
          {/* Team filter — Step 8: reskinned to .sh-filters.sh-card / .sh-chips / .sh-chip.
              Single group (My Teams) only — results has no comp or view-toggle filters.
              Horizontal scroll preserved (overrides .sh-chips flex-wrap:wrap) so a
              large followed-teams list scrolls rather than stretching the column. */}
          {!loading && teams.length + followedLeagues.length > 1 && (
            <div className="sh-filters sh-card">
              <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>My Teams</p>
              <div className="sh-chips">
                <TeamFilterPill
                  label="All"
                  active={activeTeamId === 'all' && !activeLeagueId}
                  onClick={() => { setActiveTeamId('all'); setActiveLeagueId(null); }}
                />
                {teams.map(team => (
                  <TeamFilterPill
                    key={team.id}
                    label={team.abbreviation}
                    logoUrl={TEAM_LOGOS[team.id]}
                    logoFilter={TEAM_LOGO_FILTERS[team.id]}
                    primaryColor={team.primaryColor}
                    active={!activeLeagueId && activeTeamId === team.id}
                    onClick={() => { setActiveTeamId(team.id); setActiveLeagueId(null); }}
                  />
                ))}
              </div>

              {/* A followed competition is ONE pill for the whole competition —
                  never expanded into its teams or drivers. Following F1 means
                  following the championship, so the pill is "F1", not 20 drivers. */}
              {followedLeagues.length > 0 && (
                <>
                  <p className="text-[9px] font-semibold uppercase tracking-widest mb-1.5 mt-2.5" style={{ color: 'var(--text-3)' }}>Competitions</p>
                  <div className="sh-chips">
                    {followedLeagues.map(leagueId => (
                      <TeamFilterPill
                        key={leagueId}
                        label={LEAGUE_BADGE[leagueId]?.label ?? leagueId.toUpperCase()}
                        primaryColor={leagueBrandAccent(leagueId)}
                        active={activeLeagueId === leagueId}
                        onClick={() => {
                          setActiveLeagueId(prev => prev === leagueId ? null : leagueId);
                          setActiveTeamId('all');
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Results content */}
          {loading ? (
            <ResultsSkeleton />
          ) : filteredResults.length === 0 ? (
            <div className="text-center py-20" style={{ color: 'var(--text-3)' }}>
              <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {activeLeagueId
                  ? `No results yet for ${LEAGUE_BADGE[activeLeagueId]?.label ?? activeLeagueId.toUpperCase()}.`
                  : 'No results yet for this team.'}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ dateKey, representativeDate, results: dayResults }) => (
                <section key={dateKey} id={`result-date-${dateKey}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-[13px] font-black uppercase tracking-[0.12em] shrink-0" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-head)' }}>
                      {formatDateHeading(representativeDate, userTz)}
                    </p>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-[10px] font-semibold shrink-0 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                      {dayResults.length} {dayResults.length !== 1 ? 'results' : 'result'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {dayResults.map(result => {
                      const isHighlighted = hoveredDateKey === dateKey;
                      const isExpanded    = expandedId === result.id;

                      return (
                        <div
                          key={result.id}
                          style={{
                            borderRadius: 'var(--radius)',
                            transition: 'box-shadow 0.4s ease-out',
                            boxShadow: clickedDateKey === dateKey
                              ? `0 0 48px ${result.team.primaryColor}70, 0 0 0 1px ${result.team.primaryColor}50`
                              : isHighlighted
                                ? `0 0 28px ${result.team.primaryColor}30`
                                : undefined,
                          }}
                        >
                          <ResultRow
                            result={result}
                            userTz={userTz}
                            dateKey={dateKey}
                            isHighlighted={isHighlighted}
                            isExpanded={isExpanded}
                            onHover={handleCalendarHover}
                            onToggle={() => toggleExpand(result.id)}
                          />
                          {everExpandedIds.has(result.id) && (
                            <div style={{ display: isExpanded ? 'block' : 'none' }}>
                              <ResultExpandPanel
                                result={result}
                                onCollapse={() => toggleExpand(result.id)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <aside
          /* Pinned column: capped to the viewport with its own scroll context so
             nothing below the fold becomes unreachable (see the schedule page,
             where a tall column drops stickiness entirely). */
          className="hidden lg:block sticky top-20 space-y-4 mt-0
                     max-h-[calc(100vh-5.5rem)] overflow-y-auto overscroll-contain pb-4 pr-0.5"
        >
          {!loading && (
            <ScheduleCalendar
              games={filteredUpcoming}
              pastResults={filteredResults}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={handleUpcomingDayClick}
              onPastDayClick={handleDayClick}
            />
          )}
          <FollowedTeamsWidget teams={teams} />
        </aside>
      </div>

      {/* ── Mobile calendar bottom sheet ── */}
      {calendarOpen && (
        <>
          {/* Backdrop — fades in/out with the sheet */}
          <div
            className={[
              'fixed inset-0 z-50 lg:hidden bg-black/60 backdrop-blur-sm',
              'transition-opacity duration-[420ms] ease-out',
              calendarVisible ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            onClick={() => closeCalendar()}
          />
          {/* Sheet — slides up on open, down on close. sh-theme so the inner
              ResultsCalendar's .sh-card tokens resolve outside the page wrapper. */}
          <div
            className={[
              'sh-theme sh-sheet fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl px-4 pt-4 pb-8 max-h-[85vh] overflow-y-auto',
              'transition-transform duration-[420ms] ease-out',
              calendarVisible ? 'translate-y-0' : 'translate-y-full',
            ].join(' ')}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Calendar</p>
              <button
                onClick={() => closeCalendar()}
                className="transition-colors p-1 hover:text-[var(--text)]"
                style={{ color: 'var(--text-3)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!loading && (
              <ScheduleCalendar
                games={filteredUpcoming}
                pastResults={filteredResults}
                userTz={userTz}
                hoveredDateKey={hoveredDateKey}
                onHover={handleCalendarHover}
                onDayClick={(dk) => closeCalendar(() => handleUpcomingDayClick(dk))}
                onPastDayClick={(dk) => {
                  closeCalendar(() => {
                    const el = document.getElementById(`result-date-${dk}`);
                    if (el) {
                      const y = el.getBoundingClientRect().top + window.scrollY - 88;
                      smoothScrollTo(Math.max(0, y), 750);
                    }
                    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                    setClickedDateKey(dk);
                    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
                  });
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
