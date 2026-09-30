/**
 * Card-back concept "Mithila folk" — Akabare Panipuri.
 *
 * Inspired by Mithila / Janakpur painting: bold double ink lines with hatched
 * fill, flat bright colours outlined in ink, fish, lotus, leaf vines.
 *
 *   Puri back  — owner-colour ground. A golden puri "sun" with a round akabare
 *                chili as its eye, ringed by flame rays; a pair of Mithila fish
 *                circle it head-to-tail inside a lotus-fringed medallion.
 *                Hatched double-line border with a turmeric scallop row.
 *   Power back — inverted: cream paper ground with owner-colour line work, a
 *                solid owner-colour sawtooth border, and an eight-petal lotus
 *                whose petals carry the four power symbols (each twice, on
 *                opposite petals, so the card has no "up").
 *
 * Every motif is point-symmetric about the card centre (drawn once, then
 * repeated with <use … rotate(180)>), and all wobble comes from a seeded PRNG,
 * so the output is stable and a 180° turn reveals nothing. Pure string
 * functions: no DOM, no fonts (wordmarks are outlined paths), no external refs.
 */

import type { ColorId } from '../../engine/types.ts';
import {
  PLAYER_PALETTE,
  CREAM,
  CREAM_BRIGHT,
  PAPER,
  INK,
  INK_SOFT,
  GOLD,
  CHILI,
  LEAF,
  PURI_GOLD,
  mixOklab,
  adjustOklch,
  contrastRatio,
} from '../palette.ts';
import { FRAME } from '../geometry.ts';
import { wordmarkSvg } from '../wordmarks.ts';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

const W = 750;
/** Peacock teal (the one hue outside the fronts' palette, used only for the bird). */
const PEACOCK = '#2C7A74';
const H = 1050;
const CX = 375;
const CY = 525;
const TAU = Math.PI * 2;

type Pt = [number, number];

const n1 = (v: number): string => String(Math.round(v * 10) / 10);
const pt = ([x, y]: Pt): string => `${n1(x)} ${n1(y)}`;
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth periodic noise in [-1, 1] with the given period (a few seeded sines). */
function periodicNoise(rand: () => number, period: number, harmonics = [1, 2, 3, 5]): (s: number) => number {
  const terms = harmonics.map((k) => ({ k, a: 0.4 + rand() * 0.6, p: rand() * TAU }));
  const norm = terms.reduce((s, t) => s + t.a, 0);
  return (s) => terms.reduce((acc, t) => acc + t.a * Math.sin((TAU * t.k * s) / period + t.p), 0) / norm;
}

/** Catmull-Rom spline through points → cubic Bézier path data. */
function smooth(pts: Pt[], closed: boolean, tension = 1): string {
  const n = pts.length;
  if (n < 2) return '';
  const get = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(pts[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? d + 'Z' : d;
}

const polyline = (pts: Pt[]): string => 'M' + pts.map(pt).join('L');

/** Polar → cartesian around the card centre. */
const polar = (r: number, a: number, cx = CX, cy = CY): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/** Hand-drawn circle: radius wobbles with π-periodic noise, so it stays exactly point-symmetric. */
function wobblyCircle(r: number, amp: number, seed: number, n = 40): string {
  const noise = periodicNoise(rng(seed), Math.PI, [1, 2, 3]);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push(polar(r + amp * noise(a), a));
  }
  return smooth(pts, true);
}

/** A ring of dots (even count → point-symmetric), as one round-capped path. */
function dotRing(r: number, n: number, color: string, size: number): string {
  let d = '';
  for (let i = 0; i < n; i++) d += `M${pt(polar(r, (i / n) * TAU))}h0.1`;
  return `<path d="${d}" stroke="${color}" stroke-width="${size}" stroke-linecap="round"/>`;
}

/** A slightly bowed hand-drawn line (one quadratic); bow = sideways offset of the midpoint. */
function bowLine(a: Pt, b: Pt, bow: number): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const c: Pt = [(a[0] + b[0]) / 2 - (dy / len) * bow, (a[1] + b[1]) / 2 + (dx / len) * bow];
  return `M${pt(a)}Q${pt(c)} ${pt(b)}`;
}

// ---------------------------------------------------------------------------
// Symmetry helpers (<use> keeps the SVG small)
// ---------------------------------------------------------------------------

const ROT = `rotate(180 ${CX} ${CY})`;
const MIRROR = `matrix(-1 0 0 1 ${W} 0)`;
/** Motif + its 180° rotation about the card centre. */
const sym = (id: string, inner: string): string => `<g id="${id}">${inner}</g><use href="#${id}" transform="${ROT}"/>`;
/** Motif in all four quadrants (mirror left↔right, then rotate 180°). */
const quad = (id: string, inner: string): string => sym(`${id}-h`, `<g id="${id}">${inner}</g><use href="#${id}" transform="${MIRROR}"/>`);

// ---------------------------------------------------------------------------
// Rounded-rect centre-line sampler (borders that follow the card frame)
// ---------------------------------------------------------------------------

interface FramePoint { p: Pt; t: Pt; n: Pt }
interface Frame { length: number; at(s: number): FramePoint; breaks: { s: number; len: number; arc: boolean }[] }

