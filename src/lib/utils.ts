import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes without conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an ISO date string into a human-readable label. */
export function formatGameDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Format an ISO date as a relative "X days ago" string. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Return a contrasting text color (black or white) for a given hex background. */
export function contrastColor(hex: string): string {
  if (!HEX_RE.test(hex)) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // WCAG luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/** Add alpha transparency to a hex color. */
export function hexAlpha(hex: string, alpha: number): string {
  if (!HEX_RE.test(hex)) return hex;
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/** Validate and return a safe hex color, falling back to a default. */
export function safeHex(hex: string, fallback = '#6B7280'): string {
  return HEX_RE.test(hex) ? hex : fallback;
}

/**
 * Format a UTC ISO date string as a local time with timezone abbreviation.
 * e.g. formatTimeInZone('2026-03-14T09:10:00Z', 'Australia/Brisbane') → '7:10 pm AEST'
 */
export function formatTimeInZone(isoDate: string, timeZone: string): string {
  return new Date(isoDate).toLocaleTimeString('en-AU', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Return the 'YYYY-MM-DD' date string in a given timezone.
 * Used for grouping games by calendar date in the user's local timezone.
 */
export function datekeyInZone(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoDate));
}

/** Format a number as an ordinal string, e.g. 1 → "1st", 2 → "2nd". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Collapses same-company broadcast + streaming entries into one token per group. */
const CHANNEL_GROUPS: [string, string[]][] = [
  ['Nine/9Now',   ['Nine Network', '9Now', '9Gem']],
  ['Seven/7plus', ['Seven Network', '7plus', '7mate']],
  ['Fox/Kayo',    ['Fox Sports', 'Fox Footy', 'Kayo Sports']],
  ['Stan Sport',  ['Stan Sport']],
  ['beIN Sports', ['beIN Sports', 'beIN Sports Connect']],
];

export function dedupeChannels(broadcast: string[], streaming: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of [...broadcast, ...streaming]) {
    const group = CHANNEL_GROUPS.find(([, members]) => members.includes(ch));
    const key = group ? group[0] : ch;
    if (!seen.has(key)) { seen.add(key); result.push(key); }
  }
  return result.join(' · ');
}

/** Deterministic "random" number based on a string seed (for consistent mock data). */
export function seededRandom(seed: string, index = 0): number {
  let h = index;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) / 2147483647;
}

/**
 * Smooth-scroll the window to a target Y position over `duration` ms.
 * Uses an ease-in-out cubic curve — slightly slower than the browser
 * default `behavior:'smooth'` for a more deliberate feel.
 */
export function smoothScrollTo(targetY: number, duration = 750): void {
  // Respect the reduced-motion preference: jump to the target instantly.
  if (typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo(0, targetY);
    return;
  }

  const startY    = window.scrollY;
  const distance  = targetY - startY;
  const startTime = performance.now();

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now: number) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    window.scrollTo(0, startY + distance * easeInOutCubic(progress));
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}
