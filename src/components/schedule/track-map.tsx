'use client';

/**
 * TrackMap — a "View track map" button that opens the circuit drawn from REAL
 * geometry (see lib/f1-track-map.ts): F1's own racing-line polyline, numbered
 * corners, and the rotation F1 applies when displaying that circuit, plus the
 * curated circuit facts (length, laps, lap record, DRS zones) and the measured
 * pit-lane time loss.
 *
 * Deliberate omission: the geometry source carries no DRS zone coordinates, so
 * no DRS zones are drawn on the track. They are stated instead — zone count and
 * description — because an invented zone on an otherwise accurate map is worse
 * than no zone at all.
 */

import { useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';

interface TrackCorner { number: number; x: number; y: number }
interface TrackGeometry {
  name: string; location?: string;
  points: Array<{ x: number; y: number }>;
  corners: TrackCorner[];
  rotation: number;
  pitLoss?: { normal?: string; sc?: string; vsc?: string };
  year: number;
}
interface CircuitFacts {
  name: string; country: string; locality: string; length: string; laps: number;
  lapRecord: string; drsZones: number; drsDescription: string; description: string;
}

// One fetch per circuit per page life — geometry is static within a season.
const geoCache = new Map<string, { geometry: TrackGeometry; facts: CircuitFacts | null }>();

const VIEW = 1000;   // square viewBox the track is fitted into
const PAD  = 60;

/** Rotate + scale the circuit into the viewBox, preserving aspect ratio. */
function project(geo: TrackGeometry) {
  const rad = (geo.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rot = (p: { x: number; y: number }) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

  const pts = geo.points.map(rot);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (VIEW - PAD * 2) / span;
  // Centre the shorter axis; flip Y (SVG grows downward, the feed's Y grows up).
  const offX = PAD + ((VIEW - PAD * 2) - (maxX - minX) * scale) / 2;
  const offY = PAD + ((VIEW - PAD * 2) - (maxY - minY) * scale) / 2;
  const map = (p: { x: number; y: number }) => {
    const r = rot(p);
    return { x: offX + (r.x - minX) * scale, y: VIEW - (offY + (r.y - minY) * scale) };
  };
  return { map, path: pts.map((_, i) => map(geo.points[i])) };
}

export function TrackMap({ circuitId, year, accent, mapUrl }: { circuitId: string; year: number; accent?: string; mapUrl?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ geometry: TrackGeometry; facts: CircuitFacts | null } | null>(
    geoCache.get(`${circuitId}:${year}`) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!open || data || failed) return;
    fetch(`/api/f1-track?circuit=${encodeURIComponent(circuitId)}&year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.geometry) { geoCache.set(`${circuitId}:${year}`, d); setData(d); }
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [open, circuitId, year, data, failed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const color = accent && /^#/.test(accent) ? accent : '#E8002D';

  return (
    <>
      <button className="sh-bracket-open" onClick={e => { e.stopPropagation(); setOpen(true); }}>
        <MapIcon className="h-3.5 w-3.5" /> View track map
      </button>

      {open && (
        <div className="sh-bracket-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Circuit map">
          <div className="sh-bracket-modal" onClick={e => e.stopPropagation()}>
            <div className="sh-bracket-modal-head">
              <span>{data?.facts?.name ?? data?.geometry.name ?? 'Circuit'}{data?.facts ? ` — ${data.facts.locality}` : ''}</span>
              <button className="sh-bracket-close" onClick={() => setOpen(false)} aria-label="Close map">✕</button>
            </div>

            {failed ? (
              <div className="sh-bracket-loading">Track map unavailable for this circuit.</div>
            ) : !data ? (
              <div className="sh-bracket-loading">Loading circuit…</div>
            ) : (
              <div className="sh-track-body">
                <TrackSVG geo={data.geometry} color={color} />

                {/* F1's own circuit artwork — this is where DRS zones and the
                    pit lane are annotated, by the series itself. */}
                {mapUrl && !imgFailed && (
                  <figure className="sh-track-official">
                    <img src={mapUrl} alt={`${data.facts?.name ?? 'Circuit'} official layout`} onError={() => setImgFailed(true)} />
                    <figcaption>Official F1 circuit map — DRS zones, pit lane and sector markings as published by the series.</figcaption>
                  </figure>
                )}

                <div className="sh-track-facts">
                  {data.facts && (
                    <>
                      <Fact label="Length" value={data.facts.length} />
                      <Fact label="Laps" value={String(data.facts.laps)} />
                      <Fact label="Corners" value={String(data.geometry.corners.length)} />
                      <Fact label="DRS zones" value={String(data.facts.drsZones)} />
                    </>
                  )}
                  {data.geometry.pitLoss?.normal && (
                    <Fact label="Pit loss" value={`${data.geometry.pitLoss.normal}s`} hint="green-flag stop" />
                  )}
                  {data.geometry.pitLoss?.sc && (
                    <Fact label="Under SC" value={`${data.geometry.pitLoss.sc}s`} hint="safety car" />
                  )}
                </div>

                {data.facts && (
                  <p className="sh-track-note">
                    <strong>DRS:</strong> {data.facts.drsDescription}
                  </p>
                )}
                {data.facts?.lapRecord && (
                  <p className="sh-track-note"><strong>Lap record:</strong> {data.facts.lapRecord}</p>
                )}
                <p className="sh-track-source">
                  Racing line, corner numbering and pit-loss timing come from F1 timing data
                  ({data.geometry.year} layout); DRS zones are not in that feed, so they are
                  described above and shown on the official map rather than drawn here.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="sh-track-fact">
      <span className="sh-track-fact-label">{label}</span>
      <span className="sh-track-fact-value">{value}</span>
      {hint && <span className="sh-track-fact-hint">{hint}</span>}
    </div>
  );
}

function TrackSVG({ geo, color }: { geo: TrackGeometry; color: string }) {
  const { map, path } = project(geo);
  const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  const start = path[0];
  // Direction of travel at the line, for the start/finish tick.
  const next = path[Math.min(8, path.length - 1)];
  const ang = Math.atan2(next.y - start.y, next.x - start.x) * 180 / Math.PI;

  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="sh-track-svg" role="img" aria-label={`${geo.name} circuit layout`}>
      {/* Track bed, then the racing line on top */}
      <path d={d} fill="none" stroke="var(--bkt-box-border, rgba(255,255,255,0.14))" strokeWidth={26} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />

      {/* Start/finish line */}
      <g transform={`translate(${start.x} ${start.y}) rotate(${ang + 90})`}>
        <rect x={-19} y={-3} width={38} height={6} fill="var(--bkt-ink, #ffffff)" rx={1} />
      </g>
      <text x={start.x} y={start.y - 26} textAnchor="middle" fontSize={26} fontWeight={800}
        fill="var(--bkt-ink-2, rgba(255,255,255,0.78))">START</text>

      {/* Numbered corners */}
      {geo.corners.map(c => {
        const p = map({ x: c.x, y: c.y });
        return (
          <g key={c.number}>
            <circle cx={p.x} cy={p.y} r={15} fill="var(--modal-bg, #121016)" stroke={color} strokeWidth={2.5} />
            <text x={p.x} y={p.y + 7} textAnchor="middle" fontSize={19} fontWeight={800}
              fill="var(--bkt-ink, #ffffff)">{c.number}</text>
          </g>
        );
      })}
    </svg>
  );
}
