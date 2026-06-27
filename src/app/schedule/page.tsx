'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Calendar, List, MapPin, Tv, ChevronDown, UserMinus, X } from 'lucide-react';

import { getFollowedTeams, saveFollowedTeams, usePrefsVersion } from '@/lib/user-prefs';
// mock-data intentionally NOT imported — schedule page only shows real API fixtures.
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { TEAMS, LEAGUES, REAL_DATA_LEAGUES } from '@/lib/teams';
import { contrastColor, formatTimeInZone, datekeyInZone, smoothScrollTo, ordinal, dedupeChannels } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamBadge } from '@/components/ui/team-badge';
import { NextGameHero } from '@/components/schedule/next-game-hero';
import { NextGameHeroSh } from '@/components/schedule/next-game-hero-sh';
import { ScheduleCalendar } from '@/components/schedule/schedule-calendar';
import { SportBall } from '@/components/schedule/sport-ball';
import { LeagueTableSh } from '@/components/schedule/league-table-sh';

// PERF-1: the expand panel (~1.8k lines incl. WC/F1/cricket/AI sub-views) only
// renders after a fixture is expanded (everExpandedIds) or, for WcGroupBrowser, when
// a World Cup team is followed. Both live in the same module, so both are loaded
// lazily to keep them out of the schedule route's first-load bundle. ssr:false — the
// panel is purely interactive and reads localStorage/live data on the client.
const GameExpandPanel = dynamic(
  () => import('@/components/schedule/game-expand-panel').then(m => m.GameExpandPanel),
  { ssr: false, loading: () => <div className="sh-detail-body" style={{ padding: '20px', opacity: 0.6 }}>Loading…</div> },
);
const WcGroupBrowser = dynamic(
  () => import('@/components/schedule/game-expand-panel').then(m => m.WcGroupBrowser),
  { ssr: false },
);
import type { Team, UpcomingGame, SportKey, StandingRow } from '@/types';
import { wcStageLabel } from '@/lib/world-cup';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleEntry = UpcomingGame & { team: Team };

/** All competitions with browse support (real or mock fixtures + standings). */
const BROWSABLE_LEAGUE_IDS = new Set<string>(['afl', 'epl', 'nrl', 'super_rugby', 'rugby_int', 'nba', 'f1', 'bbl', 'cricket_int', 'world_cup']);

/** Ordered list for the competition filter pills. */
const BROWSABLE_LEAGUES = LEAGUES.filter(l => BROWSABLE_LEAGUE_IDS.has(l.id));

/** Build a minimal Team stub for games whose teamId isn't in the TEAMS array. */
function makeFallbackTeam(game: UpcomingGame, league: string): Team {
  const suffix = game.teamId.split('-').slice(1).join(' ');
  return {
    id:             game.teamId,
    name:           suffix || game.teamId,
    shortName:      suffix || game.teamId,
    abbreviation:   (suffix || game.teamId).slice(0, 3).toUpperCase(),
    league:         league as SportKey,
    sport:          'Unknown',
    city:           '',
    country:        '',
    primaryColor:   '#4B5563',
    secondaryColor: '#6B7280',
    venue:          game.venue ?? '',
  };
}

// ─── Adaptive background helpers ─────────────────────────────────────────────

const DEFAULT_BG_LEFT = 'rgba(96, 26, 44, 0.44)';

/** Darken a hex team color and return an rgba() string for the left background wash. */
function teamColorToBgStop(hex: string, opacity = 0.44): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return DEFAULT_BG_LEFT;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const f = 0.30; // darken factor — keeps the wash very subtle
  return `rgba(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)}, ${opacity})`;
}

function setBgLeft(color: string) {
  document.documentElement.style.setProperty('--bg-left-color', color);
}

function resetBgLeft() {
  document.documentElement.style.setProperty('--bg-left-color', DEFAULT_BG_LEFT);
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadFixtures(team: Team): Promise<UpcomingGame[]> {
  if (!REAL_DATA_LEAGUES.has(team.league)) return [];
  try {
    const res  = await fetch(`/api/fixtures?league=${team.league}&teamId=${team.id}`);
    const data = res.ok ? await res.json() : [];
    if (Array.isArray(data) && data.length > 0) return data;
  } catch { /* network error — return empty */ }
  return [];
}

async function loadResults(team: Team): Promise<import('@/types').GameResult[]> {
  if (!REAL_DATA_LEAGUES.has(team.league)) return [];
  try {
    const res  = await fetch(`/api/results?league=${team.league}&teamId=${team.id}`);
    const data = res.ok ? await res.json() : [];
    if (Array.isArray(data) && data.length > 0) return data;
  } catch { /* network error — return empty */ }
  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateHeading(representativeDate: Date, dateKey: string, userTz: string): string {
  const now         = new Date();
  const todayKey    = datekeyInZone(now.toISOString(), userTz);
  const tomorrowKey = datekeyInZone(new Date(now.getTime() + 86_400_000).toISOString(), userTz);

  const full = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz,
    weekday: 'long',
    day:     'numeric',
    month:   'long',
  }).format(representativeDate);

  if (dateKey === todayKey)    return `Today · ${full}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${full}`;
  return full;
}

// ─── Fixture / league badge ───────────────────────────────────────────────────
// Each entry uses exact brand colours and a Unicode symbol that evokes the
// official logo's iconography — no image required.
// \uFE0E (Variation Selector-15) forces text presentation so CSS color applies.

interface BadgeMeta {
  /** Unicode glyph prefix. \uFE0E appended to force text (not emoji) rendering. */
  symbol?: string;
  /** Colour override for the symbol when it differs from the label colour. */
  symbolColor?: string;
  /** Short display label. */
  label: string;
  /** Abbreviated label for compact display when space is tight (e.g. 'UCL' for 'Champions League'). Falls back to label if unset. */
  abbr?: string;
  /** Badge background — official brand colour, darkened for legibility. */
  bg: string;
  /** Label text colour. */
  color: string;
  /** Border colour. */
  border: string;
  /** Kept for the watermark <img> in ScheduleRow — not shown in the badge. */
  logoUrl?: string;
  /** Opacity for the watermark logo — defaults to 0.18 if omitted. */
  logoOpacity?: number;
  /** CSS mix-blend-mode for the watermark logo — 'screen' dissolves dark backgrounds (good for UCL/UEFA logos). */
  logoBlend?: string;
  /** CSS filter applied to the watermark logo — e.g. 'brightness(0) invert(1)' forces the logo to white. */
  logoFilter?: string;
  /** Override the default h-[140%] height class for this logo's watermark. */
  logoHeight?: string;
  /** Cap the width of wide/banner logos so they don't spill across the card. */
  logoMaxWidth?: string;
}

