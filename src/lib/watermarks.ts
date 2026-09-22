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
 * Tuning knobs: opacity (vs the card wash; lightOpacity for the light card),
 * height (% of card height BEFORE the breakpoint factor and the card cap —
 * see .sh-wm-comp; wide wordmarks want ~140%, round roundels ~78-110%),
 * maxWidth (cap wide banners), blend ('screen' dissolves dark plates on the
 * dark card only), filter (white-force monochrome marks).
 */

export interface WatermarkSpec {
  url: string;
  opacity?: number;
  /**
   * Opacity in the LIGHT theme, when the dark-tuned one does not carry over.
   * Every `opacity` above was set by eye on the dark card; a colour plate
   * that reads soft over near-black can read twice as strong over near-white
   * (the FA Cup crest measures 0.056 vs 0.150 mean luminance shift), and our
   * own greyscale renders are lit bodies that sink into a dark card but stand
   * off a light one. Omitted = same as `opacity`.
   */
  lightOpacity?: number;
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
  // 2572/2579 both 404'd; ESPN's own scoreboard API names these ids. Opacity
  // brought into line with the Champions League mark (they share the treatment).
  'comp:Europa League':     { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png', opacity: 0.15, blend: 'screen', height: '125%', padRight: '18.2%' },
  'comp:Conference League': { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/20296.png', opacity: 0.15, blend: 'screen', height: '125%', padRight: '19.8%' },
  'comp:FA Cup':            { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/40.png',   opacity: 0.24, lightOpacity: 0.10, blend: 'screen', height: '78%', padRight: '23%'},
  'comp:EFL Cup':           { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/41.png',   opacity: 0.22, blend: 'screen', height: '78%', padRight: '17.8%'},
  // WHITE line art. `mono` is a no-op on the dark card (white → white) and is
  // what keeps it from vanishing on the light one (white on white → ink).
  'comp:Rugby Championship': { url: 'https://r2.thesportsdb.com/images/media/league/badge/dy0n4c1716684531.png', opacity: 0.20, mono: true, height: '96%', padRight: '1.2%'},
  'comp:Six Nations':        { url: 'https://r2.thesportsdb.com/images/media/league/badge/7h1wr91738670253.png', opacity: 0.20, height: '96%', padRight: '4.3%'},
  'comp:State of Origin':   { url: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Ampol_State_Of_Origin_Logo_2026.svg/500px-Ampol_State_Of_Origin_Logo_2026.svg.png', opacity: 0.18, height: '98%', padRight: '0.6%'},

  // ── Leagues ──
  'league:afl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/afl.png', opacity: 0.16, padRight: '7.4%'},
  'league:nrl':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nrl.png', opacity: 0.27, height: '98%', padRight: '13.8%'},
  // 125% = the 140% row default −15%, then +5%. Kept in step with the Champions
  // League mark above so an EPL row and a UCL row size alike.
  'league:epl':         { url: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', opacity: 0.15, mono: true, height: '125%', padRight: '22.6%'},
  'league:super_rugby': { url: 'https://r2.thesportsdb.com/images/media/league/badge/alpxhe1675871443.png', opacity: 0.18, height: '110%', padRight: '14.3%'},
  // ESPN's generic rugby icon is a solid silhouette; `mono` flattened it into a
  // featureless grey ellipse (user-reported). Locally rendered replacement —
  // the same 3D ball the fallback uses, so it takes SPORT_FALLBACK_SPEC's
  // presentation (greyscale, NOT mono; see that comment).
  // Named series (Rugby Championship, Six Nations above) still win via
  // 'comp:' — this only shows for fixtures ESPN files as
  // "international-test-match", which carry no series metadata to badge with.
  'league:rugby_int':   { url: '/watermarks/rugby-union.svg', opacity: 0.30, lightOpacity: 0.22, mono: false, height: '88%', padRight: '0%'},
  'league:nba':         { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', opacity: 0.15, padRight: '29.6%'},
  // F1 rows show ONLY this mark (no team watermark — the championship entity
  // IS the league). The old 96px was a centre-anchor correction for this wide
  // wordmark; right-edge anchoring makes it unnecessary.
  'league:f1':          { url: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',  opacity: 0.15, height: '140%', padRight: '4.6%'},
  'league:bbl':         { url: 'https://r2.thesportsdb.com/images/media/league/badge/yko7ny1546635346.png', opacity: 0.18, height: '105%', padRight: '9.4%'},
  'league:cricket_int': { url: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-cricket.png', opacity: 0.13, mono: true, height: '78%', padRight: '5.6%'},
};

/**
 * Generic per-sport marks, used when a competition/league logo fails to LOAD.
 *
 * Every mark above points at a remote CDN, and those do rot: the Europa League
 * and Conference League badges both 404 today, which left their cards with no
 * background art at all. A sport ball is always a truthful stand-in — it says
 * what game this is without claiming to be a badge we could not fetch.
 *
 * Local files, deliberately: a fallback that can itself 404 is not a fallback.
 * Each is a rendered 3D object (shaded body, panels, seams, curved brand text,
 * leather grain) in GREYSCALE + alpha — one file serves both themes without
 * the mono filter, see SPORT_FALLBACK_SPEC — and each viewBox is the artwork's
 * tight bounding box so padRight is 0%. Rendered by tools/watermarks (a small
 * Python spheroid renderer); regenerate there rather than hand-editing the
 * ~150 KB path soup.
 */
const SPORT_FALLBACKS: Record<string, string> = {
  afl:         '/watermarks/ball-afl.svg',
  nrl:         '/watermarks/rugby-union.svg',
  super_rugby: '/watermarks/rugby-union.svg',
  rugby_int:   '/watermarks/rugby-union.svg',
  epl:         '/watermarks/ball-football.svg',
  nba:         '/watermarks/ball-basketball.svg',
  nfl:         '/watermarks/ball-gridiron.svg',
  mlb:         '/watermarks/ball-baseball.svg',
  nhl:         '/watermarks/puck-hockey.svg',
  f1:          '/watermarks/flag-motorsport.svg',
  bbl:         '/watermarks/ball-cricket.svg',
  cricket_int: '/watermarks/ball-cricket.svg',
};

/** The sport-ball stand-in for a league, or undefined if we have none. */
export function sportFallbackMark(league: string): string | undefined {
  return SPORT_FALLBACKS[league];
}

/**
 * Presentation for a fallback mark — it is our own art, so one setting fits all.
 *
 * NOT mono, on purpose. The marks are shaded greyscale renders, and the mono
 * filter (brightness(0) invert(1)) would crush every tone to one ink and throw
 * the 3D away. Left as-is they are physically honest on both grounds with one
 * file: on a dark card the lit body carries the form and the black panels sink
 * into the card; on a light card the black panels and form shadow carry it and
 * the lit body sinks into the paper.
 *
 * Opacity sits above the badge marks (0.30 vs ~0.15) because half of each
 * mark's tonal range disappears into whichever ground it is on, so what is
 * left has to work harder than a solid plate of ink does. Lower again in
 * light: the lit body stands off white paper where it sank into the dark
 * card, so the same number read ~25% stronger there (measured, and visible —
 * the ball was the loudest thing on the page). These land the marks in the
 * same mean-luminance-shift band as the badge marks on each ground.
 */
export const SPORT_FALLBACK_SPEC: Required<Pick<WatermarkSpec, 'opacity' | 'lightOpacity' | 'height' | 'padRight' | 'mono'>> = {
  opacity: 0.30, lightOpacity: 0.22, height: '88%', padRight: '0%', mono: false,
};

/** Competition-first watermark lookup for a fixture row. */
export function competitionWatermark(comp: string | undefined, league: string): WatermarkSpec | undefined {
  return (comp ? WATERMARKS[`comp:${comp}`] : undefined) ?? WATERMARKS[`league:${league}`];
}
