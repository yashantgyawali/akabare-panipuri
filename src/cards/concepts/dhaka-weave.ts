/**
 * Card-back concept "Dhaka weave".
 *
 * Inspired by Nepali Dhaka cloth (topi / shawl weaving): stepped, slightly
 * irregular geometric bands and lozenges woven in the owner colour with
 * cream, ink and turmeric threads.
 *
 *   puri back   owner-colour cloth with woven Dhaka end-bands, folk corner
 *               sprigs and an embroidered cream patch: a golden puri with a
 *               round akabare chili peeking out.
 *   power back  the weave takes over: a dense owner-colour stepped lattice on
 *               parchment, around a dark round masala dabba (spice box) whose
 *               four bowls hint at the four powers.
 *
 * Pure string builders: no DOM, no fonts (wordmarks are outlined paths), no
 * external refs. All jitter is seeded, so the output is stable.
 */

import type { ColorId } from '../../engine/types.ts';
import { PLAYER_PALETTE, CREAM, CREAM_BRIGHT, PAPER, INK, INK_SOFT, GOLD, CHILI, LEAF, PURI_GOLD } from '../palette.ts';
import { FRAME } from '../geometry.ts';
import { wordmarkSvg } from '../wordmarks.ts';

type Pt = [number, number];

const W = 750;
const H = 1050;
const CX = 375;
const CY = 525;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const f = (v: number): string => String(Math.round(v * 10) / 10);

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

const jit = (R: () => number, a: number): number => (R() * 2 - 1) * a;

function poly(pts: Pt[], close = true): string {
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + (close ? 'Z' : '');
}

/** Catmull-Rom spline through points, as cubic Béziers. */
function smooth(pts: Pt[], closed: boolean): string {
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

function wobCircle(cx: number, cy: number, r: number, amp: number, n: number, R: () => number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + jit(R, 0.015);
    const rr = r + jit(R, amp);
    pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
  }
  return smooth(pts, true);
}

function wobLine(x1: number, y1: number, x2: number, y2: number, amp: number, segs: number, R: () => number): string {
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + jit(R, i === 0 || i === segs ? amp * 0.4 : amp)]);
  }
  return smooth(pts, false);
}

/** Stepped (woven) lozenge: rows of weft floats, n steps each way, step s. */
function stepDiamond(cx: number, cy: number, n: number, s: number): string {
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = -n; i <= n; i++) {
    const hw = (n - Math.abs(i)) * s + s / 2;
    const yt = cy + (i - 0.5) * s, yb = cy + (i + 0.5) * s;
    right.push([cx + hw, yt], [cx + hw, yb]);
    left.push([cx - hw, yt], [cx - hw, yb]);
  }
  return poly([...right, ...left.reverse()]);
}

/** Stepped triangle with its base on y = by, apex pointing down (dir 1) or up (dir -1). */
function stepTri(cx: number, by: number, n: number, s: number, dir: 1 | -1): string {
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const hw = (n - i) * s - s / 2;
    const y0 = by + dir * i * s, y1 = by + dir * (i + 1) * s;
    right.push([cx + hw, y0], [cx + hw, y1]);
    left.push([cx - hw, y0], [cx - hw, y1]);
  }
  return poly([...right, ...left.reverse()]);
}

