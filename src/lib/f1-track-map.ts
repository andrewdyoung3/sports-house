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
const TTL_MS = 24 * 60 * 60_000; // circuit geometry is static within a season

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
  if (hit && Date.now() - hit.at < TTL_MS) return hit.geo;

  for (const y of [year, year - 1]) {
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
        year:     y,
      };
      cache.set(cacheKey, { at: Date.now(), geo });
      return geo;
    } catch { /* try the previous season, then give up */ }
  }
  cache.set(cacheKey, { at: Date.now(), geo: null });
  return null;
}
