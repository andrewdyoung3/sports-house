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
   * Transparent padding baked into the RIGHT of the source file, as a
   * percentage of the file's width — measured from each PNG's alpha channel,
   * not guessed.
   *
   * Positioning by the element's edge positions the FILE, and these files are
   * padded very differently: the NBA mark is 29.6% empty on its right while
   * the Champions League ball is 2%. Identical CSS therefore left the NBA mark
   * floating ~61px short of the edge while the UCL one sat flush. The renderer
   * shifts each mark right by this much so it is the VISIBLE ART, not the
   * file's bounding box, that sits WM_RIGHT_INSET from the card edge.
   *
   * Expressed as a percentage so it rides the element's own width: it stays
   * correct at any card height and through the responsive scale.
   */
  padRight?: string;
  /**
   * INSET from the card's right edge to the mark's RIGHT EDGE. Default
   * WM_RIGHT_INSET.
   *
   * This used to anchor the mark's CENTRE, which meant every mark hung half
   * its width off the card and relied on overflow:hidden to crop it — fine as
   * a deliberate bleed until the card grew (the crest enlargement did exactly
   * that) and heights are percentages of card height, so the overhang grew
   * with it. The Premier League mark ended up ~43px off the edge. Anchoring
   * the right edge instead, with transform-origin at right so the 1.3x desktop
   * scale expands LEFTWARD, makes clipping impossible at any card height.
   *
   * Raise it only to pull a specific mark further in.
   */
  right?: string;
}

/** Default gap between a mark's VISIBLE ART and the card's right edge, in px.
 *  No mark overrides it, so this alone positions every watermark on the
 *  schedule and results cards. */
export const WM_RIGHT_INSET = '10px';

export const WATERMARKS: Record<string, WatermarkSpec> = {
  // ── Competitions (override the league mark for cup/rep fixtures) ──
  // 0.15 = the EPL league mark's opacity, set by eye rather than by arithmetic.
  // Equal numbers do NOT read equal across these marks: the EPL mark is `mono`
  // (flattened to a single ink by brightness(0) invert(1)) while the starball
  // keeps its full-colour art under a 'screen' blend, which lightens it against
  // the dark card. Matching the number was the visible fix; if it still reads
  // hot, dropping the blend is the next lever, not a lower opacity.
  // Height: 140% row default −15%, then +5% → 125% (net ~11% under default).
  'comp:Champions League':  { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',    opacity: 0.15, blend: 'screen', height: '125%', padRight: '2%'},
  'comp:Europa League':     { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2572.png', opacity: 0.56, blend: 'screen' },
  'comp:Conference League': { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2579.png', opacity: 0.56, blend: 'screen' },
  'comp:FA Cup':            { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',   opacity: 0.24, blend: 'screen', height: '78%', padRight: '23%'},
  'comp:EFL Cup':           { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',   opacity: 0.22, blend: 'screen', height: '78%', padRight: '17.8%'},
  'comp:Rugby Championship': { url: 'https://r2.thesportsdb.com/images/media/league/badge/dy0n4c1716684531.png', opacity: 0.20, height: '96%', padRight: '1.2%'},
  'comp:Six Nations':        { url: 'https://r2.thesportsdb.com/images/media/league/badge/7h1wr91738670253.png', opacity: 0.20, height: '96%', padRight: '4.3%'},
  'comp:State of Origin':   { url: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png', opacity: 0.18, height: '98%', padRight: '0.6%'},

  // ── Leagues ──
  'league:afl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png', opacity: 0.16, padRight: '7.4%'},
  'league:nrl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png', opacity: 0.27, height: '98%', padRight: '13.8%'},
  // 125% = the 140% row default −15%, then +5%. Kept in step with the Champions
  // League mark above so an EPL row and a UCL row size alike.
  'league:epl':         { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', opacity: 0.15, mono: true, height: '125%', padRight: '22.6%'},
  'league:super_rugby': { url: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', opacity: 0.18, height: '110%', padRight: '14.3%'},
  'league:rugby_int':   { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-rugby.png', opacity: 0.13, mono: true, height: '78%', padRight: '6.4%'},
  'league:nba':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', opacity: 0.15, padRight: '29.6%'},
  // F1 rows show ONLY this mark (no team watermark — the championship entity
  // IS the league). The old 96px was a centre-anchor correction for this wide
  // wordmark; right-edge anchoring makes it unnecessary.
  'league:f1':          { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',  opacity: 0.15, height: '140%', padRight: '4.6%'},
  'league:bbl':         { url: 'https://r2.thesportsdb.com/images/media/league/badge/yko7ny1546635346.png', opacity: 0.18, height: '105%', padRight: '9.4%'},
  'league:cricket_int': { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-cricket.png', opacity: 0.13, mono: true, height: '78%', padRight: '5.6%'},
};

/** Competition-first watermark lookup for a fixture row. */
export function competitionWatermark(comp: string | undefined, league: string): WatermarkSpec | undefined {
  return (comp ? WATERMARKS[`comp:${comp}`] : undefined) ?? WATERMARKS[`league:${league}`];
}
