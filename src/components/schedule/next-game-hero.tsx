'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Tv, MapPin, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TeamBadge } from '@/components/ui/team-badge';
import { RecentForm } from '@/components/dashboard/recent-form';
import { getRecentResults } from '@/lib/mock-data';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { formatTimeInZone } from '@/lib/utils';
import type { UpcomingGame, Team } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface NextGameHeroProps {
  game: ScheduleEntry;
  userTz: string;
}

/** How long until kickoff, as a short human string. */
function timeUntil(isoDate: string): string {
  const diff  = new Date(isoDate).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0.5)  return 'Starting soon';
  if (hours < 24)   return `In ${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days === 1)   return 'Tomorrow';
  return `In ${days} days`;
}

export function NextGameHero({ game, userTz }: NextGameHeroProps) {
  const [expanded, setExpanded] = useState(false);

  const { team } = game;
  const displayTime  = formatTimeInZone(game.date, userTz);
  const countdown    = timeUntil(game.date);
  const results      = getRecentResults(team, 5);

  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz,
    weekday:  'long',
    day:      'numeric',
    month:    'long',
  }).format(new Date(game.date));

  const allBroadcast = game.broadcast
    .concat(game.streaming)
    .filter((ch, i, arr) => arr.indexOf(ch) === i);

  return (
    <div
      className="glass-hero rounded-3xl overflow-hidden mb-8"
      style={{
        boxShadow: `0 0 80px ${team.primaryColor}28, 0 24px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.13)`,
        borderColor: `${team.primaryColor}30`,
      }}
    >
      {/* Team-colour gradient top edge — the "glow strip" */}
      <div
        className="h-[2px] w-full"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${team.primaryColor}90 40%, ${team.primaryColor}90 60%, transparent 100%)` }}
      />

      {/* ── Label bar ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: team.primaryColor }}
          >
            Next Game
          </span>
          <span className="text-[10px] text-white/25">·</span>
          <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wide">
            {game.competition ?? team.league.toUpperCase()}
          </span>
        </div>
        <span
          className="text-xs font-bold rounded-full px-2.5 py-0.5 border"
          style={{
            color: team.primaryColor,
            background: `${team.primaryColor}18`,
            borderColor: `${team.primaryColor}40`,
          }}
        >
          {countdown}
        </span>
      </div>

      {/* ── Teams ── */}
      <div className="px-5 py-5 flex items-center gap-5">
        {/* Followed team badge */}
        <TeamBadge
          logoUrl={TEAM_LOGOS[team.id]}
          abbreviation={team.abbreviation}
          primaryColor={team.primaryColor}
          size={64}
          className="rounded-2xl shadow-xl"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xl font-black text-white">{team.shortName}</span>
            <span className="text-white/40 text-sm font-medium">{game.isHome ? 'vs' : 'at'}</span>
            <TeamBadge
              logoUrl={game.opponentLogoUrl}
              abbreviation={game.opponentAbbr}
              primaryColor={game.opponentColor}
              size={36}
              className="rounded-xl"
            />
            <span className="text-lg font-bold text-white/85">{game.opponent}</span>
          </div>
          <p className="text-white/50 text-sm">
            {dateLabel}
            <span className="text-white/25 mx-1.5">·</span>
            <span className="font-bold text-white">{displayTime}</span>
          </p>
        </div>
      </div>

      {/* ── Where to watch ── */}
      <div className="px-5 pb-4 flex items-center gap-2 flex-wrap border-b border-white/8">
        <span className="flex items-center gap-1.5 text-xs text-white/40 shrink-0">
          <Tv className="h-3.5 w-3.5" />
          <span className="font-medium">Watch on</span>
        </span>
        {allBroadcast.map(ch => (
          <Badge
            key={ch}
            className={
              game.streaming.includes(ch)
                ? 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50'
                : 'bg-white/8 text-white/65 border-white/12'
            }
          >
            {ch}
          </Badge>
        ))}
      </div>

      {/* ── Expand toggle ── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-white/35 hover:text-white/70 transition-colors"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse match details' : 'Show match details'}
      >
        {expanded ? (
          <>Less detail <ChevronUp className="h-3.5 w-3.5" /></>
        ) : (
          <>Match details <ChevronDown className="h-3.5 w-3.5" /></>
        )}
      </button>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="border-t border-white/8 px-5 py-5 space-y-5 bg-black/15">

          {/* Venue */}
          {game.venue && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
              <div>
                <p className="text-white/85 font-medium">{game.venue}</p>
                <p className="text-xs text-white/40 mt-0.5">{game.isHome ? 'Home ground' : 'Away fixture'}</p>
              </div>
            </div>
          )}

          {/* Recent form */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40 flex items-center gap-1.5 mb-3">
              <Trophy className="h-3 w-3" />
              {team.shortName} — Last 5
            </p>
            <RecentForm results={results} />
            <p className="text-[10px] text-white/25 mt-3">
              Hover each result for score and opponent details.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
