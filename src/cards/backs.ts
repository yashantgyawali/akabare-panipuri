/**
 * Akabare Panipuri — the two card backs (final design, see docs/CARD_BACKS.md).
 *
 * Synthesised from three explored concepts (src/cards/concepts/*): the
 * painterly field, sunburst, lace-and-vine medallion, woven lattice and corner
 * sprays of "gouache-medallion" (the winner); the strict point symmetry and
 * seeded, renderer-independent pigment wash of "mithila-folk"; the top-down
 * masala-dabba bowls and per-owner accent choice of "dhaka-weave".
 *
 * Puri back  — owner colour as a mottled gouache wash with a hand-painted
 *              sunburst; a flame-petal lotus and a cream lace band with a
 *              leaf-and-berry vine frame a golden puri seen from above, a glossy
 *              round akabare chili sitting in its broken top. AKABARE PANIPURI
 *              arches over and (turned) under it, अकबरे पानीपुरी at both ends.
 * Power back — the balance inverted: a deckled parchment panel woven with an
 *              owner-colour Dhaka lattice inside an owner-colour margin; a deep
 *              owner-colour masala dabba whose eight katoris hold the four powers
 *              twice (vinegar, dahi, chaat, khali puri); a coin legend reading
 *              POWER · शक्ति round it.
 *
 * No-cheat properties
 *  - puriBackSvg() is the only puri back: Panipuri and Akabare are identical.
 *  - Both backs are point-symmetric: every element above the centre line has
 *    an exact 180° twin (built with <use rotate(180)>), the medallions use
 *    even-order wobble, and the pigment wash is made of seeded blots rather
 *    than feTurbulence (whose noise renderers do not rotate). Only the 1–2 px
 *    paper tooth and the ±2 px hand-drawn edge wobble are not symmetric.
 *  - Corner pips (1–6, the player's seat number, like die faces) give every
 *    owner a colour-independent mark for print and for colour-blind players.
 *
 * Pure functions returning standalone SVG strings (750×1050): no DOM, no fonts,
 * no external refs, ids namespaced per kind + colour (safe to inline several).
 * All irregularity is seeded, so the output is stable. Erasable TS only.
 */

import type { ColorId } from '../engine/types.ts';
import { COLORS } from '../engine/types.ts';
import { PLAYER_PALETTE, CREAM, CREAM_BRIGHT, PAPER, INK, GOLD, CHILI, LEAF, PURI_GOLD, mixOklab } from './palette.ts';
import type { PlayerShades } from './palette.ts';
import { FRAME } from './geometry.ts';
import { WORDMARKS, wordmarkSvg } from './wordmarks.ts';
import type { WordmarkId } from './wordmarks.ts';
import { BACK_COPY } from './content.ts';

/** Bump whenever the artwork changes (cache key for pre-rendered backs). */
export const BACK_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Geometry kit (deterministic, compact output)
// ---------------------------------------------------------------------------

type Pt = [number, number];
type Seg = ['M', Pt] | ['L', Pt] | ['Q', Pt, Pt] | ['C', Pt, Pt, Pt] | ['Z'];

const W = 750;
const H = 1050;
const CX = 375;
const CY = 525;

/** mulberry32 — tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q1 = (v: number): number => Math.round(v * 10) / 10;
/** Shortest decimal form, 1 dp: 0.5 → ".5", -0.5 → "-.5". */
function fx(v: number): string {
  const r = q1(v);
  if (r === 0) return '0';
  const s = String(r);
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s;
}
function nums(vals: number[]): string {
  let out = '';
  for (const v of vals) {
    const s = fx(v);
    out += out && !s.startsWith('-') ? ' ' + s : s;
  }
  return out;
}
const k3 = (v: number): string => String(Math.round(v * 1000) / 1000);

/** Serialise segments as a compact relative path. */
function ser(segs: Seg[]): string {
  let out = '';
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let last = '';
  const R = (p: Pt): Pt => [q1(p[0]), q1(p[1])];
  const rel = (p: Pt): number[] => [p[0] - cur[0], p[1] - cur[1]];
  const emit = (cmd: string, vals: number[]): void => {
    const body = nums(vals);
    if (cmd === last && cmd !== 'm') out += body.startsWith('-') ? body : ' ' + body;
    else out += cmd + body;
    last = cmd;
  };
  for (const s of segs) {
    if (s[0] === 'M') {
      const p = R(s[1]);
      if (out) emit('m', rel(p));
      else { out += 'M' + nums(p); last = 'M'; }
      cur = p; start = p;
    } else if (s[0] === 'L') {
      const p = R(s[1]);
      emit('l', rel(p)); cur = p;
    } else if (s[0] === 'Q') {
      const a = R(s[1]), p = R(s[2]);
      emit('q', [...rel(a), ...rel(p)]); cur = p;
    } else if (s[0] === 'C') {
      const a = R(s[1]), b = R(s[2]), p = R(s[3]);
      emit('c', [...rel(a), ...rel(b), ...rel(p)]); cur = p;
    } else {
      out += 'z'; last = 'z'; cur = start;
    }
  }
  return out;
}

const rad = (d: number): number => (d * Math.PI) / 180;
/** Polar → card coords. Angle in degrees, 0 = straight up, clockwise. */
const polar = (cx: number, cy: number, r: number, a: number): Pt => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
const rotPt = ([x, y]: Pt, a: number): Pt => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a));
  return [x * c - y * s, x * s + y * c];
};
/** The 180° twin of a card point. */
const turn = ([x, y]: Pt): Pt => [2 * CX - x, 2 * CY - y];

/** Catmull-Rom spline through the points, as cubic Bézier segments. */
function crSegs(pts: Pt[], closed: boolean, k = 1 / 6): Seg[] {
  const n = pts.length;
  const g = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs: Seg[] = [['M', pts[0]]];
  const cnt = closed ? n : n - 1;
  for (let i = 0; i < cnt; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    segs.push(['C', [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k], [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k], p2]);
  }
  if (closed) segs.push(['Z']);
  return segs;
}
const crPath = (pts: Pt[], closed: boolean, k = 1 / 6): string => ser(crSegs(pts, closed, k));

/** Evenly (by parameter) sample an open Catmull-Rom spline. */
function sampleCR(pts: Pt[], n: number): Pt[] {
  const m = pts.length;
  const g = (i: number): Pt => pts[Math.max(0, Math.min(m - 1, i))];
  const out: Pt[] = [];
  for (let s = 0; s < n; s++) {
    const t = (s / (n - 1)) * (m - 1);
    const i = Math.min(m - 2, Math.floor(t));
    const u = t - i;
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const f = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

/** Tapered brush stroke along `spine`; `width(t)` is the half-width at t ∈ [0,1], with seeded jitter. */
function brushSegs(spine: Pt[], width: (t: number) => number, rnd: () => number, samples = 12, jit = 0.12): Seg[] {
  const pts = sampleCR(spine, samples);
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const w = Math.max(0, width(i / (pts.length - 1)) * (1 + (rnd() - 0.5) * 2 * jit));
    L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
    R.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
  }
  const clean: Pt[] = [];
  for (const p of [...L, ...R.reverse()]) {
    const c = clean[clean.length - 1];
    if (!c || Math.hypot(p[0] - c[0], p[1] - c[1]) > 0.5) clean.push(p);
  }
  return crSegs(clean, true);
}
const brush = (spine: Pt[], width: (t: number) => number, rnd: () => number, samples = 12, jit = 0.12): string =>
  ser(brushSegs(spine, width, rnd, samples, jit));
/** Classic leaf / petal profile: pointed at both ends, fullest a little before the middle. */
const leafW = (w: number, p = 0.75) => (t: number): number => w * Math.pow(Math.sin(Math.PI * t), p) * (1 - 0.25 * t);
/** Flame / petal profile: round shoulder near 40%, needle-sharp tip. */
const flameW = (w: number) => (t: number): number => w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.78);

/**
 * Smooth periodic wobble from a few random EVEN harmonics, so f(a + 180°) = f(a):
 * any outline built from it is point-symmetric about its centre.
 */
function wobble(rnd: () => number, amp: number, harmonics: number[] = [2, 4, 6, 8, 12]): (a: number) => number {
  const hs = harmonics.map((k, i) => ({ k, ph: rnd() * Math.PI * 2, w: (rnd() * 0.6 + 0.4) / (1 + i * 0.5) }));
  const tot = hs.reduce((s, h) => s + h.w, 0);
  return (a: number) => (amp * hs.reduce((s, h) => s + h.w * Math.sin(rad(a) * h.k + h.ph), 0)) / tot;
}

function circlePts(cx: number, cy: number, r: number, n: number, off: (a: number) => number = () => 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    out.push(polar(cx, cy, r + off(a), a));
  }
  return out;
}
const wobblySegs = (cx: number, cy: number, r: number, rnd: () => number, amp: number, n = 40): Seg[] =>
  crSegs(circlePts(cx, cy, r, n, wobble(rnd, amp)), true);
