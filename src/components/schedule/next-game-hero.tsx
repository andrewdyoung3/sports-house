'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Tv, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameExpandPanel } from '@/components/schedule/game-expand-panel';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { formatTimeInZone } from '@/lib/utils';
import type { UpcomingGame, Team } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

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
};

// Logo URLs for background watermarks — mirrors the maps in schedule/page.tsx
const LEAGUE_LOGO: Record<string, string> = {
  nrl:         'https://a.espncdn.com/i/leaguelogos/rugby-league/500/3.png',
  epl:         'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
  super_rugby: 'https://a.espncdn.com/i/leaguelogos/rugby/500/242041.png',
};
const COMPETITION_LOGO: Record<string, string> = {
  'Champions League': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
  'Europa League':    'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png',
  'Conference League':'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png',
  'FA Cup':           'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
  'EFL Cup':          'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
};

interface NextGameHeroProps {
  game: ScheduleEntry;
  userTz: string;
}

/** How long until kickoff, as a short human string.
 *  Uses calendar-day counting in the user's timezone so "Thursday" is always
 *  3 days from Monday regardless of the time of day. */
function timeUntil(isoDate: string, userTz: string): string {
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
  return `In ${days} days`;
}

export function NextGameHero({ game, userTz }: NextGameHeroProps) {
  const [expanded,     setExpanded]     = useState(false);
  const [everExpanded, setEverExpanded] = useState(false);

  const { team } = game;
  const displayTime   = formatTimeInZone(game.date, userTz);
  const countdown     = timeUntil(game.date, userTz);
  const teamLogoUrl   = TEAM_LOGOS[team.id];
  const leagueLogoUrl = game.competition
    ? COMPETITION_LOGO[game.competition]
    : LEAGUE_LOGO[team.league];

  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz,
    weekday:  'long',
    day:      'numeric',
    month:    'long',
  }).format(new Date(game.date));

  const allBroadcast = game.broadcast
    .concat(game.streaming)
    .filter((ch, i, arr) => arr.indexOf(ch) === i);

  const outerGlow = `0 0 120px ${team.primaryColor}30, 0 32px 80px rgba(0,0,0,0.70)`;

  return (
    <div className="mb-8" style={{ boxShadow: outerGlow }}>

      {/* ── Hero card ── */}
      <div
        className={`relative overflow-hidden glass-hero ${expanded ? 'rounded-t-3xl' : 'rounded-3xl'}`}
        style={{ borderColor: `${team.primaryColor}25` }}
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
            style={{ right: '-4px', height: '210px', opacity: 0.55, mixBlendMode: 'screen' as const }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Team logo — subtle aura behind the badge on the right */}
        {teamLogoUrl && (
          <img
            src={teamLogoUrl}
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 -translate-y-1/2 w-auto object-contain pointer-events-none select-none"
            style={{ right: '-12px', height: '220%', opacity: 0.07, mixBlendMode: 'screen' as const }}
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
              className="text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: team.primaryColor }}
            >
              Next Game
            </span>
            <span className="text-white/15">·</span>
            <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
              {game.competition ?? LEAGUE_DISPLAY[team.league] ?? team.league.toUpperCase()}
            </span>
          </div>
          {/* Countdown pill */}
          <span
            className="text-[11px] font-black rounded-full px-3 py-1 border"
            style={{
              color: team.primaryColor,
              background: `${team.primaryColor}15`,
              borderColor: `${team.primaryColor}45`,
              textShadow: `0 0 12px ${team.primaryColor}80`,
            }}
          >
            {countdown}
          </span>
        </div>

        {/* ── Teams — editorial matchup ── */}
        <div className="relative z-10 px-6 py-6 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            {/* Oversized matchup typography */}
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
                />
              </div>
              <span className="text-[18px] font-bold text-white/80 leading-none">{game.opponent}</span>
            </div>
            {/* Date + time */}
            <p className="text-white/40 text-sm">
              {dateLabel}
              <span className="text-white/20 mx-1.5">·</span>
              <span className="font-bold text-[15px] text-white/85">
                {displayTime}
              </span>
            </p>
          </div>

          {/* Team badge — moved to RIGHT with neon glow */}
          <div className="shrink-0" style={{ filter: `drop-shadow(0 0 24px ${team.primaryColor}60)` }}>
            <TeamBadge
              logoUrl={TEAM_LOGOS[team.id]}
              abbreviation={team.abbreviation}
              primaryColor={team.primaryColor}
              size={72}
              className="rounded-2xl"
            />
          </div>
        </div>

        {/* ── Venue ── */}
        {game.venue && (
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
          {allBroadcast.map(ch => (
            <Badge
              key={ch}
              className={
                game.streaming.includes(ch)
                  ? 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50'
                  : 'bg-white/6 text-white/60 border-white/10'
              }
            >
              {ch}
            </Badge>
          ))}
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
            <>Match Details <ChevronDown className="h-3.5 w-3.5" /></>
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