/** s = 0 at top centre, clockwise; t = unit tangent, n = unit INWARD normal. */
function roundedFrame(inset: number, r: number): Frame {
  const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
  const w = x1 - x0 - 2 * r, h = y1 - y0 - 2 * r;
  const q = (Math.PI / 2) * r;
  const arc = (cx: number, cy: number, a0: number) => (u: number) => {
    const a = a0 + u / r;
    return { p: [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt, t: [-Math.sin(a), Math.cos(a)] as Pt };
  };
  const segs: { len: number; f: (u: number) => { p: Pt; t: Pt } }[] = [
    { len: w / 2, f: (u) => ({ p: [CX + u, y0], t: [1, 0] }) },
    { len: q, f: arc(x1 - r, y0 + r, -Math.PI / 2) },
    { len: h, f: (u) => ({ p: [x1, y0 + r + u], t: [0, 1] }) },
    { len: q, f: arc(x1 - r, y1 - r, 0) },
    { len: w, f: (u) => ({ p: [x1 - r - u, y1], t: [-1, 0] }) },
    { len: q, f: arc(x0 + r, y1 - r, Math.PI / 2) },
    { len: h, f: (u) => ({ p: [x0, y1 - r - u], t: [0, -1] }) },
    { len: q, f: arc(x0 + r, y0 + r, Math.PI) },
    { len: w / 2, f: (u) => ({ p: [x0 + r + u, y0], t: [1, 0] }) },
  ];
  const length = segs.reduce((s, g) => s + g.len, 0);
  const breaks: { s: number; len: number; arc: boolean }[] = [];
  let acc = 0;
  segs.forEach((g, i) => {
    if (i === 4) {
      breaks.push({ s: acc, len: g.len / 2, arc: false }, { s: acc + g.len / 2, len: g.len / 2, arc: false });
    } else breaks.push({ s: acc, len: g.len, arc: i % 2 === 1 });
    acc += g.len;
  });
  return {
    length,
    breaks,
    at(s) {
      let u = ((s % length) + length) % length;
      let g = segs[segs.length - 1];
      for (const seg of segs) {
        if (u <= seg.len) { g = seg; break; }
        u -= seg.len;
      }
      const { p, t } = g.f(Math.min(u, g.len));
      return { p, t, n: [-t[1], t[0]] };
    },
  };
}

/** Evenly spaced stations along HALF a frame (the caller repeats them rotated 180°). */
function stations(f: Frame, spacing: number): FramePoint[] {
  const n = Math.round(f.length / spacing / 2);
  const out: FramePoint[] = [];
  for (let i = 0; i < n; i++) out.push(f.at((i + 0.5) * (f.length / 2 / n)));
  return out;
}

/** Wobbly closed line along a rounded frame (noise period = half the loop → point-symmetric). */
function frameLine(inset: number, r: number, amp: number, seed: number, step = 44): string {
  const f = roundedFrame(inset, r);
  const noise = periodicNoise(rng(seed), f.length / 2, [2, 3, 5, 7]);
  const pts: Pt[] = [];
  for (const b of f.breaks) {
    const k = b.arc ? 4 : Math.max(1, Math.round(b.len / step));
    for (let j = 0; j < k; j++) {
      const sv = b.s + (b.len * j) / k;
      const { p, n } = f.at(sv);
      pts.push(add(p, n, amp * noise(sv)));
    }
  }
  return smooth(pts, true);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

interface Tones {
  ground: string;
  deep: string;
  dark: string;
  light: string;
  /** Owner-colour line on cream (power back), ≥ 4:1 on the paper. */
  line: string;
  /** Owner ink (very dark owner hue) for outlines on the power back. */
  ink: string;
  leaf: string;
  paper: string;
  /** Second colour of the power lotus (gold, or chili where gold would melt into the owner colour). */
  accent: string;
  /** Devanagari wordmark fill on the puri back (gold unless gold melts into the ground). */
  deva: string;
}

function tones(color: ColorId): Tones {
  const p = PLAYER_PALETTE[color];
  // Power-back paper: cream with a breath of the owner's tint, so even the light card says whose it is.
  const paper = mixOklab(mixOklab(CREAM, PAPER, 0.35), p.light, 0.16);
  const line = contrastRatio(p.deep, paper) >= 4 ? p.deep : p.darker;
  // Leaves must read against every ground: on the green player's field they turn olive-gold.
  const leaf = color === 'green' ? adjustOklch(GOLD, { dl: -0.06, cMul: 0.85, dh: 22 }) : LEAF;
  const goldReads = contrastRatio(GOLD, p.base) >= 1.6;
  const accent = color === 'yellow' ? CHILI : GOLD;
  const deva = goldReads ? GOLD : color === 'yellow' ? CHILI : CREAM_BRIGHT;
  return { ground: p.base, deep: p.deep, dark: p.darker, light: p.light, line, ink: p.ink, leaf, paper, accent, deva };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const rgb = (hex: string): string[] => [1, 3, 5].map((i) => String(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000));

/**
 * Gouache texture overlay (ignores its source graphic): soft pigment pooling
 * (light + dark, low frequency) and fine paper tooth (high frequency).
 */
function textureFilter(id: string, seed: number, light: string, dark: string, mottle: number, tooth: number): string {
  const [lr, lg, lb] = rgb(light);
  const [dr, dg, db] = rgb(dark);
  const k = (v: number): string => String(Math.round(v * 1000) / 1000);
  // alpha = slope·noise + offset; fractal noise sits around 0.5 ± 0.15
  const m = (ch: string) => `${ch === 'r' ? k(mottle * 1.6) : 0} ${ch === 'g' ? k(mottle * 1.6) : 0} 0 0 ${k(-mottle * 0.74)}`;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves="4" seed="${seed}" result="m"/>` +
    `<feColorMatrix in="m" type="matrix" values="0 0 0 0 ${lr} 0 0 0 0 ${lg} 0 0 0 0 ${lb} ${m('r')}" result="hi"/>` +
    `<feColorMatrix in="m" type="matrix" values="0 0 0 0 ${dr} 0 0 0 0 ${dg} 0 0 0 0 ${db} ${m('g')}" result="lo"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed + 11}" result="g"/>` +
    `<feColorMatrix in="g" type="matrix" values="0 0 0 0 ${dr} 0 0 0 0 ${dg} 0 0 0 0 ${db} 0 0 ${k(-tooth * 3)} 0 ${k(tooth * 1.3)}" result="sd"/>` +
    `<feColorMatrix in="g" type="matrix" values="0 0 0 0 ${lr} 0 0 0 0 ${lg} 0 0 0 0 ${lb} ${k(tooth * 3)} 0 0 0 ${k(-tooth * 1.7)}" result="sl"/>` +
    `<feMerge><feMergeNode in="hi"/><feMergeNode in="lo"/><feMergeNode in="sd"/><feMergeNode in="sl"/></feMerge>` +
    `</filter>`;
}

/** Slight ink wobble for all line work (hand-drawn edges). */
function inkFilter(id: string, seed: number, scale = 3): string {
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-8" y="-8" width="${W + 16}" height="${H + 16}">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}" result="w"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;
}

/** The fronts' double cream rounded border, exactly. */
function creamFrame(): string {
  const o = FRAME.outer, i = FRAME.inner;
  return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r}" fill="none" stroke="${CREAM}" stroke-width="${o.stroke}"/>` +
    `<rect x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}" rx="${i.r}" fill="none" stroke="${CREAM}" stroke-width="${i.stroke}"/>`;
}

// ---------------------------------------------------------------------------
// Motif library
// ---------------------------------------------------------------------------

/** Hatch strokes across a band that follows a rounded frame (half the loop). */
function hatchBand(inset0: number, inset1: number, r: number, spacing: number, skew: number, seed: number): string {
  const half = (inset1 - inset0) / 2 - 0.6;
  const rand = rng(seed);
  let d = '';
  for (const { p, t, n } of stations(roundedFrame((inset0 + inset1) / 2, r), spacing)) {
    const j = (rand() - 0.5) * 1.4;
    const k = skew + (rand() - 0.5) * 1.8;
    const c = add(p, t, j);
    d += `M${pt(add(add(c, n, -half), t, -k))}L${pt(add(add(c, n, half), t, k))}`;
  }
  return d;
}

/** Pointed petal/leaf in local coords: base at (0,0), tip at (0,-len), half-width ≈ hw. */
function petalPath(len: number, hw: number, belly = 0.45): string {
  const y = -len * belly - len * 0.2;
  return `M0 0C${n1(hw * 1.1)} ${n1(-len * 0.08)} ${n1(hw * 1.05)} ${n1(y)} 0 ${n1(-len)}C${n1(-hw * 1.05)} ${n1(y)} ${n1(-hw * 1.1)} ${n1(-len * 0.08)} 0 0Z`;
}

/** Petal like petalPath but in absolute coordinates: base point, pointing along angle a (radians). */
function petalAt(base: Pt, a: number, len: number, hw: number, belly = 0.45): string {
  const c = Math.cos(a), sn = Math.sin(a);
  // local (x, y) with tip at (0, -len): world = base + x·(−sin a, cos a) + (−y)·(cos a, sin a)
  const P = (x: number, y: number): string => pt([base[0] - x * sn - y * c, base[1] + x * c - y * sn]);
  const y = -len * belly - len * 0.2;
  return `M${P(0, 0)}C${P(hw * 1.1, -len * 0.08)} ${P(hw * 1.05, y)} ${P(0, -len)}C${P(-hw * 1.05, y)} ${P(-hw * 1.1, -len * 0.08)} ${P(0, 0)}Z`;
}

/** Leaf with midrib + side veins, local coords like petalPath. */
function leaf(len: number, hw: number, fill: string, ink: string, sw = 2.2): string {
  let veins = `M0 ${n1(-len * 0.08)}L0 ${n1(-len * 0.84)}`;
  for (let i = 1; i <= 3; i++) {
    const y = -len * (0.16 + i * 0.17);
    veins += `M0 ${n1(y)}L${n1(hw * 0.55)} ${n1(y - len * 0.1)}M0 ${n1(y)}L${n1(-hw * 0.55)} ${n1(y - len * 0.1)}`;
  }
  return `<path d="${petalPath(len, hw, 0.35)}" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>` +
    `<path d="${veins}" fill="none" stroke="${ink}" stroke-width="${n1(sw * 0.6)}" stroke-linecap="round"/>`;
}

/** Flame ray (curling triangle) standing on a circle — the puri sun's rays. */
function flameRay(r0: number, r1: number, a: number, w: number, curl: number): string {
  const b1 = polar(r0, a - w / 2), b2 = polar(r0, a + w / 2), tip = polar(r1, a + curl);
  const c1 = polar(r0 + (r1 - r0) * 0.45, a - w * 0.42 + curl * 0.15);
  const c2 = polar(r0 + (r1 - r0) * 0.85, a - w * 0.05 + curl * 0.55);
  const c3 = polar(r0 + (r1 - r0) * 0.7, a + w * 0.2 + curl * 0.7);
  const c4 = polar(r0 + (r1 - r0) * 0.3, a + w * 0.55 + curl * 0.2);
  return `M${pt(b1)}C${pt(c1)} ${pt(c2)} ${pt(tip)}C${pt(c3)} ${pt(c4)} ${pt(b2)}Z`;
}

/** Map a local point (u along the arc, v outward) onto a ring of radius R starting at angle a0. */
const ringMap = (R: number, a0: number) => ([u, v]: Pt): Pt => polar(R + v, a0 + u / R);

/**
 * A Mithila fish bent around a ring: almond body with cross-hatched scales and
 * a dotted spine, golden head with a big eye, chili fins, forked tail, and
 * three bubbles in front of its mouth.
 */
function fish(id: string, R: number, a0: number, len: number, hw: number, ink: string, seed: number): string {
  const map = ringMap(R, a0);
  const ped = len * 0.19; // peduncle (tail joint)
  const bodyHalf = (u: number): number => {
    const t = Math.min(1, Math.max(0, (u - ped) / (len - ped)));
    return hw * (0.2 * (1 - t) + Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.62) * 0.92);
  };
  const N = 22;
  const upper: Pt[] = [], lower: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const u = ped + ((len - ped) * i) / N;
    const h = i === N ? 0 : bodyHalf(u);
    upper.push([u, h]);
    lower.push([u, -h]);
  }
  const body = smooth([...upper, ...lower.slice(0, -1).reverse()].map(map), true);

  // head: gill line (bulging toward the tail) to the nose
  const ug = ped + (len - ped) * 0.72;
  const hg = bodyHalf(ug);
  const head = smooth(
    [[ug, hg] as Pt, ...upper.filter(([u]) => u > ug), ...lower.filter(([u]) => u > ug).slice(0, -1).reverse(), [ug, -hg] as Pt, [ug - hw * 0.3, -hg * 0.55] as Pt, [ug - hw * 0.4, 0] as Pt, [ug - hw * 0.3, hg * 0.55] as Pt].map(map),
    true,
  );
  // second gill line (Mithila double outline)
  const gill2 = smooth(([[ug + 7, hg * 0.86], [ug - hw * 0.28, 0], [ug + 7, -hg * 0.86]] as Pt[]).map(map), false);

  // cross-hatched scales in local space, clipped to the body
  const rand = rng(seed);
  let hatch = '';
  const sp = 9.5;
  for (let c = ped - hw * 1.6; c < ug + hw * 1.6; c += sp) {
    for (const dir of [1, -1]) {
      const a: Pt = [c - hw * 1.2, -hw * 1.2 * dir];
      const b: Pt = [c + hw * 1.2, hw * 1.2 * dir];
      hatch += polyline([a, [(a[0] + b[0]) / 2 + (rand() - 0.5), 0] as Pt, b].map(map));
    }
  }
  const spine: Pt[] = [];
  for (let i = 0; i <= 8; i++) spine.push(map([ped + 8 + ((ug - ped - 16) * i) / 8, 0]));

  // fins (outer side larger) and tail
  const fin = (u0: number, u1: number, side: 1 | -1, reach: number): string => {
    const um = u0 + (u1 - u0) * 0.4;
    const h0 = bodyHalf(u0) * side * 0.9, h1 = bodyHalf(u1) * side * 0.9;
    const tip: Pt = [um - (u1 - u0) * 0.3, (bodyHalf(um) + reach) * side];
    const finPts: Pt[] = [[u0, h0], [(u0 + tip[0]) / 2, (h0 + tip[1]) / 2 + side * 2], tip, [(tip[0] + u1) / 2 + 5, (tip[1] + h1) / 2], [u1, h1]];
    return smooth(finPts.map(map), false) + 'Z';
  };
  const L = len - ped;
  const fins = fin(ped + L * 0.3, ped + L * 0.52, 1, hw * 0.42) + fin(ped + L * 0.34, ped + L * 0.5, -1, hw * 0.34);
  const tailLocal: Pt[] = [[ped + 5, hw * 0.22], [ped * 0.55, hw * 0.52], [0, hw * 0.92], [ped * 0.3, hw * 0.3], [ped * 0.42, 0], [ped * 0.3, -hw * 0.3], [0, -hw * 0.92], [ped * 0.55, -hw * 0.52], [ped + 5, -hw * 0.22]];
  const tail = smooth(tailLocal.map(map), true, 0.8);
  let tailLines = '';
  for (const v of [-0.7, -0.3, 0.3, 0.7]) tailLines += polyline([map([ped * 0.95, v * hw * 0.36]), map([ped * 0.22, v * hw * 1.06])]);

  const eyeC = map([ug + (len - ug) * 0.4, hw * 0.16]);
  const eyeR = hw * 0.25;
  const circ = (c: Pt, r: number, attrs: string) => `<circle cx="${n1(c[0])}" cy="${n1(c[1])}" r="${n1(r)}" ${attrs}/>`;
  const bubbles = [8, 22, 38].map((du, i) => circ(map([len + du, hw * (0.1 - i * 0.12)]), 4.4 - i * 1.1, `fill="${CREAM_BRIGHT}" stroke="${ink}" stroke-width="1.6"`)).join('');

  return `<clipPath id="${id}-clip"><path d="${body}"/></clipPath>` +
    `<path d="${tail}" fill="${CHILI}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${tailLines}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="${fins}" fill="${CHILI}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="${body}" fill="${CREAM_BRIGHT}" stroke="${ink}" stroke-width="3.2" stroke-linejoin="round"/>` +
    `<path d="${hatch}" clip-path="url(#${id}-clip)" fill="none" stroke="${ink}" stroke-width="1.2" opacity=".75"/>` +
    `<path d="${smooth(spine, false)}" fill="none" stroke="${CHILI}" stroke-width="4.4" stroke-linecap="round" stroke-dasharray="0.1 9"/>` +
    `<path d="${head}" fill="${GOLD}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="${gill2}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    circ(eyeC, eyeR, `fill="${CREAM_BRIGHT}" stroke="${ink}" stroke-width="2.4"`) +
    circ(eyeC, eyeR * 0.46, `fill="${ink}"`) +
    bubbles;
}

/**
 * A small Mithila peacock facing +x, origin at the body: sweeping cream train
 * with eye-spots, owner-contrasting body, golden hatched wing, crest of three.
 */
function peacock(ink: string, body: string, eyeC: string): string {
  const train = 'M-6 -8C-26 -12 -52 -6 -66 14C-72 24 -68 38 -58 44C-44 44 -22 34 -6 12Z';
  let barbs = '';
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const e: Pt = [-58 + t * 4 - Math.sin(t * Math.PI) * 10, 40 - t * 44];
    barbs += `M-6 2L${pt(e)}`;
  }
  const eyes = ([[-50, 32], [-56, 12], [-34, 20]] as Pt[]).map(([x, y], i) =>
    `<path d="M${x} ${y - 7.5}C${x + 6} ${y - 5} ${x + 6} ${y + 5} ${x} ${y + 7}C${x - 6} ${y + 5} ${x - 6} ${y - 5} ${x} ${y - 7.5}Z" fill="${GOLD}" stroke="${ink}" stroke-width="1.6"/>` +
    `<circle cx="${x}" cy="${y + 0.6}" r="${i === 2 ? 3 : 3.4}" fill="${eyeC}"/>`).join('');
  return `<path d="${train}" fill="${CREAM}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="${barbs}" fill="none" stroke="${ink}" stroke-width="1.1" opacity=".7"/>` + eyes +
    `<path d="M0 10L-3 25M-7 25L1 25M6 9L7 25M3 25L11 25" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M4 -8C10 -16 10 -26 14 -33L23 -31C19 -24 19 -12 16 -1Z" fill="${body}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="M16 -6C14 10 -2 16 -14 9C-21 3 -13 -10 0 -10C8 -10 16 -12 16 -6Z" fill="${body}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="M-9 -3C-1 -8 9 -3 5 6C-1 9 -10 5 -9 -3Z" fill="${GOLD}" stroke="${ink}" stroke-width="1.6"/>` +
    `<path d="M-5 -1L1 5M-1 -3L5 3M-7 3L-3 7" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/>` +
    `<path d="M17 -40L11 -50M18.5 -40L17 -52M20 -40L23 -50" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="11" cy="-50" r="2.2" fill="${CHILI}"/><circle cx="17" cy="-52.5" r="2.2" fill="${CHILI}"/><circle cx="23" cy="-50" r="2.2" fill="${CHILI}"/>` +
    `<path d="M24 -36L32 -33L24 -30Z" fill="${GOLD}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<circle cx="18.5" cy="-34" r="6.8" fill="${body}" stroke="${ink}" stroke-width="2.2"/>` +
    `<circle cx="20" cy="-35" r="2.4" fill="${CREAM_BRIGHT}"/><circle cx="20.6" cy="-35" r="1.1" fill="${ink}"/>`;
}

