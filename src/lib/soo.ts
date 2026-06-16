/**
 * State of Origin — shared metadata + series-state derivation.
 *
 * Single source of truth for the two representative teams (Maroons / Blues), the
 * ESPN name mapping, and the series tally ("QLD lead 1-0", "decider", etc.).
 * Consumed by BOTH the display route (`/api/fixtures`) and the generation path
 * (league-fixtures + preview-fetchers) so the two never drift.
 *
 * Origin uses a per-perspective fixture id on the display side
 * (`soo-<teamId>-<eventId>`), so a single physical game maps to two keys. The
 * generator produces ONE preview and upserts it under both (see mirrorGameIds).
 */

export interface SOOMeta {
  self: string;       // ESPN displayName of the followed rep team
  opponent: string;   // ESPN displayName of the opposition rep team
  selfAbbr: string;
  oppAbbr: string;
  oppColor: string;
  oppLogoUrl: string;
  oppTeamId: string;  // our internal id for the opponent rep team
}

export const SOO_META: Record<string, SOOMeta> = {
  'nrl-maroons': {
    self: 'Queensland',      opponent: 'New South Wales',
    selfAbbr: 'QLD',         oppAbbr: 'NSW',
    oppColor: '#003DA5',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289317.png',
    oppTeamId: 'nrl-blues',
  },
  'nrl-blues': {
    self: 'New South Wales', opponent: 'Queensland',
    selfAbbr: 'NSW',         oppAbbr: 'QLD',
    oppColor: '#6B0000',
    oppLogoUrl: 'https://a.espncdn.com/i/teamlogos/rugby/teams/500/289318.png',
    oppTeamId: 'nrl-maroons',
  },
};

export const SOO_TEAM_IDS = Object.keys(SOO_META);
export function isSOOTeam(teamId: string): boolean {
  return teamId in SOO_META;
}

/** The two ESPN rep displayNames (used to identify an Origin event). */
export const SOO_ESPN_NAMES = ['Queensland', 'New South Wales'] as const;

/** True if an ESPN scoreboard event is a NSW-vs-QLD Origin match. */
export function isSOOEvent(event: { competitions?: { competitors?: { team?: { displayName?: string } }[] }[] }): boolean {
  const comps = event.competitions?.[0]?.competitors ?? [];
  const names = comps.map(c => c.team?.displayName);
  return names.includes('Queensland') && names.includes('New South Wales');
}

export interface SeriesTally { selfWins: number; oppWins: number; played: number }

/**
 * Tally the series from the chronologically-sorted Origin events for one rep
 * team's perspective. Counts only completed games, stopping at the first
 * incomplete one (matches the display route's original behaviour).
 */
export function tallySeries(
  sortedEvents: any[],
  meta: SOOMeta,
): SeriesTally {
  let selfWins = 0, oppWins = 0, played = 0;
  for (const e of sortedEvents) {
    if (!e.status?.type?.completed) break;
    const comps: any[] = e.competitions?.[0]?.competitors ?? [];
    const selfC = comps.find((c: any) => c.team?.displayName === meta.self);
    const oppC  = comps.find((c: any) => c.team?.displayName === meta.opponent);
    const selfPts = Number(selfC?.score ?? 0);
    const oppPts  = Number(oppC?.score ?? 0);
    if (selfPts > oppPts) selfWins++;
    else if (oppPts > selfPts) oppWins++;
    played++;
  }
  return { selfWins, oppWins, played };
}

/**
 * Short suffix for the fixture `competition` label, e.g. " (QLD lead 1-0)" or
 * " (Series won: NSW 2-0)". Empty before any game is played. Kept identical to
 * the original display-route format so the schedule label is unchanged.
 */
export function seriesLabelSuffix(t: SeriesTally, meta: SOOMeta): string {
  const { selfWins, oppWins } = t;
  const decided = selfWins >= 2 || oppWins >= 2;
  if (decided) {
    const wAbbr  = selfWins >= 2 ? meta.selfAbbr : meta.oppAbbr;
    const wCount = Math.max(selfWins, oppWins);
    const lCount = Math.min(selfWins, oppWins);
    return ` (Series won: ${wAbbr} ${wCount}-${lCount})`;
  }
  if (selfWins + oppWins > 0) {
    if (selfWins > oppWins)      return ` (${meta.selfAbbr} lead ${selfWins}-${oppWins})`;
    if (oppWins > selfWins)      return ` (${meta.oppAbbr} lead ${oppWins}-${selfWins})`;
    return ` (Series level ${selfWins}-all)`;
  }
  return '';
}

/**
 * Plain-English series state for the preview data block (replaces the suppressed
 * club ladder). e.g. "Game 2 of 3 — New South Wales lead the series 1-0" or
 * "Game 3 of 3 — series locked at 1-1, the decider" or "Series already decided:
 * Queensland lead 2-0 (dead rubber)".
 */
export function seriesStateForPreview(
  t: SeriesTally,
  meta: SOOMeta,
  gameNumber: number,
): string {
  const { selfWins, oppWins } = t;
  const lead = selfWins > oppWins ? meta.self : oppWins > selfWins ? meta.opponent : null;
  const decided = selfWins >= 2 || oppWins >= 2;
  const gamePrefix = `Game ${gameNumber} of 3`;

  if (decided) {
    const winner = selfWins >= 2 ? meta.self : meta.opponent;
    const score  = `${Math.max(selfWins, oppWins)}-${Math.min(selfWins, oppWins)}`;
    return `${gamePrefix} — ${winner} have already won the series ${score} (this is a dead rubber).`;
  }
  if (selfWins + oppWins === 0) {
    return `${gamePrefix} — series opener (0-0); the winner takes a 1-0 lead.`;
  }
  if (lead) {
    const lscore = `${Math.max(selfWins, oppWins)}-${Math.min(selfWins, oppWins)}`;
    if (gameNumber === 3) {
      return `${gamePrefix} — ${lead} lead the series ${lscore}; ${lead === meta.self ? meta.self : meta.opponent} win the series with a victory, the other side must win to force a drawn series.`;
    }
    return `${gamePrefix} — ${lead} lead the series ${lscore}; a win here clinches it, a loss levels the series.`;
  }
  // level 1-1 going into a decider
  return `${gamePrefix} — series level ${selfWins}-${oppWins}; this is the decider.`;
}
