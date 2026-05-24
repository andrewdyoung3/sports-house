'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Tv, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameExpandPanel } from '@/components/schedule/game-expand-panel';
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { formatTimeInZone } from '@/lib/utils';
import type { UpcomingGame, Team } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

// Where-to-watch URLs — keyed by channel/platform name exactly as it appears in broadcast/streaming arrays
const WATCH_URLS: Record<string, string> = {
  // ── Australian streaming ───────────────────────────────────────────────────
  'Kayo Sports':          'https://kayosports.com.au',
  '7plus':                'https://7plus.com.au',
  'Stan Sport':           'https://stan.com.au/sport',
  '9Now':                 'https://9now.com.au',
  '9GO!':                 'https://9now.com.au',
  // ── Australian TV channels ─────────────────────────────────────────────────
  'Seven Network':        'https://7plus.com.au',
  'Nine Network':         'https://9now.com.au',
  'Channel 9':            'https://9now.com.au',
  'Channel Nine':         'https://9now.com.au',
  'Fox Footy':            'https://kayosports.com.au',
  'Fox League':           'https://kayosports.com.au',
  'Fox Sports':           'https://kayosports.com.au',
  'ESPN':                 'https://kayosports.com.au',
  'beIN Sports':          'https://www.beinsports.com/en-au',
  'beIN Sports Connect':  'https://www.beinsports.com/en-au',
  'ABC':                  'https://iview.abc.net.au',
  // ── International / sport-specific streaming ──────────────────────────────
  'NBA League Pass':      'https://www.nba.com/leaguepass',
  'NFL+':                 'https://www.nfl.com/nflplus',
  'MLB.TV':               'https://www.mlb.tv',
  'NHL.TV':               'https://www.nhl.com/subscribe',
  'ESPN+':                'https://www.espnplus.com',
  'Paramount+':           'https://www.paramountplus.com/au',
  'Amazon Prime Video':   'https://www.primevideo.com',
  'Apple TV+':            'https://tv.apple.com',
  'DAZN':                 'https://www.dazn.com',
};

// Human-readable competition names — acronym where conventional, full name otherwise
const LEAGUE_DISPLAY: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  nba:         'NBA',
  nfl:         'NFL',
  nhl:         'NHL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby',
  rugby_int:   'Test Rugby',
  f1:          'Formula 1',
  bbl:         'Big Bash',
  cricket_int: "Int'l Cricket",
};