const wobblyCircle = (cx: number, cy: number, r: number, rnd: () => number, amp: number, n = 40): string =>
  ser(wobblySegs(cx, cy, r, rnd, amp, n));
/** Hand-painted annulus: two wobbly subpaths (fill-rule="evenodd"). */
const ringPath = (cx: number, cy: number, r1: number, r2: number, rnd: () => number, amp: number, n = 48): string =>
  ser([...wobblySegs(cx, cy, r2, rnd, amp, n), ...wobblySegs(cx, cy, r1, rnd, amp, n)]);
/** Jagged (broken-shell) circle whose jag repeats every 180° (n even). */
function jaggedSym(cx: number, cy: number, r: number, rnd: () => number, amp: number, n: number): Pt[] {
  const j: number[] = [];
  for (let i = 0; i < n / 2; i++) j.push((rnd() - 0.5) * 2 * amp * (i % 2 ? 0.55 : 1));
  return Array.from({ length: n }, (_, i) => polar(cx, cy, r + j[i % (n / 2)], (i * 360) / n));
}

/** Many small (optionally rotated) ellipses as one path, via arcs. */
function dotsPath(dots: { c: Pt; rx: number; ry?: number; rot?: number }[]): string {
  let out = '';
  let cur: Pt = [0, 0];
  for (const d of dots) {
    const ry = d.ry ?? d.rx, rot = d.rot ?? 0;
    const e = rotPt([d.rx, 0], rot);
    const s: Pt = [q1(d.c[0] - e[0]), q1(d.c[1] - e[1])];
    const arc = `${fx(d.rx)} ${fx(ry)} ${Math.round(rot)} 1 0`;
    out += (out ? 'm' + nums([s[0] - cur[0], s[1] - cur[1]]) : 'M' + nums(s)) +
      `a${arc} ${nums([2 * e[0], 2 * e[1]])}a${arc} ${nums([-2 * e[0], -2 * e[1]])}z`;
    cur = s;
  }
  return out;
}
const circles = (pts: Pt[], r: number | ((i: number) => number)): string =>
  dotsPath(pts.map((c, i) => ({ c, rx: typeof r === 'number' ? r : r(i) })));
/**
 * `n` equal dots on a circle round the card centre, as one dashed stroke with
 * round caps. `phase` is the polar angle of the first dot (0 = up). n even ⇒ point-symmetric.
 */
const dotRing = (r: number, n: number, dotR: number, fill: string, phase = 0, extra = ''): string =>
  `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${fill}" stroke-width="${fx(dotR * 2)}" stroke-linecap="round" stroke-dasharray="0 ${((2 * Math.PI * r) / n).toFixed(3)}"` +
  `${phase - 90 ? ` transform="rotate(${fx(phase - 90)} ${CX} ${CY})"` : ''}${extra}/>`;

const useRot = (href: string, a: number, extra = ''): string =>
  `<use href="#${href}"${a ? ` transform="rotate(${fx(a)} ${CX} ${CY})"` : ''}${extra}/>`;
/** Draw `body` and its exact 180° twin about the card centre. */
const twin = (gid: string, body: string, attrs = ''): string =>
  `<g id="${gid}"${attrs}>${body}</g>${useRot(gid, 180)}`;

// ---------------------------------------------------------------------------
// Wordmarks bent onto arcs (outline points are warped; straight runs subdivided)
// ---------------------------------------------------------------------------

function warpSegs(d: string, f: (x: number, y: number) => Pt, maxSeg: number): Seg[] {
  const toks = d.match(/[MLQCZ]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: Seg[] = [];
  let i = 0;
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  const num = (): number => parseFloat(toks[i++]);
  const line = (to: Pt): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - cur[0], to[1] - cur[1]) / maxSeg));
    for (let s = 1; s <= n; s++) out.push(['L', f(cur[0] + ((to[0] - cur[0]) * s) / n, cur[1] + ((to[1] - cur[1]) * s) / n)]);
    cur = to;
  };
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'M') { cur = [num(), num()]; start = cur; out.push(['M', f(...cur)]); }
    else if (c === 'L') line([num(), num()]);
    else if (c === 'Q') { const a: Pt = [num(), num()]; const b: Pt = [num(), num()]; out.push(['Q', f(...a), f(...b)]); cur = b; }
    else if (c === 'C') { const a: Pt = [num(), num()]; const b: Pt = [num(), num()]; const e: Pt = [num(), num()]; out.push(['C', f(...a), f(...b), f(...e)]); cur = e; }
    else if (c === 'Z') { if (Math.hypot(start[0] - cur[0], start[1] - cur[1]) > maxSeg) line(start); out.push(['Z']); cur = start; }
  }
  return out;
}

/**
 * A wordmark set on a circle round the card centre, centred on polar angle
 * `at` (0 = top), reading clockwise with letters pointing outward.
 */
function arcText(id: WordmarkId, o: { cap: number; tracking?: number; R: number; at?: number }): string {
  const wm = WORDMARKS[id];
  const s = o.cap / 100;
  const tr = o.tracking ?? 0;
  const width = wm.width * s + tr * (wm.slots[wm.slots.length - 1] - wm.slots[0]);
  const at = rad(o.at ?? 0);
  const segs: Seg[] = [];
  wm.parts.forEach((part, i) => {
    const dx = (wm.slots[i] - wm.slots[0]) * tr;
    segs.push(...warpSegs(part, (x, y) => {
      const X = x * s + dx - width / 2, Y = y * s, a = X / o.R + at;
      const r = o.R - Y;
      return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
    }, 20 / s));
  });
  return ser(segs);
}

// ---------------------------------------------------------------------------
// Owner-specific choices (palette usage only — palette.ts stays untouched)
// ---------------------------------------------------------------------------

/** Seat number 1–6 in COLORS order (red 1 … orange 6): the corner pip count. */
const seat = (color: ColorId): number => COLORS.indexOf(color) + 1;

interface Owner {
  pal: PlayerShades;
  /** Puri-back sunburst ray colour. */
  ray: string;
  /** Puri-back wash: dark and light blot strength. */
  washDark: number;
  washLight: number;
  /** Short petals between the flame petals, and the dot ring outside them. */
  petalAccent: string;
  /** Pale tongue inside each flame petal. */
  tongue: string;
  /** Medallion disc behind the puri (centre, rim). */
  disc: [string, string];
  /** Power back: lattice band fill, cell diamond fill. */
  band: string;
  cell: string;
  /** Power back: masala-dabba tin (centre, rim), and the bright owner rim round it. */
  tin: [string, string];
  tinRim: string;
  /** Power back: legend colour on parchment. */
  legend: string;
}

