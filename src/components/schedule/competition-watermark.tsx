'use client';

/**
 * CompetitionWatermark — the background art on a fixture/result card.
 *
 * Replaces four near-identical renderers (the standard row and the F1 row, on
 * both schedule and results). They had already drifted once over watermark
 * opacities, which is what `watermarks.ts` was created to stop; keeping the
 * MARKUP in one place closes the other half of that gap.
 *
 * It also owns the load failure. Each renderer previously hid the image on
 * error, so a dead CDN left the card with no art at all — which is the state
 * the Europa League and Conference League are in right now, both 404. Instead
 * the mark falls back to that sport's ball: honest about the game without
 * pretending to be a badge we could not fetch.
 */

import { useState } from 'react';
import {
  competitionWatermark, sportFallbackMark,
  SPORT_FALLBACK_SPEC, WM_RIGHT_INSET,
} from '@/lib/watermarks';

interface CompetitionWatermarkProps {
  /** Fixture competition, when it has one — takes precedence over the league mark. */
  competition?: string;
  league: string;
  /**
   * Override the breakpoint size factor the shared class applies. F1 rows pass
   * 1: that mark is already sized for the card and must not be scaled again.
   */
  scale?: number;
}

export function CompetitionWatermark({ competition, league, scale }: CompetitionWatermarkProps) {
  const [failed, setFailed] = useState(false);

  const wm       = competitionWatermark(competition, league);
  const fallback = sportFallbackMark(league);
  // Use the fallback when the real mark errored, and also when we have no mark
  // for this league at all — either way the card keeps its art.
  const useBall  = failed || !wm?.url;
  const src      = useBall ? fallback : wm?.url;
  if (!src) return null;

  const spec = useBall ? SPORT_FALLBACK_SPEC : wm!;
  const mono = useBall ? SPORT_FALLBACK_SPEC.mono : wm!.mono;
  const screen = !useBall && wm?.blend === 'screen';

  // Size and opacity go through CSS variables rather than inline height/opacity
  // so the stylesheet can clamp the size to the card and swap the opacity per
  // theme (see .sh-wm-comp in globals.css).
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      loading="lazy"
      decoding="async"
      src={src}
      alt=""
      aria-hidden="true"
      width={100}
      height={100}
      className={'sh-wm-comp' + (mono ? ' sh-wm-mono' : '') + (screen ? ' sh-wm-screen' : '')}
      style={{
        '--wm-right': wm?.right ?? WM_RIGHT_INSET,
        '--wm-padx': spec.padRight ?? '0%',
        '--wm-h':    spec.height ?? '140%',
        '--wm-op':   spec.opacity ?? 0.18,
        ...(spec.lightOpacity !== undefined ? { '--wm-op-light': spec.lightOpacity } : {}),
        ...(scale !== undefined ? { '--wm-k': scale } : {}),
        ...(!useBall && wm?.maxWidth ? { maxWidth: wm.maxWidth } : {}),
        ...(!useBall && wm?.filter   ? { filter: wm.filter } : {}),
      } as React.CSSProperties}
      // One-way: once we are on the ball there is nothing further to fall back to.
      onError={() => { if (!useBall) setFailed(true); }}
    />
  );
}
