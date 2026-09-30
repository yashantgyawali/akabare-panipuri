/**
 * Card-back concept: "Gouache medallion".
 *
 * Puri back  — the owner colour as a mottled gouache wash on grained paper, a
 *              sunburst of hand-painted rays, and an ornate medallion: a cream
 *              ring painted with a leaf-and-berry vine, holding a golden crackly
 *              puri with a round glossy akabare chili peeking out of its broken
 *              top. AKABARE PANIPURI arches over it, अकबरे पानीपुरी under it.
 * Power back — the balance inverted: a deckled parchment panel inside an
 *              owner-colour margin, a woven owner-colour lattice (Dhaka-style
 *              over/under bands with stitch lines), and a deep owner-colour
 *              medallion holding a four-petal "spice box": vinegar bottle, dahi
 *              bowl, empty puri, chaat bowl. POWER / शक्ति arch around it.
 *
 * Pure functions returning standalone SVG strings (750×1050). No DOM, no fonts,
 * no external refs. All irregularity is seeded, so the output is stable.
 */

import type { ColorId } from '../../engine/types.ts';
import { PLAYER_PALETTE, CREAM, CREAM_BRIGHT, PAPER, INK, GOLD, CHILI, LEAF, PURI_GOLD, mixOklab } from '../palette.ts';
import type { PlayerShades } from '../palette.ts';
import { FRAME } from '../geometry.ts';
import { WORDMARKS } from '../wordmarks.ts';
import type { WordmarkId } from '../wordmarks.ts';
import { BACK_COPY } from '../content.ts';

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
function ns(v: number): string {
  const r = q1(v);
  if (r === 0) return '0';
  const s = String(r);
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s;
}
const fx = ns;
function nums(vals: number[]): string {
  let out = '';
  for (const v of vals) {
    const s = ns(v);
    out += out && !s.startsWith('-') ? ' ' + s : s;
  }
  return out;
}

/** Serialise segments as a compact relative path (rounded absolute points, exact deltas). */
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

/** Smooth periodic wobble from a few random low harmonics: f(angleDeg) ∈ ~[-amp, amp]. */
function wobble(rnd: () => number, amp: number, harmonics: number[] = [2, 3, 5, 7, 11]): (a: number) => number {
  const hs = harmonics.map((k, i) => ({ k, ph: rnd() * Math.PI * 2, w: (rnd() * 0.6 + 0.4) / (1 + i * 0.5) }));
  const tot = hs.reduce((s, h) => s + h.w, 0);
  return (a: number) => (amp * hs.reduce((s, h) => s + h.w * Math.sin(rad(a) * h.k + h.ph), 0)) / tot;
}

function circlePts(cx: number, cy: number, r: number, n: number, off: (a: number) => number = () => 0, ry = r): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const s = (r + off(a)) / r;
    out.push([cx + r * s * Math.sin(rad(a)), cy - ry * s * Math.cos(rad(a))]);
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

/** Points on a jagged ellipse arc (broken puri rims). Angles: 0 = top, clockwise. */
function jagged(cx: number, cy: number, rx: number, ry: number, rnd: () => number, amp: number, n: number, from = 0, to = 360, closed = true): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const a = from + ((to - from) * i) / n;
    const j = 1 + ((rnd() - 0.5) * 2 * amp) / Math.max(rx, ry);
    out.push([cx + rx * j * Math.sin(rad(a)), cy - ry * j * Math.cos(rad(a))]);
  }
  return out;
}

/** Many small (optionally rotated) ellipses as one path, via arcs. */
function dotsPath(dots: { c: Pt; rx: number; ry?: number; rot?: number }[]): string {
  let out = '';
  let cur: Pt = [0, 0];
  for (const d of dots) {
    const ry = d.ry ?? d.rx, rot = d.rot ?? 0;
    const e = rotPt([d.rx, 0], rot);
    const s: Pt = [q1(d.c[0] - e[0]), q1(d.c[1] - e[1])];
    const arc = `${ns(d.rx)} ${ns(ry)} ${Math.round(rot)} 1 0`;
    out += (out ? 'm' + nums([s[0] - cur[0], s[1] - cur[1]]) : 'M' + nums(s)) +
      `a${arc} ${nums([2 * e[0], 2 * e[1]])}a${arc} ${nums([-2 * e[0], -2 * e[1]])}z`;
    cur = s;
  }
  return out;
}
const circles = (pts: Pt[], r: number | ((i: number) => number)): string =>
  dotsPath(pts.map((c, i) => ({ c, rx: typeof r === 'number' ? r : r(i) })));

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
 * A wordmark set on a circle around the card centre. `top`: reads left→right
 * over the top, letters pointing outward. `bottom`: reads left→right beneath,
 * letters upright (tops toward the centre).
 */
function arcText(id: WordmarkId, o: { cap: number; tracking?: number; R: number; side: 'top' | 'bottom' }): string {
  const wm = WORDMARKS[id];
  const s = o.cap / 100;
  const tr = o.tracking ?? 0;
  const width = wm.width * s + tr * (wm.slots[wm.slots.length - 1] - wm.slots[0]);
  const segs: Seg[] = [];
  wm.parts.forEach((part, i) => {
    const dx = (wm.slots[i] - wm.slots[0]) * tr;
    segs.push(...warpSegs(part, (x, y) => {
      const X = x * s + dx - width / 2, Y = y * s, a = X / o.R;
      if (o.side === 'top') { const r = o.R - Y; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; }
      const r = o.R + Y;
      return [CX + r * Math.sin(a), CY + r * Math.cos(a)];
    }, 7 / s));
  });
  return ser(segs);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const frameSvg = (color = CREAM): string =>
  `<rect x="${FRAME.outer.x}" y="${FRAME.outer.y}" width="${FRAME.outer.w}" height="${FRAME.outer.h}" rx="${FRAME.outer.r}" fill="none" stroke="${color}" stroke-width="${FRAME.outer.stroke}"/>` +
  `<rect x="${FRAME.inner.x}" y="${FRAME.inner.y}" width="${FRAME.inner.w}" height="${FRAME.inner.h}" rx="${FRAME.inner.r}" fill="none" stroke="${color}" stroke-width="${FRAME.inner.stroke}"/>`;

const FULL = `filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB"`;
const BBOX = `x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB"`;

const rgb01 = (hex: string): string[] => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));

