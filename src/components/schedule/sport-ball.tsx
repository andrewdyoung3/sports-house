/**
 * Tiny inline SVG sport-ball icons used in the team filter pills.
 * Each ball is visually distinct: shape (oval vs round) + colour scheme.
 */

/** Red AFL Sherrin — landscape oval with white centre band and lacing. */
function AflBall({ h }: { h: number }) {
  const w = Math.round(h * 1.55);
  return (
    <svg width={w} height={h} viewBox="0 0 22 14" fill="none" aria-hidden="true">
      {/* Body */}
      <ellipse cx="11" cy="7" rx="10.5" ry="6.5" fill="#C41230" stroke="#8E0B20" strokeWidth="0.6" />
      {/* Highlight sheen — top-left arc */}
      <ellipse cx="7" cy="4" rx="4" ry="2" fill="white" opacity="0.09" />
      {/* White centre band */}
      <line x1="1" y1="7" x2="21" y2="7" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
      {/* Lacing — three short vertical stitches crossing the band */}
      <line x1="9.8"  y1="4.8" x2="9.8"  y2="9.2" stroke="white" strokeWidth="0.85" strokeLinecap="round" />
      <line x1="11"   y1="4.2" x2="11"   y2="9.8" stroke="white" strokeWidth="0.85" strokeLinecap="round" />
      <line x1="12.2" y1="4.8" x2="12.2" y2="9.2" stroke="white" strokeWidth="0.85" strokeLinecap="round" />
    </svg>
  );
}

/** Rugby ball — landscape oval, cream/white with tan seams. Used for NRL, Super Rugby, Rugby Int. */
function RugbyBall({ h }: { h: number }) {
  const w = Math.round(h * 1.55);
  return (
    <svg width={w} height={h} viewBox="0 0 22 14" fill="none" aria-hidden="true">
      {/* Body */}
      <ellipse cx="11" cy="7" rx="10.5" ry="6.5" fill="#EDE3C8" stroke="#7A5828" strokeWidth="0.8" />
      {/* Highlight sheen */}
      <ellipse cx="7.5" cy="4.2" rx="3.5" ry="1.8" fill="white" opacity="0.30" />
      {/* Centre seam */}
      <line x1="1" y1="7" x2="21" y2="7" stroke="#7A5828" strokeWidth="1.1" strokeLinecap="round" />
      {/* Lacing stitches */}
      <line x1="9.8"  y1="5.0" x2="9.8"  y2="9.0" stroke="#7A5828" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="11"   y1="4.4" x2="11"   y2="9.6" stroke="#7A5828" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="12.2" y1="5.0" x2="12.2" y2="9.0" stroke="#7A5828" strokeWidth="0.75" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Soccer ball — white circle with 4 black patches.
 * All vertices pre-calculated to stay inside r=9.5, so no clipPath needed.
 * Centre pentagon + top cap + two bottom-edge patches reads clearly at tiny sizes.
 */
function SoccerBall({ h }: { h: number }) {
  return (
    <svg width={h} height={h} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9.5" fill="white" stroke="#BBBBBB" strokeWidth="1.2" />
      <g fill="#1a1a1a">
        {/* Central pentagon — pointing up, r≈4.5 */}
        <polygon points="10,5.5 14.3,8.6 12.7,13.6 7.3,13.6 5.7,8.6" />
        {/* Top edge cap */}
        <polygon points="8.6,1.2 11.4,1.2 13.2,4.8 10,5.4 6.8,4.8" />
        {/* Bottom-right edge patch */}
        <polygon points="15.0,12.0 18.0,11.0 18.0,14.0 16.0,17.0 13.0,15.5" />
        {/* Bottom-left edge patch */}
        <polygon points="5.0,12.0 2.0,11.0 2.0,14.0 4.0,17.0 7.0,15.5" />
      </g>
    </svg>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

const LEAGUE_BALL: Record<string, (h: number) => React.ReactElement> = {
  afl:         h => <AflBall h={h} />,
  nrl:         h => <RugbyBall h={h} />,
  super_rugby: h => <RugbyBall h={h} />,
  rugby_int:   h => <RugbyBall h={h} />,
  epl:         h => <SoccerBall h={h} />,
};

interface SportBallProps {
  league: string;
  /** Height in pixels (width is proportional). Defaults to 12. */
  size?: number;
}

export function SportBall({ league, size = 12 }: SportBallProps) {
  const factory = LEAGUE_BALL[league];
  if (!factory) return null;
  return factory(size);
}
