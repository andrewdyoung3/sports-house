/**
 * team-ink.ts — readable text tones derived from team brand colours.
 *
 * WHY: every accent in the app is a raw brand hex (`--accent: team.primaryColor`)
 * and a dozen CSS rules paint TEXT with it. Brand colours are chosen for jerseys,
 * not for type on a page, so a contrast audit of all 255 teams found ZERO that
 * clear WCAG AA (4.5:1) in both themes:
 *   - light mode: 48 teams below 3:1 — the yellows lead (Richmond #FFD200 at
 *     1.39:1, Wallabies/Hurricanes #FFD700 at 1.35:1), followed by cyan/teal
 *     (Mercedes #27F4D2), silvers (Spurs #C4CED4), light blues and oranges.
 *   - dark mode: 138 teams below 3:1 — the blacks (Collingwood, All Blacks,
 *     Raiders, Fulham at 1.16:1) and the deep navies that dominate NFL/NHL/MLB.
 *
 * HOW: keep the hue, move only the lightness. The colour is converted to OKLCh
 * (perceptually uniform, so a lightness change does not swing the hue the way
 * HSL does), then a binary search finds the lightness nearest the brand tone
 * that clears the contrast target against that theme's card background.
 * Teams that already pass are returned untouched — most bright colours are
 * fine in dark mode and most dark colours are fine in light mode, so the
 * correction only fires where it is needed.
 *
 * The two tones are emitted together as CSS custom properties (see accentVars)
 * and globals.css picks one per theme, so the navbar's light/dark toggle
 * switches ink with no recompute and no React re-render.
 */

/** Composited card backgrounds — .glass over body, per theme (globals.css). */
export const INK_BG_LIGHT = '#fbfafc'; // rgba(255,255,255,.62)  over #f4f1f8
export const INK_BG_DARK  = '#161617'; // rgba(255,255,255,.055) over #080809

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const srgbToLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};
const channels = (hex: string) => [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16)));

/** WCAG 2.x relative luminance (the real one — see contrastColor's note in utils.ts). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque hex colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hexToOklch(hex: string): [L: number, C: number, H: number] {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToHex(L: number, C: number, H: number): string {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  // Out-of-gamut components are clipped by linearToSrgb; the search only walks
  // lightness, so clipping shifts chroma slightly but never the hue.
  const r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** WCAG AA for normal text. Accent text here is small (11–13px labels), so AA it is. */
export const INK_TARGET_AA = 4.5;

/**
 * The brand colour if it is already readable on `bg`, otherwise the nearest
 * tone of the same hue that clears `target`. Darkens on light backgrounds and
 * lightens on dark ones; an unparseable hex is passed through untouched.
 */
export function readableInk(hex: string, bg: string, target: number = INK_TARGET_AA): string {
  if (!HEX_RE.test(hex)) return hex;
  const brand = hex.toLowerCase();
  if (contrastRatio(brand, bg) >= target) return brand;

  const [L0, C, H] = hexToOklch(brand);
  const darken = relativeLuminance(bg) > 0.4;
  // Search between the brand lightness and the extreme that gains contrast, so
  // the result is the *least* altered tone that passes.
  let lo = darken ? 0 : L0;
  let hi = darken ? L0 : 1;
  let best = darken ? '#000000' : '#ffffff';
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = oklchToHex(mid, C, H);
    if (contrastRatio(candidate, bg) >= target) {
      best = candidate;
      if (darken) lo = mid; else hi = mid;
    } else if (darken) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/**
 * CSS custom properties for a team accent. Spread into a `style` prop in place
 * of `{ '--accent': hex }`:
 *
 *   --accent        the brand colour — fills, borders, glows, tints (unchanged)
 *   --accent-ink-l  readable on the light theme
 *   --accent-ink-d  readable on the dark theme
 *
 * globals.css resolves `--accent-ink` to one of the two per theme. Paint text
 * and icons with `--accent-ink`; keep `--accent` for everything else.
 */
export function accentVars(hex: string): Record<string, string> {
  return {
    '--accent': hex,
    '--accent-ink-l': readableInk(hex, INK_BG_LIGHT),
    '--accent-ink-d': readableInk(hex, INK_BG_DARK),
  };
}
