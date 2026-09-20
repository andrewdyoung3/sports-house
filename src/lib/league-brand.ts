/**
 * league-brand.ts — a competition's own colours, for when a competition is the
 * subject rather than a team.
 *
 * Team accents come from teams.ts. A whole-competition follow has no team, so
 * the competition itself needs an identity: the schedule's competition pills,
 * the results competition pills, and the dashboard's competition cards all draw
 * from here.
 *
 * The per-page badge tables (schedule's BadgeMeta, results' ResultBadgeMeta)
 * carry extra presentational fields — a glyph, a border, a logo height — and
 * stay where they are; what must not fork is the brand pair and how an accent
 * is resolved from it.
 */

export interface LeagueBrand {
  /** Competition background — the deep, saturated half of the pair. */
  bg: string;
  /** Competition foreground, as used on that background. */
  color: string;
  /** Short label for pills and badges. */
  label: string;
}

export const LEAGUE_BRAND: Record<string, LeagueBrand> = {
  afl:         { bg: '#001d3d', color: '#f4ac20', label: 'AFL' },
  nrl:         { bg: '#002955', color: '#ffffff', label: 'NRL' },
  epl:         { bg: '#38003c', color: '#ffffff', label: 'PL' },
  super_rugby: { bg: '#0b2a6b', color: '#7eb8ff', label: 'SR' },
  rugby_int:   { bg: '#0f1a2e', color: '#a0b4cc', label: 'Test' },
  nba:         { bg: '#17408b', color: '#c9082a', label: 'NBA' },
  f1:          { bg: '#1a0000', color: '#e8002d', label: 'F1' },
  bbl:         { bg: '#001428', color: '#d917a5', label: 'BBL' },
  cricket_int: { bg: '#0a1a00', color: '#78be20', label: 'INT' },
  nfl:         { bg: '#013369', color: '#d50a0a', label: 'NFL' },
  mlb:         { bg: '#041e42', color: '#bf0d3e', label: 'MLB' },
  nhl:         { bg: '#111111', color: '#ffffff', label: 'NHL' },
};

/**
 * The accent to paint a competition with.
 *
 * Prefers the foreground, falling back to the background when the foreground is
 * white or near-white — otherwise the Premier League and the NRL would both
 * resolve to plain white and lose their identity. The result still passes
 * through readableInk() wherever it is used as text, so a dark value like F1's
 * near-black background is corrected per theme rather than avoided here.
 */
export function leagueBrandAccent(leagueId: string): string {
  const meta = LEAGUE_BRAND[leagueId];
  const fg = (meta?.color ?? '').toLowerCase();
  const whiteish = fg === '#fff' || fg === '#ffffff';
  return (whiteish ? meta?.bg : meta?.color) ?? meta?.bg ?? '#9b6bff';
}

/** Short display label for a competition, falling back to the id. */
export function leagueLabel(leagueId: string): string {
  return LEAGUE_BRAND[leagueId]?.label ?? leagueId.toUpperCase();
}
