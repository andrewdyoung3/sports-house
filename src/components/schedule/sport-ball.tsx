/**
 * Sport ball icons.
 * AFL: custom red Sherrin SVG — visually distinct from the rugby codes.
 * All other leagues: native emoji rendered by the OS at the right size.
 */

import React from 'react';

/**
 * Red AFL Sherrin — tilted ~40° to match the rugby ball emoji orientation.
 * Square viewBox accommodates the diagonal. Features:
 *   • rich red body with darker shadow panel and bright highlight sheen
 *   • wide white lace panel (rect) perpendicular to the long axis
 *   • three horizontal lacing bars + vertical spine through the panel
 *   • subtle body seams curving away from the panel on each side
 */
function AflBall({ h }: { h: number }) {
  return (
    <svg width={h} height={h} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <g transform="rotate(-42, 11, 11)">
        {/* Body */}
        <ellipse cx="11" cy="11" rx="9.8" ry="5.4" fill="#C8102E" stroke="#8A0820" strokeWidth="0.65" />
        {/* Shadow panel — lower-right gives depth */}
        <ellipse cx="12.5" cy="14" rx="7.5" ry="3.0" fill="#7A0618" opacity="0.50" />
        {/* Highlight sheen — upper-left */}
        <ellipse cx="7.2" cy="8.2" rx="4.2" ry="2.0" fill="white" opacity="0.22" />
        {/* White lace panel */}
        <rect x="9.7" y="5.6" width="2.6" height="10.8" rx="0.5" fill="white" opacity="0.93" />
        {/* Lacing horizontal bars — dark, confined within the white panel */}
        <line x1="9.7" y1="8.5"  x2="12.3" y2="8.5"  stroke="#222" strokeWidth="0.75" strokeLinecap="round" />
        <line x1="9.7" y1="10.2" x2="12.3" y2="10.2" stroke="#222" strokeWidth="0.75" strokeLinecap="round" />
        <line x1="9.7" y1="11.9" x2="12.3" y2="11.9" stroke="#222" strokeWidth="0.75" strokeLinecap="round" />
        <line x1="9.7" y1="13.6" x2="12.3" y2="13.6" stroke="#222" strokeWidth="0.75" strokeLinecap="round" />
        {/* Body seams curving away from panel on each side */}
        <path d="M1.5 11 Q5.5 9.2 9.7 11" stroke="#8A0820" strokeWidth="0.55" fill="none" strokeLinecap="round" opacity="0.65" />
        <path d="M12.3 11 Q16.5 9.2 20.5 11" stroke="#8A0820" strokeWidth="0.55" fill="none" strokeLinecap="round" opacity="0.65" />
      </g>
    </svg>
  );
}

const LEAGUE_EMOJI: Record<string, string> = {
  nrl:         '🏉',
  super_rugby: '🏉',
  rugby_int:   '🏉',
  epl:         '⚽',
  nba:         '🏀',
  nfl:         '🏈',
  mlb:         '⚾',
  nhl:         '🏒',
  f1:          '🏎',
  bbl:         '🏏',
  cricket_int: '🏏',
  world_cup:   '🏆',
};

interface SportBallProps {
  league: string;
  /** Height in pixels. Defaults to 12. */
  size?: number;
}

export function SportBall({ league, size = 12 }: SportBallProps) {
  if (league === 'afl') return <AflBall h={size} />;
  const emoji = LEAGUE_EMOJI[league];
  if (emoji) return <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>;
  return null;
}