/** Six-lobed calyx star at the card centre. */
function sixStar(r: number, rIn: number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < 12; i++) pts.push(polar(i % 2 ? rIn : r, (i / 12) * TAU - Math.PI / 2));
  return smooth(pts, true, 0.5);
}

// ---------------------------------------------------------------------------
// PURI BACK
// ---------------------------------------------------------------------------

export function puriBackSvg(color: ColorId): string {
  const T = tones(color);
  const id = `mf-pb-${color}`;
  const ink = INK;

  // --- border: cream band between two ink lines, hatched; turmeric scallops inside
  const bandO = 50, bandI = 71, bandR = 24;
  let scallops = '';
  for (const { p, t, n } of stations(roundedFrame(bandI + 1.5, bandR - 6), 21)) {
    const b1 = add(p, t, -7.5), b2 = add(p, t, 7.5);
    scallops += `M${pt(b1)}C${pt(add(b1, n, 12))} ${pt(add(b2, n, 12))} ${pt(b2)}Z`;
  }
  const border =
    `<path d="${frameLine((bandO + bandI) / 2, bandR, 0.5, 3)}" fill="none" stroke="${CREAM}" stroke-width="${bandI - bandO}"/>` +
    sym(`${id}-hb`, `<path d="${hatchBand(bandO, bandI, bandR, 6.4, 5, 17)}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<path d="${scallops}" fill="${GOLD}" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>`) +
    `<path d="${frameLine(bandO, bandR + 4, 0.9, 5)}" fill="none" stroke="${ink}" stroke-width="3"/>` +
    `<path d="${frameLine(bandI, bandR - 4, 0.9, 7)}" fill="none" stroke="${ink}" stroke-width="3"/>`;

  // --- corner flourish: chili flame flower pointing into the corner, a curling
  //     vine with leaves along each edge (mirrored about the corner diagonal)
  const arm =
    `<path d="M40 40C62 30 96 16 138 20C160 22 170 36 160 46C152 53 142 46 148 40" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<g transform="translate(76 27) rotate(-8)">${leaf(30, 8, CREAM, ink, 2)}</g>` +
    `<g transform="translate(104 21) rotate(112)">${leaf(28, 8, T.leaf, ink, 2)}</g>` +
    `<g transform="translate(134 21) rotate(24)">${leaf(22, 7, CREAM, ink, 2)}</g>`;
  const flame =
    `<g transform="translate(34 34) rotate(-45)">` +
    `<path d="M0 12C-15 2 -13 -18 0 -38C13 -18 15 2 0 12Z" fill="${CHILI}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="M0 5C-7 -1 -6 -12 0 -23C6 -12 7 -1 0 5Z" fill="${GOLD}" stroke="${ink}" stroke-width="1.6"/></g>` +
    `<circle cx="44" cy="44" r="5" fill="${GOLD}" stroke="${ink}" stroke-width="1.8"/>`;
  const cool = color === 'blue' || color === 'green';
  const filler = `<g transform="translate(184 292) scale(1.2)">${peacock(ink, cool ? CHILI : PEACOCK, cool ? PEACOCK : CHILI)}</g>`;
  const corners = quad(`${id}-c`, `<g transform="translate(88 88)">${arm}<g transform="matrix(0 1 1 0 0 0)">${arm}</g>${flame}</g>${filler}`);

  // --- medallion (from the outside in)
  const fringeR = 236;
  let fringe = '', fringeIn = '';
  const nF = 40;
  for (let i = 0; i < nF; i++) {
    const a = (i / nF) * TAU;
    fringe += petalAt(polar(fringeR - 3, a), a, 27, 16, 0.3);
    fringeIn += `M${pt(polar(fringeR, a))}L${pt(polar(fringeR + 14, a))}`;
  }
  const rays = (() => {
    const n = 16;
    let red = '', gold = '', veins = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const d = flameRay(102, 150, a, (TAU / n) * 0.92, 0.13);
      if (i % 2) red += d; else gold += d;
      veins += `M${pt(polar(108, a + 0.01))}Q${pt(polar(126, a + 0.03))} ${pt(polar(138, a + 0.09))}`;
    }
    return `<path d="${gold}" fill="${GOLD}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<path d="${red}" fill="${CHILI}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<path d="${veins}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`;
  })();

  const puri = (() => {
    const rand = rng(41);
    let blisters = '';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI + rand() * 0.15;
      const r = 64 + (i % 3) * 9 + rand() * 4;
      const [x, y] = polar(r, a);
      const s = 3 + rand() * 2.5;
      blisters += `M${n1(x - s)} ${n1(y)}q${n1(s)} ${n1(-s * 1.1)} ${n1(s * 2)} 0`;
      blisters += `M${n1(2 * CX - x + s)} ${n1(2 * CY - y)}q${n1(-s)} ${n1(s * 1.1)} ${n1(-s * 2)} 0`;
    }
    // broken-open top: jagged dark hole (teeth repeat every half turn → point-symmetric)
    const jr = rng(8);
    const nT = 24;
    const jag: number[] = [];
    for (let i = 0; i < nT / 2; i++) jag.push(jr());
    const hole: Pt[] = [];
    for (let i = 0; i < nT; i++) hole.push(polar(i % 2 ? 53 + jag[i % (nT / 2)] * 4 : 46 + jag[i % (nT / 2)] * 3, (i / nT) * TAU));
    return `<path d="${wobblyCircle(100, 1.2, 12, 36)}" fill="${PURI_GOLD.mid}" stroke="${ink}" stroke-width="3.4"/>` +
      `<path d="${wobblyCircle(89, 1.2, 13, 36)}" fill="${PURI_GOLD.light}"/>` +
      `<path d="${blisters}" fill="none" stroke="${PURI_GOLD.deep}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="${polyline(hole)}Z" fill="${ink}" stroke="${PURI_GOLD.deep}" stroke-width="2.4" stroke-linejoin="round"/>` +
      // akabare chili seen from above: red cherry with a six-lobed calyx
      `<circle cx="${CX}" cy="${CY}" r="35" fill="${CHILI}" stroke="${ink}" stroke-width="3"/>` +
      `<path d="${wobblyCircle(27, 0.6, 21, 24)}" fill="none" stroke="${adjustOklch(CHILI, { dl: 0.12, cMul: 0.9 })}" stroke-width="3.4"/>` +
      `<path d="${sixStar(15, 6.5)}" fill="${LEAF}" stroke="${ink}" stroke-width="2"/>` +
      `<circle cx="${CX}" cy="${CY}" r="3.8" fill="${ink}"/>`;
  })();

  const medallion =
    `<path d="${fringe}" fill="${CREAM}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="${fringeIn}" fill="none" stroke="${CHILI}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="${wobblyCircle(fringeR, 1.2, 33, 48)}" fill="${T.deep}" stroke="${ink}" stroke-width="3.4"/>` +
    dotRing(fringeR - 11, 176, CREAM, 2.4) +
    sym(`${id}-fish`, fish(`${id}-f`, 190, -Math.PI / 2 - 0.3, 392, 30, ink, 77)) +
    `<path d="${wobblyCircle(154, 1, 37, 40)}" fill="${T.dark}" stroke="${ink}" stroke-width="2.6"/>` +
    rays +
    puri;

  // --- wordmark (top, and the same again rotated 180° at the bottom)
  const titleY = 176;
  const words =
    wordmarkSvg('AKABARE PANIPURI', { x: CX, y: titleY, height: 26, tracking: 2.5, fill: CREAM_BRIGHT, stroke: ink, strokeWidth: 4.5 }) +
    wordmarkSvg('अकबरे पानीपुरी', { x: CX, y: titleY + 42, height: 17, tracking: 12, fill: T.deva, stroke: ink, strokeWidth: 4 });
  const dots = [-1, 1].map((s) => `<circle cx="${CX + s * 112}" cy="${titleY + 31}" r="3.6" fill="${CHILI}" stroke="${ink}" stroke-width="1.5"/><circle cx="${CX + s * 126}" cy="${titleY + 31}" r="2.4" fill="${CREAM}"/>`).join('');
  const wordmark = sym(`${id}-w`, words + dots);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>${textureFilter(`${id}-tex`, 5, CREAM, T.dark, 0.24, 0.36)}${inkFilter(`${id}-ink`, 9)}</defs>` +
    `<rect width="${W}" height="${H}" fill="${T.ground}"/>` +
    `<rect width="${W}" height="${H}" fill="#000" filter="url(#${id}-tex)"/>` +
    `<g filter="url(#${id}-ink)">${border}${corners}${medallion}${wordmark}</g>` +
    creamFrame() +
    `</svg>`;
}

// ---------------------------------------------------------------------------
// POWER BACK
// ---------------------------------------------------------------------------

/**
 * The four power symbols, local coords centred at (0,0), "up" = −y (outward on the lotus),
 * about 56 units tall: vinegar bottle, dahi bowl, khali (empty puri), chaat bowl.
 */
function powerSymbols(id: string, L: string, ink: string): string {
  const s = `stroke="${ink}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;
  const bottle = 'M-5 -16L-5 -8C-17 -4 -20 6 -18 14C-16 24 16 24 18 14C20 6 17 -4 5 -8L5 -16Z';
  const vinegar = `<path d="${bottle}" fill="${CREAM_BRIGHT}"/>` +
    `<path d="M-17.6 8C-10 4 10 11 17.6 8C18 16 12 21.5 0 21.5C-12 21.5 -18 16 -17.6 8Z" fill="${GOLD}"/>` +
    `<path d="M-9 -2C-12 2 -13 6 -13 9" fill="none" stroke="#FFFDF4" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="${bottle}" fill="none" ${s}/>` +
    `<rect x="-7" y="-26" width="14" height="10" rx="2.5" fill="${PURI_GOLD.deep}" ${s}/>` +
    `<path d="M-5 -12L5 -12" stroke="${L}" stroke-width="2"/>` +
    `<circle cx="-5" cy="14" r="1.6" fill="${ink}"/><circle cx="4" cy="16" r="1.4" fill="${ink}"/><circle cx="9" cy="11" r="1.2" fill="${ink}"/>`;
  const dahi = `<path d="M5 -6L17 -27" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<ellipse cx="18" cy="-28" rx="4.2" ry="6.4" transform="rotate(30 18 -28)" fill="${CREAM_BRIGHT}" ${s}/>` +
    `<path d="M-21 0C-19 -16 19 -16 21 0Z" fill="#FFFDF4" ${s}/>` +
    `<path d="M-8 -6C-3 -11 4 -10 7 -5" fill="none" stroke="${L}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M-25 0L25 0C23 14 13 20 0 20C-13 20 -23 14 -25 0Z" fill="${L}" ${s}/>` +
    `<path d="M-8 20L-10 25L10 25L8 20" fill="${L}" ${s}/>` +
    `<path d="M-15 7L-9 9M-3 11L3 11M9 9L15 7" stroke="${CREAM}" stroke-width="2" stroke-linecap="round"/>`;
  const khali = `<circle cx="0" cy="4" r="21" fill="${PURI_GOLD.light}" ${s}/>` +
    `<path d="M-16 -6L-13 -12L-9 -10L-6 -15L-1 -12L3 -16L7 -12L11 -14L14 -9L17 -6L14 -1L9 1L3 0L-3 2L-9 0L-14 -1Z" fill="${PURI_GOLD.mid}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M-11 -5L-8 -9L-3 -8L1 -11L5 -8L10 -9L12 -5L8 -2L-1 -1L-8 -2Z" fill="${ink}"/>` +
    `<path d="M-12 12q2 -2 4 0M6 16q2 -2 4 0M12 6q2 -2 4 0M-4 20q2 -2 4 0M-1 9q2 -2 4 0" fill="none" stroke="${PURI_GOLD.deep}" stroke-width="1.6" stroke-linecap="round"/>`;
  const chaat = `<circle cx="-10" cy="-5" r="8.5" fill="${PURI_GOLD.light}" ${s}/><circle cx="10" cy="-5" r="8.5" fill="${PURI_GOLD.light}" ${s}/><circle cx="0" cy="-13" r="8.5" fill="${PURI_GOLD.mid}" ${s}/>` +
    `<circle cx="-4" cy="-6" r="2.4" fill="${CHILI}"/><circle cx="6" cy="-14" r="2.2" fill="${CHILI}"/><circle cx="13" cy="-8" r="2" fill="${LEAF}"/><circle cx="-12" cy="-11" r="2" fill="${LEAF}"/>` +
    `<path d="M-27 0L27 0C25 12 15 17 0 17C-15 17 -25 12 -27 0Z" fill="${CREAM_BRIGHT}" ${s}/>` +
    `<path d="M-17 7C-11 11 -5 11 0 7C5 11 11 11 17 7" fill="none" stroke="${CHILI}" stroke-width="2" stroke-linecap="round"/>`;
  return [vinegar, dahi, khali, chaat].map((g, i) => `<g id="${id}-s${i}">${g}</g>`).join('');
}