// ── Primary-league badges ─────────────────────────────────────────────────────
const LEAGUE_BADGE: Record<string, BadgeMeta> = {
  afl: {
    // AFL: navy + gold — no symbol, "AFL" reads cleanly on its own
    label: 'AFL',
    bg: '#001d3d', color: '#f4ac20', border: 'rgba(244,172,32,0.30)',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png',
    logoOpacity: 0.10,
  },
  nrl: {
    // NRL: ◆ (diamond from the NRL shield mark) in brand red on navy
    symbol: '◆\uFE0E', symbolColor: '#e21b23',
    label: 'NRL',
    bg: '#002955', color: '#ffffff', border: 'rgba(226,27,35,0.40)',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png',
    logoOpacity: 0.27, logoHeight: '98%',
  },
  epl: {
    // Premier League: ♛ (queen chess piece = stylised lion) in PL gold on official purple
    symbol: '♛\uFE0E', symbolColor: '#e8a200',
    label: 'Premier League', abbr: 'EPL',
    bg: '#38003c', color: '#ffffff', border: 'rgba(255,255,255,0.18)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
    logoOpacity: 0.11, logoFilter: 'brightness(0) invert(1)',
  },
  super_rugby: {
    // Super Rugby Pacific: "SR" abbreviated, electric blue palette
    label: 'Super Rugby', abbr: 'SUPER',
    bg: '#0b2a6b', color: '#7eb8ff', border: 'rgba(126,184,255,0.28)',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png',
    logoOpacity: 0.18, logoHeight: '110%',
  },
  rugby_int: {
    // International Test rugby: ✦ (four-point star, World Rugby style) on dark slate
    symbol: '✦\uFE0E', symbolColor: '#8899bb',
    label: 'Test Rugby', abbr: 'TEST',
    bg: '#0f1a2e', color: '#a0b4cc', border: 'rgba(160,180,204,0.22)',
  },
  nba: {
    // NBA: dark navy + brand red, basketball emoji from league icon
    symbol: '🏀', label: 'NBA',
    bg: '#051828', color: '#c8102e', border: 'rgba(200,16,46,0.35)',
  },
  nhl: {
    // NHL: near-black + icy silver, hockey stick emoji from league icon
    symbol: '🏒', label: 'NHL',
    bg: '#0a0f1a', color: '#c0c8d4', border: 'rgba(192,200,212,0.28)',
  },
  f1: {
    // F1: official scarlet on near-black, checkered flag symbol
    symbol: '🏁', label: 'F1',
    bg: '#1a0000', color: '#E8002D', border: 'rgba(232,0,45,0.40)',
    logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',
    logoOpacity: 0.15,
  },
  bbl: {
    symbol: '🏏', label: 'BBL',
    bg: '#001428', color: '#d917a5', border: '#d917a550',
  },
  cricket_int: {
    symbol: '🏏', label: 'Cricket',
    bg: '#0a1a00', color: '#78be20', border: '#78be2050',
  },
  world_cup: {
    symbol: '🏆', label: 'World Cup', abbr: 'WC',
    bg: '#1a0a00', color: '#c8922a', border: 'rgba(200,146,42,0.40)',
  },
};

// ── Cup / European competition badges ─────────────────────────────────────────
const COMPETITION_BADGE: Record<string, BadgeMeta> = {
  'Champions League': {
    // UCL: ★ (the iconic starball mark) in official gold on UCL dark navy
    symbol: '★\uFE0E', symbolColor: '#ffd700',
    label: 'Champions League', abbr: 'UCL',
    bg: '#071432', color: '#dce8ff', border: 'rgba(255,215,0,0.30)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
    logoOpacity: 0.68, logoBlend: 'screen',
  },
  'Europa League': {
    // UEL: ◎ (bullseye / UEL circular motif) in brand orange on dark ground
    symbol: '◎\uFE0E', symbolColor: '#f57320',
    label: 'Europa League', abbr: 'UEL',
    bg: '#200e00', color: '#f57320', border: 'rgba(245,115,32,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png',
    logoOpacity: 0.56, logoBlend: 'screen',
  },
  'Conference League': {
    // UECL: ◉ (inner circle = target / conference identity) in brand teal
    symbol: '◉\uFE0E', symbolColor: '#00c87a',
    label: 'Conference League', abbr: 'UECL',
    bg: '#001a10', color: '#00c87a', border: 'rgba(0,200,122,0.32)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png',
    logoOpacity: 0.56, logoBlend: 'screen',
  },
  'FA Cup': {
    // FA Cup: Three Lions abstracted as ◆ ◆ ◆ is complex — use ✦ on FA red
    symbol: '✦\uFE0E', symbolColor: '#ffffff',
    label: 'FA Cup',
    bg: '#1a0005', color: '#ff2244', border: 'rgba(255,34,68,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',
    logoOpacity: 0.47, logoBlend: 'screen',
  },
  'EFL Cup': {
    // EFL Cup / Carabao Cup: official green palette, "EFL" abbreviation
    label: 'EFL Cup',
    bg: '#0d1f00', color: '#78be20', border: 'rgba(120,190,32,0.38)',
    logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',
    logoOpacity: 0.43, logoBlend: 'screen',
  },
  'State of Origin': {
    // SOO: maroon/gold — official Ampol State of Origin series logo
    label: 'SOO',
    bg: '#1a0000', color: '#F5A623', border: 'rgba(245,166,35,0.35)',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png',
    logoOpacity: 0.18, logoHeight: '98%',
  },
};

/** A competition's recognizable brand hue for active-chip tinting (Phase B · Step 2 refine).
 *  Prefers the badge's foreground `color`, falling back to `bg` when that's white/near-white
 *  — so EPL (color #fff) resolves to its purple `bg`, F1 to red, AFL to gold, etc. */
function leagueBrandAccent(leagueId: string): string {
  const meta = LEAGUE_BADGE[leagueId];
  const c = (meta?.color ?? '').toLowerCase();
  const whiteish = c === '#fff' || c === '#ffffff';
  return (whiteish ? meta?.bg : meta?.color) ?? meta?.bg ?? '#9b6bff';
}

function FixtureBadge({ league, competition, compact }: { league: string; competition?: string; compact?: boolean }) {
  const baseComp = competition?.startsWith('State of Origin') ? 'State of Origin' : competition;
  const meta = baseComp
    ? (COMPETITION_BADGE[baseComp] ?? null)
    : (LEAGUE_BADGE[league] ?? null);

  const fullLabel = meta?.label ?? (competition ?? league.toUpperCase());
  // In compact mode, prefer the abbreviation so the badge stays narrow and on-line
  const label    = compact && meta?.abbr ? meta.abbr : fullLabel;
  const bg       = meta?.bg      ?? 'rgba(255,255,255,0.06)';
  const color    = meta?.color   ?? 'rgba(255,255,255,0.40)';
  const border   = meta?.border  ?? 'rgba(255,255,255,0.12)';

  return (
    <span
      className="inline-flex items-center gap-[3px] text-[10px] font-black uppercase tracking-wide rounded border px-[5px] py-[3px] shrink-0 leading-none"
      style={{ background: bg, color, borderColor: border }}
    >
      {meta?.symbol && (
        <span aria-hidden="true" style={{ color: meta.symbolColor ?? color, fontSize: '8px' }}>
          {meta.symbol}
        </span>
      )}
      {label}
    </span>
  );
}

// ─── Schedule row ─────────────────────────────────────────────────────────────

// ─── Channel deduplication ────────────────────────────────────────────────────

interface ScheduleRowProps {
  game: ScheduleEntry;
  userTz: string;
  dateKey: string;
  isHighlighted: boolean;
  isExpanded: boolean;
  /** True in league-browse mode when the user follows one of the two teams. */
  isFollowed?: boolean;
  /** teamId → league position, shown in league-browse mode for AFL/NRL/EPL. */
  standingsMap?: Map<string, number>;
  onHover: (dateKey: string | null) => void;
  onToggle: () => void;
}