/** Almond leaf from (x, y) along angle `ang` (deg). */
function leafPath(x: number, y: number, ang: number, len: number, wd: number): string {
  const a = (ang * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const tip: Pt = [x + ux * len, y + uy * len];
  const c1: Pt = [x + ux * len * 0.4 + nx * wd, y + uy * len * 0.4 + ny * wd];
  const c2: Pt = [x + ux * len * 0.5 - nx * wd * 0.9, y + uy * len * 0.5 - ny * wd * 0.9];
  return `M${f(x)} ${f(y)}Q${f(c1[0])} ${f(c1[1])} ${f(tip[0])} ${f(tip[1])}Q${f(c2[0])} ${f(c2[1])} ${f(x)} ${f(y)}Z`;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** feColorMatrix values painting `hex` with alpha = k·channel + o (channel 0=R … 3=A). */
function tint(hex: string, k: number, o: number, ch = 0): string {
  const [r, g, b] = hexRgb(hex);
  const a = [0, 0, 0, 0];
  a[ch] = k;
  return `0 0 0 0 ${r.toFixed(3)} 0 0 0 0 ${g.toFixed(3)} 0 0 0 0 ${b.toFixed(3)} ${a.join(' ')} ${o}`;
}

// ---------------------------------------------------------------------------
// palette per owner
// ---------------------------------------------------------------------------

interface Threads {
  base: string; deep: string; darker: string; light: string; ink: string;
  /** primary accent thread ("turmeric") and secondary ("chili"), chosen to read on base */
  a1: string; a2: string;
  /** corner flower: petal, heart, leaf */
  petal: string; heart: string; leaf: string;
}

const ACCENTS: Record<ColorId, [string, string, string, string, string]> = {
  //         a1               a2     petal           heart   leaf
  red:    [GOLD,            LEAF,  GOLD,           CHILI,  LEAF],
  blue:   [GOLD,            CHILI, CHILI,          GOLD,   LEAF],
  yellow: [CHILI,           LEAF,  CHILI,          CREAM,  LEAF],
  green:  [GOLD,            CHILI, CHILI,          GOLD,   '#A9C08A'],
  purple: [GOLD,            CHILI, CHILI,          GOLD,   LEAF],
  orange: [PURI_GOLD.light, LEAF,  PURI_GOLD.light, CHILI, LEAF],
};

function threads(color: ColorId): Threads {
  const p = PLAYER_PALETTE[color];
  const [a1, a2, petal, heart, leaf] = ACCENTS[color];
  return { base: p.base, deep: p.deep, darker: p.darker, light: p.light, ink: p.ink, a1, a2, petal, heart, leaf };
}

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

function svgOpen(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
}

function frame(): string {
  const o = FRAME.outer, i = FRAME.inner;
  return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r}" fill="none" stroke="${CREAM}" stroke-width="${o.stroke}"/>`
    + `<rect x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}" rx="${i.r}" fill="none" stroke="${CREAM}" stroke-width="${i.stroke}"/>`;
}

const region = (x: number, y: number, w: number, h: number): string =>
  `filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" color-interpolation-filters="sRGB"`;
const FULL = region(0, 0, W, H);

/** Filters shared by both backs (ids prefixed). */
function filters(p: string, washDark: string, washLight: string, weaveDark: string): string {
  return [
    // painted-paper grain: dark and light specks
    `<filter id="${p}-grain" ${FULL}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>`
      + `<feColorMatrix in="n" type="matrix" values="${tint(INK, 3.2, -1.78)}" result="d"/>`
      + `<feColorMatrix in="n" type="matrix" values="${tint(CREAM_BRIGHT, -3.2, 1.3)}" result="l"/>`
      + `<feMerge><feMergeNode in="d"/><feMergeNode in="l"/></feMerge></filter>`,
    // gouache wash: slow blotches of darker and lighter pigment
    `<filter id="${p}-wash" ${FULL}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.0055 0.008" numOctaves="3" seed="23" result="n"/>`
      + `<feColorMatrix in="n" type="matrix" values="${tint(washDark, 2.6, -1.2)}" result="d"/>`
      + `<feColorMatrix in="n" type="matrix" values="${tint(washLight, -2.4, 0.95, 1)}" result="l"/>`
      + `<feMerge><feMergeNode in="d"/><feMergeNode in="l"/></feMerge></filter>`,
    // cloth: short weft slubs and faint warp
    `<filter id="${p}-cloth" ${FULL}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.045 0.75" numOctaves="2" seed="5" result="h"/>`
      + `<feColorMatrix in="h" type="matrix" values="${tint(weaveDark, 2.4, -1.18)}" result="hh"/>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.75 0.06" numOctaves="1" seed="9" result="v"/>`
      + `<feColorMatrix in="v" type="matrix" values="${tint(weaveDark, 2, -1.05)}" result="vv"/>`
      + `<feMerge><feMergeNode in="hh"/><feMergeNode in="vv"/></feMerge></filter>`,
    // hand wobble for threads and stitches, plus uneven (hand-dyed) thread density
    `<filter id="${p}-wob" ${region(-20, -20, W + 40, H + 40)}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="3" result="t"/>`
      + `<feDisplacementMap in="SourceGraphic" in2="t" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="17" result="m"/>`
      + `<feColorMatrix in="m" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.5 0 0.16" result="ma"/>`
      + `<feComposite in="d" in2="ma" operator="in"/></filter>`,
    `<filter id="${p}-soft" ${FULL}><feGaussianBlur stdDeviation="6"/></filter>`,
  ].join('');
}

/**
 * Folk corner sprig for the top-left corner (corner at 0,0, card inwards = +x,+y),
 * symmetric about the diagonal: flame flower pointing into the corner, cream
 * scrolls running along both edges, two leaves and a trail of turmeric dots.
 */
function sprig(p: string, stem: string, petal: string, heart: string, leaf: string, dot: string): string {
  const half = `<path d="M42 40C60 30 88 14 118 18C144 22 148 50 126 53C112 55 110 40 121 37" fill="none" stroke="${stem}" stroke-width="5.5" stroke-linecap="round"/>`
    + `<path d="${leafPath(62, 30, -72, 21, 6.5)}" fill="${stem}"/><path d="${leafPath(90, 19, -92, 18, 5.5)}" fill="${stem}"/>`
    + `<path d="${leafPath(78, 30, 38, 24, 7)}" fill="${stem}"/><path d="${leafPath(104, 22, 52, 19, 5.5)}" fill="${stem}"/>`
    + `<path d="${leafPath(44, 44, 27, 52, 13)}" fill="${leaf}"/><path d="M47 45.5L90 68" stroke="${CREAM}" stroke-width="1.4" opacity=".55"/>`
    + `<path d="M36 38C26 46 10 46 0 36C12 30 26 30 36 38Z" fill="${petal}"/>`
    + `<circle cx="136" cy="42" r="3.6" fill="${dot}"/>`;
  return `<g id="${p}-half">${half}</g>`
    + `<use href="#${p}-half" transform="matrix(0 1 1 0 0 0)"/>`
    + `<path d="M40 40C27 35 10 20 3 3C20 10 35 27 40 40Z" fill="${petal}"/>`
    + `<path d="M40 40C33 36 24 28 20 20C28 24 36 33 40 40Z" fill="${heart}"/>`
    + `<circle cx="42" cy="42" r="6.2" fill="${heart}"/>`
    + `<circle cx="76" cy="76" r="4.4" fill="${dot}"/><circle cx="89" cy="89" r="3.2" fill="${dot}"/><circle cx="99" cy="99" r="2.2" fill="${dot}"/>`;
}

// ---------------------------------------------------------------------------
// lattice (woven stepped ribbons) — shared by the power back and, tone-on-tone, the puri field
// ---------------------------------------------------------------------------

const A = 54; // lattice half-period: nodes at (CX + i·A, CY + j·A), i + j even

/** One 2A×2A tile of stepped (woven) diagonal ribbons, optionally with a stitched centre thread. */
function latticePattern(id: string, fill: string, float: string | null, stitch: string | null): string {
  const T = 2 * A, s = 6, rows = T / s;
  let d = '';
  const ribbon = (c: number, dir: 1 | -1): void => {
    // line y = dir·x + c, laid as rows of weft floats
    for (let r = -2; r < rows + 2; r++) {
      const y = r * s;
      const x0 = dir === 1 ? y - c - s * 0.5 : c - y - s * 1.5;
      d += `M${f(x0)} ${y}h${2 * s}v${s}h-${2 * s}z`;
    }
  };
  for (const c of [-T, 0, T]) ribbon(c, 1);
  for (const c of [0, T, 2 * T]) ribbon(c, -1);
  const per = Math.hypot(T, T) / 14;
  return `<pattern id="${id}" width="${T}" height="${T}" patternUnits="userSpaceOnUse" x="${CX}" y="${CY}">`
    + `<path d="${d}" fill="${fill}"${float ? ` stroke="${float}" stroke-width=".9" stroke-opacity=".55"` : ''}/>`
    + (stitch ? `<path d="M0 0L${T} ${T}M${T} 0L0 ${T}" stroke="${stitch}" stroke-width="1.8" stroke-dasharray="${f(per * 0.55)} ${f(per * 0.45)}" opacity=".85"/>` : '')
    + `</pattern>`;
}

// ---------------------------------------------------------------------------
// puri back
// ---------------------------------------------------------------------------

const BAND = { x0: 56, x1: 694, y0: 58 };
/** Field between the woven end-panels. */
const FIELD = { y0: 220, y1: H - 220 };

function dhakaBand(p: string, t: Threads): string {
  const R = rng(101);
  const { x0, x1, y0 } = BAND;
  const line = (y: number, c: string, w: number): string =>
    `<path d="${wobLine(x0, y, x1, y, 0.7, 10, R)}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
  let g = `<defs>`
    + `<path id="${p}-td" d="${stepTri(0, 0, 3, 3.4, 1)}"/>`
    + `<path id="${p}-tu" d="${stepTri(0, 0, 3, 3.4, -1)}"/>`
    + `<g id="${p}-da"><path d="${stepDiamond(0, 0, 4, 4)}" fill="${CREAM}"/><path d="${stepDiamond(0, 0, 2, 4)}" fill="${t.a2}"/><path d="${stepDiamond(0, 0, 0, 4)}" fill="${t.a1}"/></g>`
    + `<g id="${p}-db"><path d="${stepDiamond(0, 0, 4, 4)}" fill="${t.a1}"/><path d="${stepDiamond(0, 0, 2, 4)}" fill="${t.darker}"/><path d="${stepDiamond(0, 0, 0, 4)}" fill="${CREAM}"/></g>`
    + `<path id="${p}-ds" d="${stepDiamond(0, 0, 1, 3)}"/>`
    + `<g id="${p}-dl"><path d="${stepDiamond(0, 0, 2, 4)}" fill="${t.a1}"/><path d="${stepDiamond(0, 0, 0, 4)}" fill="${t.darker}"/></g>`
    + `</defs>`;
  g += line(y0, CREAM, 2.6) + line(y0 + 6, t.a1, 3.4);
  const nT = 34, pT = (x1 - x0) / nT;
  for (let i = 0; i < nT; i++) g += `<use href="#${p}-td" x="${f(x0 + pT * (i + 0.5) + jit(R, 0.5))}" y="${f(y0 + 10 + jit(R, 0.4))}" fill="${CREAM}"/>`;
  const cy = y0 + 40;
  g += line(cy, t.darker, 3.2);
  const nD = 15, pD = (x1 - x0) / nD;
  for (let i = 0; i < nD; i++) {
    const cx = x0 + pD * (i + 0.5);
    g += `<use href="#${p}-${i % 2 ? 'db' : 'da'}" x="${f(cx + jit(R, 0.6))}" y="${f(cy + jit(R, 0.5))}"/>`;
    if (i < nD - 1) {
      const mx = cx + pD / 2;
      g += `<use href="#${p}-ds" x="${f(mx + jit(R, 0.5))}" y="${f(cy - 12)}" fill="${t.light}"/><use href="#${p}-ds" x="${f(mx + jit(R, 0.5))}" y="${f(cy + 12)}" fill="${t.light}"/>`;
    }
  }
  for (let i = 0; i < nT; i++) g += `<use href="#${p}-tu" x="${f(x0 + pT * (i + 0.5) + jit(R, 0.5))}" y="${f(y0 + 70 + jit(R, 0.4))}" fill="${CREAM}"/>`;
  g += line(y0 + 74, t.a1, 3.4) + line(y0 + 80, CREAM, 2.6);
  // weft rows: every motif is made of visible threads
  g += `<rect x="${x0}" y="${y0 - 3}" width="${x1 - x0}" height="87" fill="url(#${p}-weft)"/>`;
  // label row (the wordmark is laid in separately) with lozenge terminals, then a fringe stripe
  g += `<use href="#${p}-dl" x="${x0 + 18}" y="${f((y0 + 80 + FIELD.y0) / 2 - 3)}"/><use href="#${p}-dl" x="${x1 - 18}" y="${f((y0 + 80 + FIELD.y0) / 2 - 3)}"/>`;
  g += line(FIELD.y0 - 12, t.a1, 3) + line(FIELD.y0 - 6, CREAM, 2.4);
  const nF = 58, pF = (x1 - x0) / nF;
  let fr = '';
  for (let i = 0; i < nF; i++) fr += `M${f(x0 + pF * (i + 0.5) - 1.6 + jit(R, 0.4))} ${FIELD.y0 - 3}h3.2v${i % 2 ? 4 : 7}h-3.2z`;
  g += `<path d="${fr}" fill="${CREAM}" opacity=".9"/>`;
  return `<g id="${p}-band">${g}</g>`;
}

function patch(p: string, t: Threads): string {
  const R = rng(202);
  let g = '';
  g += `<circle cx="${CX}" cy="${CY + 7}" r="208" fill="${t.darker}" opacity=".6" filter="url(#${p}-soft)"/>`;
  // merrowed satin edge
  g += `<path d="${wobCircle(CX, CY, 206, 0.9, 30, R)}" fill="${t.darker}"/>`;
  g += `<circle cx="${CX}" cy="${CY}" r="200.5" fill="none" stroke="${t.deep}" stroke-width="11" stroke-dasharray="1.5 2.1"/>`;
  g += `<circle cx="${CX}" cy="${CY}" r="200.5" fill="none" stroke="${t.base}" stroke-width="5" stroke-dasharray="1.2 7.8" opacity=".7"/>`;
  // linen
  g += `<path d="${wobCircle(CX, CY, 194, 0.8, 30, R)}" fill="${CREAM}"/>`;
  g += `<circle cx="${CX}" cy="${CY}" r="194" filter="url(#${p}-linen)" opacity=".6"/>`;
  // running stitch + Dhaka ring
  g += `<path d="${wobCircle(CX, CY, 185, 0.8, 30, R)}" fill="none" stroke="${t.base}" stroke-width="2.8" stroke-dasharray="9 5.5" stroke-linecap="round"/>`;
  g += `<path d="${wobCircle(CX, CY, 177, 0.7, 30, R)}" fill="none" stroke="${t.deep}" stroke-width="2.6"/>`;
  g += `<path d="${wobCircle(CX, CY, 145, 0.7, 30, R)}" fill="none" stroke="${t.deep}" stroke-width="2.6"/>`;
  const N = 28;
  g += `<defs><path id="${p}-tooth" d="${stepTri(CX, CY - 176, 4, 3.6, 1)}"/><path id="${p}-loz" d="${stepDiamond(CX, CY - 157, 2, 3.4)}"/></defs>`;
  for (let i = 0; i < N; i++) {
    const a = (i * 360) / N;
    g += `<use href="#${p}-tooth" fill="${t.base}" transform="rotate(${f(a + jit(R, 0.5))} ${CX} ${CY})"/>`;
    g += `<use href="#${p}-loz" fill="${i % 2 ? t.a2 : GOLD}" transform="rotate(${f(a + 180 / N + jit(R, 0.5))} ${CX} ${CY})"/>`;
  }
  g += `<g filter="url(#${p}-pwob)">${puri(p)}</g>`;
  return g;
}

function puri(p: string): string {
  const R = rng(303);
  const px = CX, py = CY + 36, rx = 98, ry = 86;
  const pts: Pt[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const s = Math.sin(a);
    pts.push([px + Math.cos(a) * (rx + jit(R, 1.4)), py + s * (ry + jit(R, 1.4)) * (s > 0 ? 0.93 : 1)]);
  }
  const body = smooth(pts, true);
  const hy = py - ry + 20;
  const chy = hy - 16;
  const cr = 29;
  let g = `<defs><clipPath id="${p}-pc"><path d="${body}"/></clipPath>`
    + `<radialGradient id="${p}-pg" cx="0.38" cy="0.3" r="0.78"><stop offset="0" stop-color="#F7D07A"/><stop offset="0.5" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="${PURI_GOLD.deep}"/></radialGradient>`
    + `<radialGradient id="${p}-cg" cx="0.36" cy="0.32" r="0.72"><stop offset="0" stop-color="#F26A3C"/><stop offset="0.5" stop-color="${CHILI}"/><stop offset="1" stop-color="#7E170A"/></radialGradient>`
    + `<pattern id="${p}-sat" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><rect width="6" height="2.2" fill="#FBE2A2"/></pattern>`
    + `<clipPath id="${p}-cc"><path d="M280 360H470V${hy}A62 20 0 0 1 280 ${hy}Z"/></clipPath></defs>`;
  // cast shadow on the linen
  g += `<ellipse cx="${px + 8}" cy="${f(py + ry * 0.93 + 3)}" rx="88" ry="11" fill="${INK_SOFT}" opacity=".4" filter="url(#${p}-soft)"/>`;
  // shell: gradient, satin threads, crisp blisters (french knots), shade
  g += `<path d="${body}" fill="url(#${p}-pg)"/>`;
  let inner = `<rect x="${px - rx - 5}" y="${py - ry - 5}" width="${rx * 2 + 10}" height="${ry * 2 + 10}" fill="url(#${p}-sat)" opacity=".26"/>`;
  // fried-shell texture: puffy blisters, brown fry speckles, light blister rims on the lit side
  const RK = rng(404);
  const circ = (x: number, y: number, r: number): string => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
  let bub = '', dark = '', rim = '';
  for (let i = 0; i < 120; i++) {
    const a = RK() * Math.PI * 2, r = Math.sqrt(RK()) * 0.94;
    const x = px + Math.cos(a) * rx * r, y = py + Math.sin(a) * ry * r;
    const rr = 1.3 + RK() * 2.4;
    if (y < hy + 12 && Math.abs(x - px) < 74) continue;
    const lit = (x - px) * 0.8 + (y - py) < 10;
    if (i % 6 === 0) bub += circ(x, y, rr * 2.3);
    else if (lit && i % 2) rim += `M${f(x - rr * 1.3)} ${f(y)}a${f(rr * 1.3)} ${f(rr * 1.1)} 0 0 1 ${f(rr * 2.6)} 0`;
    else dark += circ(x, y, rr * (lit ? 0.7 : 1));
  }
  inner += `<path d="${bub}" fill="#F6C96E" stroke="${PURI_GOLD.deep}" stroke-width="1.2" stroke-opacity=".6" opacity=".75"/>`
    + `<path d="${dark}" fill="${PURI_GOLD.deep}" opacity=".5"/>`
    + `<path d="${rim}" fill="none" stroke="#FCE7B0" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>`;
  inner += `<path d="M${px - rx} ${py + 10}C${px - rx + 20} ${py + ry + 10} ${px + rx - 10} ${py + ry} ${px + rx} ${py - 20}L${px + rx + 10} ${py + ry + 10}H${px - rx - 10}Z" fill="${PURI_GOLD.deep}" opacity=".36"/>`;
  g += `<g clip-path="url(#${p}-pc)">${inner}</g>`;
  g += `<path d="${body}" fill="none" stroke="#8A4212" stroke-width="3.2" stroke-dasharray="12 2.6" stroke-linejoin="round"/>`;
  // broken opening with a glimpse of the filling
  const hole: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = 1 + (i % 2 ? -0.09 : 0.05) + jit(R, 0.05);
    hole.push([px + Math.cos(a) * 62 * rr, hy + Math.sin(a) * 20 * rr]);
  }
  g += `<path d="${poly(hole)}" fill="#2A170E" stroke="#FAE0A0" stroke-width="2.6" stroke-linejoin="round"/>`;
  g += `<ellipse cx="${px - 34}" cy="${hy + 5}" rx="14" ry="5" fill="${LEAF}" opacity=".9"/><ellipse cx="${px + 36}" cy="${hy + 4}" rx="12" ry="4.4" fill="#C9892E"/><circle cx="${px + 22}" cy="${hy + 9}" r="3.4" fill="#E5B45A"/>`;
  // round akabare chili nestled in the opening: glossy cherry body, small cap, long hooked stem
  const lob: Pt[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const rr = cr + jit(R, 0.5);
    lob.push([px + Math.cos(a) * rr * 1.04, chy + Math.sin(a) * rr]);
  }
  const ch = `<path d="${smooth(lob, true)}" fill="url(#${p}-cg)" stroke="#6E1409" stroke-width="2"/>`
    + `<path d="M${px - 20} ${chy - 4}C${px - 19} ${chy - 16} ${px - 11} ${chy - 23} ${px - 1} ${chy - 25}" fill="none" stroke="#FFD6BA" stroke-width="5" stroke-linecap="round" opacity=".9"/>`
    + `<circle cx="${px - 21}" cy="${chy + 5}" r="2.6" fill="#FFD6BA" opacity=".85"/>`
    + `<path d="M${px + 8} ${chy + 22}C${px + 18} ${chy + 18} ${px + 24} ${chy + 10} ${px + 26} ${chy}" fill="none" stroke="#F0653A" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>`;
  g += `<g clip-path="url(#${p}-cc)">${ch}</g>`;
  const top = chy - cr;
  g += `<path d="M${px - 12} ${top + 3}C${px - 8} ${top - 5} ${px + 8} ${top - 5} ${px + 12} ${top + 3}C${px + 6} ${top} ${px + 3} ${top + 4} ${px} ${top + 1}C${px - 3} ${top + 4} ${px - 6} ${top} ${px - 12} ${top + 3}Z" fill="${LEAF}" stroke="#2F4F1E" stroke-width="1.4" stroke-linejoin="round"/>`;
  g += `<path d="M${px} ${top - 2}C${px - 2} ${top - 20} ${px + 6} ${top - 36} ${px + 22} ${top - 38}C${px + 30} ${top - 38} ${px + 33} ${top - 32} ${px + 30} ${top - 27}" fill="none" stroke="#2F4F1E" stroke-width="6.4" stroke-linecap="round"/>`;
  g += `<path d="M${px} ${top - 3}C${px - 2} ${top - 20} ${px + 6} ${top - 35} ${px + 22} ${top - 37}C${px + 29} ${top - 37} ${px + 32} ${top - 32} ${px + 30} ${top - 28}" fill="none" stroke="#7FA24A" stroke-width="3" stroke-linecap="round"/>`;
  // danger rays
  for (let i = 0; i < 8; i++) {
    if (i === 4 || i === 5) continue; // leave room for the stem
    const a = ((-176 + i * 24.5) * Math.PI) / 180;
    const r0 = cr + 16, r1 = cr + 28 + (i % 2) * 7;
    g += `<path d="M${f(px + Math.cos(a) * r0)} ${f(chy + Math.sin(a) * r0)}L${f(px + Math.cos(a) * r1)} ${f(chy + Math.sin(a) * r1)}" stroke="${CHILI}" stroke-width="3.6" stroke-linecap="round"/>`;
  }
  // coriander leaves at the foot
  g += `<path d="${leafPath(px - 76, py + 68, 158, 36, 10)}" fill="${LEAF}"/><path d="${leafPath(px - 72, py + 76, 196, 26, 8)}" fill="#6E9A3E"/>`;
  g += `<path d="${leafPath(px + 76, py + 68, 22, 36, -10)}" fill="${LEAF}"/><path d="${leafPath(px + 72, py + 76, -16, 26, -8)}" fill="#6E9A3E"/>`;
  return g;
}

export function puriBackSvg(color: ColorId): string {
  const t = threads(color);
  const p = `dw-pu-${color}`;
  const defs = filters(p, t.darker, t.light, t.darker)
    + `<filter id="${p}-linen" ${region(170, 320, 410, 410)}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.04 0.8" numOctaves="1" seed="4" result="h"/>`
      + `<feColorMatrix in="h" type="matrix" values="${tint(INK_SOFT, 2.4, -1.22)}" result="hh"/>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.8 0.04" numOctaves="1" seed="8" result="v"/>`
      + `<feColorMatrix in="v" type="matrix" values="${tint(INK_SOFT, 2.4, -1.26)}" result="vv"/>`
      + `<feMerge><feMergeNode in="hh"/><feMergeNode in="vv"/></feMerge><feComposite in2="SourceGraphic" operator="in"/></filter>`
    + `<filter id="${p}-pwob" ${region(250, 360, 250, 320)}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="13" result="t"/>`
      + `<feDisplacementMap in="SourceGraphic" in2="t" scale="3.5" xChannelSelector="R" yChannelSelector="G"/></filter>`
    + `<pattern id="${p}-weft" width="8" height="4" patternUnits="userSpaceOnUse" y="${BAND.y0}"><rect y="3" width="8" height="1" fill="${INK}" opacity=".16"/></pattern>`
    + latticePattern(`${p}-tone`, t.deep, null, null)
    + `<clipPath id="${p}-in"><rect x="40.5" y="40.5" width="669" height="969" rx="29.5"/></clipPath>`
    + dhakaBand(p, t)
    + `<g id="${p}-fl">${sprig(p, CREAM, t.petal, t.heart, t.leaf, t.a1)}</g>`;

  let body = `<rect width="${W}" height="${H}" fill="${t.base}"/>`;
  // tone-on-tone jacquard lattice in the field, under the wash so it reads as dyed cloth
  body += `<rect x="40" y="${FIELD.y0}" width="670" height="${FIELD.y1 - FIELD.y0}" fill="url(#${p}-tone)" opacity=".28" filter="url(#${p}-wob)"/>`;
  body += `<rect width="${W}" height="${H}" filter="url(#${p}-wash)" opacity=".55"/>`;
  body += `<g clip-path="url(#${p}-in)"><rect width="${W}" height="${H}" filter="url(#${p}-cloth)" opacity=".5"/></g>`;

  const fx = 44, fy = FIELD.y0 + 2, sc = 0.92;
  body += `<g filter="url(#${p}-wob)">`
    + `<use href="#${p}-band"/><use href="#${p}-band" transform="rotate(180 ${CX} ${CY})"/>`
    + `<use href="#${p}-fl" transform="translate(${fx} ${fy}) scale(${sc})"/>`
    + `<use href="#${p}-fl" transform="translate(${W - fx} ${fy}) scale(-${sc} ${sc})"/>`
    + `<use href="#${p}-fl" transform="translate(${fx} ${H - fy}) scale(${sc} -${sc})"/>`
    + `<use href="#${p}-fl" transform="translate(${W - fx} ${H - fy}) scale(-${sc} -${sc})"/>`
    + wordmarkSvg('AKABARE PANIPURI', { x: CX, y: 176, valign: 'cap-middle', height: 33, tracking: 2, fill: CREAM_BRIGHT, stroke: t.darker, strokeWidth: 5 })
    + wordmarkSvg('अकबरे पानीपुरी', { x: CX, y: H - 176, valign: 'middle', height: 31, fill: t.a1, stroke: t.darker, strokeWidth: 5 })
    + `</g>`;
  body += patch(p, t);
  body += frame();
  body += `<rect width="${W}" height="${H}" filter="url(#${p}-grain)" opacity=".2"/>`;
  return svgOpen() + `<defs>${defs}</defs>` + body + '</svg>';
}

// ---------------------------------------------------------------------------
// power back
// ---------------------------------------------------------------------------

const PANEL = { x: 52, y: 52, w: 646, h: 946, r: 22 };
/** Corner clearings are bounded by the lattice ribbons x±y = const, 6 periods out from the centre. */
const CORNER_K = 6;

function lattice(p: string, t: Threads): string {
  const R = rng(505);
  let g = `<rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" fill="url(#${p}-lat)"/>`;
  g += `<defs>`
    + `<g id="${p}-knot"><path d="${stepDiamond(0, 0, 2, 4)}" fill="${t.deep}"/><path d="${stepDiamond(0, 0, 0, 4)}" fill="currentColor"/></g>`
    + `<g id="${p}-cell"><path d="${stepDiamond(0, 0, 3, 4)}" fill="${t.light}"/><path d="${stepDiamond(0, 0, 1, 4)}" fill="currentColor"/></g>`
    + `<g id="${p}-cell2"><path d="${stepDiamond(0, 0, 3, 4)}" fill="none" stroke="${t.base}" stroke-width="2.4"/><path d="${stepDiamond(0, 0, 1, 4)}" fill="currentColor"/></g>`
    + `</defs>`;
  const lim = CORNER_K * 2 * A;
  for (let j = -9; j <= 9; j++) {
    for (let i = -6; i <= 6; i++) {
      const x = CX + i * A, y = CY + j * A;
      if (x < PANEL.x - 16 || x > PANEL.x + PANEL.w + 16 || y < PANEL.y - 16 || y > PANEL.y + PANEL.h + 16) continue;
      if (Math.hypot(x - CX, y - CY) < 215) continue;
      if (Math.abs(i + j) * A > lim || Math.abs(j - i) * A > lim) continue; // inside a corner clearing
      const pos = `x="${f(x + jit(R, 1.2))}" y="${f(y + jit(R, 1.2))}"`;
      if ((i + j) % 2 === 0) {
        g += `<use href="#${p}-knot" ${pos} color="${(i + j) % 4 === 0 ? t.a1 : CREAM}"/>`;
      } else {
        const k = ((i * 2 + j * 3) % 3 + 3) % 3;
        g += k === 0
          ? `<use href="#${p}-cell" ${pos} color="${t.a2}"/>`
          : `<use href="#${p}-cell2" ${pos} color="${k === 1 ? t.deep : t.a1}"/>`;
      }
    }
  }
  return g;
}

function dabba(p: string, t: Threads): string {
  const R = rng(606);
  let g = '';
  // parchment halo that clears the lattice
  g += `<path d="${wobCircle(CX, CY, 232, 1.2, 30, R)}" fill="${PAPER}"/>`;
  g += `<path d="${wobCircle(CX, CY, 225, 0.8, 30, R)}" fill="none" stroke="${t.base}" stroke-width="3.2" stroke-dasharray="10 6" stroke-linecap="round"/>`;
  g += `<circle cx="${CX}" cy="${CY + 8}" r="206" fill="${t.darker}" opacity=".55" filter="url(#${p}-soft)"/>`;
  // satin-stitched owner rim
  g += `<path d="${wobCircle(CX, CY, 207, 0.9, 30, R)}" fill="${t.deep}"/>`;
  g += `<circle cx="${CX}" cy="${CY}" r="200" fill="none" stroke="${t.base}" stroke-width="12" stroke-dasharray="1.5 2.1"/>`;
  g += `<path d="${wobCircle(CX, CY, 190, 0.8, 30, R)}" fill="none" stroke="${CREAM}" stroke-width="2.8" stroke-dasharray="9 5.5" stroke-linecap="round"/>`;
  // tin body with a soft sheen
  g += `<defs><radialGradient id="${p}-tin" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="${t.deep}"/><stop offset="1" stop-color="${t.ink}"/></radialGradient>`
    + `<radialGradient id="${p}-brass" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#F8DC92"/><stop offset=".5" stop-color="${PURI_GOLD.mid}"/><stop offset="1" stop-color="#8A4212"/></radialGradient>`
    + `<radialGradient id="${p}-bowl" cx="0.6" cy="0.65" r="0.7"><stop offset="0" stop-color="${PURI_GOLD.light}"/><stop offset="1" stop-color="#8A4212"/></radialGradient>`
    + `<path id="${p}-dt" d="${stepTri(CX, CY - 182, 3, 3.6, 1)}"/></defs>`;
  g += `<path d="${wobCircle(CX, CY, 183, 0.8, 30, R)}" fill="url(#${p}-tin)"/>`;
  for (let i = 0; i < 36; i++) g += `<use href="#${p}-dt" fill="${i % 2 ? t.base : t.a1}" transform="rotate(${f(i * 10 + jit(R, 0.4))} ${CX} ${CY})"/>`;
  // four bowls (the four powers: vinegar, dahi, chaat, khali puri)
  const D = 88, BR = 60;
  const bowls: [number, number, string][] = [[-1, -1, 'vinegar'], [1, -1, 'dahi'], [1, 1, 'chaat'], [-1, 1, 'khali']];
  for (const [sx, sy, kind] of bowls) {
    const x = CX + sx * D, y = CY + sy * D;
    g += `<circle cx="${f(x + 3)}" cy="${f(y + 5)}" r="${BR}" fill="#000" opacity=".3"/>`;
    g += `<path d="${wobCircle(x, y, BR, 0.7, 16, R)}" fill="url(#${p}-brass)" stroke="${INK}" stroke-width="2"/>`;
    g += `<path d="${wobCircle(x, y, BR - 9, 0.6, 16, R)}" fill="url(#${p}-bowl)" stroke="#6B3410" stroke-width="1.6"/>`;
    g += spice(kind, x, y, BR - 13, R);
  }
  // centre: four-petal knot pointing between the bowls
  for (let i = 0; i < 4; i++) {
    g += `<path d="M0 -8C11 -18 13 -32 0 -44C-13 -32 -11 -18 0 -8Z" fill="${GOLD}" stroke="${INK}" stroke-width="1.8" transform="translate(${CX} ${CY}) rotate(${i * 90})"/>`;
    g += `<path d="M0 -14C4 -20 5 -28 0 -34C-5 -28 -4 -20 0 -14Z" fill="${CHILI}" transform="translate(${CX} ${CY}) rotate(${i * 90})"/>`;
  }
  g += `<circle cx="${CX}" cy="${CY}" r="9" fill="${CREAM}" stroke="${INK}" stroke-width="1.8"/>`;
  return g;
}

function spice(kind: string, x: number, y: number, r: number, R: () => number): string {
  let g = '';
  const mound = (fill: string, hi: string): string =>
    `<path d="${wobCircle(x, y, r, 1, 14, R)}" fill="${fill}"/>`
    + `<path d="M${f(x - r * 0.62)} ${f(y - r * 0.2)}C${f(x - r * 0.5)} ${f(y - r * 0.62)} ${f(x - r * 0.1)} ${f(y - r * 0.74)} ${f(x + r * 0.25)} ${f(y - r * 0.64)}" fill="none" stroke="${hi}" stroke-width="5" stroke-linecap="round" opacity=".6"/>`;
  if (kind === 'vinegar') {
    g += `<path d="${wobCircle(x, y, r, 0.5, 14, R)}" fill="#C98114"/>`;
    g += `<path d="${wobCircle(x + 3, y + 3, r * 0.78, 0.5, 12, R)}" fill="#E4A21E"/>`;
    g += `<ellipse cx="${f(x - r * 0.32)}" cy="${f(y - r * 0.36)}" rx="${f(r * 0.38)}" ry="${f(r * 0.15)}" fill="#FBE3A0" opacity=".85" transform="rotate(-32 ${f(x - r * 0.32)} ${f(y - r * 0.36)})"/>`;
    for (let i = 0; i < 10; i++) g += `<circle cx="${f(x + jit(R, r * 0.55))}" cy="${f(y + r * 0.22 + jit(R, r * 0.38))}" r="${f(2 + R() * 1.2)}" fill="#5A3212"/>`;
    g += `<path d="${leafPath(x + r * 0.1, y + r * 0.1, -30, r * 0.7, 6)}" fill="${LEAF}"/>`;
  } else if (kind === 'dahi') {
    g += mound('#F8F1DF', '#FFFFFF');
    g += `<path d="M${x} ${y}c6 -2 8 6 2 10c-10 6 -20 -4 -16 -14c6 -14 26 -14 32 0c8 18 -8 32 -24 28" fill="none" stroke="#D9C8A2" stroke-width="3" stroke-linecap="round"/>`;
    for (let i = 0; i < 6; i++) g += `<circle cx="${f(x + r * 0.2 + jit(R, r * 0.4))}" cy="${f(y - r * 0.35 + jit(R, r * 0.2))}" r="2.2" fill="${CHILI}"/>`;
  } else if (kind === 'chaat') {
    g += mound('#A82E18', '#E0643A');
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * r * 0.8;
      const qx = x + Math.cos(a) * rr, qy = y + Math.sin(a) * rr;
      g += i % 3 === 0
        ? `<circle cx="${f(qx)}" cy="${f(qy)}" r="3.6" fill="${LEAF}"/>`
        : i % 3 === 1
          ? `<path d="M${f(qx)} ${f(qy)}l${f(jit(R, 9))} ${f(jit(R, 9))}" stroke="${GOLD}" stroke-width="2.6" stroke-linecap="round"/>`
          : `<circle cx="${f(qx)}" cy="${f(qy)}" r="2.6" fill="#F3E6C8"/>`;
    }
  } else {
    // khali: an empty puri shell sitting in the bowl
    const s = r * 0.8;
    g += `<ellipse cx="${f(x + 3)}" cy="${f(y + s * 0.8)}" rx="${f(s * 0.8)}" ry="${f(s * 0.18)}" fill="#6B3410" opacity=".5"/>`;
    g += `<path d="${wobCircle(x, y + 2, s, 0.8, 14, R)}" fill="${PURI_GOLD.mid}"/>`;
    g += `<path d="M${f(x - s)} ${f(y + 6)}C${f(x - s * 0.6)} ${f(y + s * 1.1)} ${f(x + s * 0.8)} ${f(y + s * 1.1)} ${f(x + s)} ${f(y - 2)}C${f(x + s * 0.8)} ${f(y + s * 0.8)} ${f(x - s * 0.6)} ${f(y + s * 0.8)} ${f(x - s)} ${f(y + 6)}Z" fill="${PURI_GOLD.deep}" opacity=".5"/>`;
    for (let i = 0; i < 9; i++) g += `<circle cx="${f(x + jit(R, s * 0.7))}" cy="${f(y + s * 0.35 + jit(R, s * 0.3))}" r="${f(1.8 + R())}" fill="${PURI_GOLD.light}" stroke="${PURI_GOLD.deep}" stroke-width=".8"/>`;
    g += `<ellipse cx="${x}" cy="${f(y - s * 0.3)}" rx="${f(s * 0.5)}" ry="${f(s * 0.2)}" fill="#2A170E" stroke="#FAE0A0" stroke-width="1.8"/>`;
    g += `<path d="${wobCircle(x, y + 2, s, 0.8, 14, R)}" fill="none" stroke="#8A4212" stroke-width="1.8" stroke-dasharray="7 2"/>`;
  }
  return g;
}