/** Filters shared by both backs; `id(x)` namespaces them per kind + colour. */
function filterDefs(id: (s: string) => string, seed: number): string {
  return (
    // paper tooth: faint dark and light specks from one noise field
    `<filter id="${id('grain')}" ${FULL}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 .16 0 0 0 0 .09 0 0 0 0 .05 2 0 0 0 -1.04" result="d"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 .97 0 0 0 0 .9 -2 0 0 0 .92" result="l"/>` +
    `<feMerge><feMergeNode in="d"/><feMergeNode in="l"/></feMerge></filter>` +
    // hand-drawn edge wobble, sized to the element
    `<filter id="${id('rough')}" ${BBOX}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${seed + 3}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<filter id="${id('rough2')}" ${BBOX}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="1" seed="${seed + 5}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<filter id="${id('blur')}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>`
  );
}

/** Mottled gouache wash: dark and light blotches from low-frequency noise, plus finer pigment granulation. */
function washFilter(fid: string, dark: string, light: string, seed: number, gran = 1): string {
  const [dr, dg, db] = rgb01(dark);
  const [lr, lg, lb] = rgb01(light);
  return (
    `<filter id="${fid}" ${FULL}>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.0045 0.006" numOctaves="3" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${dr} 0 0 0 0 ${dg} 0 0 0 0 ${db} 2.8 0 0 0 -1.36" result="d"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 ${lr} 0 0 0 0 ${lg} 0 0 0 0 ${lb} 0 -2.6 0 0 1.16" result="l"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed + 9}" result="g"/>` +
    `<feColorMatrix in="g" type="matrix" values="0 0 0 0 ${dr} 0 0 0 0 ${dg} 0 0 0 0 ${db} ${1.6 * gran} 0 0 0 ${-0.74 * gran}" result="gd"/>` +
    `<feMerge><feMergeNode in="d"/><feMergeNode in="l"/><feMergeNode in="gd"/></feMerge></filter>`
  );
}

interface MotifColors { arm: string; armOpacity: number; bud: string; budVein: string; budSide: string; leaf: string; leafVein: string; dot: string; stamen: string }

/**
 * Corner flourish in local coords (corner at 0,0, growing into +x/+y),
 * mirror-symmetric about the diagonal like the fronts' corner sprays: a flame
 * bud pointing into the corner, two acanthus arms sweeping along the edges and
 * curling back, slim leaves at the base, trailing dots.
 */
function cornerMotif(c: MotifColors, seed: number): string {
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
    arms.push(...brushSegs(m([[50, 44], [60, 27], [82, 14], [112, 9], [140, 13], [158, 25], [158, 39], [147, 43], [140, 36], [145, 29]]),
      (t) => 6.2 * Math.pow(1 - t, 0.85) + 0.7 + 1.6 * Math.sin(Math.PI * Math.min(1, t * 2.5)), rnd, 26, 0.08));
    // secondary leaflet dropping off the arm, curling inward
    arms.push(...brushSegs(m([[84, 15], [96, 24], [101, 38], [95, 49], [86, 49], [85, 42]]), (t) => 4.4 * Math.pow(1 - t, 0.8) + 0.5, rnd, 16, 0.08));
    // small flick toward the edge
    arms.push(...brushSegs(m([[116, 10], [126, 3], [138, 1]]), leafW(2.6), rnd, 8));
    // side petal of the bud
    side.push(...brushSegs(m([[46, 50], [33, 44], [20, 42], [9, 45]]), leafW(5.2, 0.7), rnd, 12));
    // slim leaf at the base
    leaves.push(...brushSegs(m([[56, 56], [72, 62], [90, 74], [102, 90]]), leafW(6.2), rnd, 14));
    veins.push(...crSegs(m([[60, 58], [76, 65], [94, 80]]), false));
    for (const [x, y, r] of [[176, 22, 3.3], [188, 22, 2.4], [198, 23, 1.6]] as const) { dots.push(m([[x, y]])[0]); dotR.push(r); }
  }
  const bud = brushSegs([[56, 56], [40, 40], [24, 24], [6, 6]], (t) => 8.6 * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * t)), 0.62) * (1 - 0.3 * t), rnd, 16, 0.06);
  return (
    `<path d="${ser(arms)}" fill="${c.arm}" opacity="${c.armOpacity}"/>` +
    `<path d="${circles(dots, (i) => dotR[i])}" fill="${c.dot}" opacity="${c.armOpacity}"/>` +
    `<path d="${ser(leaves)}" fill="${c.leaf}"/>` +
    `<path d="${ser(veins)}" fill="none" stroke="${c.leafVein}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>` +
    `<path d="${ser(side)}" fill="${c.budSide}"/>` +
    `<path d="${ser(bud)}" fill="${c.bud}"/>` +
    `<path d="${crPath([[52, 52], [38, 38], [22, 22]], false)}" fill="none" stroke="${c.budVein}" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>` +
    `<path d="${circles([[57, 57], [48, 62], [62, 48]], (i) => (i ? 2 : 4))}" fill="${c.stamen}"/>`
  );
}

/** The motif in all four corners (the placements are 180°-rotationally symmetric). */
function corners(defId: string, inset: number): string {
  const a = inset, b = W - inset, c = H - inset;
  return (
    `<use href="#${defId}" transform="translate(${a} ${a})"/>` +
    `<use href="#${defId}" transform="translate(${b} ${a}) scale(-1 1)"/>` +
    `<use href="#${defId}" transform="translate(${a} ${c}) scale(1 -1)"/>` +
    `<use href="#${defId}" transform="translate(${b} ${c}) scale(-1 -1)"/>`
  );
}

const useRot = (href: string, a: number, extra = ''): string =>
  `<use href="#${href}"${a ? ` transform="rotate(${fx(a)} ${CX} ${CY})"` : ''}${extra}/>`;

// ---------------------------------------------------------------------------
// The puri + akabare emblem
// ---------------------------------------------------------------------------

const PURI = { cx: CX, cy: 553, rx: 86, ry: 77, cutY: 500, cutRx: 64, cutRy: 19, holeRx: 51, holeRy: 14 } as const;