// Logo URLs + per-logo opacity for background watermarks
// height: override the default 210px hero height for this logo
// maxWidth: cap width so wide banner-style logos don't spill across the card
type LogoMeta = { url: string; opacity: number; blend?: string; filter?: string; height?: string; maxWidth?: string };
const LEAGUE_LOGO: Record<string, LogoMeta> = {
  afl:         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png',              opacity: 0.10 },
  nrl:         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png',              opacity: 0.31, height: '147px' },
  epl:         { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',              opacity: 0.13, filter: 'brightness(0) invert(1)' },
  super_rugby: { url: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', opacity: 0.21, height: '160px' },
  f1:          { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',               opacity: 0.15 },
};
const COMPETITION_LOGO: Record<string, LogoMeta> = {
  'Champions League':  { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',    opacity: 0.72, blend: 'screen' },
  'Europa League':     { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png', opacity: 0.60, blend: 'screen' },
  'Conference League': { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png', opacity: 0.60, blend: 'screen' },
  'FA Cup':            { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',   opacity: 0.51, blend: 'screen' },
  'EFL Cup':           { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',   opacity: 0.47, blend: 'screen' },
};

interface NextGameHeroProps {
  game: ScheduleEntry;
  userTz: string;
}

/** How long until kickoff, as a short human string.
 *  Returns null for games 7+ days away (pill is hidden; the date label suffices). */
function timeUntil(isoDate: string, userTz: string): string | null {
  const diff  = new Date(isoDate).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0.5) return 'Starting soon';
  if (hours < 24)  return `In ${Math.floor(hours)}h`;

  // Compare calendar dates in the user's timezone (en-CA → YYYY-MM-DD, safe to parse)
  const toDateStr = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: userTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

  const days = Math.round(
    (new Date(toDateStr(new Date(isoDate))).getTime() - new Date(toDateStr(new Date())).getTime()) / 86_400_000,
  );

  if (days === 1) return 'Tomorrow';
  if (days < 7) {
    const dayName = new Intl.DateTimeFormat('en-AU', { timeZone: userTz, weekday: 'long' }).format(new Date(isoDate));
    return `This ${dayName}`;
  }
  return null;
}

export function NextGameHero({ game, userTz }: NextGameHeroProps) {
  const [expanded,     setExpanded]     = useState(false);
  const [everExpanded, setEverExpanded] = useState(false);

  const { team } = game;
  const isF1 = team.league === 'f1';
  const displayTime   = formatTimeInZone(game.date, userTz);
  const countdown     = timeUntil(game.date, userTz);
  const teamLogoUrl  = TEAM_LOGOS[team.id];
  const leagueMeta        = (game.competition ? COMPETITION_LOGO[game.competition] : undefined)
    ?? LEAGUE_LOGO[team.league];
  const leagueLogoUrl      = leagueMeta?.url;
  const leagueLogoOpacity  = leagueMeta?.opacity ?? 0.25;
  const leagueLogoBlend    = leagueMeta?.blend;
  const leagueLogoFilter   = leagueMeta?.filter;
  const leagueLogoHeight   = leagueMeta?.height ?? '210px';
  const leagueLogoMaxWidth = leagueMeta?.maxWidth;

  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz,
    weekday:  'long',
    day:      'numeric',
    month:    'long',
  }).format(new Date(game.date));

  const allBroadcast = game.broadcast
    .concat(game.streaming)
    .filter((ch, i, arr) => arr.indexOf(ch) === i);

  // Outer glow uses a fixed desaturated amethyst-purple rather than the team
  // primary colour, so all hero cards share the same cool hue regardless of team.
  const outerGlow = `0 0 120px rgba(98, 50, 185, 0.26), 0 32px 80px rgba(0,0,0,0.70)`;

  return (
    <div className="mb-8" style={{ boxShadow: outerGlow }}>

      {/* ── Hero card ── */}
      <div
        className={`relative overflow-hidden glass-hero cursor-pointer ${expanded ? 'rounded-t-3xl' : 'rounded-3xl'}`}
        style={{ borderColor: `rgba(105, 58, 182, 0.22)` }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button')) return;
          setExpanded(v => !v);
          setEverExpanded(true);
        }}
      >
        {/* Cinematic team-colour backdrop — large radial glow behind content */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 80% 60% at 100% 50%, ${team.primaryColor}18 0%, transparent 65%),
                         radial-gradient(ellipse 50% 80% at 0% 0%, ${team.primaryColor}0c 0%, transparent 60%)`,
          }}
        />

        {/* Competition / league logo — right side, screen-blended so dark pixels vanish */}
        {leagueLogoUrl && (
          <img
            src={leagueLogoUrl}
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 -translate-y-1/2 w-auto object-contain pointer-events-none select-none"
            style={{ right: '-4px', height: leagueLogoHeight, ...(leagueLogoMaxWidth ? { maxWidth: leagueLogoMaxWidth } : {}), opacity: leagueLogoOpacity, ...(leagueLogoBlend ? { mixBlendMode: leagueLogoBlend as 'screen' } : {}), ...(leagueLogoFilter ? { filter: leagueLogoFilter } : {}) }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Team logo / driver portrait — background watermark on the right.
            F1 driver headshots are anchored to the bottom so the driver stands
            up into the frame with face visible; other sports use the large
            centre-crop treatment. */}
        {teamLogoUrl && (
          <img
            src={teamLogoUrl}
            alt=""
            aria-hidden="true"
            className={`absolute w-auto object-contain pointer-events-none select-none ${isF1 ? 'top-0' : 'top-1/2 -translate-y-1/2'}`}
            style={isF1
              ? { right: '185px', height: '104%', opacity: 0.13, mixBlendMode: 'screen' as const }
              : { right: '-12px', height: '220%', opacity: 0.07, mixBlendMode: 'screen' as const }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}

        {/* Neon accent line at top */}
        <div
          className="h-[2px] w-full"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${team.primaryColor}cc 35%, ${team.primaryColor}cc 65%, transparent 100%)` }}
        />

        {/* ── Label bar ── */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-4 pb-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[12px] font-black uppercase tracking-[0.18em]"
              style={{ color: team.primaryColor }}
            >
              {isF1 ? 'Next Session' : 'Next Game'}
            </span>
            {!isF1 && (
              <>
                <span className="text-white/30">·</span>
                <span className="text-[12px] font-bold text-white/60 uppercase tracking-widest">
                  {LEAGUE_DISPLAY[team.league] ?? game.competition ?? team.league.toUpperCase()}
                </span>
              </>
            )}
          </div>
          {/* Countdown pill — solid team colour so it reads instantly */}
          {countdown && (
            <span
              className="text-[13px] font-black rounded-full px-4 py-1.5 leading-none"
              style={{
                color: '#ffffff',
                background: team.primaryColor,
                boxShadow: `0 0 22px ${team.primaryColor}80, 0 2px 8px rgba(0,0,0,0.45)`,
              }}
            >
              {countdown}
            </span>
          )}
        </div>

        {/* ── Teams — editorial matchup ── */}
        <div className="relative z-10 px-6 py-6 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            {/* Oversized matchup typography */}
            {isF1 ? (
              <div className="flex flex-col gap-0.5 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span
                    className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border"
                    style={{
                      color:        team.primaryColor,
                      background:   `${team.primaryColor}18`,
                      borderColor:  `${team.primaryColor}45`,
                    }}
                  >
                    F1 · {game.competition ?? 'Race'}
                  </span>
                </div>
                <span className="text-[22px] font-black tracking-tight text-white/85 leading-tight">
                  {game.opponent}
                </span>
                {game.venue && (
                  <p className="text-[11px] text-white/35 mt-0.5">{game.venue}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <span className="text-[22px] font-black tracking-tight text-white/85 leading-none">
                  {team.shortName}
                </span>
                <span className="text-white/30 text-sm font-medium">{game.isHome ? 'vs' : '@'}</span>
                <div style={{ filter: `drop-shadow(0 0 8px ${game.opponentColor}50)` }}>
                  <TeamBadge
                    logoUrl={game.opponentLogoUrl}
                    abbreviation={game.opponentAbbr}
                    primaryColor={game.opponentColor}
                    size={40}
                    className="rounded-xl"
                    logoFilter={TEAM_LOGO_FILTERS[game.opponentId ?? '']}
                  />
                </div>
                <span className="text-[18px] font-bold text-white/80 leading-none">{game.opponent}</span>
              </div>
            )}
            {/* Date + time */}
            <p className="text-white/40 text-sm">
              {dateLabel}
              <span className="text-white/20 mx-1.5">·</span>
              <span className="font-bold text-[15px] text-white/85">
                {displayTime}
              </span>
            </p>
          </div>

        </div>

        {/* ── Venue ── (hidden for F1; circuit is shown inline in the matchup block) */}
        {game.venue && !isF1 && (
          <div className="relative z-10 px-6 pb-3 flex items-center gap-2 text-[11px] text-white/35">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{game.venue}</span>
            <span className="text-white/15">·</span>
            <span className="font-semibold">{game.isHome ? 'Home' : 'Away'}</span>
          </div>
        )}

        {/* ── Where to watch ── */}
        <div className="relative z-10 px-6 pb-5 flex items-center gap-2 flex-wrap border-b border-white/6">
          <span className="flex items-center gap-1.5 text-[11px] text-white/35 shrink-0">
            <Tv className="h-3.5 w-3.5" />
            <span className="font-semibold uppercase tracking-wide">Watch</span>
          </span>
          {allBroadcast.map(ch => {
            const url = WATCH_URLS[ch];
            const cls = game.streaming.includes(ch)
              ? 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50'
              : 'bg-white/6 text-white/60 border-white/10';
            return url ? (
              <a key={ch} href={url} target="_blank" rel="noopener noreferrer" tabIndex={0}>
                <Badge className={`${cls} cursor-pointer hover:brightness-125 transition-[filter]`}>
                  {ch}
                </Badge>
              </a>
            ) : (
              <Badge key={ch} className={cls}>{ch}</Badge>
            );
          })}
        </div>

        {/* ── Expand toggle ── */}
        <button
          onClick={() => { setExpanded(v => !v); setEverExpanded(true); }}
          className="relative z-10 w-full flex items-center justify-center gap-1.5 py-3 text-[11px] font-semibold text-white/30 hover:text-white/65 transition-colors uppercase tracking-widest"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse match details' : 'Show match details'}
        >
          {expanded ? (
            <>Collapse <ChevronUp className="h-3.5 w-3.5" /></>
          ) : (
            <>{isF1 ? 'Race Information' : 'Match Details'} <ChevronDown className="h-3.5 w-3.5" /></>
          )}
        </button>
      </div>

      {/* ── Expanded panel — mounted once then kept alive; hidden with CSS so state is preserved ── */}
      {everExpanded && (
        <div style={{ display: expanded ? 'block' : 'none' }}>
          <GameExpandPanel game={game} className="rounded-b-3xl" />
        </div>
      )}
    </div>
  );
}
