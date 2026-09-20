/**
 * F1 track geometry — real circuit outlines for the track-map view.
 *
 * Source: the MultiViewer circuit API (api.multiviewer.app), which serves the
 * same geometry F1's own live-timing graphics use: an ordered x/y polyline of
 * the racing line, numbered corner positions, the display rotation F1 applies,
 * and measured pit-loss times. Nothing here is drawn by hand or approximated.
 *
 * What this data does NOT contain is DRS zone geometry, so the map never draws
 * DRS zones — the panel states the zone count and description from the curated
 * F1_CIRCUITS entries instead. Showing an invented zone would be worse than
 * showing none.
 *
 * Circuit keys were discovered by scanning the API once (2026-09-19) and are
 * pinned here so no discovery traffic runs at request time.
 */

/** Our F1_CIRCUITS id → MultiViewer circuitKey. */
export const MV_CIRCUIT_KEYS: Record<string, number> = {
  albert_park:        10,  // Melbourne
  bahrain:            63,  // Sakhir
  jeddah:            149,
  suzuka:             46,
  shanghai:           49,
  miami:             151,
  imola:               6,
  monaco:             22,  // Monte Carlo
  catalunya:          15,
  gilles_villeneuve:  23,  // Montréal
  silverstone:         2,
  hungaroring:         4,
  spa:                 7,
  zandvoort:          55,
  monza:              39,
  baku:              144,
  marina_bay:         61,  // Singapore
  americas:            9,  // Austin
  red_bull_ring:      19,  // Spielberg — added 2026-09-20; its absence cost the
                           // Austrian round both its map and its facts.
  rodriguez:          65,  // Mexico City
  interlagos:         14,
  las_vegas:         152,
  losail:            150,
  yas_marina:         70,
};

export interface TrackCorner {
  number: number; x: number; y: number;
  /** Turn angle in degrees (magnitude = how sharply the corner turns). */
  angle: number;
  /** Cumulative distance to the corner, in the feed's own units. */
  length: number;
}
export interface TrackGeometry {
  name: string;
  location?: string;
  /** Racing-line polyline, in the API's own coordinate space. */
  points: Array<{ x: number; y: number }>;
  corners: TrackCorner[];
  /** Degrees of rotation F1 applies when displaying this circuit. */
  rotation: number;
  /** Measured pit-lane time loss, seconds. */
  pitLoss?: { normal?: string; sc?: string; vsc?: string };
  year: number;
}

const cache = new Map<string, { at: number; geo: TrackGeometry | null }>();

/**
 * Re-sampling cadence. Geometry for the ASKED-FOR season is static — a layout
 * is fixed once the season's entry exists — so it is held for a day.
 *
 * The other two outcomes are provisional and are re-checked far more often, so
 * the map corrects itself without a deploy:
 *  - a PRIOR season's layout served as a stand-in: the current-season entry
 *    usually appears in the weeks before a round, and re-sampling is what
 *    swaps a provisional map for the real one.
 *  - NOTHING found: a newly-added or returning circuit (Madrid, Sepang) may be
 *    published mid-season. A day-long negative cache would hide it that long.
 */
const TTL_EXACT_MS       = 24 * 60 * 60_000;
const TTL_PROVISIONAL_MS =  6 * 60 * 60_000;
const TTL_MISSING_MS     =  3 * 60 * 60_000;

function ttlFor(geo: TrackGeometry | null, askedYear: number): number {
  if (!geo) return TTL_MISSING_MS;
  return geo.year === askedYear ? TTL_EXACT_MS : TTL_PROVISIONAL_MS;
}

/**
 * True when the served layout predates the race's season — the API answered
 * with an older circuit shape because the race year's own is not published.
 * A LATER layout is not provisional: it is at worst the same shape, and F1
 * publishes next season's geometry ahead of the calendar.
 */
export function isProvisional(geo: TrackGeometry, askedYear: number): boolean {
  return geo.year < askedYear;
}

/**
 * Geometry for one circuit, or null when we have no key for it (or the API is
 * unreachable). Tries the fixture's season first, then the prior one — a new
 * season's entry can lag, and a circuit's shape rarely changes between them.
 */
export async function fetchTrackGeometry(circuitId: string, year: number): Promise<TrackGeometry | null> {
  const key = MV_CIRCUIT_KEYS[circuitId];
  if (!key) return null;

  const cacheKey = `${key}:${year}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlFor(hit.geo, year)) return hit.geo;

  // Walk back a few seasons: a circuit returning after an absence, or a season
  // whose entry has not been published yet, still has a usable shape. Anything
  // older than the asked-for year is flagged provisional to the caller.
  for (const y of [year, year - 1, year - 2, year - 3]) {
    try {
      const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`, {
        headers: { 'User-Agent': 'SportsHouseMVP/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const d = await res.json() as Record<string, unknown>;
      const xs = d.x as number[] | undefined;
      const ys = d.y as number[] | undefined;
      if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length < 10) continue;

      const geo: TrackGeometry = {
        name:     String(d.circuitName ?? circuitId),
        location: d.location ? String(d.location) : undefined,
        points:   xs.map((x, i) => ({ x, y: ys[i] })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
        corners:  ((d.corners ?? []) as Array<Record<string, any>>)
          .filter(c => c?.trackPosition)
          .map(c => ({
            number: Number(c.number),
            x: Number(c.trackPosition.x), y: Number(c.trackPosition.y),
            angle: Number(c.angle ?? 0), length: Number(c.length ?? 0),
          })),
        rotation: Number(d.rotation ?? 0),
        pitLoss:  (d.pitLoss ?? undefined) as TrackGeometry['pitLoss'],
        // The SEASON THE PAYLOAD REPORTS, not the season we asked for. The API
        // answers any year with its nearest held layout and states which one
        // that is, so this is the only honest basis for the provisional flag —
        // echoing back `y` made every map look current, including ones drawn
        // from a layout several seasons old.
        year:     Number.isFinite(Number(d.year)) ? Number(d.year) : y,
      };
      cache.set(cacheKey, { at: Date.now(), geo });
      return geo;
    } catch { /* try the previous season, then give up */ }
  }
  cache.set(cacheKey, { at: Date.now(), geo: null });
  return null;
}