function owner(color: ColorId): Owner {
  const pal = PLAYER_PALETTE[color];
  const lightOwner = pal.onBase === INK; // yellow, orange
  const petalAccent = color === 'yellow' ? CHILI : GOLD;
  // Red and orange are neighbours on the wheel: push red toward crimson shadow and cool
  // pink light, orange toward glowing gold, so the pair separates at a glance.
  const ray =
    color === 'orange' ? mixOklab(pal.light, GOLD, 0.45) :
    color === 'yellow' ? mixOklab(pal.light, CREAM_BRIGHT, 0.35) :
    color === 'red' ? mixOklab(pal.light, '#F2B8B0', 0.35) : pal.light;
  const washDark = color === 'red' ? 0.46 : color === 'orange' ? 0.26 : color === 'yellow' ? 0.28 : 0.36;
  const washLight = color === 'orange' ? 0.26 : color === 'red' ? 0.12 : color === 'yellow' ? 0.2 : 0.16;
  const disc: [string, string] =
    color === 'yellow' ? [mixOklab(pal.deep, '#7A3414', 0.3), mixOklab(pal.darker, '#5A2410', 0.35)] :
    color === 'orange' ? [mixOklab(pal.deep, '#6E2A10', 0.2), pal.darker] :
    color === 'red' ? [mixOklab(pal.deep, '#5A0E12', 0.2), mixOklab(pal.darker, '#3A0A10', 0.25)] : [pal.deep, pal.darker];
  const tin: [string, string] = lightOwner ? [pal.base, pal.deep] : [pal.deep, pal.darker];
  const tinRim = lightOwner ? pal.darker : pal.base;
  const band = color === 'red' ? mixOklab(pal.base, '#9E2A2A', 0.3) : color === 'yellow' ? mixOklab(pal.base, '#B07A10', 0.25) : pal.base;
  const cell = color === 'orange' ? mixOklab(pal.light, GOLD, 0.35) : pal.light;
  const legend = color === 'yellow' ? pal.darker : pal.deep;
  return { pal, ray, washDark, washLight, petalAccent, tongue: mixOklab(pal.light, GOLD, 0.3), disc, band, cell, tin, tinRim, legend };
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const frameSvg = (color = CREAM): string =>
  `<rect x="${FRAME.outer.x}" y="${FRAME.outer.y}" width="${FRAME.outer.w}" height="${FRAME.outer.h}" rx="${FRAME.outer.r}" fill="none" stroke="${color}" stroke-width="${FRAME.outer.stroke}"/>` +
  `<rect x="${FRAME.inner.x}" y="${FRAME.inner.y}" width="${FRAME.inner.w}" height="${FRAME.inner.h}" rx="${FRAME.inner.r}" fill="none" stroke="${color}" stroke-width="${FRAME.inner.stroke}"/>`;

const FULL = `filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB"`;
const BBOX = `x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB"`;

/** Filters shared by both backs; `id(x)` namespaces them per kind + colour. */
function filterDefs(id: (s: string) => string, seed: number): string {
  return (
    // paper tooth: faint dark and light 1–2 px specks from one noise field
    `<filter id="${id('grain')}" ${FULL}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 .16 0 0 0 0 .09 0 0 0 0 .05 2 0 0 0 -1.04" result="d"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 .97 0 0 0 0 .9 -2 0 0 0 .92" result="l"/>` +
    `<feMerge><feMergeNode in="d"/><feMergeNode in="l"/></feMerge></filter>` +
    // hand-drawn edge wobble, sized to the element
    `<filter id="${id('rough')}" ${BBOX}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${seed + 3}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    // the same with a card-sized region, for groups whose bbox overflows the card (resvg needs this)
    `<filter id="${id('roughC')}" ${FULL}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${seed + 3}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<filter id="${id('rough2')}" ${FULL}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="1" seed="${seed + 5}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<filter id="${id('blur')}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>` +
    `<filter id="${id('soft')}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>`
  );
}

/**
 * Gouache pigment pooling, point-symmetric and identical in every renderer:
 * seeded soft brush dabs (light and dark, three sizes) laid in the top half,
 * repeated turned 180°, blurred into a cloudy wash; plus pigment granulation
 * (small dark specks) the same way. Returns defs + body.
 */
function washSvg(gid: string, seed: number, light: string, dark: string, sLight: number, sDark: number, gran = 0.22, blur = 16): { defs: string; body: string } {
  const rnd = prng(seed);
  const sizes = [{ w: 150, n: 7, len: 120, o: 1 }, { w: 88, n: 15, len: 80, o: 0.85 }, { w: 46, n: 30, len: 50, o: 0.7 }, { w: 22, n: 46, len: 26, o: 0.6 }];
  let dabs = '';
  for (const [col, str] of [[light, sLight], [dark, sDark]] as const) {
    if (!str) continue;
    for (const z of sizes) {
      let d = '';
      for (let i = 0; i < z.n; i++) {
        const x = rnd() * (W + 80) - 40, y = rnd() * (CY + 90) - 50, a = rnd() * 180, l = z.len * (0.3 + rnd() * 0.7);
        const e = rotPt([l / 2, 0], a);
        d += `M${nums([x - e[0], y - e[1]])}l${nums([2 * e[0], 2 * e[1]])}`;
      }
      dabs += `<path d="${d}" stroke="${col}" stroke-width="${z.w}" stroke-linecap="round" opacity="${k3(str * z.o)}"/>`;
    }
  }
  let specks = '';
  if (gran) {
    const pts: { c: Pt; rx: number; ry: number; rot: number }[] = [];
    for (let i = 0; i < 150; i++) pts.push({ c: [rnd() * W, rnd() * CY], rx: 1.4 + rnd() * 3.2, ry: 1 + rnd() * 1.8, rot: rnd() * 180 });
    specks = `<path d="${dotsPath(pts)}" fill="${dark}" opacity="${k3(gran)}"/>`;
  }
  return {
    defs:
      `<filter id="${gid}-b" filterUnits="userSpaceOnUse" x="-150" y="-150" width="${W + 300}" height="${H + 300}"><feGaussianBlur stdDeviation="${blur}"/></filter>` +
      `<filter id="${gid}-g" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feGaussianBlur stdDeviation="1.1"/></filter>`,
    body:
      `<g filter="url(#${gid}-b)">${twin(`${gid}-h`, dabs)}</g>` +
      (specks ? `<g filter="url(#${gid}-g)">${twin(`${gid}-s`, specks)}</g>` : ''),
  };
}

// ---------------------------------------------------------------------------
// Corner spray with the owner's pips
// ---------------------------------------------------------------------------

/** Die-face pip positions (unit spacing), 2 and 3 on the anti-diagonal so the corner mirrors agree. */
const PIPS: Record<number, Pt[]> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-0.9, -1.15], [0.9, -1.15], [-0.9, 0], [0.9, 0], [-0.9, 1.15], [0.9, 1.15]],
};

interface SprayColors { arm: string; armOpacity: number; bud: string; budVein: string; budSide: string; leaf: string; leafVein: string; dot: string; boss: string; bossRing: string; bossRing2: string; pip: string }

/** Centre of the corner boss in the spray's local frame. */
const BOSS: Pt = [30, 30];
const BOSS_R = 25;

/**
 * Corner spray in local coords (corner at 0,0, growing into +x/+y), mirror-
 * symmetric about the diagonal like the fronts' corner sprays: a round boss in
 * the corner carrying the owner's pips, two acanthus arms sweeping along the
 * edges and curling back, a chili-red flame bud pointing inward between two
 * slim leaves, trailing dots.
 */
function cornerSpray(c: SprayColors, pips: number, seed: number): string {
  const rnd = prng(seed);
  const sw = ([x, y]: Pt): Pt => [y, x];
  const arms: Seg[] = [];
  const side: Seg[] = [];
  const leaves: Seg[] = [];
  const veins: Seg[] = [];
  const dots: Pt[] = [];
  const dotR: number[] = [];
  for (const mirror of [false, true]) {
    const m = (pts: Pt[]): Pt[] => (mirror ? pts.map(sw) : pts);
    // main arm along the edge, curling back at its end
    arms.push(...brushSegs(m([[44, 22], [62, 12], [86, 7], [114, 7], [140, 12], [158, 25], [158, 39], [147, 43], [140, 36], [145, 29]]),
      (t) => 6.4 * Math.pow(1 - t, 0.85) + 0.7 + 1.6 * Math.sin(Math.PI * Math.min(1, t * 2.5)), rnd, 21, 0.08));
    // secondary leaflet dropping off the arm, curling inward
    arms.push(...brushSegs(m([[84, 9], [98, 19], [104, 34], [98, 46], [88, 47], [86, 40]]), (t) => 4.6 * Math.pow(1 - t, 0.8) + 0.5, rnd, 16, 0.08));
    // small flick toward the edge
    arms.push(...brushSegs(m([[118, 8], [128, 2], [140, 0]]), leafW(2.6), rnd, 8));
    // side petal of the bud
    side.push(...brushSegs(m([[58, 62], [72, 60], [86, 64], [96, 72]]), leafW(5, 0.7), rnd, 12));
    // slim leaf at the base
    leaves.push(...brushSegs(m([[54, 42], [72, 48], [92, 60], [106, 78]]), leafW(6.4), rnd, 14));
    veins.push(...crSegs(m([[58, 44], [76, 51], [96, 66]]), false));
    for (const [x, y, r] of [[176, 20, 3.3], [188, 20, 2.4], [198, 21, 1.6]] as const) { dots.push(m([[x, y]])[0]); dotR.push(r); }
  }
  // flame bud: from the boss, tip pointing into the card
  const bud = brushSegs([[50, 50], [66, 66], [84, 84], [104, 104]], (t) => 9 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.62) * (1 - 0.35 * t), rnd, 16, 0.06);
  const s = 9.6, pr = 4.1;
  const pipPts = PIPS[pips].map(([x, y]) => [BOSS[0] + x * s, BOSS[1] + y * s] as Pt);
  return (
    `<path d="${ser(arms)}" fill="${c.arm}" opacity="${c.armOpacity}"/>` +
    `<path d="${circles(dots, (i) => dotR[i])}" fill="${c.dot}" opacity="${c.armOpacity}"/>` +
    `<path d="${ser(side)}" fill="${c.budSide}"/>` +
    `<path d="${ser(leaves)}" fill="${c.leaf}"/>` +
    `<path d="${ser(veins)}" fill="none" stroke="${c.leafVein}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>` +
    `<path d="${ser(bud)}" fill="${c.bud}"/>` +
    `<path d="${crPath([[56, 56], [72, 72], [90, 90]], false)}" fill="none" stroke="${c.budVein}" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>` +
    // boss: gold ring, owner ring, cream (or owner) face, pips
    `<circle cx="${BOSS[0]}" cy="${BOSS[1]}" r="${BOSS_R + 3}" fill="${c.bossRing2}"/>` +
    `<circle cx="${BOSS[0]}" cy="${BOSS[1]}" r="${BOSS_R}" fill="${c.boss}" stroke="${c.bossRing}" stroke-width="2.6"/>` +
    `<path d="${circles(pipPts, pr)}" fill="${c.pip}"/>`
  );
}

