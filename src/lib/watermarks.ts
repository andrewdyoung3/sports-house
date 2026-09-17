/**
 * Watermark art tuning — THE single source for every transparent logo the
 * fixture/result rows render. Both pages read from here; per-surface copies
 * of these values are what caused the drift this file retires (schedule and
 * results carried different EPL opacities within hours of each other).
 *
 * Three key spaces:
 *   'comp:<name>'   — competition roundels (cups, SOO). Highest precedence.
 *   'league:<id>'   — league marks, used when the fixture has no comp entry.
 *   team crests     — sized by CSS defaults (globals.css --wm-team-* vars);
 *                     TEAM_WM_TUNING overrides per team id where a crest's
 *                     art needs it (very wide banner logos, faint art, …).
 *
 * Tuning knobs: opacity (vs the card wash), height (% of card height —
 * wide wordmarks want ~140%, round roundels ~78-110%), maxWidth (cap wide
 * banners), blend ('screen' dissolves dark plates), filter (white-force
 * monochrome marks).
 */

export interface WatermarkSpec {
  url: string;
  opacity?: number;
  height?: string;
  maxWidth?: string;
  blend?: string;
  filter?: string;
}

export const WATERMARKS: Record<string, WatermarkSpec> = {
  // ── Competitions (override the league mark for cup/rep fixtures) ──
  'comp:Champions League':  { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',    opacity: 0.68, blend: 'screen' },
  'comp:Europa League':     { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png', opacity: 0.56, blend: 'screen' },
  'comp:Conference League': { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png', opacity: 0.56, blend: 'screen' },
  'comp:FA Cup':            { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',   opacity: 0.24, blend: 'screen', height: '78%' },
  'comp:EFL Cup':           { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',   opacity: 0.22, blend: 'screen', height: '78%' },
  'comp:State of Origin':   { url: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png', opacity: 0.18, height: '98%' },

  // ── Leagues ──
  'league:afl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png', opacity: 0.16 },
  'league:nrl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png', opacity: 0.27, height: '98%' },
  'league:epl':         { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', opacity: 0.15, filter: 'brightness(0) invert(1)' },
  'league:super_rugby': { url: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', opacity: 0.18, height: '110%' },
  'league:rugby_int':   { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-rugby.png', opacity: 0.13, filter: 'brightness(0) invert(1)', height: '78%' },
  'league:nba':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', opacity: 0.15 },
  'league:f1':          { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',  opacity: 0.15 },
  'league:bbl':         { url: 'https://r2.thesportsdb.com/images/media/league/badge/yko7ny1546635346.png', opacity: 0.18, height: '105%' },
  'league:cricket_int': { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-cricket.png', opacity: 0.13, filter: 'brightness(0) invert(1)', height: '78%' },
};

/** Competition-first watermark lookup for a fixture row. */
export function competitionWatermark(comp: string | undefined, league: string): WatermarkSpec | undefined {
  return (comp ? WATERMARKS[`comp:${comp}`] : undefined) ?? WATERMARKS[`league:${league}`];
}

/** Per-team crest overrides for the LEFT (team) watermark. CSS defaults:
 *  94px / 0.17 desktop, 60px / 0.13 mobile (globals.css --wm-team-*). Add an
 *  entry here when a specific crest's art fights those defaults. */
export interface TeamWmTune { height?: string; opacity?: number; maxWidth?: string }
export const TEAM_WM_TUNING: Record<string, TeamWmTune> = {
  // (empty by design — add e.g. 'epl-arsenal': { height: '110px' } as needed)
};

/** CSS-variable style object for a row's team-watermark wrapper. */
export function teamWatermarkVars(teamId: string): Record<string, string> | undefined {
  const t = TEAM_WM_TUNING[teamId];
  if (!t) return undefined;
  const vars: Record<string, string> = {};
  if (t.height)   vars['--wm-team-h']  = t.height;
  if (t.opacity !== undefined) vars['--wm-team-o'] = String(t.opacity);
  if (t.maxWidth) vars['--wm-team-mw'] = t.maxWidth;
  return vars;
}
