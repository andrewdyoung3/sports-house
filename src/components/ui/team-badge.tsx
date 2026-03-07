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
}

/**
 * Renders the official team crest on a dark glass background.
 * Falls back gracefully to the coloured abbreviation badge if the image
 * fails to load or no URL is provided.
 */
export function TeamBadge({
  logoUrl,
  abbreviation,
  primaryColor,
  size = 40,
  className = '',
}: TeamBadgeProps) {
  const [imgError, setImgError] = useState(false);
  const showLogo = logoUrl && !imgError;

  const fontSize = size <= 24 ? '9px' : size <= 36 ? '11px' : size <= 48 ? '13px' : '16px';
  const textColor = contrastColor(primaryColor);

  if (showLogo) {
    return (
      <div
        className={`relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden ${className}`}
        style={{
          width: size,
          height: size,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: `0 4px 20px rgba(0,0,0,0.35), 0 0 0 1px ${primaryColor}22`,
        }}
      >
        <Image
          src={logoUrl}
          alt={abbreviation}
          width={size}
          height={size}
          className="object-contain p-[15%]"
          onError={() => setImgError(true)}
          unoptimized
        />
      </div>
    );
  }

  // Fallback — coloured badge with abbreviation
  return (
    <div
      className={`shrink-0 flex items-center justify-center rounded-xl font-black ${className}`}
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
