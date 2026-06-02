'use client';

/**
 * Phase B · Step 1 — new "next game" hero (TWO-TEAM fixtures only).
 *
 * Net-new, additive: consumes the SAME prop shape as the existing NextGameHero, but
 * renders the `.sh-*` design-system markup and drives the accent from the FOCAL team's
 * own colours (set inline on the `.sh-theme` wrapper). The schedule page falls back to
 * the existing <NextGameHero/> for F1 (non-versus) events — see the gate there.
 *
 * Presentation only: no data fetching, no state (the Step-1 markup omits the expand
 * panel + competition lockup), no new date library — formatting reuses the existing
 * helpers. Static card → no new animation; no backdrop-filter (blur is a later step).
 */

import { MapPin, Tv } from 'lucide-react';
import { TeamBadge } from '@/components/ui/team-badge';
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { formatTimeInZone } from '@/lib/utils';
import type { UpcomingGame, Team } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface NextGameHeroShProps {
  game: ScheduleEntry;
  userTz: string;
}

// Human-readable competition names (non-F1; F1 never reaches this hero).
const LEAGUE_DISPLAY: Record<string, string> = {
  afl:         'AFL',
  nrl:         'NRL',
  nba:         'NBA',
  nfl:         'NFL',
  nhl:         'NHL',
  epl:         'Premier League',
  super_rugby: 'Super Rugby',
  rugby_int:   'Test Rugby',
  bbl:         'Big Bash',
  cricket_int: "Int'l Cricket",
};

/** How long until kickoff, as a short human string. Returns null for games 7+ days
 *  away (the date label suffices, so the pill is hidden). Mirrors the existing hero. */
function timeUntil(isoDate: string, userTz: string): string | null {
  const diff  = new Date(isoDate).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0.5) return 'Starting soon';
  if (hours < 24)  return `In ${Math.floor(hours)}h`;

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

export function NextGameHeroSh({ game, userTz }: NextGameHeroShProps) {
  const { team } = game;

  // Focal team paints the hero; opponent is the flat fields on UpcomingGame.
  const focalProps = {
    logoUrl:      TEAM_LOGOS[team.id],
    abbreviation: team.abbreviation,
    primaryColor: team.primaryColor,
    logoFilter:   TEAM_LOGO_FILTERS[team.id],
  };
  const oppProps = {
    logoUrl:      game.opponentLogoUrl,
    abbreviation: game.opponentAbbr,
    primaryColor: game.opponentColor,
    logoFilter:   TEAM_LOGO_FILTERS[game.opponentId ?? ''],
  };

  // Resolve away/home from game.isHome (the focal team's perspective).
  const away = game.isHome ? { props: oppProps,   name: game.opponent }  : { props: focalProps, name: team.shortName };
  const home = game.isHome ? { props: focalProps, name: team.shortName } : { props: oppProps,   name: game.opponent };

  const competitionName = LEAGUE_DISPLAY[team.league] ?? game.competition ?? team.league.toUpperCase();
  const whenLabel = timeUntil(game.date, userTz);
  const timeLabel = formatTimeInZone(game.date, userTz);
  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(game.date));
  const venueTag = game.isHome ? 'Home' : 'Away';
  const watch    = game.broadcast[0] ?? game.streaming[0];

  return (
    // Accent now inherited from the page-level `.sh-theme` wrapper (Phase B · Step 2),
    // which is driven by this same focal team — so the hero is unchanged.
    <section className="sh-hero">
      <div className="sh-hero-wm" aria-hidden="true">{team.shortName.toUpperCase()}</div>

      <div className="sh-hero-body">
        <div className="sh-hero-top">
          <span className="sh-hero-kicker">
            Next game<span className="sh-dot-sep">·</span>{competitionName}
          </span>
          {whenLabel && <span className="sh-hero-when-pill">{whenLabel}</span>}
        </div>

        <div className="sh-hero-match">
          <span className="sh-hero-team">
            <TeamBadge {...away.props} size={40} />
            <span className="sh-hero-team-name">{away.name}</span>
          </span>
          <span className="sh-hero-at">@</span>
          <span className="sh-hero-team">
            <TeamBadge {...home.props} size={40} />
            <span className="sh-hero-team-name">{home.name}</span>
          </span>
        </div>

        <div className="sh-hero-datetime">
          {dateLabel}<span className="sh-dot-sep">·</span><strong>{timeLabel}</strong>
        </div>

        <div className="sh-hero-meta">
          {game.venue && (
            <span className="sh-meta-item">
              <MapPin size={15} />{game.venue}
              <span className="sh-tag-away">{venueTag}</span>
            </span>
          )}
          {watch && (
            <span className="sh-meta-item sh-watch">
              <Tv size={15} />
              <span className="sh-meta-label">Watch</span>
              <span className="sh-watch-chip">{watch}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
