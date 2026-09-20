import { NextRequest, NextResponse } from 'next/server';
import { fetchTrackGeometry, isProvisional, MV_CIRCUIT_KEYS } from '@/lib/f1-track-map';
import { F1_CIRCUITS, canonicalCircuitId } from '@/lib/f1-data';

/**
 * GET /api/f1-track?circuit=<id>&year=<yyyy>
 * Real circuit geometry (MultiViewer) plus our curated circuit facts — the two
 * halves the track-map view needs. Geometry is cached server-side for a day.
 */
export async function GET(req: NextRequest) {
  // Accept a raw feed id too — callers outside the normalised fixture path
  // (a bookmarked URL, an older cached page) should not silently 404.
  const circuit = canonicalCircuitId(req.nextUrl.searchParams.get('circuit') ?? '');
  const yearRaw = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearRaw) && yearRaw > 2000 ? yearRaw : new Date().getFullYear();

  if (!circuit || !(circuit in MV_CIRCUIT_KEYS)) {
    return NextResponse.json({ error: 'Unknown circuit' }, { status: 400 });
  }

  const [geometry, facts] = [await fetchTrackGeometry(circuit, year), F1_CIRCUITS[circuit] ?? null];
  if (!geometry) return NextResponse.json({ error: 'No geometry available' }, { status: 404 });

  // A layout borrowed from an earlier season may not reflect a resurfacing or
  // a corner change that has not been announced in the geometry feed yet, so
  // the map says so rather than presenting it as this year's certainty. The
  // shorter edge cache matches the library's re-sampling cadence, so a
  // provisional map is replaced soon after the real one is published.
  const provisional = isProvisional(geometry, year);
  return NextResponse.json(
    { circuit, geometry, facts, provisional, layoutYear: geometry.year },
    {
      headers: {
        'Cache-Control': provisional
          ? 's-maxage=21600, stale-while-revalidate=86400'
          : 's-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}