/** The spray in all four corners (placements are 180°-rotationally symmetric). */
function corners(defId: string, inset: number): string {
  const a = inset, b = W - inset, c = H - inset;
  return (
    `<use href="#${defId}" transform="translate(${a} ${a})"/>` +
    `<use href="#${defId}" transform="translate(${b} ${a}) scale(-1 1)"/>` +
    `<use href="#${defId}" transform="translate(${a} ${c}) scale(1 -1)"/>` +
    `<use href="#${defId}" transform="translate(${b} ${c}) scale(-1 -1)"/>`
  );
}

// ---------------------------------------------------------------------------
// The puri + akabare emblem, seen from above (point-symmetric)
// ---------------------------------------------------------------------------

const PURI_R = 108;
const HOLE_R = 52;
const CHILI_R = 38;

function puriDefs(id: (s: string) => string, seed: number): string {
  return (
    // a fried sphere seen from above, lit from the viewer: bright crown, falling off to a deep rim
    `<radialGradient id="${id('puriG')}" cx=".5" cy=".5" r=".5">` +
    `<stop offset=".3" stop-color="#FFE2A0"/><stop offset=".55" stop-color="#F7C665"/><stop offset=".74" stop-color="#E9A246"/><stop offset=".9" stop-color="#C8742A"/><stop offset="1" stop-color="#8A4014"/></radialGradient>` +
    `<radialGradient id="${id('holeG')}" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#170903"/><stop offset=".88" stop-color="#3A1B0A"/><stop offset="1" stop-color="#70401A"/></radialGradient>` +
    `<radialGradient id="${id('chiliG')}" cx=".5" cy=".5" r=".5">` +
    `<stop offset=".2" stop-color="#F0582C"/><stop offset=".55" stop-color="#DB3B1C"/><stop offset=".82" stop-color="${CHILI}"/><stop offset="1" stop-color="#6A1005"/></radialGradient>` +
    // the pepper's sunken shoulder round the calyx
    `<radialGradient id="${id('dimple')}" cx=".5" cy=".5" r=".5"><stop offset=".45" stop-color="#4A0803" stop-opacity=".6"/><stop offset=".75" stop-color="#6A1005" stop-opacity=".28"/><stop offset="1" stop-color="#6A1005" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id('calyxG')}" cx=".5" cy=".5" r=".5"><stop offset=".3" stop-color="#7FA844"/><stop offset="1" stop-color="#3F6424"/></radialGradient>` +
    // lit crust relief, light straight from the viewer (no direction a turned card could betray)
    `<filter id="${id('crust')}" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="2" seed="${seed}" result="n"/>` +
    `<feDiffuseLighting in="n" surfaceScale="3.4" diffuseConstant="1.1" lighting-color="#FFF3DA" result="lit"><feDistantLight azimuth="0" elevation="90"/></feDiffuseLighting>` +
    `<feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1=".78" k2="0" k3=".36" k4="0" result="m"/>` +
    `<feComposite in="m" in2="SourceGraphic" operator="in"/></filter>`
  );
}

function puriEmblem(id: (s: string) => string, seed: number): string {
  const rnd = prng(seed);
  const bodyD = wobblyCircle(CX, CY, PURI_R, rnd, 1.8, 36);
  const rimD = crPath(jaggedSym(CX, CY, HOLE_R + 8, rnd, 3.6, 30), true, 0.12);
  const holeD = crPath(jaggedSym(CX, CY, HOLE_R, rnd, 3.2, 30), true, 0.12);

  // blisters (each with its 180° twin): puffy fried bubbles, foreshortened toward the rim,
  // lit on top with a shadow on the outward side
  const hi: { c: Pt; rx: number; ry: number; rot: number }[] = [];
  const lo: { c: Pt; rx: number; ry: number; rot: number }[] = [];
  const brown: { c: Pt; rx: number; ry: number; rot: number }[] = [];
  for (let n = 0, tries = 0; n < 58 && tries < 2000; tries++) {
    const r = HOLE_R + 12 + rnd() * (PURI_R * 0.95 - HOLE_R - 12), a = rnd() * 180;
    const u = r / PURI_R, nz = Math.sqrt(Math.max(0.06, 1 - u * u));
    const size = (2.6 + rnd() * 4.4) * (0.65 + 0.35 * nz);
    for (const aa of [a, a + 180]) {
      hi.push({ c: polar(CX, CY, r - size * 0.12, aa), rx: size * (0.45 + 0.55 * nz), ry: size, rot: aa });
      lo.push({ c: polar(CX, CY, r + size * (0.45 + 0.4 * nz), aa), rx: size * 0.3 * nz + 0.7, ry: size * 0.82, rot: aa });
    }
    n++;
  }
  for (let i = 0; i < 22; i++) {
    const r = HOLE_R + 14 + rnd() * (PURI_R - HOLE_R - 18), a = rnd() * 180, rr = 1.6 + rnd() * 3.2;
    const e = { rx: rr, ry: rr * (0.5 + rnd() * 0.4), rot: rnd() * 180 };
    brown.push({ c: polar(CX, CY, r, a), ...e }, { c: polar(CX, CY, r, a + 180), ...e });
  }
  // hairline cracks running out from the broken top
  const cracks: Seg[] = [];
  for (const a0 of [16, 58, 101, 142]) {
    const pts: Pt[] = [];
    const len = 16 + rnd() * 16;
    for (let k = 0; k <= 3; k++) pts.push(polar(CX, CY, HOLE_R + 7 + (len * k) / 3, a0 + (k ? (rnd() - 0.5) * 8 : 0)));
    cracks.push(...crSegs(pts, false), ...crSegs(pts.map(turn), false));
  }
  // bits of filling glinting in the gap round the chili (potato, chickpea, pani-green)
  const bits: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = 8 + i * 30 + (rnd() - 0.5) * 10, r = (CHILI_R + HOLE_R) / 2 + 2;
    const col = ['#E6B24C', '#7E9A36', '#D9A65A'][i % 3];
    const e = { c: polar(CX, CY, r, a), rx: 3 + rnd() * 1.6, ry: 2 + rnd() * 1.2, rot: a + 90 };
    bits.push(`<path d="${dotsPath([e, { ...e, c: turn(e.c) }])}" fill="${col}"/>`);
  }
  // coriander sprigs tucked into the gap (a twin pair)
  const cori: Seg[] = [];
  const coriVein: Seg[] = [];
  for (const aa of [58, 238]) {
    const base = polar(CX, CY, CHILI_R - 4, aa);
    for (const [da, l, w] of [[-30, 20, 6.4], [0, 24, 7.4], [30, 19, 6]] as const) {
      const tip = polar(base[0], base[1], l, aa + da);
      const mid = polar(base[0], base[1], l * 0.55, aa + da - 5);
      cori.push(...brushSegs([base, mid, tip], leafW(w * 0.8), prng(31), 10, 0.04));
      coriVein.push(...crSegs([base, polar(base[0], base[1], l * 0.8, aa + da)], false));
    }
  }

  // akabare: a glossy four-lobed round pepper, sunken shoulder, cup calyx with a thick stem stub
  const chiliD = crPath(circlePts(CX, CY, CHILI_R, 40, (a) => 3.4 * Math.cos(rad(a) * 4)), true);
  const creases: Seg[] = [];
  for (const a of [45, 135, 225, 315]) creases.push(...crSegs([polar(CX, CY, 17, a), polar(CX, CY, 26, a + 2), polar(CX, CY, 35.5, a)], false));
  const gloss: Seg[] = [];
  for (const a of [0, 90, 180, 270]) gloss.push(...brushSegs([polar(CX, CY, 22, a - 26), polar(CX, CY, 26.5, a - 6), polar(CX, CY, 27.5, a + 14)], leafW(3, 0.7), prng(7), 10, 0.02));
  const glint = dotsPath([-38, 142].map((a) => ({ c: polar(CX, CY, 24, a), rx: 3.4, ry: 2.2, rot: a + 90 })));
  const calyxD = crPath(circlePts(CX, CY, 12.5, 36, (a) => 2.6 * Math.cos(rad(a) * 6)), true);

  return (
    // soft drop shadow straight under (light from the viewer)
    `<circle cx="${CX}" cy="${CY}" r="${PURI_R + 8}" fill="#120703" opacity=".5" filter="url(#${id('blur')})"/>` +
    `<defs><path id="${id('body')}" d="${bodyD}"/></defs>` +
    `<use href="#${id('body')}" fill="url(#${id('puriG')})" filter="url(#${id('crust')})"/>` +
    `<path d="${dotsPath(brown)}" fill="#A2561C" opacity=".32"/>` +
    `<path d="${dotsPath(lo)}" fill="#7A3A10" opacity=".45"/>` +
    `<path d="${dotsPath(hi)}" fill="#FFEAB0" opacity=".8"/>` +
    `<path d="${ser(cracks)}" fill="none" stroke="#7A3A10" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>` +
    // the broken shell: pale cut edge, dark hollow
    `<path d="${rimD}" fill="#FBE2A2" filter="url(#${id('crust')})"/>` +
    `<path d="${rimD}" fill="none" stroke="#B0621E" stroke-width="1.3" opacity=".7"/>` +
    `<path d="${holeD}" fill="url(#${id('holeG')})" stroke="${INK}" stroke-width="1.9"/>` +
    bits.join('') +
    `<path d="${ser(cori)}" fill="${LEAF}" stroke="#2E4A1C" stroke-width="1"/>` +
    `<path d="${ser(coriVein)}" fill="none" stroke="#A6C27A" stroke-width=".9" opacity=".7"/>` +
    `<circle cx="${CX}" cy="${CY}" r="${CHILI_R + 3}" fill="#0E0502" opacity=".65" filter="url(#${id('soft')})"/>` +
    // the chili
    `<path d="${chiliD}" fill="url(#${id('chiliG')})" stroke="${INK}" stroke-width="2.4"/>` +
    `<path d="${ser(creases)}" fill="none" stroke="#6E1206" stroke-width="2.6" stroke-linecap="round" opacity=".42"/>` +
    `<circle cx="${CX}" cy="${CY}" r="21" fill="url(#${id('dimple')})"/>` +
    `<path d="${ser(gloss)}" fill="#FFF1E2" opacity=".6"/>` +
    `<path d="${glint}" fill="#FFFAF2" opacity=".95"/>` +
    `<path d="${calyxD}" fill="url(#${id('calyxG')})" stroke="#23390F" stroke-width="1.4"/>` +
    `<circle cx="${CX}" cy="${CY}" r="6" fill="#5D8A31" stroke="#23390F" stroke-width="1.3"/>` +
    `<circle cx="${CX}" cy="${CY}" r="3.2" fill="#A9CB6E"/>` +
    `<use href="#${id('body')}" fill="none" stroke="${INK}" stroke-width="2.8"/>`
  );
}

