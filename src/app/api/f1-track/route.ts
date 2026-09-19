import { NextRequest, NextResponse } from 'next/server';
import { fetchTrackGeometry, MV_CIRCUIT_KEYS } from '@/lib/f1-track-map';
import { F1_CIRCUITS } from '@/lib/f1-data';

/**
 * GET /api/f1-track?circuit=<id>&year=<yyyy>
 * Real circuit geometry (MultiViewer) plus our curated circuit facts — the two
 * halves the track-map view needs. Geometry is cached server-side for a day.
 */
export async function GET(req: NextRequest) {
  const circuit = req.nextUrl.searchParams.get('circuit') ?? '';
  const yearRaw = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearRaw) && yearRaw > 2000 ? yearRaw : new Date().getFullYear();

  if (!circuit || !(circuit in MV_CIRCUIT_KEYS)) {
    return NextResponse.json({ error: 'Unknown circuit' }, { status: 400 });
  }

  const [geometry, facts] = [await fetchTrackGeometry(circuit, year), F1_CIRCUITS[circuit] ?? null];
  if (!geometry) return NextResponse.json({ error: 'No geometry available' }, { status: 404 });

  return NextResponse.json(
    { circuit, geometry, facts },
    { headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800' } },
  );
}
