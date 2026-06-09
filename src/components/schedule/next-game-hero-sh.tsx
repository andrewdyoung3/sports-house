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

import { useState } from 'react';
import { MapPin, Tv, ChevronDown } from 'lucide-react';
import { TeamBadge } from '@/components/ui/team-badge';
import { GameExpandPanel } from '@/components/schedule/game-expand-panel';
import { TEAM_LOGOS, TEAM_LOGO_FILTERS } from '@/lib/team-logos';
import { formatTimeInZone, dedupeChannels } from '@/lib/utils';
import type { UpcomingGame, Team } from '@/types';

type ScheduleEntry = UpcomingGame & { team: Team };

interface NextGameHeroShProps {
  game: ScheduleEntry;
  userTz: string;
  leagueLogoUrl?: string;
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
  world_cup:   'FIFA World Cup',
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

export function NextGameHeroSh({ game, userTz, leagueLogoUrl }: NextGameHeroShProps) {
  const { team } = game;

  // Step 6 · 2A — the hero can now expand to the SAME GameExpandPanel the feed uses.
  // A hero-local boolean is safe: the schedule page excludes `heroGame` from its
  // grouped feed (see `if (game === heroGame) continue;`), so this game never mounts
  // a second panel elsewhere — no shared-state needed.
  const [open, setOpen] = useState(false);

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
  const isWorldCup = team.league === 'world_cup';
  const whenLabel = timeUntil(game.date, userTz);
  const timeLabel = formatTimeInZone(game.date, userTz);
  const dateLabel = new Intl.DateTimeFormat('en-AU', {
    timeZone: userTz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(game.date));
  const venueTag = game.isHome ? 'Home' : 'Away';
  const watch    = dedupeChannels(game.broadcast, game.streaming);

  return (
    // Accent now inherited from the page-level `.sh-theme` wrapper (Phase B · Step 2),
    // which is driven by this same focal team — so the hero is unchanged.
    <>
    <section
      className="sh-hero"
      // When open, flatten the hero's bottom corners and drop its bottom margin so the
      // expand panel below reads as one continuous unit (the panel carries the rounded
      // bottom + the trailing spacing).
      style={open ? { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined}
    >
      {/* Team watermark — logo when available, large text fallback otherwise */}
      {focalProps.logoUrl
        ? <img src={focalProps.logoUrl} alt="" aria-hidden="true" draggable={false} className="sh-hero-wm-logo" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        : <div className="sh-hero-wm" aria-hidden="true">{team.shortName.toUpperCase()}</div>
      }
      {/* Competition logo — lower-right, smaller layer */}
      {leagueLogoUrl && (
        <img src={leagueLogoUrl} alt="" aria-hidden="true" draggable={false} className="sh-hero-comp-logo" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}

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
              {!isWorldCup && <span className="sh-tag-away">{venueTag}</span>}
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

      {/* Step 6 · 2A — full-width "Match details" bar at the very bottom edge of the
          card (sibling of `.sh-hero-body`, not inside it, so it spans flush to the
          rounded edges rather than being inset by the body padding). */}
      <button
        type="button"
        className="sh-hero-expand"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Match details
        <ChevronDown
          size={16}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }}
        />
      </button>
    </section>

    {open && (
      // Sits directly beneath the (now flat-bottomed) hero. The panel matches the hero's
      // 22px corner radius on its own bottom so the join is seamless, and carries the
      // 22px trailing margin the hero normally provides.
      <div style={{ marginBottom: 22 }}>
        <GameExpandPanel
          game={game}
          onCollapse={() => setOpen(false)}
          className="rounded-b-[22px]"
        />
      </div>
    )}
    </>
  );
}