function puriDefs(id: (s: string) => string, seed: number): string {
  return (
    `<radialGradient id="${id('puriG')}" cx=".4" cy=".36" r=".72" fx=".34" fy=".28">` +
    `<stop offset="0" stop-color="#FBDF97"/><stop offset=".32" stop-color="${PURI_GOLD.light}"/><stop offset=".7" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="${PURI_GOLD.deep}"/></radialGradient>` +
    `<radialGradient id="${id('puriB')}" cx=".8" cy=".88" r=".42"><stop offset="0" stop-color="#FFB45C" stop-opacity=".4"/><stop offset="1" stop-color="#FFB45C" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id('holeG')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241006"/><stop offset=".65" stop-color="#43210D"/><stop offset="1" stop-color="#5A4418"/></linearGradient>` +
    `<radialGradient id="${id('chiliG')}" cx=".4" cy=".36" r=".72" fx=".32" fy=".26">` +
    `<stop offset="0" stop-color="#FF8A55"/><stop offset=".38" stop-color="#E0401F"/><stop offset=".75" stop-color="${CHILI}"/><stop offset="1" stop-color="#6A1005"/></radialGradient>` +
    `<filter id="${id('crust')}" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.13" numOctaves="2" seed="${seed}" result="n"/>` +
    `<feDiffuseLighting in="n" surfaceScale="2.4" diffuseConstant="1" lighting-color="#FFF3DA" result="lit"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>` +
    `<feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1=".62" k2="0" k3=".5" k4="0" result="m"/>` +
    `<feComposite in="m" in2="SourceGraphic" operator="in"/></filter>`
  );
}