export function powerBackSvg(color: ColorId): string {
  const T = tones(color);
  const id = `mf-pw-${color}`;
  const L = T.line;
  const ink = T.ink;

  // --- solid owner-colour band with a cream sawtooth pointing outward from the field
  const bandI = 88, fieldR = 16;
  const field = `<rect x="${bandI}" y="${bandI}" width="${W - 2 * bandI}" height="${H - 2 * bandI}" rx="${fieldR}" fill="${T.paper}"/>`;
  let teeth = '', dots = '';
  for (const { p, t, n } of stations(roundedFrame(bandI - 1, fieldR), 23)) {
    teeth += `M${pt(add(p, t, -8.5))}L${pt(add(p, n, -22))}L${pt(add(p, t, 8.5))}Z`;
    const q = add(add(p, t, 11.5), n, -26);
    dots += `M${pt(q)}h0.1`;
  }
  const sawtooth = sym(`${id}-st`,
    `<path d="${teeth}" fill="${CREAM}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${dots}" stroke="${CREAM}" stroke-width="4.6" stroke-linecap="round"/>`);
  const fieldEdge = `<path d="${frameLine(bandI, fieldR, 0.7, 51)}" fill="none" stroke="${ink}" stroke-width="3"/>` +
    `<path d="${frameLine(bandI + 9, fieldR - 8, 0.7, 53)}" fill="none" stroke="${L}" stroke-width="1.6"/>`;

  // --- faint diamond lattice (kachni line work) on the cream field
  let lattice = '';
  {
    // Lines x − y = c and x + y = c + H with c = c0 + k·step; c0 puts line 0 through the
    // card centre, so a half turn maps line k onto line −k. Their bows are equal and
    // opposite (a half turn reverses a line's direction), so the lattice is point-symmetric.
    const step = 46;
    const c0 = (W - H) / 2;
    for (let k = -24; k <= 24; k++) {
      const c = c0 + k * step;
      if (c + H < 0 || c > W) continue;
      const r = rng(61 + Math.abs(k));
      const sgn = Math.sign(k);
      lattice += bowLine([c, 0], [c + H, H], sgn * (r() - 0.5) * 5) + bowLine([c, H], [c + H, 0], sgn * (r() - 0.5) * 5);
    }
  }
  const x0 = bandI + 12;
  const latticeSvg = `<clipPath id="${id}-fc"><rect x="${x0}" y="${x0}" width="${W - 2 * x0}" height="${H - 2 * x0}" rx="8"/></clipPath>` +
    `<path clip-path="url(#${id}-fc)" d="${lattice}" fill="none" stroke="${T.light}" stroke-width="1.5"/>`;

  // --- the eight-petal lotus
  const lotus = (() => {
    const r0 = 72;
    let back = '', petals = '', panels = '', symbols = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const deg = n1((a * 180) / Math.PI + 90);
      const base = pt(polar(r0 - 6, a));
      petals += `<path transform="translate(${base}) rotate(${deg})" d="${petalPath(160, 47, 0.3)}"/>`;
      panels += `<path transform="translate(${base}) rotate(${deg}) translate(0 -16) scale(.76)" d="${petalPath(160, 47, 0.3)}"/>`;
      symbols += `<use href="#${id}-s${i % 4}" transform="translate(${pt(polar(r0 + 70, a))}) rotate(${deg}) scale(1.28)"/>`;
      const a2 = a + TAU / 16;
      back += `<path transform="translate(${pt(polar(r0 - 4, a2))}) rotate(${n1((a2 * 180) / Math.PI + 90)})" d="${petalPath(126, 27, 0.35)}"/>`;
    }
    return `<path d="${wobblyCircle(244, 1.2, 71, 48)}" fill="none" stroke="${L}" stroke-width="2.6"/>` +
      dotRing(254, 176, L, 2.4) +
      `<g fill="${T.accent}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round">${back}</g>` +
      `<g fill="${T.ground}" stroke="${ink}" stroke-width="3" stroke-linejoin="round">${petals}</g>` +
      `<g fill="${T.paper}" stroke="${ink}" stroke-width="1.4">${panels}</g>` +
      symbols +
      `<path d="${wobblyCircle(r0, 1, 75, 32)}" fill="${T.accent}" stroke="${ink}" stroke-width="3"/>` +
      `<path d="${wobblyCircle(r0 - 14, 0.8, 77, 28)}" fill="${T.ground}" stroke="${ink}" stroke-width="2.2"/>` +
      fourPetal(40, T.paper, ink) +
      `<circle cx="${CX}" cy="${CY}" r="7" fill="${CHILI}" stroke="${ink}" stroke-width="2"/>`;
  })();

  // --- corners: a quarter lotus fanning out of each field corner
  const cornerFan = (() => {
    let pet = '', inner = '';
    const o: Pt = [bandI + 12, bandI + 12];
    for (const deg of [112, 135, 158]) {
      const a = ((deg - 90) * Math.PI) / 180;
      const len = deg === 135 ? 70 : 54;
      pet += petalAt(o, a, len, 15, 0.3);
      inner += petalAt(add(o, [Math.cos(a), Math.sin(a)], 12), a, len * 0.62, 8, 0.3);
    }
    return `<path d="${pet}" fill="${T.ground}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="${inner}" fill="${T.accent}" stroke="${ink}" stroke-width="1.4"/>` +
      `<circle cx="${o[0]}" cy="${o[1]}" r="13" fill="${T.accent}" stroke="${ink}" stroke-width="2.2"/><circle cx="${o[0]}" cy="${o[1]}" r="4.5" fill="${T.ground}"/>`;
  })();
  // small owner-colour four-petal flowers in the diagonal gaps (echo the lotus centre)
  const fc: Pt = [150, 298];
  let fp = '', fi = '';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    fp += petalAt(fc, a, 26, 10, 0.35);
    fi += `M${pt(polar(7, a, fc[0], fc[1]))}L${pt(polar(18, a, fc[0], fc[1]))}`;
  }
  let fd = '';
  for (let i = 0; i < 4; i++) fd += `M${pt(polar(27, (i * Math.PI) / 2, fc[0], fc[1]))}h0.1`;
  const gapFlower = `<path d="${fp}" fill="${T.ground}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="${fi}" stroke="${T.paper}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="${fd}" stroke="${T.accent}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="${fc[0]}" cy="${fc[1]}" r="6" fill="${T.accent}" stroke="${ink}" stroke-width="1.6"/>`;
  const corners = quad(`${id}-c`, cornerFan + gapFlower);

  // --- label (top, and the same rotated at the bottom)
  const titleY = 182;
  const words =
    wordmarkSvg('POWER', { x: CX, y: titleY, height: 40, tracking: 9, fill: T.ground, stroke: ink, strokeWidth: 4.5 }) +
    wordmarkSvg('शक्ति', { x: CX, y: titleY + 46, height: 22, fill: L });
  const flank = [-1, 1].map((s) => `<path d="M${CX + s * 42} ${titleY + 33}l${s * 8} -5l${s * 8} 5l${-s * 8} 5Z" fill="${GOLD}" stroke="${ink}" stroke-width="1.4"/><circle cx="${CX + s * 70}" cy="${titleY + 33}" r="3" fill="${L}"/>`).join('');
  const label = sym(`${id}-w`, words + flank);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>${textureFilter(`${id}-tex`, 15, CREAM_BRIGHT, INK_SOFT, 0.16, 0.2)}${inkFilter(`${id}-ink`, 19)}${powerSymbols(id, L, ink)}</defs>` +
    `<rect width="${W}" height="${H}" fill="${T.ground}"/>` +
    field +
    `<rect width="${W}" height="${H}" fill="#000" filter="url(#${id}-tex)"/>` +
    `<g filter="url(#${id}-ink)">${latticeSvg}${sawtooth}${fieldEdge}${corners}${lotus}${label}</g>` +
    creamFrame() +
    `</svg>`;
}

/** Simple four-petal flower at the card centre. */
function fourPetal(r: number, fill: string, ink: string): string {
  let d = '';
  for (let i = 0; i < 4; i++) d += `<path transform="translate(${CX} ${CY}) rotate(${45 + i * 90})" d="${petalPath(r, r * 0.42, 0.4)}"/>`;
  return `<g fill="${fill}" stroke="${ink}" stroke-width="2" stroke-linejoin="round">${d}</g>`;
}
