/**
 * Watermark art tuning — THE single source for every transparent logo the
 * fixture/result rows render. Both pages read from here; per-surface copies
 * of these values are what caused the drift this file retires (schedule and
 * results carried different EPL opacities within hours of each other).
 *
 * Two key spaces:
 *   'comp:<name>'   — competition roundels (cups, SOO). Highest precedence.
 *   'league:<id>'   — league marks, used when the fixture has no comp entry.
 *
 * Team crests are NOT watermarked. Cards used to carry a faded team logo (or
 * the team's name in giant type) in a lane left of the league mark; that was
 * removed (2026-09-20, user request) so a card's background art is only ever
 * the competition it belongs to. The team is identified by its crest beside
 * the name, which no longer competes with a second copy of itself.
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
  /** Monochrome mark: white-forced on dark, ink-forced in light (CSS .sh-wm-mono). */
  mono?: boolean;
  /**
   * Distance from the card's right edge to the mark's CENTRE (the renderers
   * translateX(50%) off this anchor). Default '49px'. Raise it to pull a wide
   * mark left so its right half is not clipped by the card edge.
   */
  right?: string;
}

export const WATERMARKS: Record<string, WatermarkSpec> = {
  // ── Competitions (override the league mark for cup/rep fixtures) ──
  // 0.15 = the EPL league mark's opacity, set by eye rather than by arithmetic.
  // Equal numbers do NOT read equal across these marks: the EPL mark is `mono`
  // (flattened to a single ink by brightness(0) invert(1)) while the starball
  // keeps its full-colour art under a 'screen' blend, which lightens it against
  // the dark card. Matching the number was the visible fix; if it still reads
  // hot, dropping the blend is the next lever, not a lower opacity.
  // Height: 140% row default −15%, then +5% → 125% (net ~11% under default).
  'comp:Champions League':  { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',    opacity: 0.15, blend: 'screen', height: '125%' },
  'comp:Europa League':     { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png', opacity: 0.56, blend: 'screen' },
  'comp:Conference League': { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png', opacity: 0.56, blend: 'screen' },
  'comp:FA Cup':            { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',   opacity: 0.24, blend: 'screen', height: '78%' },
  'comp:EFL Cup':           { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',   opacity: 0.22, blend: 'screen', height: '78%' },
  'comp:Rugby Championship': { url: 'https://r2.thesportsdb.com/images/media/league/badge/dy0n4c1716684531.png', opacity: 0.20, height: '96%' },
  'comp:Six Nations':        { url: 'https://r2.thesportsdb.com/images/media/league/badge/7h1wr91738670253.png', opacity: 0.20, height: '96%' },
  'comp:State of Origin':   { url: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png', opacity: 0.18, height: '98%' },

  // ── Leagues ──
  'league:afl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png', opacity: 0.16 },
  'league:nrl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png', opacity: 0.27, height: '98%' },
  // 125% = the 140% row default −15%, then +5%. Kept in step with the Champions
  // League mark above so an EPL row and a UCL row size alike.
  'league:epl':         { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', opacity: 0.15, mono: true, height: '125%' },
  'league:super_rugby': { url: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', opacity: 0.18, height: '110%' },
  'league:rugby_int':   { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-rugby.png', opacity: 0.13, mono: true, height: '78%' },
  'league:nba':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', opacity: 0.15 },
  // F1 rows show ONLY this mark (no team watermark — the championship entity
  // IS the league). 140% height, anchored further in from the right edge so the
  // wide wordmark sits fully inside the card instead of being clipped.
  'league:f1':          { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',  opacity: 0.15, height: '140%', right: '96px' },
  'league:bbl':         { url: 'https://r2.thesportsdb.com/images/media/league/badge/yko7ny1546635346.png', opacity: 0.18, height: '105%' },
  'league:cricket_int': { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-cricket.png', opacity: 0.13, mono: true, height: '78%' },
};

/** Competition-first watermark lookup for a fixture row. */
export function competitionWatermark(comp: string | undefined, league: string): WatermarkSpec | undefined {
  return (comp ? WATERMARKS[`comp:${comp}`] : undefined) ?? WATERMARKS[`league:${league}`];
}