function puriEmblem(id: (s: string) => string, seed: number): string {
  const rnd = prng(seed);
  const { cx, cy, rx, ry, cutY, cutRx, cutRy, holeRx, holeRy } = PURI;
  // silhouette: sphere below the cut + the jagged back edge of the broken top
  const tCut = Math.asin((cutY - cy) / ry);
  const wob = wobble(rnd, 1.4);
  const body: Pt[] = [];
  for (let i = 0; i <= 26; i++) {
    const t = tCut + ((Math.PI - 2 * tCut) * i) / 26;
    const k = 1 + wob((t * 180) / Math.PI) / rx;
    body.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  const bodyD = crPath([...body, ...jagged(cx, cutY, cutRx, cutRy, rnd, 2.4, 14, 270, 450, false).slice(1, -1)], true, 0.16);
  const rimD = crPath(jagged(cx, cutY, cutRx, cutRy, rnd, 2.6, 24), true, 0.14);
  const holeD = crPath(jagged(cx + 1, cutY + 1, holeRx, holeRy, rnd, 2.8, 24), true, 0.14);
  const wallD = crPath([
    ...jagged(cx + 1, cutY + 1, holeRx - 1.5, holeRy - 1.5, rnd, 1, 10, 270, 450, false),
    ...jagged(cx + 1, cutY + 5, holeRx - 9, holeRy - 6, rnd, 0.6, 8, 90, -90, false).slice(1, -1),
  ], true, 0.14);
  // clip: everything above the hole's front lip
  const lip = jagged(cx + 1, cutY + 1, holeRx, holeRy, rnd, 0, 18, 90, 270, false);
  const clipD = ser([['M', [cx + 100, 380]], ['L', [cx + 100, cutY + 1]], ...lip.map((p) => ['L', p] as Seg), ['L', [cx - 100, cutY + 1]], ['L', [cx - 100, 380]], ['Z']]);

  // blisters: little fried bubbles, foreshortened on the sphere, lit from the upper left
  const hi: { c: Pt; rx: number; ry: number; rot: number }[] = [];
  const lo: { c: Pt; rx: number; ry: number; rot: number }[] = [];
  const light = [-0.52, -0.62, 0.58];
  for (let n = 0, tries = 0; n < 64 && tries < 800; tries++) {
    const x = cx + (rnd() * 2 - 1) * rx, y = cy + (rnd() * 2 - 1) * ry;
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    const rr = nx * nx + ny * ny;
    if (rr > 0.86 || y < cutY + 8) continue;
    const nz = Math.sqrt(1 - rr);
    const lit = nx * light[0] + ny * light[1] + nz * light[2];
    const size = 2.2 + rnd() * 3.6;
    const rot = (Math.atan2(ny, nx) * 180) / Math.PI;
    const e = { rx: size * (0.45 + 0.55 * nz), ry: size, rot };
    if (lit > 0.35) hi.push({ c: [x, y], ...e });
    lo.push({ c: [x + 1.6, y + 1.8], rx: e.rx * 0.8, ry: e.ry * 0.7, rot });
    n++;
  }
  // hairline cracks running down from the broken rim
  const cracks: Seg[] = [];
  for (const a of [-62, -38, -14, 18, 44, 66]) {
    const s = jagged(cx, cutY, cutRx, cutRy, rnd, 0, 1, 180 + a, 180 + a, false)[0];
    const len = 9 + rnd() * 10;
    cracks.push(...crSegs([s, [s[0] + (rnd() - 0.5) * 5, s[1] + len * 0.5], [s[0] + (rnd() - 0.5) * 8, s[1] + len]], false));
  }

  // chili: a round, slightly lobed cherry pepper
  const ch: Pt = [cx + 9, 489];
  const chR = 29;
  const lobe = wobble(rnd, 0.9);
  const chiliD = crPath(circlePts(ch[0], ch[1], chR, 30, (a) => 1.8 * Math.cos(rad(a) * 4) + lobe(a), chR * 0.94), true);
  const calyx: Pt = [ch[0] + 1, ch[1] - chR * 0.9];
  const sepals: Seg[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -84 + i * 42 + (rnd() - 0.5) * 8;
    const len = 14 + rnd() * 4;
    const tip: Pt = [calyx[0] + len * Math.sin(rad(a)), calyx[1] - len * 0.42 * Math.cos(rad(a)) + 2.5];
    const mid: Pt = [(calyx[0] + tip[0]) / 2, (calyx[1] + tip[1]) / 2 - 1.5];
    sepals.push(...brushSegs([calyx, mid, tip], (t) => 4.8 * Math.pow(1 - t, 0.9) + 0.3, rnd, 8));
  }
  const stemD = brush([[calyx[0], calyx[1] + 1], [calyx[0] + 1, calyx[1] - 12], [calyx[0] + 9, calyx[1] - 24], [calyx[0] + 21, calyx[1] - 29], [calyx[0] + 27, calyx[1] - 26]], (t) => 3.8 - 1.8 * t, rnd, 12, 0.05);
  // coriander sprig on the left
  const sprig: Seg[] = [];
  for (const [a, l, w] of [[-60, 25, 7.5], [-34, 21, 6.5], [-84, 18, 6]] as const) {
    const base: Pt = [cx - 24, 503];
    const tip = polar(base[0], base[1], l, a);
    sprig.push(...brushSegs([base, [(base[0] + tip[0]) / 2 + 2, (base[1] + tip[1]) / 2 - 2], tip], leafW(w * 0.8), rnd, 10));
  }
  const specks: { c: Pt; rx: number }[] = [];
  const speckC: string[] = [];
  for (let i = 0; i < 8; i++) {
    const p = polar(cx + 1, cutY + 4, holeRx * (0.5 + rnd() * 0.4), 105 + rnd() * 150);
    specks.push({ c: [p[0], p[1] - 3], rx: 1.6 + rnd() * 1.6 });
    speckC.push(i % 3 ? '#6E8B2E' : '#E0AD48');
  }

  return (
    `<ellipse cx="${cx + 5}" cy="${cy + ry - 5}" rx="${rx * 0.82}" ry="13" fill="#140803" opacity=".5" filter="url(#${id('blur')})"/>` +
    `<path d="${bodyD}" fill="url(#${id('puriG')})" filter="url(#${id('crust')})"/>` +
    `<path d="${bodyD}" fill="url(#${id('puriB')})"/>` +
    `<path d="${dotsPath(lo)}" fill="#8A4210" opacity=".42"/>` +
    `<path d="${dotsPath(hi)}" fill="#FFE7A8" opacity=".75"/>` +
    `<path d="${rimD}" fill="#F7D48A" filter="url(#${id('crust')})"/>` +
    `<path d="${ser(cracks)}" fill="none" stroke="#7A3A10" stroke-width="1.3" stroke-linecap="round" opacity=".7"/>` +
    `<path d="${holeD}" fill="url(#${id('holeG')})"/>` +
    `<path d="${wallD}" fill="${PURI_GOLD.deep}" opacity=".8"/>` +
    `<g clip-path="url(#${id('holeClip')})">` +
    `<path d="${ser(sprig)}" fill="${LEAF}" stroke="#2E4A1C" stroke-width="1.1"/>` +
    specks.map((s, i) => `<circle cx="${fx(s.c[0])}" cy="${fx(s.c[1])}" r="${fx(s.rx)}" fill="${speckC[i]}"/>`).join('') +
    `<ellipse cx="${ch[0] + 3}" cy="${cutY + 4}" rx="30" ry="8" fill="#120602" opacity=".55"/>` +
    `<path d="${chiliD}" fill="url(#${id('chiliG')})" stroke="${INK}" stroke-width="2.4"/>` +
    `<path d="${crPath([[ch[0] + 21, ch[1] - 8], [ch[0] + 24, ch[1] + 5], [ch[0] + 16, ch[1] + 19]], false)}" fill="none" stroke="#FF9A66" stroke-width="3" stroke-linecap="round" opacity=".45"/>` +
    `<path d="${dotsPath([{ c: [ch[0] - 11, ch[1] - 11], rx: 9.5, ry: 5.2, rot: -40 }, { c: [ch[0] + 2, ch[1] - 20], rx: 2.4 }, { c: [ch[0] - 19, ch[1] + 2], rx: 1.8 }])}" fill="#FFF6E6" opacity=".9"/>` +
    `<path d="${stemD}" fill="#5D8A31" stroke="#2A4418" stroke-width="1.5"/>` +
    `<path d="${ser(sepals)}" fill="${LEAF}" stroke="#2A4418" stroke-width="1.3"/>` +
    `</g>` +
    `<path d="${holeD}" fill="none" stroke="${INK}" stroke-width="1.7" opacity=".85"/>` +
    `<path d="${bodyD}" fill="none" stroke="${INK}" stroke-width="2.8"/>` +
    `<clipPath id="${id('holeClip')}"><path d="${clipD}"/></clipPath>`
  );
}

// ---------------------------------------------------------------------------
// Puri back
// ---------------------------------------------------------------------------

export function puriBackSvg(color: ColorId): string {
  const pal = PLAYER_PALETTE[color];
  const id = (s: string): string => `gm-pu-${color}-${s}`;
  const rnd = prng(1234);
  const inner = FRAME.inner;

  // sunburst — three ray variants, stamped round the centre with varying strength
  const N = 32;
  const rayDefs: string[] = [];
  for (let v = 0; v < 3; v++) {
    const r0 = 206, r1 = 660, half = ((Math.PI * r1) / N) * (0.36 + v * 0.05), bend = (rnd() - 0.5) * 2.4;
    rayDefs.push(`<path id="${id('ray' + v)}" d="${brush([polar(CX, CY, r0, 0), polar(CX, CY, (r0 + r1) / 2, bend * 0.5), polar(CX, CY, r1, bend)], (t) => 1.5 + half * Math.pow(t, 0.95), rnd, 7, 0.1)}"/>`);
    rayDefs.push(`<path id="${id('flick' + v)}" d="${brush([polar(CX, CY, 207 + v * 2, 0), polar(CX, CY, 222 + v * 4, (rnd() - 0.5) * 1.5), polar(CX, CY, 236 + v * 7, (rnd() - 0.5) * 2)], leafW(2.8 + v * 0.4, 0.8), rnd, 8)}"/>`);
  }
  const rays: string[] = [];
  const flicks: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i * 360) / N;
    rays.push(useRot(id('ray' + (i % 3)), a, ` opacity="${fx(0.1 + ((i * 7) % 5) * 0.022)}"`));
    flicks.push(useRot(id('flick' + ((i * 2) % 3)), a + 180 / N));
  }

  // medallion: cream band + vine wreath, lace scallops, gold dots, dark disc
  const bandIn = 130, bandOut = 174;
  const leafPair = (() => {
    const segs: Seg[] = [];
    for (const side of [-1, 1]) {
      const base = polar(CX, CY, 152, 2), mid = polar(CX, CY, 152 + side * 8.5, 7.5), tip = polar(CX, CY, 152 + side * 14.5, 13);
      segs.push(...brushSegs([base, mid, tip], leafW(5.3, 0.7), rnd, 10));
    }
    const vein: Seg[] = [];
    for (const side of [-1, 1]) vein.push(...crSegs([polar(CX, CY, 152 + side * 2, 4), polar(CX, CY, 152 + side * 8, 8), polar(CX, CY, 152 + side * 12, 11.5)], false));
    const berry = polar(CX, CY, 152, -5.8);
    return `<g id="${id('lp')}"><path d="${ser(segs)}" fill="${LEAF}"/><path d="${ser(vein)}" fill="none" stroke="#9DBB6A" stroke-width="1" opacity=".7"/>` +
      `<circle cx="${fx(berry[0])}" cy="${fx(berry[1])}" r="4.7" fill="${CHILI}"/><circle cx="${fx(berry[0] - 1.4)}" cy="${fx(berry[1] - 1.5)}" r="1.4" fill="#FFE9D6" opacity=".85"/></g>`;
  })();
  const NL = 18;
  const wreath: string[] = [];
  for (let i = 0; i < NL; i++) wreath.push(useRot(id('lp'), (i * 360) / NL));
  const NS = 36;
  const scallops = circles(Array.from({ length: NS }, (_, i) => polar(CX, CY, bandOut + 1, (i * 360) / NS)), () => 8.4 + rnd() * 0.8);
  const gdots = circles(Array.from({ length: NS }, (_, i) => polar(CX, CY, bandOut + 18, (i * 360) / NS)), () => 2.7 + rnd() * 0.6);
  const innerDots = circles(Array.from({ length: 40 }, (_, i) => polar(CX, CY, 119, (i * 360) / 40 + 4.5)), 1.9);

  // wordmarks on arcs
  const top = arcText(BACK_COPY.puri.title as WordmarkId, { cap: 28.5, tracking: 3, R: 268, side: 'top' });
  const bottom = arcText(BACK_COPY.puri.devanagari as WordmarkId, { cap: 35, tracking: 12, R: 292, side: 'bottom' });

  const motif = cornerMotif({ arm: CREAM, armOpacity: 0.92, bud: CHILI, budVein: '#8A1A08', budSide: '#E0662E', leaf: LEAF, leafVein: '#A6C27A', dot: CREAM, stamen: GOLD }, 77);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    filterDefs(id, 21) +
    washFilter(id('wash'), pal.darker, pal.light, 41) +
    puriDefs(id, 9) +
    `<radialGradient id="${id('vig')}" cx=".5" cy=".5" r=".62"><stop offset=".5" stop-color="${pal.darker}" stop-opacity="0"/><stop offset="1" stop-color="${pal.darker}" stop-opacity=".6"/></radialGradient>` +
    `<radialGradient id="${id('glow')}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${pal.light}" stop-opacity=".36"/><stop offset=".42" stop-color="${pal.light}" stop-opacity=".12"/><stop offset="1" stop-color="${pal.light}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id('disc')}" cx=".5" cy=".42" r=".58"><stop offset="0" stop-color="${pal.deep}"/><stop offset="1" stop-color="${pal.darker}"/></radialGradient>` +
    `<radialGradient id="${id('halo')}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${GOLD}" stop-opacity=".6"/><stop offset=".55" stop-color="${GOLD}" stop-opacity=".18"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id('in')}"><rect x="${inner.x + 2}" y="${inner.y + 2}" width="${inner.w - 4}" height="${inner.h - 4}" rx="${inner.r - 2}"/></clipPath>` +
    rayDefs.join('') + leafPair +
    `<g id="${id('motif')}" filter="url(#${id('rough')})">${motif}</g>` +
    `</defs>` +
    // field
    `<rect width="${W}" height="${H}" fill="${pal.base}"/>` +
    `<rect width="${W}" height="${H}" filter="url(#${id('wash')})" opacity=".55"/>` +
    `<rect width="${W}" height="${H}" fill="url(#${id('vig')})"/>` +
    // sunburst
    `<g clip-path="url(#${id('in')})">` +
    `<circle cx="${CX}" cy="${CY}" r="480" fill="url(#${id('glow')})"/>` +
    `<g fill="${pal.light}">${rays.join('')}</g>` +
    `</g>` +
    `<g fill="${GOLD}" opacity=".8">${flicks.join('')}</g>` +
    // medallion
    `<circle cx="${CX}" cy="${CY + 7}" r="${bandOut + 18}" fill="${pal.darker}" opacity=".5" filter="url(#${id('blur')})"/>` +
    `<g filter="url(#${id('rough2')})">` +
    `<path d="${scallops}" fill="${CREAM}"/>` +
    `<path d="${ringPath(CX, CY, bandIn, bandOut, rnd, 1.5, 56)}" fill="${CREAM}" fill-rule="evenodd"/>` +
    `<path d="${gdots}" fill="${GOLD}"/>` +
    `<path d="${wobblyCircle(CX, CY, bandIn + 1, rnd, 1.2, 40)}" fill="url(#${id('disc')})"/>` +
    `<circle cx="${CX}" cy="${CY + 10}" r="120" fill="url(#${id('halo')})"/>` +
    `<path d="${innerDots}" fill="${CREAM}" opacity=".65"/>` +
    `<path d="${ringPath(CX, CY, bandIn - 1.6, bandIn + 1.6, rnd, 1.1, 40)}" fill="${pal.darker}" fill-rule="evenodd" opacity=".85"/>` +
    `<path d="${ringPath(CX, CY, bandOut - 1.3, bandOut + 1.3, rnd, 1.1, 40)}" fill="${pal.darker}" fill-rule="evenodd" opacity=".5"/>` +
    `<path d="${wobblyCircle(CX, CY, 152, rnd, 1.2, 40)}" fill="none" stroke="#3E6127" stroke-width="2"/>` +
    wreath.join('') +
    `</g>` +
    puriEmblem(id, 5) +
    // wordmarks
    `<g filter="url(#${id('rough2')})">` +
    `<g fill="${pal.darker}" opacity=".75" transform="translate(1.5 3)"><path d="${top}"/><path d="${bottom}"/></g>` +
    `<g fill="${CREAM_BRIGHT}"><path d="${top}"/><path d="${bottom}"/></g>` +
    `</g>` +
    corners(id('motif'), 52) +
    frameSvg() +
    `<rect width="${W}" height="${H}" filter="url(#${id('grain')})" opacity=".32"/>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Power back
// ---------------------------------------------------------------------------

function vessels(pal: PlayerShades, puriGrad: string, rnd: () => number): { bottle: string; dahi: string; khali: string; chaat: string } {
  const ink = `stroke="${INK}" stroke-width="2" stroke-linejoin="round"`;
  const bottleBody: Pt[] = [[-5, -20], [-5.5, -11], [-12, -3], [-17, 8], [-14, 20], [0, 25], [14, 20], [17, 8], [12, -3], [5.5, -11], [5, -20]];
  const liquid: Pt[] = [[-15.4, 1], [-17, 8], [-14, 20], [0, 25], [14, 20], [17, 8], [15.4, 1], [8, 2.2], [0, 0.8], [-8, 2.2]];
  const bottle =
    `<path d="${crPath(bottleBody, true, 0.15)}" fill="#EFE8D2"/>` +
    `<path d="${crPath(liquid, true, 0.15)}" fill="${GOLD}"/>` +
    `<path d="${crPath([[-9, 6], [-10, 14], [-6, 20]], false)}" fill="none" stroke="#FFF6DE" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>` +
    `<path d="${circles([[4, 10], [-3, 16], [7, 18]], 1.4)}" fill="#6B3A12"/>` +
    `<path d="${crPath(bottleBody, true, 0.15)}" fill="none" ${ink}/>` +
    `<rect x="-6.5" y="-28" width="13" height="9" rx="2.5" fill="#A8703F" ${ink}/>` +
    `<path d="M-6 -15q6 2.5 12 0" fill="none" stroke="${GOLD}" stroke-width="2"/>`;
  const bowl = (fill: string, rim: string, deco: string): string =>
    `<path d="M-27 -1c1 13 11 20 19 21l-1 4h18l-1-4c8-1 18-8 19-21z" fill="${fill}" ${ink}/>` +
    `<ellipse cx="0" cy="-1" rx="27" ry="5.5" fill="${rim}" ${ink}/>` + deco;
  const dahi =
    bowl(pal.base, pal.deep, `<path d="${circles([[-12, 9], [0, 12], [12, 9], [-6, 14.5], [6, 14.5]], (i) => (i < 3 ? 1.9 : 1.2))}" fill="${CREAM}"/>`) +
    `<path d="${ser([...crSegs([[-23, -2], [-18, -9], [-8, -13], [0, -18], [5, -14], [14, -11], [22, -4], [23, -2]], false), ['Z']])}" fill="#FBF5E6" ${ink}/>` +
    `<path d="M-10 -7q8-5 16-1q-4 3-9 1" fill="none" stroke="#C9B894" stroke-width="1.6" stroke-linecap="round"/>`;
  const khali =
    `<ellipse cx="0" cy="4" rx="23" ry="20.5" fill="url(#${puriGrad})" ${ink}/>` +
    `<ellipse cx="0" cy="-8" rx="15" ry="5.5" fill="${PURI_GOLD.light}"/>` +
    `<path d="${crPath(jagged(0, -8, 12, 4, rnd, 0.8, 14), true, 0.14)}" fill="#2A1308" stroke="${INK}" stroke-width="1.4"/>` +
    `<path d="${circles([[-10, 4], [-4, 12], [7, 6], [-13, -2], [3, 17], [13, 13]], (i) => [2.2, 1.8, 2, 1.4, 1.5, 1.4][i])}" fill="#F8D98E" opacity=".9"/>` +
    `<path d="${circles([[-6, 6], [10, 1], [1, 9]], 1.2)}" fill="${PURI_GOLD.deep}" opacity=".8"/>`;
  const heap: Pt[] = [[-25, -2], [-22, -10], [-14, -17], [-4, -20], [6, -19], [16, -15], [23, -8], [25, -2]];
  const sev: Seg[] = [];
  for (let i = 0; i < 9; i++) {
    const x = -18 + rnd() * 36, y = -16 + rnd() * 12;
    const e = rotPt([5, 0], rnd() * 180);
    sev.push(['M', [x - e[0], y - e[1]]], ['L', [x + e[0], y + e[1]]]);
  }
  const chaat =
    bowl('#F1E3C2', CHILI, `<circle cx="0" cy="11" r="4" fill="${CHILI}"/><circle cx="0" cy="11" r="1.5" fill="${GOLD}"/><path d="M-16 8q5-4 9 1M16 8q-5-4-9 1" fill="none" stroke="${pal.base}" stroke-width="2"/>`) +
    `<path d="${ser([...crSegs(heap, false), ['Z']])}" fill="#C98B3C" ${ink}/>` +
    `<path d="M-14 -9q8-5 16-1t14-2" fill="none" stroke="#FBF5E6" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="${ser(sev)}" stroke="#F3C046" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="${circles([[-10, -5], [8, -14], [14, -5]], 2.2)}" fill="${CHILI}"/>` +
    `<path d="${circles([[-3, -15], [4, -6], [-16, -6]], 2)}" fill="${LEAF}"/>`;
  return { bottle, dahi, khali, chaat };
}

/**
 * One seamless tile of the woven lattice. Tile corners are crossings where the
 * A band (↘, x−y const) goes over; the tile centre is a crossing where B (↗) goes over.
 */
function latticeTile(pal: PlayerShades, S: number, bw: number): string {
  const d = Math.SQRT1_2;
  const band = (p: Pt, o: Pt, len: number): Seg[] => {
    const n: Pt = [-o[1], o[0]];
    const a: Pt = [p[0] - o[0] * len, p[1] - o[1] * len], b: Pt = [p[0] + o[0] * len, p[1] + o[1] * len];
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
  // the dash period divides the tile diagonal, so stitches line up across tiles
  const dash = diag / 12;
  const dashArr = `${fx(dash * 0.45)} ${fx(dash * 0.55)}`;
  const shade = (p: Pt, over: Pt): Seg[] => {
    const n: Pt = [-over[1], over[0]];
    const out: Seg[] = [];
    for (const s of [-1, 1]) {
      const o = bw + 1;
      out.push(['M', [p[0] + n[0] * o * s - over[0] * bw, p[1] + n[1] * o * s - over[1] * bw]], ['L', [p[0] + n[0] * o * s + over[0] * bw, p[1] + n[1] * o * s + over[1] * bw]]);
    }
    return out;
  };
  const shades: Seg[] = [...shade(c, B)];
  for (const p of [[0, 0], [S, 0], [0, S], [S, S]] as Pt[]) shades.push(...shade(p, A));
  const cellPts: Pt[] = [[S / 2, 0], [0, S / 2], [S, S / 2], [S / 2, S]];
  const cellsD = cellPts.map(([x, y]) => `M${fx(x)} ${fx(y - 9)}l6 9-6 9-6-9z`).join('');
  // B stitch in the patch: the B line through (S,0) starts diag·1.5 before the centre (at −B·diag·1.5 … wait: it
  // spans p ± B·diag), so the patch start sits (diag − L) along it from its start.
  const offB = (diag - L) % dash;
  return (
    `<path d="${cellsD}" fill="${pal.light}" stroke="${pal.deep}" stroke-width="1.4"/>` +
    `<path d="${circles(cellPts, 2.2)}" fill="${CHILI}"/>` +
    `<path d="${ser(bandsB)}" fill="${pal.base}"/>` +
    `<path d="${ser(stB)}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" opacity=".8"/>` +
    `<path d="${ser(bandsA)}" fill="${pal.base}"/>` +
    `<path d="${ser(stA)}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" opacity=".8"/>` +
    `<path d="${ser(patchB)}" fill="${pal.base}"/>` +
    `<path d="${ser([['M', [c[0] - B[0] * L, c[1] - B[1] * L]], ['L', [c[0] + B[0] * L, c[1] + B[1] * L]]])}" fill="none" stroke="${CREAM}" stroke-width="1.7" stroke-dasharray="${dashArr}" stroke-dashoffset="${fx(-offB)}" opacity=".8"/>` +
    `<path d="${ser(shades)}" stroke="${pal.darker}" stroke-width="2.4" opacity=".5"/>`
  );
}

export function powerBackSvg(color: ColorId): string {
  const pal = PLAYER_PALETTE[color];
  const id = (s: string): string => `gm-pw-${color}-${s}`;
  const rnd = prng(4321);
  const panel = { x: 48, y: 48, w: W - 96, h: H - 96, r: 24 };

  // deckled parchment panel (like the fronts' painted paper squares)
  const edge: Pt[] = [];
  {
    const { x, y, w, h, r } = panel;
    const pts: Pt[] = [];
    const seg = (a: Pt, b: Pt): void => {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9));
      for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    };
    const arc = (c: Pt, a0: number): void => { for (let i = 0; i < 4; i++) pts.push(polar(c[0], c[1], r, a0 + i * 22.5)); };
    seg([x + r, y], [x + w - r, y]); arc([x + w - r, y + r], 0);
    seg([x + w, y + r], [x + w, y + h - r]); arc([x + w - r, y + h - r], 90);
    seg([x + w - r, y + h], [x + r, y + h]); arc([x + r, y + h - r], 180);
    seg([x, y + h - r], [x, y + r]); arc([x + r, y + r], 270);
    for (const p of pts) {
      const dx = p[0] - CX, dy = p[1] - CY, l = Math.hypot(dx, dy), j = (rnd() - 0.5) * 2.6;
      edge.push([p[0] + (dx / l) * j, p[1] + (dy / l) * j]);
    }
  }
  const panelD = crPath(edge, true, 0.12);

  // lattice geometry
  const S = 94, bw = 7.5;
  const HALO = 294;
  const cornerR = 130;
  const cornerCs: Pt[] = [[panel.x, panel.y], [panel.x + panel.w, panel.y], [panel.x, panel.y + panel.h], [panel.x + panel.w, panel.y + panel.h]];

  // lace edges: halo and corner cartouches
  const NLc = 56;
  const lace = circles([
    ...Array.from({ length: NLc }, (_, i) => polar(CX, CY, HALO + 2, (i * 360) / NLc)),
    ...cornerCs.flatMap(([x, y]) => {
      const base = (Math.atan2(CY - y, CX - x) * 180) / Math.PI;
      return Array.from({ length: 13 }, (_, i) => {
        const a = rad(base - 45 + (i * 90) / 12);
        return [x + (cornerR + 1) * Math.cos(a), y + (cornerR + 1) * Math.sin(a)] as Pt;
      });
    }),
  ], () => 8.8 + rnd() * 0.8);
  const laceDots = circles(Array.from({ length: NLc }, (_, i) => polar(CX, CY, HALO - 17, ((i + 0.5) * 360) / NLc)), () => 2.4 + rnd() * 0.5);

  // medallion
  const MR = 180;
  const petalOut = brush([polar(CX, CY, MR - 18, 0), polar(CX, CY, MR + 2, 0), polar(CX, CY, MR + 17, 0)], leafW(9, 0.9), rnd, 10);
  const outer: string[] = [];
  for (let i = 0; i < 24; i++) outer.push(useRot(id('po'), (i * 360) / 24 + 7.5));
  const bandIn = 140, bandOut = MR - 8;
  const NT = 40;
  const teeth: Seg[] = [];
  for (let i = 0; i < NT; i++) {
    const a = (i * 360) / NT, w = 180 / NT;
    teeth.push(['M', polar(CX, CY, bandIn + 3, a - w * 0.82)], ['L', polar(CX, CY, bandOut - 6, a)], ['L', polar(CX, CY, bandIn + 3, a + w * 0.82)], ['Z']);
  }
  const toothDots = circles(Array.from({ length: NT }, (_, i) => polar(CX, CY, bandOut - 7, ((i + 0.5) * 360) / NT)), 2.5);
  const petal: Pt[] = [[0, -12], [-22, -40], [-42, -72], [-44, -102], [-26, -125], [0, -131], [26, -125], [44, -102], [42, -72], [22, -40]];
  const petals: Seg[] = [], petalLines: Seg[] = [];
  for (const a of [-45, 45, 135, 225]) {
    petals.push(...crSegs(petal.map((p) => rotPt(p, a)).map(([x, y]) => [x + CX, y + CY] as Pt), true, 0.17));
    petalLines.push(...crSegs(petal.map(([x, y]) => rotPt([x * 0.84, y * 0.84 - 10], a)).map(([x, y]) => [x + CX, y + CY] as Pt), true, 0.17));
  }
  const v = vessels(pal, id('puriS'), rnd);
  const place = (s: string, a: number, sc = 1.3): string => {
    const [x, y] = polar(CX, CY, 86, a);
    return `<g transform="translate(${fx(x)} ${fx(y + 2)}) scale(${sc})">${s}</g>`;
  };
  const sprigs: Seg[] = [];
  for (const a of [0, 90, 180, 270]) {
    sprigs.push(...brushSegs([polar(CX, CY, 56, a), polar(CX, CY, 94, a), polar(CX, CY, 126, a)], leafW(6.4, 0.8), rnd, 12));
    for (const s of [-1, 1]) sprigs.push(...brushSegs([polar(CX, CY, 78, a), polar(CX, CY, 94, a + s * 9), polar(CX, CY, 104, a + s * 15)], leafW(4, 0.8), rnd, 8));
  }
  const star: Seg[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45 + 22.5;
    star.push(...brushSegs([polar(CX, CY, 4, a), polar(CX, CY, 16, a), polar(CX, CY, 27, a)], (t) => 6.2 * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * t)), 0.8), rnd, 10));
  }

  const top = arcText(BACK_COPY.power.title as WordmarkId, { cap: 44, tracking: 14, R: 216, side: 'top' });
  const bottom = arcText(BACK_COPY.power.devanagari as WordmarkId, { cap: 46, R: 268, side: 'bottom' });

  const motif = cornerMotif({ arm: pal.base, armOpacity: 1, bud: CHILI, budVein: '#8A1A08', budSide: '#E0662E', leaf: LEAF, leafVein: '#A6C27A', dot: pal.deep, stamen: GOLD }, 78);
  const paperDark = mixOklab(PAPER, '#8A6A43', 0.6);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    filterDefs(id, 31) +
    washFilter(id('wash'), paperDark, '#FBF4E2', 52, 1.2) +
    washFilter(id('owash'), pal.darker, pal.light, 61) +
    `<radialGradient id="${id('puriS')}" cx=".38" cy=".34" r=".75"><stop offset="0" stop-color="#F8D98E"/><stop offset=".55" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="${PURI_GOLD.deep}"/></radialGradient>` +
    `<radialGradient id="${id('vig')}" cx=".5" cy=".5" r=".64"><stop offset=".58" stop-color="#8A6A43" stop-opacity="0"/><stop offset="1" stop-color="#8A6A43" stop-opacity=".42"/></radialGradient>` +
    `<radialGradient id="${id('disc')}" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${pal.base}"/><stop offset=".6" stop-color="${pal.deep}"/><stop offset="1" stop-color="${pal.darker}"/></radialGradient>` +
    `<pattern id="${id('weave')}" patternUnits="userSpaceOnUse" x="${CX}" y="${CY}" width="${S}" height="${S}">${latticeTile(pal, S, bw)}</pattern>` +
    `<clipPath id="${id('panel')}"><path d="${panelD}"/></clipPath>` +
    `<mask id="${id('lm')}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
    `<path d="${wobblyCircle(CX, CY, HALO, rnd, 1.5, 48)}${circles(cornerCs, cornerR)}" fill="#000"/></mask>` +
    `<path id="${id('po')}" d="${petalOut}"/>` +
    `<g id="${id('motif')}" filter="url(#${id('rough')})">${motif}</g>` +
    `</defs>` +
    // owner margin
    `<rect width="${W}" height="${H}" fill="${pal.base}"/>` +
    `<rect width="${W}" height="${H}" filter="url(#${id('owash')})" opacity=".45"/>` +
    frameSvg() +
    // parchment panel
    `<path d="${panelD}" fill="${PAPER}"/>` +
    `<g clip-path="url(#${id('panel')})">` +
    `<g mask="url(#${id('lm')})"><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="url(#${id('weave')})" filter="url(#${id('rough2')})"/></g>` +
    `<g filter="url(#${id('rough2')})">` +
    `<path d="${lace}" fill="${pal.base}"/>` +
    `<path d="${ringPath(CX, CY, HALO - 2, HALO + 6, rnd, 1.3, 48)}" fill="${pal.deep}" fill-rule="evenodd"/>` +
    `<path d="${laceDots}" fill="${pal.base}" opacity=".85"/>` +
    `</g>` +
    `<rect width="${W}" height="${H}" filter="url(#${id('wash')})" opacity=".5"/>` +
    `<rect width="${W}" height="${H}" fill="url(#${id('vig')})"/>` +
    `<path d="${panelD}" fill="none" stroke="${pal.darker}" stroke-width="3" opacity=".5"/>` +
    `</g>` +
    // medallion
    `<circle cx="${CX}" cy="${CY + 7}" r="${MR + 14}" fill="#4A2E16" opacity=".32" filter="url(#${id('blur')})"/>` +
    `<g filter="url(#${id('rough2')})">` +
    `<g fill="${pal.deep}">${outer.join('')}</g>` +
    `<path d="${ringPath(CX, CY, bandIn, bandOut, rnd, 1.4, 48)}" fill="${CREAM}" fill-rule="evenodd"/>` +
    `<path d="${ser(teeth)}" fill="${pal.base}"/>` +
    `<path d="${toothDots}" fill="${CHILI}"/>` +
    `<path d="${wobblyCircle(CX, CY, bandIn + 1, rnd, 1.1, 40)}" fill="url(#${id('disc')})"/>` +
    `<path d="${ringPath(CX, CY, bandIn - 1.5, bandIn + 1.5, rnd, 1, 40)}${ringPath(CX, CY, bandOut - 1.5, bandOut + 1.5, rnd, 1, 40)}" fill="${pal.darker}" fill-rule="evenodd"/>` +
    `<path d="${ser(sprigs)}" fill="${GOLD}"/>` +
    `<path d="${ser(petals)}" fill="${CREAM}" stroke="${pal.darker}" stroke-width="2.4"/>` +
    `<path d="${ser(petalLines)}" fill="none" stroke="${GOLD}" stroke-width="1.8" opacity=".9"/>` +
    `<path d="${ser(star)}" fill="${GOLD}" stroke="${INK}" stroke-width="1.4"/>` +
    `<circle cx="${CX}" cy="${CY}" r="6" fill="${CHILI}" stroke="${INK}" stroke-width="1.4"/>` +
    `</g>` +
    place(v.bottle, -45) + place(v.chaat, 45) + place(v.khali, 225) + place(v.dahi, 135) +
    // wordmarks
    `<g fill="${pal.deep}" filter="url(#${id('rough2')})"><path d="${top}"/><path d="${bottom}"/></g>` +
    corners(id('motif'), 60) +
    `<rect width="${W}" height="${H}" filter="url(#${id('grain')})" opacity=".3"/>` +
    `</svg>`
  );
}
