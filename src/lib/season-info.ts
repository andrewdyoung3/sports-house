/**
 * Coarse season-calendar facts for the league-browse empty state: when a
 * league has no upcoming fixtures, tell the user it is out of season and
 * roughly when it returns (month + year — deliberately no dates, since exact
 * fixture releases vary; a wrong precise date is worse than a coarse month).
 *
 * `windowNote` marks competitions with scheduling windows rather than a single
 * season (international rugby/cricket) — for those the note IS the message.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface SeasonInfo {
  /** 1-12 — typical month the season starts. */
  startMonth?: number;
  /** Windowed competitions: shown instead of a start month. */
  windowNote?: string;
  label: string;
}

const SEASON_INFO: Record<string, SeasonInfo> = {
  afl:         { startMonth: 3,  label: 'The AFL season' },
  nrl:         { startMonth: 3,  label: 'The NRL season' },
  epl:         { startMonth: 8,  label: 'The Premier League season' },
  super_rugby: { startMonth: 2,  label: 'The Super Rugby Pacific season' },
  nba:         { startMonth: 10, label: 'The NBA season' },
  nhl:         { startMonth: 10, label: 'The NHL season' },
  f1:          { startMonth: 3,  label: 'The Formula 1 season' },
  bbl:         { startMonth: 12, label: 'The Big Bash League season' },
  nfl:         { startMonth: 9,  label: 'The NFL season' },
  mlb:         { startMonth: 3,  label: 'The MLB season' },
  rugby_int:   { windowNote: 'Test rugby is played in windows — typically July and November tours plus the Rugby Championship and Six Nations — so fixtures appear here once a series is scheduled.', label: 'International rugby' },
  cricket_int: { windowNote: 'International cricket runs in series rather than a single season — fixtures appear here once a tour or series is scheduled.', label: 'International cricket' },
};

/**
 * Out-of-season message for a league with no upcoming fixtures, or null when
 * we know nothing about the league's calendar.
 */
export function outOfSeasonMessage(league: string, now = new Date()): string | null {
  const info = SEASON_INFO[league];
  if (!info) return null;
  if (info.windowNote) return `${info.label} has no scheduled fixtures right now. ${info.windowNote}`;
  if (!info.startMonth) return null;
  // Next occurrence of the start month: this year if still ahead, else next.
  const year = now.getMonth() + 1 < info.startMonth ? now.getFullYear() : now.getFullYear() + 1;
  return `${info.label} is not currently in play — the new season is expected to start around ${MONTH_NAMES[info.startMonth - 1]} ${year}.`;
}