// ---------------------------------------------------------------------------
// Puri back
// ---------------------------------------------------------------------------

export function puriBackSvg(color: ColorId): string {
  const o = owner(color);
  const pal = o.pal;
  const id = (s: string): string => `ap-pu-${color}-${s}`;
  const rnd = prng(1234);
  const inner = FRAME.inner;

  // medallion geometry
  const bandIn = 144, bandOut = 190, wreathR = (bandIn + bandOut) / 2;
  const petalTip = bandOut + 48;

  // sunburst — three ray variants; the pattern repeats every 16 rays (180°)
  const N = 32;
  const rayDefs: string[] = [];
  for (let v = 0; v < 3; v++) {
    const r0 = petalTip - 6, r1 = 660, half = ((Math.PI * r1) / N) * (0.36 + v * 0.05), bend = (rnd() - 0.5) * 2.4;
    rayDefs.push(`<path id="${id('ray' + v)}" d="${brush([polar(CX, CY, r0, 0), polar(CX, CY, (r0 + r1) / 2, bend * 0.5), polar(CX, CY, r1, bend)], (t) => 1.5 + half * Math.pow(t, 0.95), rnd, 7, 0.1)}"/>`);
  }
  const rays: string[] = [];
  for (let i = 0; i < N; i++) { const j = i % 16; rays.push(useRot(id('ray' + (j % 3)), (i * 360) / N, ` opacity="${fx(0.11 + ((j * 7) % 5) * 0.024)}"`)); }

  // lotus ring: long owner-dark flame petals with a pale tongue, short accent petals between (period 10 = 180°)
  const NP = 20;
  const petalDefs: string[] = [];
  for (let v = 0; v < 3; v++) {
    const b = (v - 1) * 1.8 + (rnd() - 0.5) * 0.8;
    const spine = (r0: number, r1: number, k: number): Pt[] =>
      [polar(CX, CY, r0, 0), polar(CX, CY, r0 + (r1 - r0) * 0.4, b * 0.55 * k), polar(CX, CY, r0 + (r1 - r0) * 0.75, b * 0.2 * k), polar(CX, CY, r1, b * 1.1 * k)];
    petalDefs.push(
      `<g id="${id('pl' + v)}"><path d="${brush(spine(bandOut - 8, petalTip, 1), flameW(13.5), rnd, 14, 0.06)}" fill="${o.disc[1]}"/>` +
      `<path d="${brush(spine(bandOut + 6, petalTip - 12, 0.9), flameW(3.8), rnd, 10, 0.05)}" fill="${o.tongue}"/></g>` +
      `<path id="${id('ps' + v)}" d="${brush(spine(bandOut - 6, bandOut + 31, 0.7), flameW(8.2), rnd, 10, 0.06)}"/>`,
    );
  }
  const petalsLong: string[] = [], petalsShort: string[] = [];
  for (let i = 0; i < NP; i++) {
    const j = i % 10;
    petalsLong.push(useRot(id('pl' + (j % 3)), (i * 360) / NP));
    petalsShort.push(useRot(id('ps' + ((j * 2) % 3)), ((i + 0.5) * 360) / NP));
  }

  // vine wreath on the cream band: leaf pair + berry, stamped every 18°
  const leafPair = (() => {
    const segs: Seg[] = [];
    for (const side of [-1, 1]) {
      const base = polar(CX, CY, wreathR, 2), mid = polar(CX, CY, wreathR + side * 9, 7), tip = polar(CX, CY, wreathR + side * 15.5, 12);
      segs.push(...brushSegs([base, mid, tip], leafW(5.8, 0.7), rnd, 10));
    }
    const vein: Seg[] = [];
    for (const side of [-1, 1]) vein.push(...crSegs([polar(CX, CY, wreathR + side * 2, 3.8), polar(CX, CY, wreathR + side * 8.5, 7.4), polar(CX, CY, wreathR + side * 13, 10.6)], false));
    const berry = polar(CX, CY, wreathR, -5.4);
    return `<g id="${id('lp')}"><path d="${ser(segs)}" fill="${LEAF}"/><path d="${ser(vein)}" fill="none" stroke="#9DBB6A" stroke-width="1" opacity=".7"/>` +
      `<circle cx="${fx(berry[0])}" cy="${fx(berry[1])}" r="5" fill="${CHILI}"/><circle cx="${fx(berry[0])}" cy="${fx(berry[1])}" r="1.6" fill="#FFE9D6" opacity=".8"/></g>`;
  })();
  const wreath: string[] = [];
  for (let i = 0; i < 20; i++) wreath.push(useRot(id('lp'), i * 18));

  // wordmarks: Latin arched over the medallion, Devanagari at the top edge; both twinned
  const arc = arcText(BACK_COPY.puri.title as WordmarkId, { cap: 29, tracking: 3, R: 278 });
  const deva = wordmarkSvg(BACK_COPY.puri.devanagari as WordmarkId, { x: CX, y: 152, height: 30, tracking: 16, anchor: 'middle' });
  const devaShadow = wordmarkSvg(BACK_COPY.puri.devanagari as WordmarkId, { x: CX + 1.5, y: 155, height: 30, tracking: 16, anchor: 'middle' });
  // little leaf-and-dot flourishes either side of the Devanagari
  const flick: Seg[] = [];
  const flickDots: Pt[] = [];
  for (const sx of [-1, 1]) {
    const m = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [CX + sx * x, y] as Pt);
    flick.push(...brushSegs(m([[176, 140], [196, 136], [214, 140], [226, 148]]), leafW(3.2, 0.8), rnd, 10));
    flick.push(...brushSegs(m([[180, 146], [198, 150], [210, 158]]), leafW(2.4, 0.8), rnd, 8));
    flickDots.push(...m([[238, 150], [248, 150]]));
  }

  const spray = cornerSpray({
    arm: CREAM, armOpacity: 0.92, bud: CHILI, budVein: '#8A1A08', budSide: '#E0662E', leaf: LEAF, leafVein: '#A6C27A', dot: CREAM,
    boss: CREAM_BRIGHT, bossRing: o.disc[1], bossRing2: GOLD, pip: o.disc[1],
  }, seat(color), 77);
  const wash = washSvg(id('wash'), 41, pal.light, pal.darker, o.washLight, o.washDark, color === 'yellow' ? 0.14 : 0.2);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    filterDefs(id, 21) +
    wash.defs +
    puriDefs(id, 9) +
    `<radialGradient id="${id('vig')}" cx=".5" cy=".5" r=".62"><stop offset=".5" stop-color="${pal.darker}" stop-opacity="0"/><stop offset="1" stop-color="${pal.darker}" stop-opacity=".5"/></radialGradient>` +
    `<radialGradient id="${id('glow')}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${o.ray}" stop-opacity=".36"/><stop offset=".42" stop-color="${o.ray}" stop-opacity=".12"/><stop offset="1" stop-color="${o.ray}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id('disc')}" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="${o.disc[0]}"/><stop offset="1" stop-color="${o.disc[1]}"/></radialGradient>` +
    `<radialGradient id="${id('halo')}" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="${GOLD}" stop-opacity=".5"/><stop offset=".8" stop-color="${GOLD}" stop-opacity=".16"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id('in')}"><rect x="${inner.x + 2}" y="${inner.y + 2}" width="${inner.w - 4}" height="${inner.h - 4}" rx="${inner.r - 2}"/></clipPath>` +
    rayDefs.join('') + petalDefs.join('') + leafPair +
    `<g id="${id('spray')}" filter="url(#${id('rough')})">${spray}</g>` +
    `</defs>` +
    // field
    `<rect width="${W}" height="${H}" fill="${pal.base}"/>` +
    wash.body +
    `<rect width="${W}" height="${H}" fill="url(#${id('vig')})"/>` +
    // sunburst
    `<g clip-path="url(#${id('in')})">` +
    `<circle cx="${CX}" cy="${CY}" r="480" fill="url(#${id('glow')})"/>` +
    `<g fill="${o.ray}" filter="url(#${id('roughC')})">${rays.join('')}</g>` +
    `</g>` +
    // medallion
    `<circle cx="${CX}" cy="${CY}" r="${petalTip + 4}" fill="${pal.darker}" opacity=".45" filter="url(#${id('blur')})"/>` +
    `<g filter="url(#${id('rough2')})">` +
    `<g fill="${o.petalAccent}">${petalsShort.join('')}</g>` +
    petalsLong.join('') +
    dotRing(petalTip + 8, NP, 3.3, o.petalAccent) +
    dotRing(bandOut + 1, 40, 8.8, CREAM) +
    `<path d="${ringPath(CX, CY, bandIn, bandOut, rnd, 1.5, 36)}" fill="${CREAM}" fill-rule="evenodd"/>` +
    `<path d="${wobblyCircle(CX, CY, bandIn + 1, rnd, 1.2, 30)}" fill="url(#${id('disc')})"/>` +
    `<circle cx="${CX}" cy="${CY}" r="${bandIn - 6}" fill="url(#${id('halo')})"/>` +
    dotRing(bandIn - 11, 44, 1.9, CREAM, 4.1, ' opacity=".6"') +
    `<path d="${ringPath(CX, CY, bandIn - 1.6, bandIn + 1.6, rnd, 1.1, 28)}" fill="${o.disc[1]}" fill-rule="evenodd" opacity=".85"/>` +
    `<path d="${ringPath(CX, CY, bandOut - 1.3, bandOut + 1.3, rnd, 1.1, 28)}" fill="${o.disc[1]}" fill-rule="evenodd" opacity=".5"/>` +
    `<path d="${wobblyCircle(CX, CY, wreathR, rnd, 1.2, 30)}" fill="none" stroke="#3E6127" stroke-width="2"/>` +
    wreath.join('') +
    `</g>` +
    puriEmblem(id, 5) +
    // wordmarks
    `<g filter="url(#${id('rough2')})">` +
    twin(id('wm'),
      `<path d="${arc}" fill="${pal.darker}" opacity=".75" transform="translate(1.5 3)"/><path d="${arc}" fill="${CREAM_BRIGHT}"/>` +
      devaShadow.replace('<path ', `<path opacity=".7" `).replace(/fill="[^"]*"/, `fill="${pal.darker}"`) +
      deva.replace(/fill="[^"]*"/, `fill="${CREAM_BRIGHT}"`) +
      `<path d="${ser(flick)}" fill="${CREAM}" opacity=".9"/><path d="${circles(flickDots, (i) => (i % 2 ? 1.8 : 2.8))}" fill="${o.petalAccent}"/>`) +
    `</g>` +
    corners(id('spray'), 40) +
    frameSvg() +
    `<rect width="${W}" height="${H}" filter="url(#${id('grain')})" opacity=".3"/>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Power back
// ---------------------------------------------------------------------------

/**
 * The four powers as katoris (small bowls) seen from above, local coords,
 * centre 0,0, rim radius 36. Lighting is radial (from the viewer).
 */
function katoris(id: (s: string) => string, rnd: () => number): Record<'vinegar' | 'dahi' | 'chaat' | 'khali', string> {
  const inkS = `stroke="${INK}" stroke-width="2"`;
  const wob = (r: number, amp: number, n = 18): string => wobblyCircle(0, 0, r, rnd, amp, n);
  const rim =
    `<circle r="40" fill="#120703" opacity=".4" filter="url(#${id('soft')})"/>` +
    `<path d="${wob(36, 0.6)}" fill="url(#${id('brass')})" ${inkS}/>` +
    `<path d="${ser([...brushSegs([polar(0, 0, 32.5, -80), polar(0, 0, 33.5, -45), polar(0, 0, 32.5, -10)], leafW(1.8, 0.6), rnd, 8), ...brushSegs([polar(0, 0, 32.5, 100), polar(0, 0, 33.5, 135), polar(0, 0, 32.5, 170)], leafW(1.8, 0.6), rnd, 8)])}" fill="#FFF1C4" opacity=".85"/>`;
  const well = (fill: string): string => `<path d="${wob(28.5, 0.5)}" fill="${fill}" stroke="#5A2A0C" stroke-width="1.5"/>`;
  const sheen = (col: string, o = 0.55): string =>
    `<path d="${ser([...brushSegs([polar(0, 0, 18, -70), polar(0, 0, 20, -40), polar(0, 0, 18, -12)], leafW(3.2, 0.7), rnd, 8), ...brushSegs([polar(0, 0, 18, 110), polar(0, 0, 20, 140), polar(0, 0, 18, 168)], leafW(3.2, 0.7), rnd, 8)])}" fill="${col}" opacity="${o}"/>`;

  // vinegar: golden liquid, sheen, mustard seeds, a sprig of dill
  const seeds: Pt[] = [];
  for (let i = 0; i < 7; i++) seeds.push(polar(0, 0, 6 + rnd() * 14, rnd() * 360));
  const vinegar = rim + well('#C8840F') +
    `<path d="${wob(22, 0.6, 14)}" fill="#E6A424"/>` +
    `<path d="${wob(13, 0.5, 12)}" fill="#F2BE48" opacity=".8"/>` + sheen('#FFF3C8', 0.7) +
    `<path d="${circles(seeds, 1.5)}" fill="#5A3212"/>` +
    `<path d="${brush([[-12, 10], [-4, 4], [6, -4]], leafW(2.6), rnd, 8)}${brush([[-4, 4], [-1, -3], [0, -9]], leafW(2), rnd, 8)}" fill="${LEAF}"/>`;
  // dahi: cream mound, swirl, chili-powder specks
  const chiliSpecks: Pt[] = [];
  for (let i = 0; i < 6; i++) chiliSpecks.push(polar(0, 0, 4 + rnd() * 12, rnd() * 360));
  const dahi = rim + well('#EFE3C4') +
    `<path d="${wob(24, 1.2, 14)}" fill="#FBF6EA"/>` +
    `<path d="M0 0c4-1 6 3 3 6c-6 5-14-1-12-8c3-10 18-11 22 0c4 12-8 20-19 16" fill="none" stroke="#D5C39B" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="${circles(chiliSpecks, 1.4)}" fill="${CHILI}"/>`;
  // chaat: tamarind-dark mix, dahi drizzle, sev, coriander, pomegranate
  const sev: Seg[] = [];
  for (let i = 0; i < 10; i++) {
    const c = polar(0, 0, rnd() * 20, rnd() * 360), e = rotPt([4.5, 0], rnd() * 180);
    sev.push(['M', [c[0] - e[0], c[1] - e[1]]], ['L', [c[0] + e[0], c[1] + e[1]]]);
  }
  const pome: Pt[] = [], cor: Pt[] = [];
  for (let i = 0; i < 6; i++) pome.push(polar(0, 0, 5 + rnd() * 16, rnd() * 360));
  for (let i = 0; i < 5; i++) cor.push(polar(0, 0, 4 + rnd() * 17, rnd() * 360));
  const chaat = rim + well('#7A3A18') +
    `<path d="${wob(24, 1.4, 14)}" fill="#A5532A"/>` +
    `<path d="M-18 -4c6-6 10 4 16-2s10 4 16-2" fill="none" stroke="#FBF2DE" stroke-width="3.4" stroke-linecap="round"/>` +
    `<path d="M-14 9c6-5 10 3 15-1s8 3 12-1" fill="none" stroke="#FBF2DE" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="${ser(sev)}" stroke="#F3C046" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="${circles(pome, 2.3)}" fill="#B3182C" stroke="#5A0A14" stroke-width=".8"/>` +
    `<path d="${circles(cor, 2.4)}" fill="${LEAF}"/>`;
  // khali: an empty puri shell in its katori, broken top dark and hollow
  const blis: Pt[] = [];
  for (let i = 0; i < 9; i++) blis.push(polar(0, 0, 13 + rnd() * 9, rnd() * 360));
  const khali = rim + well('#8A4A1A') +
    `<circle r="25" fill="url(#${id('puriS')})" stroke="${INK}" stroke-width="1.6"/>` +
    `<path d="${circles(blis, (i) => 1.5 + (i % 3) * 0.5)}" fill="#FBE3A0" opacity=".85"/>` +
    `<path d="${crPath(jaggedSym(0, 0, 13.5, rnd, 1.6, 14), true, 0.12)}" fill="#F6D690"/>` +
    `<path d="${crPath(jaggedSym(0, 0, 10, rnd, 1.4, 14), true, 0.12)}" fill="#1E0C04" stroke="${INK}" stroke-width="1.3"/>`;
  return { vinegar, dahi, chaat, khali };
}

/**
 * One seamless tile of the woven lattice. Tile corners are crossings where the
 * A band (↘) goes over; the tile centre is a crossing where B (↗) goes over.
 * A 180° turn about any tile corner maps the weave onto itself.
 */
function latticeTile(o: Owner, S: number, bw: number): string {
  const pal = o.pal;
  const d = Math.SQRT1_2;
  const band = (p: Pt, v: Pt, len: number): Seg[] => {
    const n: Pt = [-v[1], v[0]];
    const a: Pt = [p[0] - v[0] * len, p[1] - v[1] * len], b: Pt = [p[0] + v[0] * len, p[1] + v[1] * len];
    return [['M', [a[0] + n[0] * bw, a[1] + n[1] * bw]], ['L', [b[0] + n[0] * bw, b[1] + n[1] * bw]], ['L', [b[0] - n[0] * bw, b[1] - n[1] * bw]], ['L', [a[0] - n[0] * bw, a[1] - n[1] * bw]], ['Z']];
  };
  const A: Pt = [d, d], B: Pt = [d, -d];
  const diag = S * Math.SQRT2;
  const aLines: Pt[] = [[0, 0], [S, 0], [0, S]];
  const bLines: Pt[] = [[0, 0], [S, 0], [S, S]];
  const bandsA: Seg[] = [], bandsB: Seg[] = [], stA: Seg[] = [], stB: Seg[] = [];
  for (const p of aLines) {
    bandsA.push(...band(p, A, diag));
    stA.push(['M', [p[0] - A[0] * diag, p[1] - A[1] * diag]], ['L', [p[0] + A[0] * diag, p[1] + A[1] * diag]]);
  }
  for (const p of bLines) {
    bandsB.push(...band(p, B, diag));
    stB.push(['M', [p[0] - B[0] * diag, p[1] - B[1] * diag]], ['L', [p[0] + B[0] * diag, p[1] + B[1] * diag]]);
  }
  const L = bw + 3;
  const c: Pt = [S / 2, S / 2];
  const patchB = band(c, B, L);
  const dash = diag / 12;
  const dashArr = `${fx(dash * 0.45)} ${fx(dash * 0.55)}`;
  const shade = (p: Pt, over: Pt): Seg[] => {
    const n: Pt = [-over[1], over[0]];
    const out: Seg[] = [];
    for (const s of [-1, 1]) {
      const off = bw + 1;
      out.push(['M', [p[0] + n[0] * off * s - over[0] * bw, p[1] + n[1] * off * s - over[1] * bw]], ['L', [p[0] + n[0] * off * s + over[0] * bw, p[1] + n[1] * off * s + over[1] * bw]]);
    }
    return out;
  };
  const shades: Seg[] = [...shade(c, B)];
  for (const p of [[0, 0], [S, 0], [0, S], [S, S]] as Pt[]) shades.push(...shade(p, A));
  const cellPts: Pt[] = [[S / 2, 0], [0, S / 2], [S, S / 2], [S / 2, S]];
  const cellsD = cellPts.map(([x, y]) => `M${fx(x)} ${fx(y - 10)}l6.5 10-6.5 10-6.5-10z`).join('');
  const offB = (diag - L) % dash;
  return (
    `<path d="${cellsD}" fill="${o.cell}" stroke="${pal.deep}" stroke-width="1.4"/>` +
    `<path d="${circles(cellPts, 2.3)}" fill="${CHILI}"/>` +
    `<path d="${ser(bandsB)}" fill="${o.band}"/>` +
    `<path d="${ser(stB)}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" opacity=".8"/>` +
    `<path d="${ser(bandsA)}" fill="${o.band}"/>` +
    `<path d="${ser(stA)}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" opacity=".8"/>` +
    `<path d="${ser(patchB)}" fill="${o.band}"/>` +
    `<path d="${ser([['M', [c[0] - B[0] * L, c[1] - B[1] * L]], ['L', [c[0] + B[0] * L, c[1] + B[1] * L]]])}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" stroke-dashoffset="${fx(-offB)}" opacity=".8"/>` +
    `<path d="${ser(shades)}" stroke="${pal.darker}" stroke-width="2.4" opacity=".5"/>`
  );
}

export function powerBackSvg(color: ColorId): string {
  const o = owner(color);
  const pal = o.pal;
  const id = (s: string): string => `ap-pw-${color}-${s}`;
  const rnd = prng(4321);
  const panel = { x: 48, y: 48, w: W - 96, h: H - 96, r: 24 };

  // deckled parchment panel: perimeter points in 180°-twin pairs, jittered radially
  const panelD = (() => {
    const { x, y, w, h, r } = panel;
    const pts: Pt[] = [];
    const seg = (a: Pt, b: Pt): void => {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 17));
      for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    };
    const arcP = (c: Pt, a0: number): void => { for (let i = 0; i < 4; i++) pts.push(polar(c[0], c[1], r, a0 + i * 22.5)); };
    seg([x + r, y], [x + w - r, y]); arcP([x + w - r, y + r], 0);
    seg([x + w, y + r], [x + w, y + h - r]); arcP([x + w - r, y + h - r], 90);
    const half = pts.length;
    for (let i = 0; i < half; i++) pts.push(turn(pts[i]));
    const jit: number[] = [];
    for (let i = 0; i < half; i++) jit.push((rnd() - 0.5) * 2.6);
    const edge = pts.map((p, i) => {
      const dx = p[0] - CX, dy = p[1] - CY, l = Math.hypot(dx, dy), j = jit[i % half];
      return [p[0] + (dx / l) * j, p[1] + (dy / l) * j] as Pt;
    });
    return crPath(edge, true, 0.12);
  })();

  // lattice geometry
  const S = 94, bw = 9;
  const HALO = 308;
  const cornerR = 132;
  const cornerCs: Pt[] = [[panel.x, panel.y], [panel.x + panel.w, panel.y], [panel.x, panel.y + panel.h], [panel.x + panel.w, panel.y + panel.h]];

  // lace scallops round the corner cut-outs (13 per corner, placed in twin pairs)
  const laceR: number[] = Array.from({ length: 26 }, () => 8.8 + rnd() * 0.8);
  const lacePts: Pt[] = [];
  const laceRs: number[] = [];
  cornerCs.slice(0, 2).forEach(([x, y], k) => {
    const base = (Math.atan2(CY - y, CX - x) * 180) / Math.PI;
    for (let i = 0; i < 13; i++) {
      const a = rad(base - 45 + (i * 90) / 12);
      const p: Pt = [x + (cornerR + 1) * Math.cos(a), y + (cornerR + 1) * Math.sin(a)];
      lacePts.push(p, turn(p));
      laceRs.push(laceR[k * 13 + i], laceR[k * 13 + i]);
    }
  });

  // medallion: outer petals, cream toothed band, owner tin, eight katoris
  const MR = 198;
  const petalOut = brush([polar(CX, CY, MR - 18, 0), polar(CX, CY, MR + 2, 0), polar(CX, CY, MR + 17, 0)], leafW(9, 0.9), rnd, 10);
  const outer: string[] = [];
  for (let i = 0; i < 24; i++) outer.push(useRot(id('po'), (i * 360) / 24 + 7.5));
  const bandIn = 156, bandOut = MR - 8;
  const NT = 40;
  const teeth: Seg[] = [];
  for (let i = 0; i < NT; i++) {
    const a = (i * 360) / NT, w = 180 / NT;
    teeth.push(['M', polar(CX, CY, bandIn + 3, a - w * 0.82)], ['L', polar(CX, CY, bandOut - 6, a)], ['L', polar(CX, CY, bandIn + 3, a + w * 0.82)], ['Z']);
  }
  const k = katoris(id, rnd);
  const KR = 100;
  const kinds = ['vinegar', 'dahi', 'chaat', 'khali'] as const;
  const bowls = kinds.map((kind, i) => {
    const [x, y] = polar(CX, CY, KR, 22.5 + i * 45);
    return `<g transform="translate(${fx(x)} ${fx(y)})">${k[kind]}</g>`;
  }).join('');
  // tiny lozenges between the bowls and a gold eight-point star at the centre
  const loz = Array.from({ length: 8 }, (_, i) => {
    const [x, y] = polar(CX, CY, KR + 2, i * 45);
    return `M${fx(x)} ${fx(y - 6)}l4 6-4 6-4-6z`;
  }).join('');
  const starArm = brush([polar(CX, CY, 6, 0), polar(CX, CY, 24, 0), polar(CX, CY, 44, 0)], (t) => 8.6 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8), rnd, 10);
  const starArm2 = brush([polar(CX, CY, 6, 0), polar(CX, CY, 17, 0), polar(CX, CY, 28, 0)], (t) => 6 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8), rnd, 10);
  const star: string[] = [];
  for (let i = 0; i < 4; i++) star.push(useRot(id('sa'), i * 90));
  const star2: string[] = [];
  for (let i = 0; i < 4; i++) star2.push(useRot(id('sb'), i * 90 + 45));

  // coin legend in the halo: POWER over the top, शक्ति on the right; twinned for bottom / left
  const legendTop = arcText(BACK_COPY.power.title as WordmarkId, { cap: 44, tracking: 13, R: 236 });
  const legendSide = arcText(BACK_COPY.power.devanagari as WordmarkId, { cap: 40, tracking: 0, R: 242, at: 90 });
  // separators: chili bud + leaves at the gaps between the words
  const sepBud: Seg[] = [], sepLeaf: Seg[] = [], sepVein: Seg[] = [];
  const sepDots: Pt[] = [];
  for (const a of [57, 123]) {
    sepBud.push(...brushSegs([polar(CX, CY, 238, a), polar(CX, CY, 254, a + 0.5), polar(CX, CY, 270, a - 0.3), polar(CX, CY, 286, a + 0.6)], flameW(8.5), rnd, 14, 0.05));
    sepVein.push(...crSegs([polar(CX, CY, 244, a), polar(CX, CY, 258, a + 0.4), polar(CX, CY, 272, a)], false));
    for (const sd of [-1, 1]) {
      sepLeaf.push(...brushSegs([polar(CX, CY, 240, a), polar(CX, CY, 248, a + sd * 4.5), polar(CX, CY, 262, a + sd * 8.5)], leafW(5.6, 0.7), rnd, 12));
      sepDots.push(polar(CX, CY, 274, a + sd * 8), polar(CX, CY, 284, a + sd * 6.2));
    }
  }

  const spray = cornerSpray({
    arm: pal.base, armOpacity: 1, bud: CHILI, budVein: '#8A1A08', budSide: '#E0662E', leaf: LEAF, leafVein: '#A6C27A', dot: pal.deep,
    boss: o.tin[0], bossRing: pal.darker, bossRing2: GOLD, pip: CREAM_BRIGHT,
  }, seat(color), 78);
  const paperDark = mixOklab(PAPER, '#8A6A43', 0.6);
  const paperWash = washSvg(id('pwash'), 52, '#FBF4E2', paperDark, 0.16, 0.2, 0.08, 12);
  const ownerWash = washSvg(id('owash'), 61, pal.light, pal.darker, o.washLight * 0.8, o.washDark * 0.8, 0.16);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    filterDefs(id, 31) +
    paperWash.defs + ownerWash.defs +
    `<radialGradient id="${id('puriS')}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FBE3A0"/><stop offset=".62" stop-color="${PURI_GOLD.light}"/><stop offset=".88" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="${PURI_GOLD.deep}"/></radialGradient>` +
    `<radialGradient id="${id('brass')}" cx=".5" cy=".5" r=".5"><stop offset=".72" stop-color="#9A5A1C"/><stop offset=".84" stop-color="#F3CF7E"/><stop offset=".93" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="#7A3A10"/></radialGradient>` +
    `<radialGradient id="${id('vig')}" cx=".5" cy=".5" r=".64"><stop offset=".58" stop-color="#8A6A43" stop-opacity="0"/><stop offset="1" stop-color="#8A6A43" stop-opacity=".4"/></radialGradient>` +
    `<radialGradient id="${id('tin')}" cx=".5" cy=".5" r=".5"><stop offset=".3" stop-color="${o.tin[0]}"/><stop offset="1" stop-color="${o.tin[1]}"/></radialGradient>` +
    `<pattern id="${id('weave')}" patternUnits="userSpaceOnUse" x="${CX}" y="${CY}" width="${S}" height="${S}">${latticeTile(o, S, bw)}</pattern>` +
    `<path id="${id('pd')}" d="${panelD}"/>` +
    `<clipPath id="${id('panel')}"><use href="#${id('pd')}"/></clipPath>` +
    `<mask id="${id('lm')}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
    `<path d="${wobblyCircle(CX, CY, HALO, rnd, 1.5, 48)}${circles(cornerCs, cornerR)}" fill="#000"/></mask>` +
    `<path id="${id('po')}" d="${petalOut}"/><path id="${id('sa')}" d="${starArm}"/><path id="${id('sb')}" d="${starArm2}"/>` +
    `<g id="${id('spray')}" filter="url(#${id('rough')})">${spray}</g>` +
    `</defs>` +
    // owner margin
    `<rect width="${W}" height="${H}" fill="${pal.base}"/>` +
    ownerWash.body +
    frameSvg() +
    // parchment panel
    `<use href="#${id('pd')}" fill="${PAPER}"/>` +
    `<g clip-path="url(#${id('panel')})">` +
    `<g mask="url(#${id('lm')})"><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="url(#${id('weave')})" filter="url(#${id('rough2')})"/></g>` +
    `<g filter="url(#${id('rough2')})">` +
    `<path d="${circles(lacePts, (i) => laceRs[i])}" fill="${o.band}"/>` +
    dotRing(HALO + 2, 56, 9, o.band) +
    `<path d="${ringPath(CX, CY, HALO - 2, HALO + 6, rnd, 1.3, 36)}" fill="${pal.deep}" fill-rule="evenodd"/>` +
    dotRing(HALO - 17, 56, 2.5, o.band, 180 / 56, ' opacity=".85"') +
    `</g>` +
    paperWash.body +
    `<rect width="${W}" height="${H}" fill="url(#${id('vig')})"/>` +
    `<use href="#${id('pd')}" fill="none" stroke="${pal.darker}" stroke-width="3" opacity=".5"/>` +
    `</g>` +
    // medallion
    `<circle cx="${CX}" cy="${CY}" r="${MR + 16}" fill="#4A2E16" opacity=".32" filter="url(#${id('blur')})"/>` +
    `<g filter="url(#${id('rough2')})">` +
    `<g fill="${pal.deep}">${outer.join('')}</g>` +
    `<path d="${ringPath(CX, CY, bandIn, bandOut, rnd, 1.4, 34)}" fill="${CREAM}" fill-rule="evenodd"/>` +
    `<path d="${ser(teeth)}" fill="${o.band}"/>` +
    dotRing(bandOut - 7, NT, 2.5, CHILI, 180 / NT) +
    `<path d="${wobblyCircle(CX, CY, bandIn + 1, rnd, 1.1, 40)}" fill="url(#${id('tin')})"/>` +
    `<circle cx="${CX}" cy="${CY}" r="${bandIn - 7}" fill="none" stroke="${o.tinRim}" stroke-width="5" opacity=".9"/>` +
    `<circle cx="${CX}" cy="${CY}" r="${bandIn - 7}" fill="none" stroke="${CREAM}" stroke-width="1.6" stroke-dasharray="6 4" opacity=".75"/>` +
    `<path d="${ringPath(CX, CY, bandIn - 1.5, bandIn + 1.5, rnd, 1, 28)}${ringPath(CX, CY, bandOut - 1.5, bandOut + 1.5, rnd, 1, 28)}" fill="${pal.darker}" fill-rule="evenodd"/>` +
    `<path d="${loz}" fill="${o.petalAccent}" stroke="${INK}" stroke-width="1"/>` +
    `<g fill="${CREAM}" stroke="${INK}" stroke-width="1.4">${star2.join('')}</g>` +
    `<g fill="${GOLD}" stroke="${INK}" stroke-width="1.5">${star.join('')}</g>` +
    `<circle cx="${CX}" cy="${CY}" r="8" fill="${CHILI}" stroke="${INK}" stroke-width="1.5"/>` +
    `</g>` +
    twin(id('bowls'), bowls, ` filter="url(#${id('rough2')})"`) +
    // legend + separators
    `<g filter="url(#${id('rough2')})">` +
    twin(id('legend'),
      `<path d="${legendTop}${legendSide}" fill="${o.legend}"/>` +
      `<path d="${ser(sepLeaf)}" fill="${LEAF}"/>` +
      `<path d="${ser(sepBud)}" fill="${CHILI}"/>` +
      `<path d="${ser(sepVein)}" fill="none" stroke="#8A1A08" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>` +
      `<path d="${circles(sepDots, 2.6)}" fill="${o.legend}"/>`) +
    `</g>` +
    corners(id('spray'), 48) +
    `<rect width="${W}" height="${H}" filter="url(#${id('grain')})" opacity=".28"/>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Either back by family. */
export function backSvg(family: 'puri' | 'power', color: ColorId): string {
  return family === 'puri' ? puriBackSvg(color) : powerBackSvg(color);
}

const uriCache = new Map<string, string>();
/** `data:image/svg+xml` URI for <img src> / CSS background (memoised; ids stay isolated). */
export function backDataUri(family: 'puri' | 'power', color: ColorId): string {
  const key = `${family}-${color}`;
  let uri = uriCache.get(key);
  if (!uri) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(backSvg(family, color))}`;
    uriCache.set(key, uri);
  }
  return uri;
}

/** Corner pip count for an owner (their seat number, 1–6). */
export function ownerPips(color: ColorId): number {
  return seat(color);
}