function ScheduleRow({
  game,
  userTz,
  dateKey,
  isHighlighted,
  isExpanded,
  isFollowed = false,
  standingsMap,
  onHover,
  onToggle,
}: ScheduleRowProps) {
  const { team } = game;
  const isF1           = team.league === 'f1';
  const isCricket      = team.league === 'bbl' || team.league === 'cricket_int';
  const displayTime    = formatTimeInZone(game.date, userTz);
  // Normalise SOO competition strings ("State of Origin — Game N (…)") to the base key
  const baseComp        = game.competition?.startsWith('State of Origin') ? 'State of Origin' : game.competition;
  // Only show league positions for plain league fixtures — not cups or series games.
  const isLeagueFixture = !baseComp || !COMPETITION_BADGE[baseComp];
  const teamPosition      = isLeagueFixture ? standingsMap?.get(team.id) : undefined;
  const opponentPosition  = isLeagueFixture && game.opponentId ? standingsMap?.get(game.opponentId) : undefined;

  const teamLogoUrl    = TEAM_LOGOS[team.id];
  const teamLogoFilter = TEAM_LOGO_FILTERS[team.id];
  const leagueMeta     = (baseComp ? COMPETITION_BADGE[baseComp] : undefined)
    ?? LEAGUE_BADGE[team.league];
  const leagueLogoUrl      = leagueMeta?.logoUrl;
  const leagueLogoOpacity  = leagueMeta?.logoOpacity ?? 0.18;
  const leagueLogoBlend    = leagueMeta?.logoBlend;
  const leagueLogoFilter   = leagueMeta?.logoFilter;
  const leagueLogoHeight   = leagueMeta?.logoHeight;
  const leagueLogoMaxWidth = leagueMeta?.logoMaxWidth;
  // Logo center alignment: translateX(50%) self-measures the logo's rendered width and shifts it
  // rightward by half, so `right: 49px` becomes the CENTER anchor — works for any aspect ratio.
  const LOGO_CENTER_RIGHT = '49px';

  // Three-tier opponent name: (1) raw API string when ≤14 chars; (2) our team.name
  // when shorter than the API string (e.g. "Greater Western Sydney" → "GWS Giants");
  // (3) team.shortName when team.name is no shorter (e.g. "Tottenham Hotspur" → "Spurs").
  // Compact font (last resort): only if the DISPLAY name is still > 11 chars after
  // substitution — applied equally to BOTH names so the card is always one consistent size.
  const SHORTNAME_THRESHOLD = 14;
  const oppTeam = game.opponentId ? TEAMS.find(t => t.id === game.opponentId) : undefined;
  const oppDisplayName = game.opponent.length > SHORTNAME_THRESHOLD && oppTeam
    ? (oppTeam.name.length < game.opponent.length ? oppTeam.name : oppTeam.shortName)
    : game.opponent;
  const longerDisplayLen = Math.max(team.shortName.length, oppDisplayName.length);
  const isCompact     = longerDisplayLen > 11;
  const nameFontSize  = isCompact ? '14px' : '17px';
  const compactBadge  = isCompact;

  // Mobile time split: strip the trailing TZ abbreviation from the time string so it
  // can be shown on a separate line, freeing horizontal space for the team names.
  // e.g. "7:30 pm AEST" → timeOnly="7:30 pm", tzAbbr="AEST"
  // Falls back gracefully when the format doesn't match (e.g. "TBC").
  const lastSpace   = displayTime.lastIndexOf(' ');
  const possibleTz  = lastSpace > 0 ? displayTime.slice(lastSpace + 1) : '';
  const hasTzSuffix = /^[A-Z]{2,6}([+-]\d+)?$/.test(possibleTz);
  const mobileTimeOnly = hasTzSuffix ? displayTime.slice(0, lastSpace) : displayTime;
  const mobileTzAbbr   = hasTzSuffix ? possibleTz : '';

  // Subtitle shown below the time on desktop (and on mobile when there is no TZ to show)
  const timeSubtitle = isF1
    ? (game.competition ?? 'F1')
    : isCricket && game.cricketFormat
      ? (game.cricketFormat === 'test' ? 'Test' : game.cricketFormat === 'odi' ? 'ODI' : 'T20')
      : game.isHome ? 'Home' : 'Away';

  // ── Phase B · Step 2 — TWO-TEAM fixtures use the new `.sh-fix` card (team-coloured
  //    via per-card --accent). F1 (non-versus) falls through to the existing render
  //    below, unchanged. Every handler + a11y attr is preserved; all informational
  //    elements the old row showed are folded in (positions, cricket-format pill,
  //    ★ Following, mobile time-split, name-length clamp). The existing expand panel
  //    + its wiring are untouched. ──
  if (!isF1) {
    const compMeta   = baseComp ? (COMPETITION_BADGE[baseComp] ?? null) : (LEAGUE_BADGE[team.league] ?? null);
    const compShort  = compMeta?.abbr ?? compMeta?.label ?? (game.competition ?? team.league.toUpperCase()); // prefer the short code so the pill never wraps
    const compColor  = compMeta?.color ?? 'rgba(255,255,255,0.7)';
    const cricketColor = game.cricketFormat === 'test' ? '#e2a84b' : game.cricketFormat === 'odi' ? '#60a5fa' : '#a78bfa';
    const cricketLabel = game.cricketFormat === 'test' ? 'Test' : game.cricketFormat?.toUpperCase();
    const nameSize   = isCompact ? { fontSize: '14px' } : undefined;
    const posStyle   = { fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text-3)' } as React.CSSProperties;

    return (
      <article
        className={'sh-fix' + (isExpanded ? ' is-open' : '')}
        style={{ '--accent': team.primaryColor } as React.CSSProperties}
        onClick={onToggle}
        onMouseEnter={() => onHover(dateKey)}
        onMouseLeave={() => onHover(null)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        {/* Team watermark — logo inside wrapper when available, text fallback otherwise */}
        <div className="sh-fix-wm" aria-hidden="true">
          {teamLogoUrl
            ? <img src={teamLogoUrl} alt="" aria-hidden="true" draggable={false} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : team.shortName.toUpperCase()
          }
        </div>

        {/* Competition logo watermark */}
        {leagueLogoUrl && (
          <img
            src={leagueLogoUrl} alt="" aria-hidden="true" width={100} height={100}
            className="absolute top-1/2 -translate-y-1/2 translate-x-1/2 w-auto object-contain pointer-events-none select-none origin-center max-lg:scale-[0.7] lg:scale-[1.3]"
            style={{
              right: LOGO_CENTER_RIGHT, height: leagueLogoHeight ?? '140%',
              ...(leagueLogoMaxWidth ? { maxWidth: leagueLogoMaxWidth } : {}),
              opacity: leagueLogoOpacity,
              ...(leagueLogoBlend  ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}),
              ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}),
            }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}

        {/* Feature badge: left column (direct flex item on the article) */}
        <span className="sh-fix-badge-f">
          <TeamBadge logoUrl={teamLogoUrl} abbreviation={team.abbreviation} primaryColor={team.primaryColor} size={56} logoFilter={teamLogoFilter} />
        </span>

        {/* Text column: main row + sub row, so the sub aligns under names */}
        <div className="sh-fix-text">
          <div className="sh-fix-main">
            {/* Outer wraps so ONLY the trailing tags drop to a second line; the matchup
                (two teams + separator) is an inner nowrap unit that never breaks. Positions
                ride with their team inside the nowrap unit (wrapping them away would orphan
                "(3rd)"); the comp/cricket/following pills wrap before the matchup ever does. */}
            <div className="sh-fix-teams" style={{ flexWrap: 'wrap', rowGap: '6px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'nowrap', minWidth: 0 }}>
                <span className="sh-fix-name" style={nameSize}>{team.shortName}</span>
                {teamPosition !== undefined && <span style={posStyle}>({ordinal(teamPosition)})</span>}
                <span className="sh-fix-sep">{game.isHome ? 'vs' : '@'}</span>
                {/* Opponent badge: 40px circle (bumped from 32 for clearer hierarchy) */}
                <TeamBadge logoUrl={game.opponentLogoUrl} abbreviation={game.opponentAbbr} primaryColor={game.opponentColor} size={40} logoFilter={TEAM_LOGO_FILTERS[game.opponentId ?? '']} />
                <span className="sh-fix-name" style={nameSize}>{oppDisplayName}</span>
                {opponentPosition !== undefined && <span style={posStyle}>({ordinal(opponentPosition)})</span>}
              </span>
              {team.league !== 'cricket_int' && (
                <span className="sh-comptag" style={{ '--c': compColor } as React.CSSProperties}>{compShort}</span>
              )}
              {isCricket && game.cricketFormat && (
                <span className="sh-comptag" style={{ '--c': cricketColor } as React.CSSProperties}>{cricketLabel}</span>
              )}
              {isFollowed && (
                <span className="sh-comptag" style={{ '--c': team.primaryColor } as React.CSSProperties}>★ Following</span>
              )}
            </div>

            <div className="sh-fix-time">
              <span className="sh-fix-kick">
                <span className="lg:hidden">{mobileTimeOnly}</span>
                <span className="hidden lg:inline">{displayTime}</span>
              </span>
              {mobileTzAbbr && (
                <span className="lg:hidden" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)' }}>{mobileTzAbbr}</span>
              )}
              <span className={'sh-tag-venue is-' + (game.isHome ? 'home' : 'away')}>{game.isHome ? 'Home' : 'Away'}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-3)' }} />
            </div>
          </div>

          <div className="sh-fix-sub">
            {game.venue && (
              <span className="sh-meta-item"><MapPin size={14} /><span className="truncate" style={{ maxWidth: '220px' }}>{game.venue}</span></span>
            )}
            <span className="sh-meta-item"><Tv size={14} /><span className="truncate">{dedupeChannels(game.broadcast, game.streaming)}</span></span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div
      className={[
        'relative overflow-hidden flex items-center gap-4 glass px-4 py-4 cursor-pointer min-h-[84px]',
        'transition-all duration-300 ease-out select-none',
        isExpanded ? 'rounded-t-2xl' : 'rounded-2xl',
      ].join(' ')}
      style={{
        borderLeftColor: isFollowed ? team.primaryColor : `${team.primaryColor}cc`,
        borderLeftWidth: isFollowed ? '3px' : '3px',
        transition: 'box-shadow 0.4s ease-out',
        boxShadow: isFollowed && !isExpanded
          ? `inset 0 0 0 1px ${team.primaryColor}30, 0 0 32px ${team.primaryColor}28`
          : isHighlighted && !isExpanded
            ? `inset 0 0 0 1px ${team.primaryColor}28, 0 0 40px ${team.primaryColor}22`
            : undefined,
      }}
      onClick={onToggle}
      onMouseEnter={() => onHover(dateKey)}
      onMouseLeave={() => onHover(null)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      {/* ── Team-colour ambient tint (sits above glass, below content) ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(105deg, ${team.primaryColor}10 0%, transparent 40%)` }}
      />

      {/* ── Background watermarks ──
           width/height give intrinsic dimensions so the browser reserves space; the
           CSS height + w-auto still govern the displayed size, and the UA-mapped
           aspect-ratio:auto defers to each logo's natural ratio (no distortion). */}
      {teamLogoUrl && (
        <img
          src={teamLogoUrl}
          alt=""
          aria-hidden="true"
          width={100}
          height={100}
          className="absolute top-1/2 -translate-y-1/2 h-[150%] w-auto object-contain pointer-events-none select-none"
          style={{ right: '88px', opacity: 0.10 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {leagueLogoUrl && (
        <img
          src={leagueLogoUrl}
          alt=""
          aria-hidden="true"
          width={100}
          height={100}
          className={[
            'absolute top-1/2 -translate-y-1/2 translate-x-1/2 w-auto object-contain pointer-events-none select-none origin-center',
            // Reduce league watermark by 30% on mobile — F1 logo left as-is (already right size)
            team.league !== 'f1' ? 'max-lg:scale-[0.7] lg:scale-[1.3]' : '',
          ].join(' ')}
          style={{ right: LOGO_CENTER_RIGHT, height: leagueLogoHeight ?? '140%', ...(leagueLogoMaxWidth ? { maxWidth: leagueLogoMaxWidth } : {}), opacity: leagueLogoOpacity, ...(leagueLogoBlend ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}), ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}) }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* ── Team badge — oversized with neon glow ── */}
      <div
        className="relative shrink-0 z-10 self-center"
        style={{ filter: `drop-shadow(0 0 16px ${team.primaryColor}66)` }}
      >
        <TeamBadge
          logoUrl={teamLogoUrl}
          abbreviation={team.abbreviation}
          primaryColor={team.primaryColor}
          size={52}
          logoFilter={teamLogoFilter}
        />
      </div>

      {/* ── Matchup + metadata ── */}
      <div className="flex-1 min-w-0 relative z-10">
        {/* Primary line: team vs opponent */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* For F1 in league-browse mode, show the Grand Prix name as the headline */}
          {isF1 ? (
            <>
              <span className="text-[17px] font-semibold text-white/70 leading-none">
                {game.opponent}
              </span>
              {game.competition && (
                <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0"
                  style={{ color: '#E8002D', background: 'rgba(232,0,45,0.12)', borderColor: 'rgba(232,0,45,0.35)' }}
                >
                  {game.competition === 'Race' ? '🏁\uFE0E ' : ''}{game.competition}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-semibold text-white/70 leading-none" style={{ fontSize: nameFontSize }}>
                {team.shortName}
              </span>
              {teamPosition !== undefined && (
                <span className="text-[13px] font-bold text-white/35 leading-none">({ordinal(teamPosition)})</span>
              )}
              <span className="text-[14px] font-medium text-white/30">
                {game.isHome ? 'vs' : '@'}
              </span>
              <TeamBadge
                logoUrl={game.opponentLogoUrl}
                abbreviation={game.opponentAbbr}
                primaryColor={game.opponentColor}
                size={30}
                className="rounded-md"
                logoFilter={TEAM_LOGO_FILTERS[game.opponentId ?? '']}
              />
              <span className="font-semibold text-white/70 leading-none" style={{ fontSize: nameFontSize }}>
                {game.opponent}
              </span>
              {opponentPosition !== undefined && (
                <span className="text-[13px] font-bold text-white/35 leading-none">({ordinal(opponentPosition)})</span>
              )}
            </>
          )}
          {!isF1 && team.league !== 'cricket_int' && <FixtureBadge league={team.league} competition={game.competition} compact={compactBadge} />}
          {team.league === 'world_cup' && game.worldCupStage && (
            <span
              className="inline-flex items-center text-[9px] font-black uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 leading-none border"
              style={{ color: '#c8922a', background: 'rgba(200,146,42,0.12)', borderColor: 'rgba(200,146,42,0.35)' }}
            >
              {wcStageLabel(game.worldCupStage, game.worldCupGroup)}
            </span>
          )}
          {isCricket && game.cricketFormat && (
            <span
              className="inline-flex items-center text-[9px] font-black uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 leading-none border"
              style={
                game.cricketFormat === 'test'
                  ? { color: '#e2a84b', background: 'rgba(226,168,75,0.12)', borderColor: 'rgba(226,168,75,0.35)' }
                  : game.cricketFormat === 'odi'
                  ? { color: '#60a5fa', background: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.35)' }
                  : { color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.35)' }
              }
            >
              {game.cricketFormat === 'test' ? 'Test Match' : game.cricketFormat.toUpperCase()}
            </span>
          )}
          {isFollowed && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 leading-none"
              style={{
                background: `${team.primaryColor}22`,
                color:      team.primaryColor,
                border:     `1px solid ${team.primaryColor}44`,
              }}
            >
              ★ Following
            </span>
          )}
        </div>

        {/* Secondary line: venue + broadcast — single line, no wrap */}
        <div className="flex items-center gap-3 mt-1.5 min-w-0 overflow-hidden">
          {game.venue && (
            <span className="flex items-center gap-1 text-[11px] text-white/30 shrink-0 min-w-0 max-w-[130px]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{game.venue}</span>
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-white/30 truncate min-w-0">
            <Tv className="h-3 w-3 shrink-0" />
            <span className="truncate">{dedupeChannels(game.broadcast, game.streaming)}</span>
          </span>
        </div>
      </div>

      {/* ── Time + chevron ── */}
      <div className="text-right shrink-0 flex items-center gap-2 relative z-10">
        <div>
          {/* Mobile: time without TZ so the column is narrower */}
          <p className="text-[19px] font-bold leading-none tabular-nums text-white/85">
            <span className="lg:hidden">{mobileTimeOnly}</span>
            <span className="hidden lg:inline">{displayTime}</span>
          </p>
          {/* Mobile: TZ abbr on its own line  |  Desktop: Home/Away/session label */}
          <p className="text-[11px] font-medium text-white/30 mt-0.5 uppercase tracking-wide">
            {mobileTzAbbr
              ? <><span className="lg:hidden">{mobileTzAbbr}</span><span className="hidden lg:inline">{timeSubtitle}</span></>
              : timeSubtitle}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/20 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ScheduleSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map(i => (
        <div key={i}>
          <div className="h-4 w-52 bg-white/8 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {[0, 1].map(j => (
              <div key={j} className="h-[72px] bg-white/5 border border-white/8 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── FilterPill ───────────────────────────────────────────────────────────────

// Phase B · Step 2 — reskinned to the design's segmented control. Call-site props
// (label/active/onClick) and every handler are unchanged; `muted` is accepted for
// call-site compatibility but no longer needed (active state = page accent via .sh-seg).
function FilterPill({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void; muted?: boolean;
}) {
  return (
    <button onClick={onClick} className={'sh-seg' + (active ? ' is-active' : '')}>
      {label}
    </button>
  );
}

// ─── TeamFilterPill ────────────────────────────────────────────────────────────

// Phase B · Step 2 (refine #2) — reskinned to `.sh-chip`; an ACTIVE chip self-colours by
// subject: its own team's primaryColor is set inline as `--accent`, which `.sh-chip.is-active`
// turns into the soft-tint bg + border (text stays --text, legible for dark colours). The
// "All" chip has no primaryColor → it keeps the inherited page/focal accent.
function TeamFilterPill({
  label, logoUrl, logoFilter, primaryColor, league, active, onClick,
}: {
  label: string; logoUrl?: string; logoFilter?: string; primaryColor?: string; league?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={'sh-chip' + (active ? ' is-active' : '')}
      style={active && primaryColor ? ({ '--accent': primaryColor } as React.CSSProperties) : undefined}
    >
      {logoUrl && (
        <img
          src={logoUrl}
          alt=""
          width={15}
          height={15}
          className="w-[15px] h-[15px] object-contain shrink-0"
          style={logoFilter ? { filter: logoFilter } : undefined}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {label}
      {league && <SportBall league={league} size={11} />}
    </button>
  );
}

// ─── LeagueFilterPill ─────────────────────────────────────────────────────────

// Phase B · Step 2 (refine #2) — reskinned to `.sh-chip` (Decision i: competition stays
// PILLS, not a select). An ACTIVE chip self-colours by subject: the competition's brand
// hue (leagueBrandAccent — EPL stays purple) is set inline as `--accent`.
function LeagueFilterPill({
  leagueId, active, onClick,
}: {
  leagueId: string; active: boolean; onClick: () => void;
}) {
  const meta = LEAGUE_BADGE[leagueId];
  const isWC = leagueId === 'world_cup';
  const wcInactiveStyle = isWC && !active ? {
    borderColor: 'rgba(200,146,42,0.55)',
    boxShadow: '0 0 10px rgba(200,146,42,0.22), inset 0 0 6px rgba(200,146,42,0.06)',
    color: 'rgba(224,170,60,0.95)',
  } : undefined;
  return (
    <button
      onClick={onClick}
      className={'sh-chip' + (active ? ' is-active' : '')}
      style={active ? ({ '--accent': leagueBrandAccent(leagueId) } as React.CSSProperties) : wcInactiveStyle}
    >
      <SportBall league={leagueId} size={11} />
      {meta?.label ?? leagueId.toUpperCase()}
    </button>
  );
}

// ─── Followed-teams sidebar widget ────────────────────────────────────────────

function FollowedTeamsWidget({ teams, onUnfollow }: { teams: Team[]; onUnfollow: (id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popup on any click outside the widget
  useEffect(() => {
    if (!openId) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openId]);

  if (teams.length === 0) return null;
  return (
    <div ref={containerRef} className="sh-card sh-following">
      {/* Phase B · Step 3 (2C) — reskinned to .sh-card.sh-following. The per-badge
          unfollow popup is PRESERVED (an existing interaction the design's display-only
          badge omits); onboarding access moves to the header .sh-edit-link "Edit". */}
      <div className="sh-card-head">
        <span className="sh-card-head-label">Following</span>
        <Link href="/onboarding" className="sh-edit-link">Edit</Link>
      </div>
      <div className="sh-follow-grid">
        {teams.map(team => (
          <div key={team.id} className="sh-follow-item relative">
            {/* Badge — click toggles popup */}
            <button
              onClick={() => setOpenId(prev => prev === team.id ? null : team.id)}
              className="block rounded-xl transition-transform active:scale-95"
              style={{ filter: `drop-shadow(0 0 8px ${team.primaryColor}44)` }}
              aria-label={`Options for ${team.shortName}`}
            >
              <TeamBadge
                logoUrl={TEAM_LOGOS[team.id]}
                abbreviation={team.abbreviation}
                primaryColor={team.primaryColor}
                size={42}
                className="rounded-xl"
                logoFilter={TEAM_LOGO_FILTERS[team.id]}
              />
            </button>

            {/* Popup */}
            {openId === team.id && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-40 rounded-xl overflow-hidden shadow-xl"
                style={{ border: `1px solid ${team.primaryColor}44`, minWidth: '110px' }}
              >
                {/* Team name header */}
                <div
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-center"
                  style={{ background: `${team.primaryColor}22`, color: team.primaryColor }}
                >
                  {team.shortName}
                </div>
                {/* Unfollow button */}
                <button
                  onClick={() => { onUnfollow(team.id); setOpenId(null); }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/15 transition-colors"
                  style={{ background: 'rgba(10,10,15,0.95)' }}
                >
                  <UserMinus className="h-3 w-3" />
                  Unfollow
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const router = useRouter();
  const [teams,    setTeams]    = useState<Team[]>([]);
  const [allGames, setAllGames] = useState<ScheduleEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [userTz,   setUserTz]   = useState('Australia/Brisbane');
  const prefsVersion = usePrefsVersion(); // bumps when followed teams change (e.g. post-sign-in merge)

  const [activeTeamId,    setActiveTeamId]    = useState<string>('all');
  const [activeLeagueId,  setActiveLeagueId]  = useState<string | null>(null);
  const [leagueLoading,   setLeagueLoading]   = useState(false);
  // Keyed cache — reading synchronously in the same render as activeLeagueId changes
  // avoids the one-render lag that caused the flash of the previous league's games.
  const leagueCacheRef    = useRef<Map<string, ScheduleEntry[]>>(new Map());
  const [leagueCacheVersion, setLeagueCacheVersion] = useState(0);
  const [homeAwayFilter,  setHomeAwayFilter]  = useState<'all' | 'home' | 'away'>('all');
  const [gameRangeFilter, setGameRangeFilter] = useState<'all' | 'this_round'>('all');
  const standingsCacheRef     = useRef<Map<string, StandingRow[] | null>>(new Map());
  const [standingsCacheVersion, setStandingsCacheVersion] = useState(0);

  // Cross-highlight state: shared between calendar and schedule rows
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);

  // Expanded card state
  const [expandedId,      setExpandedId]      = useState<string | null>(null);
  const [everExpandedIds, setEverExpandedIds] = useState<Set<string>>(new Set());
  // Track whether the hero expand panel is open (used to hide the WC sidebar standings duplicate)
  const [heroExpanded,    setHeroExpanded]    = useState(false);

  // Past results for calendar (fetched on load, filtered to last 2 months)
  const [pastResults, setPastResults] = useState<(import('@/types').GameResult & { team: Team })[]>([]);

  // Mobile calendar bottom sheet — opened by the navbar Calendar button via custom event,
  // or via ?cal=1 URL param (used when navigating from the home page).
  const [calendarOpen,    setCalendarOpen]    = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);

  const openCalendar = useCallback(() => {
    setCalendarOpen(true);
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cal') === '1') {
      openCalendar();
      // Clean the param from the URL without a page reload
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [openCalendar]);

  // Calendar click — temporary glow on the clicked date's fixtures
  const [clickedDateKey, setClickedDateKey] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect browser timezone once on mount
  useEffect(() => {
    try {
      setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // keep default AEST
    }
  }, []);

  // Adaptive left-background color — reflects active team or first followed team.
  useEffect(() => {
    if (activeTeamId !== 'all') {
      const team = teams.find(t => t.id === activeTeamId);
      if (team?.primaryColor) {
        setBgLeft(teamColorToBgStop(team.primaryColor));
        return;
      }
    }
    // "All teams" mode — use first followed team as ambient tint
    if (teams.length > 0 && teams[0].primaryColor) {
      setBgLeft(teamColorToBgStop(teams[0].primaryColor));
    } else {
      resetBgLeft();
    }
  }, [activeTeamId, teams]);

  // Reset on unmount so other pages keep the default
  useEffect(() => () => { resetBgLeft(); }, []);

  // NOTE: standings resolution (standingsLeague / standings / standingsMap) lives
  // *below* the heroGame memo — it now falls back to the hero game's league when the
  // hero panel is open, which requires heroGame to be defined first.

  // Fetch league fixtures on first visit; subsequent visits are served from the
  // ref cache synchronously (same render as activeLeagueId changes — no flash).
  useEffect(() => {
    if (!activeLeagueId) return;
    if (leagueCacheRef.current.has(activeLeagueId)) {
      setLeagueLoading(false);
      return;
    }
    setLeagueLoading(true);
    setExpandedId(null);
    fetch(`/api/league-fixtures?league=${activeLeagueId}`)
      .then(r => r.ok ? r.json() : [])
      .then((games: UpcomingGame[]) => {
        const entries: ScheduleEntry[] = games.map(g => {
          const team = TEAMS.find(t => t.id === g.teamId) ?? makeFallbackTeam(g, activeLeagueId);
          return { ...g, team };
        });
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        leagueCacheRef.current.set(activeLeagueId, entries);
        setLeagueCacheVersion(v => v + 1); // trigger re-render to pick up new cache entry
      })
      .catch(() => {})
      .finally(() => setLeagueLoading(false));
  }, [activeLeagueId]);

  useEffect(() => {
    // Reset accumulators so a followed-teams change (prefsVersion, e.g. the post-sign-in
    // anon→permanent union) refetches the EXACT new set instead of layering onto the old one.
    setAllGames([]);
    setPastResults([]);
    setLoading(true);

    const followed = getFollowedTeams();

    // Auto-inject QLD Maroons (State of Origin) whenever any NRL club team is followed
    const hasNRLClub  = followed.some(t => t.league === 'nrl' && t.id !== 'nrl-maroons' && t.id !== 'nrl-blues');
    const hasMaroons  = followed.some(t => t.id === 'nrl-maroons');
    const maroonsTeam = !hasMaroons && hasNRLClub ? TEAMS.find(t => t.id === 'nrl-maroons') : undefined;
    const teamsToFetch = maroonsTeam ? [...followed, maroonsTeam] : followed;

    setTeams(teamsToFetch);

    if (teamsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    let active = true;
    let remaining = teamsToFetch.length;

    // Cutoff: 2 months ago
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    teamsToFetch.forEach(async (team) => {
      // Fixtures
      const games = await loadFixtures(team);
      if (!active) return;
      const entries: ScheduleEntry[] = games.map(g => ({ ...g, team }));
      setAllGames(prev => {
        const existingIds = new Set(prev.map(g => g.id));
        const merged = [...prev, ...entries.filter(g => !existingIds.has(g.id))];
        merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return merged;
      });

      // Results for calendar — fetch in background, no loading gate
      loadResults(team).then(results => {
        if (!active) return;
        const recent = results.filter(r => new Date(r.date) >= twoMonthsAgo);
        if (recent.length === 0) return;
        setPastResults(prev => {
          // Deduplicate by team+date+opponent
          const existingKeys = new Set(prev.map(r => `${r.team.id}:${r.date.slice(0,10)}:${r.opponent}`));
          const fresh = recent
            .map(r => ({ ...r, team }))
            .filter(r => !existingKeys.has(`${r.team.id}:${r.date.slice(0,10)}:${r.opponent}`));
          return [...prev, ...fresh];
        });
      });

      remaining -= 1;
      if (remaining === 0) setLoading(false);
    });
    return () => { active = false; };
  }, [prefsVersion]);

  const handleUnfollow = useCallback((teamId: string) => {
    // Prevent removing auto-injected SOO team if user still follows NRL clubs
    if (teamId === 'nrl-maroons') {
      const remaining = teams.filter(t => t.id !== 'nrl-maroons');
      const stillHasNRL = remaining.some(t => t.league === 'nrl' && t.id !== 'nrl-maroons' && t.id !== 'nrl-blues');
      if (stillHasNRL) return; // keep it auto-included
    }
    const updated = teams.filter(t => t.id !== teamId);
    saveFollowedTeams(updated);
    setTeams(updated);
    setAllGames(prev => prev.filter(g => g.team.id !== teamId));
    if (activeTeamId === teamId) setActiveTeamId('all');
  }, [teams, activeTeamId]);

  // IDs of teams the user actually follows — stable across card expansions.
  // Used for hero game selection and "following" badges.
  const baseFollowedTeamIds = useMemo(() => new Set(teams.map(t => t.id)), [teams]);

  // Augmented set: also includes the opponent of the currently-expanded game so
  // downstream components (standings highlight, form panels) can style it correctly.
  // Must NOT be used for hero game selection — see heroGame below.
  const followedTeamIds = useMemo(() => {
    const ids = teams.map(t => t.id);
    const currentLeagueGames = activeLeagueId ? (leagueCacheRef.current.get(activeLeagueId) ?? []) : [];
    const eg = [...allGames, ...currentLeagueGames].find(g => g.id === expandedId);
    if (eg?.opponentId) ids.push(eg.opponentId);
    return new Set(ids);
  }, [teams, expandedId, allGames, activeLeagueId, leagueCacheVersion]);

  const isLeagueMode = activeLeagueId !== null;

  // In league-browse mode: show all league games (home/away filter still applies).
  // In team mode: show followed-team games filtered by active team pill.
  const filteredGames = useMemo<ScheduleEntry[]>(() => {
    // Read directly from the ref — synchronous, no render lag, so switching
    // league pills shows the correct league's games in the very first render.
    const cachedLeagueGames = activeLeagueId ? (leagueCacheRef.current.get(activeLeagueId) ?? []) : [];
    const source = isLeagueMode ? (cachedLeagueGames.length > 0 ? cachedLeagueGames : allGames) : allGames;
    return source.filter(g => {
      if (!isLeagueMode && activeTeamId !== 'all' && g.team.id !== activeTeamId) return false;
      if (homeAwayFilter === 'home' && !g.isHome) return false;
      if (homeAwayFilter === 'away' &&  g.isHome) return false;
      return true;
    });
  }, [isLeagueMode, activeLeagueId, allGames, activeTeamId, homeAwayFilter, leagueCacheVersion]);

  // "This Round": 7 days from the first upcoming game in the current filtered set.
  // One game per (team, competition) pair — prevents cup + league double-ups.
  const displayedGames = useMemo<ScheduleEntry[]>(() => {
    if (gameRangeFilter !== 'this_round' || filteredGames.length === 0) {
      return filteredGames;
    }
    const roundStart = new Date(filteredGames[0].date);
    const roundEnd   = new Date(roundStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const seen = new Set<string>();
    return filteredGames.filter(g => {
      if (new Date(g.date) >= roundEnd) return false;
      const key = `${g.team.id}:${g.competition ?? g.team.league}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredGames, gameRangeFilter]);

  // Hero game: in league mode, prefer a followed team's next fixture.
  // Uses baseFollowedTeamIds (not the augmented set) so expanding a card never
  // changes which game is promoted to the hero slot.
  const heroGame = useMemo(() => {
    if (displayedGames.length === 0) return null;
    if (!isLeagueMode) return displayedGames[0];
    return (
      displayedGames.find(g =>
        baseFollowedTeamIds.has(g.team.id) ||
        (g.opponentId != null && baseFollowedTeamIds.has(g.opponentId)),
      ) ?? displayedGames[0]
    );
  }, [displayedGames, isLeagueMode, baseFollowedTeamIds]);

  // Resolve which league's standings to show. Memoised so the fetch below only
  // re-runs when the resolved league actually changes — not on every card expand.
  // Falls back to the hero game's league while its panel is open, so the desktop
  // sidebar table tracks the hero even on the "all teams" view (no pill selected).
  const standingsLeague = useMemo((): string | null => {
    const league = activeLeagueId
      ?? (activeTeamId !== 'all' ? teams.find(t => t.id === activeTeamId)?.league ?? null : null)
      ?? allGames.find(g => g.id === expandedId)?.team.league
      ?? (heroExpanded ? heroGame?.team.league ?? null : null)
      ?? null;
    return league && REAL_DATA_LEAGUES.has(league) ? league : null;
  }, [activeLeagueId, activeTeamId, expandedId, teams, allGames, heroExpanded, heroGame]);

  // Standings derived synchronously from cache — no render lag, no flicker.
  const standings = standingsLeague
    ? (standingsCacheRef.current.has(standingsLeague)
        ? standingsCacheRef.current.get(standingsLeague) ?? null
        : null)
    : null;

  // Fetch standings on first visit to each league; cache hit = instant, no re-fetch.
  useEffect(() => {
    if (!standingsLeague) return;
    if (standingsCacheRef.current.has(standingsLeague)) return;
    fetch(`/api/standings?league=${standingsLeague}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: StandingRow[]) => {
        standingsCacheRef.current.set(standingsLeague, rows.length > 0 ? rows : null);
        setStandingsCacheVersion(v => v + 1);
      })
      .catch(() => {
        standingsCacheRef.current.set(standingsLeague, null);
        setStandingsCacheVersion(v => v + 1);
      });
  }, [standingsLeague]);

  // Position map for AFL/NRL/EPL/F1 league-browse — teamId → table position.
  const STANDINGS_POSITION_LEAGUES = new Set(['afl', 'nrl', 'epl', 'f1']);
  const standingsMap = useMemo((): Map<string, number> | undefined => {
    if (!isLeagueMode || !activeLeagueId || !STANDINGS_POSITION_LEAGUES.has(activeLeagueId) || !standings) return undefined;
    const map = new Map<string, number>();
    for (const row of standings) {
      if (row.teamId) map.set(row.teamId, row.position);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, isLeagueMode, activeLeagueId, standingsCacheVersion]);

  // Group by calendar date in the user's timezone — hero game excluded (shown separately above)
  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; representativeDate: Date; games: ScheduleEntry[] }[] = [];
    for (const game of displayedGames) {
      if (game === heroGame) continue;
      const dateKey = datekeyInZone(game.date, userTz);
      const last = groups[groups.length - 1];
      if (last?.dateKey === dateKey) {
        last.games.push(game);
      } else {
        groups.push({ dateKey, representativeDate: new Date(game.date), games: [game] });
      }
    }
    return groups;
  }, [displayedGames, heroGame, userTz]);

  // Calendar interaction handlers
  const handleCalendarHover = useCallback((dk: string | null) => setHoveredDateKey(dk), []);
  // UX-5: SPA navigation instead of a full page reload (the results page scrolls to
  // the #result-date-* hash once its data loads).
  const handlePastDayClick  = useCallback((dk: string) => {
    router.push(`/results#result-date-${dk}`);
  }, [router]);

  const handleDayClick = useCallback((dk: string) => {
    const el = document.getElementById(`date-section-${dk}`);
    if (el) {
      // Offset by navbar height + breathing room so the section heading is visible
      const y = el.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    // Flash a glow on that date's fixtures for 2.5 s
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    setClickedDateKey(dk);
    clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
  }, []);

  // Toggle expanded card
  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
    setEverExpandedIds(prev => { const next = new Set(prev); next.add(id); return next; });
  }, []);

  if (!loading && !isLeagueMode && teams.length === 0) return (
    <EmptyState
      icon={Calendar}
      title="No schedule yet"
      body="Select teams to follow and your upcoming fixtures will appear here."
    />
  );

  const activeLoading = loading;

  // Phase B · Step 2 — page-level focal accent, driven by the SAME focal team the hero
  // uses (heroGame.team). `.sh-theme` only defines CSS custom properties, so adding it to
  // the wrapper is visually inert except for `.sh-*` descendants (currently just the hero).
  // Omitted when there's no focal team → the `.sh-theme` default tokens apply.
  const focalTeam = heroGame?.team;
  const focalAccent = focalTeam
    ? ({
        '--accent':    focalTeam.primaryColor,
        '--accent-2':  focalTeam.secondaryColor ?? focalTeam.primaryColor,
        '--on-accent': contrastColor(focalTeam.primaryColor),
      } as React.CSSProperties)
    : undefined;

  // Phase B · Step 3 — which league the sidebar standings show (same resolution the
  // LeagueTable call used), plus its brand colour + short code for the card-head comp tag.
  const standingsTableLeague = (
    activeLeagueId
      ?? (activeTeamId !== 'all' ? teams.find(t => t.id === activeTeamId)?.league : undefined)
      ?? [...allGames, ...(activeLeagueId ? (leagueCacheRef.current.get(activeLeagueId) ?? []) : [])].find(g => g.id === expandedId)?.team.league
      ?? (heroExpanded ? heroGame?.team.league : undefined)
  ) as SportKey | undefined;
  const standingsBadge = standingsTableLeague ? LEAGUE_BADGE[standingsTableLeague] : undefined;
  // Task 2: hide the WC group-standings sidebar widget when the in-preview group table is already
  // visible (hero expanded or a schedule row expanded). Other leagues are never affected.
  const hideWcSidebarStandings = standingsTableLeague === 'world_cup' && (heroExpanded || expandedId !== null);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white/90 flex items-center gap-2 mb-1">
          <List className="h-6 w-6 text-indigo-400" />
          {isLeagueMode
            ? `${BROWSABLE_LEAGUES.find(l => l.id === activeLeagueId)?.fullName ?? 'League'} — All Fixtures`
            : 'Your Schedule'}
        </h1>
        {activeLoading && <p className="text-white/40 text-sm">Loading fixtures…</p>}
      </div>

      <div className="sh-theme" style={focalAccent}>

      {/* ── Two-column layout: hero + filters + schedule (left) + sidebar (right) ── */}
      <div className="lg:grid lg:grid-cols-[1fr_270px] lg:gap-6 lg:items-start">

        {/* ── Left column: hero + filters + schedule ── */}
        {/* min-w-0: let the 1fr grid track shrink below its content's intrinsic width so the
            My-Teams / competition pill rows below scroll within overflow-x-auto instead of
            stretching the whole page when many teams are followed. */}
        <div className="min-w-0">
          {/* ── Next Game Hero ── */}
          {/* F1 (non-versus) keeps the existing hero; two-team fixtures get the new
              focal-team-themed .sh-* hero (Phase B · Step 1). */}
          {!activeLoading && heroGame && (
            heroGame.team.league === 'f1'
              ? <NextGameHero   game={heroGame} userTz={userTz} />
              : <NextGameHeroSh game={heroGame} userTz={userTz} leagueLogoUrl={LEAGUE_BADGE[heroGame.team.league]?.logoUrl} onExpandChange={setHeroExpanded} />
          )}

          {/* Filters — Phase B · Step 2: reskinned to the design vocabulary
              (.sh-filters.sh-card / .sh-chips > .sh-chip / .sh-segmented > .sh-seg).
              The 3-group information architecture is preserved (Decision i: competition
              stays PILLS, not a select); every handler and state is unchanged. Active
              chips/segs colour from the inherited page accent (.sh-chip.is-active). */}
          {!activeLoading && (
            <div className="sh-filters sh-card">

              {/* My teams */}
              <div>
                <div className="sh-chips">
                  <TeamFilterPill
                    label="All"
                    active={!isLeagueMode && activeTeamId === 'all'}
                    onClick={() => { setActiveLeagueId(null); setActiveTeamId('all'); }}
                  />
                  {teams.map(team => (
                    <TeamFilterPill
                      key={team.id}
                      label={team.abbreviation}
                      logoUrl={TEAM_LOGOS[team.id]}
                      logoFilter={TEAM_LOGO_FILTERS[team.id]}
                      primaryColor={team.primaryColor}
                      league={team.league}
                      active={!isLeagueMode && activeTeamId === team.id}
                      onClick={() => { setActiveLeagueId(null); setActiveTeamId(team.id); }}
                    />
                  ))}
                </div>
              </div>

              <div className="sh-filter-divider" />

              {/* Browse competition (pills) */}
              <div>
                <div className="sh-chips">
                  {BROWSABLE_LEAGUES.filter(l => l.id === 'world_cup' || teams.some(t => t.league === l.id)).map(league => (
                    <LeagueFilterPill
                      key={league.id}
                      leagueId={league.id}
                      active={activeLeagueId === league.id}
                      onClick={() => {
                        setActiveLeagueId(prev => prev === league.id ? null : league.id);
                        setActiveTeamId('all');
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="sh-filter-divider" />

              {/* View toggles — TWO independent single-select segmented groups (refine #3):
                  range (This Round / All games) and, in team mode, home/away. Same state
                  + handlers; each value is now an explicit button rather than one toggle. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="sh-segmented">
                  <FilterPill
                    label="This Round"
                    active={gameRangeFilter === 'this_round'}
                    onClick={() => setGameRangeFilter('this_round')}
                    muted
                  />
                  <FilterPill
                    label="All games"
                    active={gameRangeFilter === 'all'}
                    onClick={() => setGameRangeFilter('all')}
                    muted
                  />
                </div>
                {!isLeagueMode && (
                  <div className="sh-segmented">
                    {(['all', 'home', 'away'] as const).map(opt => (
                      <FilterPill
                        key={opt}
                        label={opt === 'all' ? 'All' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                        active={homeAwayFilter === opt}
                        onClick={() => setHomeAwayFilter(opt)}
                        muted
                      />
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Schedule content */}
          {activeLoading ? (
            <ScheduleSkeleton />
          ) : displayedGames.length === 0 ? (
            <div className="text-center py-20 text-white/40">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No fixtures match this filter.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByDate.map(({ dateKey, representativeDate, games }) => (
                <section key={dateKey} id={`date-section-${dateKey}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-[15px] font-black uppercase tracking-[0.12em] text-white/75 shrink-0">
                      {formatDateHeading(representativeDate, dateKey, userTz)}
                    </p>
                    <div className="flex-1 h-px bg-white/12" />
                    <span className="text-[10px] font-semibold text-white/40 shrink-0 uppercase tracking-wide">
                      {games.length} {games.length !== 1 ? 'fixtures' : 'fixture'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {games.map(game => {
                      const isHighlighted = hoveredDateKey === dateKey;
                      const isExpanded    = expandedId === game.id;
                      // In league mode, highlight rows where the user follows either team.
                      const isFollowed    = isLeagueMode && (
                        followedTeamIds.has(game.team.id) ||
                        (game.opponentId != null && followedTeamIds.has(game.opponentId))
                      );

                      return (
                        <div
                          key={game.id}
                          className="rounded-2xl"
                          style={{
                            transition: 'box-shadow 0.4s ease-out',
                            boxShadow: clickedDateKey === dateKey
                              ? `0 0 48px ${game.team.primaryColor}70, 0 0 0 1px ${game.team.primaryColor}50`
                              : isHighlighted
                                ? `0 0 28px ${game.team.primaryColor}30`
                                : undefined,
                          }}
                        >
                          <ScheduleRow
                            game={game}
                            userTz={userTz}
                            dateKey={dateKey}
                            isHighlighted={isHighlighted}
                            isExpanded={isExpanded}
                            isFollowed={isFollowed}
                            standingsMap={standingsMap}
                            onHover={handleCalendarHover}
                            onToggle={() => toggleExpand(game.id)}
                          />
                          {everExpandedIds.has(game.id) && (
                            <div style={{ display: isExpanded ? 'block' : 'none' }}>
                              <GameExpandPanel
                                game={game}
                                compact={isLeagueMode}
                                onCollapse={() => toggleExpand(game.id)}
                                onStandingsUpdate={rows => {
                                  if (standingsLeague) {
                                    standingsCacheRef.current.set(standingsLeague, rows.length > 0 ? rows : null);
                                    setStandingsCacheVersion(v => v + 1);
                                  }
                                }}
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

        {/* ── Right column: sticky sidebar ── */}
        <aside className="hidden lg:block sticky top-20 space-y-4 mt-0">

          {/* Calendar */}
          {!activeLoading && (
            <ScheduleCalendar
              games={displayedGames}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={handleDayClick}
              pastResults={pastResults}
              onPastDayClick={handlePastDayClick}
            />
          )}

          {/* League standings / WC groups — shown in league-browse mode, when a team is selected, or when a card is expanded.
              WC group standings are hidden when any expand panel is open (the in-preview group table is already visible). */}
          {!activeLoading && standings && standings.length > 0 && (isLeagueMode || activeTeamId !== 'all' || expandedId !== null || heroExpanded) && !hideWcSidebarStandings && (
            standingsTableLeague === 'world_cup' ? (
              <div className="sh-card sh-standings">
                <div className="sh-card-head">
                  <span className="sh-comptag" style={{ '--c': LEAGUE_BADGE['world_cup']?.color ?? '#c8922a' } as React.CSSProperties}>WC</span>
                  <span className="sh-card-head-label">Group Standings</span>
                </div>
                <div style={{ padding: '8px 12px 12px' }}>
                  <WcGroupBrowser
                    standings={standings}
                    followedTeamId={teams.find(t => t.league === 'world_cup')?.id ?? ''}
                    teamGroup={
                      (() => {
                        const wcTeamId = teams.find(t => t.league === 'world_cup')?.id;
                        return wcTeamId
                          ? (standings.find(r => r.teamId === wcTeamId)?.group
                            ?? allGames.find(g => g.team.id === wcTeamId && g.worldCupGroup)?.worldCupGroup)
                          : undefined;
                      })()
                    }
                  />
                </div>
              </div>
            ) : (
              <LeagueTableSh
                league={standingsTableLeague as SportKey}
                rows={standings}
                followedTeamIds={followedTeamIds}
                compColor={standingsBadge?.color}
                compShort={standingsBadge?.abbr ?? standingsBadge?.label}
              />
            )
          )}

          {/* Followed teams — always show in league mode so user sees who they follow */}
          <FollowedTeamsWidget teams={teams} onUnfollow={handleUnfollow} />

        </aside>
      </div>
      </div>{/* end transition-opacity wrapper */}

      {/* ── Mobile calendar bottom sheet (triggered from navbar Calendar button) ── */}
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
          {/* Sheet — slides up on open, down on close */}
          <div
            className={[
              'fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl border-t border-white/10 bg-[#0e0e18] px-4 pt-4 pb-8 max-h-[85vh] overflow-y-auto',
              'transition-transform duration-[420ms] ease-out',
              calendarVisible ? 'translate-y-0' : 'translate-y-full',
            ].join(' ')}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white/80">Calendar</p>
              <button
                onClick={() => closeCalendar()}
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Phase B · Step 3 — this calendar instance is OUTSIDE the page `.sh-theme`
                wrapper, so it carries its own `.sh-theme` + focal accent for the reskinned
                `.sh-cal` tokens to resolve. */}
            <div className="sh-theme" style={focalAccent}>
            <ScheduleCalendar
              games={displayedGames}
              userTz={userTz}
              hoveredDateKey={hoveredDateKey}
              onHover={handleCalendarHover}
              onDayClick={(dk) => {
                closeCalendar(() => {
                  const el = document.getElementById(`date-section-${dk}`);
                  if (el) {
                    const y = el.getBoundingClientRect().top + window.scrollY - 88;
                    smoothScrollTo(Math.max(0, y), 750);
                  }
                  if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                  setClickedDateKey(dk);
                  clickTimerRef.current = setTimeout(() => setClickedDateKey(null), 2500);
                });
              }}
              pastResults={pastResults}
              onPastDayClick={(dk) => closeCalendar(() => handlePastDayClick(dk))}
            />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
