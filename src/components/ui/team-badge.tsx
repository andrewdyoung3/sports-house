'use client';

import { useState } from 'react';
import Image from 'next/image';
import { contrastColor } from '@/lib/utils';

interface TeamBadgeProps {
  /** Official logo URL (ESPN CDN). Falls back to abbreviation if absent or broken. */
  logoUrl?: string;
  abbreviation: string;
  primaryColor: string;
  /** px dimension — both width and height */
  size?: number;
  className?: string;
  /**
   * When provided, renders a small circular constructor/team logo badge
   * overlaid in the bottom-right corner. Also switches the main image to
   * object-cover mode (suitable for headshot photos rather than logos).
   */
  overlayLogoUrl?: string;
}

/**
 * Renders the official team crest on a dark glass background.
 * Falls back gracefully to the coloured abbreviation badge if the image
 * fails to load or no URL is provided.
 *
 * When `overlayLogoUrl` is passed (e.g. for F1 driver headshots), the main
 * image fills the frame with object-cover and a small constructor logo badge
 * appears in the bottom-right corner.
 */
export function TeamBadge({
  logoUrl,
  abbreviation,
  primaryColor,
  size = 40,
  className = '',
  overlayLogoUrl,
}: TeamBadgeProps) {
  const [imgError,     setImgError]     = useState(false);
  const [overlayError, setOverlayError] = useState(false);

  const showLogo    = logoUrl && !imgError;
  const photoMode   = !!overlayLogoUrl;
  // Overlay is hidden when the badge is very small (< 32px) — too tiny to be useful
  const showOverlay = photoMode && !overlayError && size >= 32;

  const fontSize = size <= 24 ? '9px' : size <= 36 ? '11px' : size <= 48 ? '13px' : '16px';
  const textColor = contrastColor(primaryColor);

  // Overlay circle sizing: ~32% of the main badge, min 16px, max 28px
  const overlaySize = Math.min(28, Math.max(16, Math.round(size * 0.32)));

  if (showLogo) {
    return (
      <div
        className={`relative shrink-0 flex items-center justify-center rounded-2xl overflow-visible ${className}`}
        style={{
          width: size,
          height: size,
        }}
      >
        {/* Main image container — clips the main image only */}
        <div
          className="w-full h-full flex items-center justify-center rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid rgba(255,255,255,0.07)`,
          }}
        >
          <Image
            src={logoUrl}
            alt={abbreviation}
            width={size}
            height={size}
            className={photoMode ? 'object-cover w-full h-full' : 'object-contain p-[15%]'}
            onError={() => setImgError(true)}
            unoptimized
          />
        </div>

        {/* Constructor / team overlay badge — bottom-right corner */}
        {showOverlay && (
          <div
            className="absolute flex items-center justify-center rounded-full"
            style={{
              width: overlaySize,
              height: overlaySize,
              bottom: -4,
              right: -4,
              background: 'rgba(10,10,10,0.85)',
              border: '1.5px solid rgba(255,255,255,0.18)',
              zIndex: 10,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={overlayLogoUrl}
              alt=""
              aria-hidden="true"
              width={overlaySize - 6}
              height={overlaySize - 6}
              style={{ objectFit: 'contain', width: overlaySize - 6, height: overlaySize - 6 }}
              onError={() => setOverlayError(true)}
            />
          </div>
        )}
      </div>
    );
  }

  // Fallback — coloured badge with abbreviation
  return (
    <div
      className={`shrink-0 flex items-center justify-center rounded-2xl font-black ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: primaryColor,
        color: textColor,
        fontSize,
      }}
    >
      {abbreviation.slice(0, 3)}
    </div>
  );
}
