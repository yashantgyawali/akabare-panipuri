/**
 * Akabare Panipuri — card palette.
 *
 * Every `base` colour is the exact frame fill sampled from the v0.6 print
 * sheets (source_assets/print_sheets/*.png; `node scripts/extract-art.mjs`
 * re-verifies them). The other shades are derived perceptually in OKLCH:
 * shadows get darker, a little less saturated and drift a few degrees toward
 * a warm masala hue (like gouache shadows glazed with burnt sienna), tints are
 * mixed toward the card cream, never toward white. The result stays earthy —
 * nothing here should read as neon.
 *
 * Framework-free and dependency-free: safe to import from React components,
 * SVG string generators (src/cards/backs.ts) and Node scripts alike.
 */

import type { ColorId } from '../engine/types.ts';

// ---------------------------------------------------------------------------
// Fixed accents
// ---------------------------------------------------------------------------

/** The double rounded border on every card (sampled: 245,232,202). */
export const CREAM = '#F5E8CA';
/** Slightly brighter cream used for the printed titles and index circle (sampled: 249,239,211). */
export const CREAM_BRIGHT = '#F9EFD3';
/** The deckled paper edge around the illustrations (sampled). */
export const PAPER = '#EEE1C9';
/** Deep masala brown — outlines, body text on cream, the "ink" of the hand-drawn lines. */
export const INK = '#3A2418';
/** Softer brown for secondary ink / hairlines. */
export const INK_SOFT = '#6B4A33';
/** Turmeric gold (between the Vinegar background #CA8D1C and its liquid #E9A011). */
export const GOLD = '#D99A22';
/** Akabare red — the chili's body (sampled range #BF2410 … #E54B21). */
export const CHILI = '#C8321A';
/** Chili stem / coriander leaf green. */
export const LEAF = '#4F7A32';

/** Golden fried puri shell, sampled from the Panipuri / Akabare art (light → shadow). */
export const PURI_GOLD = {
  light: '#F3C46A',
  mid: '#E39A36',
  deep: '#AB5417',
} as const;

// ---------------------------------------------------------------------------
// OKLCH math (Björn Ottosson's OKLab), inline so there are no dependencies
// ---------------------------------------------------------------------------

export interface Oklch {
  /** Perceptual lightness 0…1 */
  l: number;
  /** Chroma, ~0…0.37 */
  c: number;
  /** Hue in degrees 0…360 */
  h: number;
}

interface Oklab { l: number; a: number; b: number }

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbToOklab([r, g, b]: [number, number, number]): Oklab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab → gamma sRGB, unclamped (components may fall outside 0…1). */
function oklabToRgb({ l: L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const labToLch = ({ l, a, b }: Oklab): Oklch => ({ l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 });
const lchToLab = ({ l, c, h }: Oklch): Oklab => ({ l, a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) });
const inGamut = (rgb: [number, number, number]): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function hexToOklch(hex: string): Oklch {
  return labToLch(rgbToOklab(hexToRgb(hex)));
}

/** OKLCH → hex. Out-of-gamut colours keep L and h and lose chroma until they fit (no hue shifts, no clipping casts). */
export function oklchToHex(c: Oklch): string {
  const col = { l: clamp01(c.l), c: Math.max(0, c.c), h: c.h };
  let rgb = oklabToRgb(lchToLab(col));
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = col.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToRgb(lchToLab({ ...col, c: mid })))) lo = mid;
      else hi = mid;
    }
    rgb = oklabToRgb(lchToLab({ ...col, c: lo }));
  }
  return rgbToHex(rgb);
}

/** Perceptual mix in OKLab. t = 0 → a, t = 1 → b. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb({ l: A.l + (B.l - A.l) * t, a: A.a + (B.a - A.a) * t, b: A.b + (B.b - A.b) * t }));
}

/** Relative adjust in OKLCH: dl is added to L, cMul multiplies chroma, dh is added to hue. */
export function adjustOklch(hex: string, { dl = 0, cMul = 1, dh = 0 }: { dl?: number; cMul?: number; dh?: number }): string {
  const c = hexToOklch(hex);
  return oklchToHex({ l: c.l + dl, c: c.c * cMul, h: (c.h + dh + 360) % 360 });
}

/** `#RRGGBB` + alpha 0…1 → `rgba()` string (for SVG/CSS). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, b2] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Player palette
// ---------------------------------------------------------------------------

export interface PlayerShades {
  /** Display name. */
  name: string;
  /** Exact frame fill from the print sheets. */
  base: string;
  /** One step into shadow — gradients, pressed states, back-design mid-tones. */
  deep: string;
  /** Two steps into shadow — outlines on the base, vignettes, card edges. */
  darker: string;
  /** Cream-mixed tint — highlights, tinted panels, the power back's lattice on cream. */
  light: string;
  /** Very dark, low-chroma version of the hue — text/lines in the player colour on cream. */
  ink: string;
  /** CREAM or INK, whichever reads better on `base` (WCAG contrast). */
  onBase: string;
}

/** Sampled frame fills (print sheets v0.6). */
export const FRAME_FILL: Record<ColorId, string> = {
  red: '#B84A3A',
  blue: '#2D6281',
  yellow: '#D29B2E',
  green: '#47704D',
  purple: '#71506F',
  orange: '#C66D38',
};

const NAMES: Record<ColorId, string> = {
  red: 'Red',
  blue: 'Blue',
  yellow: 'Yellow',
  green: 'Green',
  purple: 'Purple',
  orange: 'Orange',
};

/** The warm hue shadows drift toward (burnt sienna / masala, OKLCH degrees). */
const WARM_HUE = 50;

/** Rotate `h` toward WARM_HUE by at most `deg` degrees along the shorter arc. */
function warmShift(h: number, deg: number): number {
  const d = ((WARM_HUE - h + 540) % 360) - 180;
  return (h + Math.sign(d) * Math.min(Math.abs(d), deg) + 360) % 360;
}

function derive(color: ColorId): PlayerShades {
  const base = FRAME_FILL[color];
  const b = hexToOklch(base);
  const deep = oklchToHex({ l: b.l - 0.1, c: b.c * 0.86, h: warmShift(b.h, 4) });
  const darker = oklchToHex({ l: Math.max(0.24, b.l - 0.21), c: b.c * 0.6, h: warmShift(b.h, 6) });
  // Tint: lift L toward ~0.84 keeping the hue's own chroma, then glaze with cream.
  // (A straight OKLab mix with cream greys out the cool hues — blue/cream are near-complements.)
  const lifted = oklchToHex({ l: b.l + (0.86 - b.l) * 0.8, c: b.c * 0.56, h: warmShift(b.h, 3) });
  const light = mixOklab(lifted, CREAM, 0.3);
  const ink = oklchToHex({ l: 0.29, c: Math.min(b.c * 0.55, 0.06), h: warmShift(b.h, 5) });
  const onBase = contrastRatio(CREAM, base) >= contrastRatio(INK, base) ? CREAM : INK;
  return { name: NAMES[color], base, deep, darker, light, ink, onBase };
}

export const PLAYER_PALETTE: Record<ColorId, PlayerShades> = {
  red: derive('red'),
  blue: derive('blue'),
  yellow: derive('yellow'),
  green: derive('green'),
  purple: derive('purple'),
  orange: derive('orange'),
};
