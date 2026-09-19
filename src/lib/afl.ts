/**
 * Single source of truth for AFL team data used by the API routes.
 *
 * Colours and abbreviations are DERIVED from src/lib/teams.ts; logos are derived
 * from src/lib/team-logos.ts. The only thing that lives here is the Squiggle API
 * display-name mapping, which has no equivalent in teams.ts.
 *
 * Previously this table was copy-pasted (as AFL_TEAM / AFL_TEAMS, keyed by
 * Squiggle display name) across the fixtures, results, and league-fixtures
 * routes. Consolidating here keeps the AFL palette in lockstep with teams.ts.
 */

import { TEAMS } from '@/lib/teams';
import { TEAM_LOGOS } from '@/lib/team-logos';

/** Our internal AFL teamId → Squiggle API display name (hteam / ateam values). */
export const SQUIGGLE_NAME: Record<string, string> = {
  'afl-crows':     'Adelaide',
  'afl-lions':     'Brisbane Lions',
  'afl-blues':     'Carlton',
  'afl-pies':      'Collingwood',
  'afl-bombers':   'Essendon',
  'afl-dockers':   'Fremantle',
  'afl-cats':      'Geelong',
  'afl-suns':      'Gold Coast',
  'afl-giants':    'Greater Western Sydney',
  'afl-hawks':     'Hawthorn',
  'afl-demons':    'Melbourne',
  'afl-kangaroos': 'North Melbourne',
  'afl-power':     'Port Adelaide',
  'afl-tigers':    'Richmond',
  'afl-saints':    'St Kilda',
  'afl-swans':     'Sydney',
  'afl-eagles':    'West Coast',
  'afl-dogs':      'Western Bulldogs',
};

export interface AflTeamEntry {
  /** Internal teamId (e.g. 'afl-crows'). */
  id:    string;
  color: string;
  abbr:  string;
  logo:  string;
}

/**
 * Squiggle display name → AFL team data, derived from teams.ts + team-logos.ts.
 * Keyed by Squiggle name because that's what the Squiggle API returns for
 * hteam/ateam. `color`/`abbr` come from teams.ts; `logo` from team-logos.ts.
 */
export const AFL_TEAM_BY_SQUIGGLE: Record<string, AflTeamEntry> = (() => {
  const byId = new Map(TEAMS.map(t => [t.id, t]));
  const out: Record<string, AflTeamEntry> = {};
  for (const [teamId, squiggleName] of Object.entries(SQUIGGLE_NAME)) {
    const team = byId.get(teamId);
    if (!team) continue;
    out[squiggleName] = {
      id:    teamId,
      color: team.primaryColor,
      abbr:  team.abbreviation,
      logo:  TEAM_LOGOS[teamId] ?? '',
    };
  }
  return out;
})();


/**
 * Squiggle occasionally carries TWO live records for the same match: the finals
 * bracket pre-allocates a slot (placeholder start time and home side) and a
 * second record appears once the fixture is scheduled for real. Both remain in
 * the feed with identical teams and date — which surfaced as a duplicated 2026
 * Grand Final (Brisbane home 19:20 alongside Fremantle home 14:30).
 *
 * Keeps one record per matchup+day: the most recently updated, tie-broken by
 * the newer record id. Every AFL consumer must run its raw `games` array
 * through this before mapping.
 */
export function dedupeSquiggleGames<T extends Record<string, unknown>>(games: T[]): T[] {
  const canonical = new Map<string, T>();
  for (const g of games) {
    if (!g?.hteam || !g?.ateam || !g?.date) continue;
    const key = [String(g.hteam), String(g.ateam)].sort().join('|') + '·' + String(g.date).slice(0, 10);
    const prev = canonical.get(key);
    if (!prev) { canonical.set(key, g); continue; }
    const gu = String(g.updated ?? ''), pu = String(prev.updated ?? '');
    if (gu > pu || (gu === pu && Number(g.id) > Number(prev.id))) canonical.set(key, g);
  }
  return Array.from(canonical.values());
}