/** Elongated hexagon with 45° ends (so it sits along the lattice), inset by `o`. */
function hexPath(cy: number, w: number, h: number, o: number): string {
  const x0 = CX - w / 2 - o, x1 = CX + w / 2 + o, y0 = cy - h / 2 - o, y1 = cy + h / 2 + o, e = h / 2 + o;
  return poly([[x0 + e, y0], [x1 - e, y0], [x1, cy], [x1 - e, y1], [x0 + e, y1], [x0, cy]]);
}

function cartouche(p: string, t: Threads, cy: number, label: 'POWER' | 'शक्ति'): string {
  const R = rng(cy);
  const w = 388, h = 80;
  let g = `<path d="${hexPath(cy, w, h, 13)}" fill="${PAPER}" stroke-linejoin="round"/>`;
  g += `<path d="${hexPath(cy, w, h, 6)}" fill="none" stroke="${t.base}" stroke-width="2.4" stroke-dasharray="8 5"/>`;
  g += `<path d="${hexPath(cy, w, h, 0)}" fill="${t.base}" stroke="${t.darker}" stroke-width="2" stroke-linejoin="round"/>`;
  g += `<path d="${hexPath(cy, w, h, -7)}" fill="none" stroke="${CREAM}" stroke-width="2.2" stroke-dasharray="7 4" stroke-linecap="round"/>`;
  for (const ex of [CX - w / 2 + 44, CX + w / 2 - 44]) g += `<path d="${stepDiamond(ex + jit(R, 0.4), cy, 2, 4)}" fill="${t.a1}"/><path d="${stepDiamond(ex, cy, 0, 4)}" fill="${t.darker}"/>`;
  g += label === 'POWER'
    ? wordmarkSvg('POWER', { x: CX, y: cy, valign: 'cap-middle', height: 40, tracking: 9, fill: CREAM_BRIGHT, stroke: t.darker, strokeWidth: 4 })
    : wordmarkSvg('शक्ति', { x: CX, y: cy + 3, valign: 'middle', height: 42, fill: CREAM_BRIGHT, stroke: t.darker, strokeWidth: 4 });
  return g;
}

export function powerBackSvg(color: ColorId): string {
  const t = threads(color);
  const p = `dw-pw-${color}`;
  const defs = filters(p, t.darker, t.light, t.darker)
    + `<filter id="${p}-pwash" ${FULL}>`
      + `<feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="3" seed="31" result="n"/>`
      + `<feColorMatrix in="n" type="matrix" values="${tint('#C9A877', 2.6, -1.15)}"/></filter>`
    + `<clipPath id="${p}-panel"><rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="${PANEL.r}"/></clipPath>`
    + latticePattern(`${p}-lat`, t.base, t.darker, CREAM)
    + `<g id="${p}-fl">${sprig(p, t.deep, t.a2 === LEAF ? CHILI : t.a2, GOLD, LEAF, t.a1)}</g>`;

  // corner clearings: triangles cut along the lattice ribbons x ± y = const
  const c = CORNER_K * 2 * A + 11;
  const corner = (sx: number, sy: number): string => {
    const x = sx > 0 ? PANEL.x : PANEL.x + PANEL.w, y = sy > 0 ? PANEL.y : PANEL.y + PANEL.h;
    const cx0 = CX - sx * (PANEL.w / 2), cy0 = CY - sy * (PANEL.h / 2);
    // distance (along the axis) from the panel corner to the clearing edge
    const leg = (Math.abs(cx0 - CX) + Math.abs(cy0 - CY)) - c;
    return `<path d="M${x - sx * 4} ${y - sy * 4}H${f(x + sx * leg)}L${x - sx * 4} ${f(y + sy * (leg + 4))}Z" fill="${PAPER}"/>`
      + `<use href="#${p}-fl" transform="translate(${x + sx * 5} ${y + sy * 5}) scale(${sx * 0.62} ${sy * 0.62})"/>`;
  };

  let body = `<rect width="${W}" height="${H}" fill="${t.base}"/>`;
  body += `<rect width="${W}" height="${H}" filter="url(#${p}-wash)" opacity=".5"/>`;
  body += `<g clip-path="url(#${p}-panel)">`
    + `<rect width="${W}" height="${H}" fill="${PAPER}"/>`
    + `<rect width="${W}" height="${H}" filter="url(#${p}-pwash)" opacity=".7"/>`
    + `<g filter="url(#${p}-wob)">${lattice(p, t)}`
    + corner(1, 1) + corner(-1, 1) + corner(1, -1) + corner(-1, -1)
    + cartouche(p, t, 126, 'POWER') + cartouche(p, t, H - 126, 'शक्ति')
    + `</g></g>`;
  body += `<rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="${PANEL.r}" fill="none" stroke="${t.darker}" stroke-width="3"/>`;
  body += dabba(p, t);
  body += frame();
  body += `<rect width="${W}" height="${H}" filter="url(#${p}-grain)" opacity=".2"/>`;
  return svgOpen() + `<defs>${defs}</defs>` + body + '</svg>';
}
