#!/usr/bin/env node
/**
 * Procedurally paints public/art/nayaplate.webp (620x620): a fresh brass thali
 * set down beside two puri shells and a chutney katori, gouache-on-paper look.
 * There is no print-sheet source for this art (scripts/extract-art.mjs skips it).
 *   node scripts/render-nayaplate-art.mjs [--svg=<file.svg>]
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 77;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const jit = (a) => (rnd() - 0.5) * 2 * a;
const f = (v) => Math.round(v * 10) / 10;
const INK = '#2A140A';

/** Hand-wobbled closed ellipse path (smooth, seeded). */
function wob(cx, cy, rx, ry, amp = 2, n = 28, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + jit(amp / Math.min(rx, ry));
    let x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
    const c = Math.cos(rot), s = Math.sin(rot);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) d += `M${f(p1[0])} ${f(p1[1])}`;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

/** A leaf/petal from base (0,0) to tip (len,0), width w. */
const leaf = (len, w) => `M0 0C${len * 0.3} ${-w} ${len * 0.75} ${-w * 0.8} ${len} 0C${len * 0.75} ${w * 0.8} ${len * 0.3} ${w} 0 0Z`;

function sprig() {
  // folk-art corner flourish, drawn for the top-left corner
  const L = (x, y, a, len, w, fill) => `<path transform="translate(${x} ${y}) rotate(${a})" d="${leaf(len, w)}" fill="${fill}" stroke="${INK}" stroke-width="1" stroke-opacity=".5"/>`;
  return `<g filter="url(#wobble)">
    <path d="M30 100C34 70 50 45 88 32" fill="none" stroke="#D9B66A" stroke-width="3.4" stroke-linecap="round"/>
    ${L(36, 88, -75, 34, 9, '#D9B66A')}${L(44, 62, -40, 34, 9, '#EFDDB0')}${L(62, 44, -18, 32, 9, '#D9B66A')}
    ${L(40, 76, 20, 26, 8, '#EFDDB0')}${L(56, 52, 40, 24, 7, '#D9B66A')}
    ${L(27, 38, 45, 30, 10, '#D2452B')}${L(27, 38, 8, 26, 8, '#E6762F')}${L(27, 38, 82, 26, 8, '#B3321F')}
    <circle cx="27" cy="38" r="4" fill="#F3C046"/>
  </g>`;
}

function puri(cx, cy, r, tilt) {
  const specks = Array.from({ length: 34 }, () => {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r * 0.9;
    return `<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d * 0.9)}" r="${f(1 + rnd() * 2.6)}" fill="${rnd() > 0.5 ? '#FBE3A0' : '#B8741E'}" opacity=".55"/>`;
  }).join('');
  return `<g filter="url(#wobble)">
    <ellipse cx="${cx + 8}" cy="${cy + r * 0.95}" rx="${r * 1.05}" ry="${r * 0.28}" fill="#120703" opacity=".5" filter="url(#soft)"/>
    <path d="${wob(cx, cy, r, r * 0.94, 2.2, 24)}" fill="url(#puriG)" stroke="${INK}" stroke-width="2.6"/>
    ${specks}
    <path d="${wob(cx - r * 0.1, cy - r * 0.5, r * 0.5, r * 0.2, 2.5, 14, tilt)}" fill="#F6D690" stroke="${INK}" stroke-width="2"/>
    <path d="${wob(cx - r * 0.1, cy - r * 0.48, r * 0.38, r * 0.13, 1.8, 14, tilt)}" fill="#2A1206"/>
    <path d="M${cx - r * 0.7} ${cy - r * 0.1}Q${cx - r * 0.3} ${cy - r * 0.8} ${cx + r * 0.1} ${cy - r * 0.78}" fill="none" stroke="#FFF1C4" stroke-width="4" stroke-linecap="round" opacity=".5"/>
  </g>`;
}

function thali(cx, cy, rx, ry) {
  const E = (k) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx * k}" ry="${ry * k}"`;
  const petals = Array.from({ length: 8 }, (_, i) => `<path transform="translate(${cx} ${cy}) scale(1 ${ry / rx}) rotate(${i * 45})" d="${leaf(rx * 0.5, 22)}" fill="none" stroke="#7A4A12" stroke-width="2.4"/>`).join('');
  const vine = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 6.283, k = 0.8;
    return `<path transform="translate(${f(cx + Math.cos(a) * rx * k)} ${f(cy + Math.sin(a) * ry * k)}) rotate(${f(a * 57.3 + 90)}) scale(1 ${f(Math.max(0.5, ry / rx))})" d="${leaf(15, 5)}" fill="#8A5A18" opacity=".7"/>`;
  }).join('');
  return `<g filter="url(#wobble)">
    <ellipse cx="${cx + 14}" cy="${cy + 26}" rx="${rx * 1.03}" ry="${ry * 1.04}" fill="#0E0502" opacity=".55" filter="url(#soft)"/>
    <path d="${wob(cx, cy + 12, rx, ry, 2, 36)}" fill="#6B4510" stroke="${INK}" stroke-width="2.6"/>
    <path d="${wob(cx, cy, rx, ry, 2, 36)}" fill="url(#brassRim)" stroke="${INK}" stroke-width="3"/>
    ${E(0.93)} fill="none" stroke="#FFEFB0" stroke-width="3" opacity=".7"/>
    <path d="${wob(cx, cy + 2, rx * 0.86, ry * 0.86, 1.6, 36)}" fill="url(#brassWell)" stroke="#7A4A12" stroke-width="2.4"/>
    ${E(0.74)} fill="none" stroke="#8A5A18" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"/>
    ${E(0.6)} fill="none" stroke="#FFF3C0" stroke-width="1.6" opacity=".6"/>
    ${vine}${petals}
    <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.12}" ry="${ry * 0.12}" fill="#F7D878" stroke="#7A4A12" stroke-width="2"/>
    <path d="M${cx - rx * 0.78} ${cy - ry * 0.18}Q${cx - rx * 0.6} ${cy - ry * 0.7} ${cx - rx * 0.12} ${cy - ry * 0.82}" fill="none" stroke="#FFFBE6" stroke-width="9" stroke-linecap="round" opacity=".55" filter="url(#soft2)"/>
    <path d="M${cx + rx * 0.5} ${cy + ry * 0.62}Q${cx + rx * 0.75} ${cy + ry * 0.4} ${cx + rx * 0.84} ${cy + ry * 0.1}" fill="none" stroke="#FFEFB0" stroke-width="5" stroke-linecap="round" opacity=".4" filter="url(#soft2)"/>
  </g>`;
}

function bowl(cx, cy) {
  const flowers = [-46, -14, 18, 48].map((x, i) => `<path transform="translate(${cx + x} ${cy + 36 + (i % 2) * 6}) rotate(${i * 50})" d="${leaf(22, 6)}" fill="#2F5FA8" opacity=".9"/><path transform="translate(${cx + x} ${cy + 36 + (i % 2) * 6}) rotate(${i * 50 + 180})" d="${leaf(22, 6)}" fill="#2F5FA8" opacity=".9"/>`).join('');
  return `<g filter="url(#wobble)">
    <ellipse cx="${cx + 8}" cy="${cy + 92}" rx="82" ry="16" fill="#0E0502" opacity=".55" filter="url(#soft)"/>
    <path d="M${cx - 82} ${cy - 6}C${cx - 80} ${cy + 60} ${cx - 40} ${cy + 92} ${cx} ${cy + 92}C${cx + 40} ${cy + 92} ${cx + 80} ${cy + 60} ${cx + 82} ${cy - 6}Z" fill="url(#bowlG)" stroke="${INK}" stroke-width="2.8"/>
    <path d="M${cx - 80} ${cy + 18}Q${cx} ${cy + 40} ${cx + 80} ${cy + 18}" fill="none" stroke="#F3C046" stroke-width="3" opacity=".9"/>
    ${flowers}
    <path d="${wob(cx, cy - 6, 82, 26, 1.4, 22)}" fill="#EFE3C4" stroke="${INK}" stroke-width="2.8"/>
    <path d="${wob(cx, cy - 4, 70, 20, 1.2, 22)}" fill="url(#chutney)" stroke="#2F5A1A" stroke-width="1.6"/>
    <path d="M${cx - 40} ${cy - 8}q18 -10 36 -2" fill="none" stroke="#C6E08A" stroke-width="4" stroke-linecap="round" opacity=".7"/>
    <path d="M${cx - 8} ${cy - 2}C${cx + 40} ${cy - 40} ${cx + 70} ${cy - 90} ${cx + 100} ${cy - 112}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M${cx - 8} ${cy - 2}C${cx + 40} ${cy - 40} ${cx + 70} ${cy - 90} ${cx + 100} ${cy - 112}" fill="none" stroke="#E8B84A" stroke-width="5" stroke-linecap="round"/>
    <path d="${wob(cx - 14, cy - 2, 18, 8, 1, 10, -0.4)}" fill="#E8B84A" stroke="${INK}" stroke-width="2"/>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="620" viewBox="0 0 620 620">
<defs>
  <filter id="wobble" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="soft2"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="edge" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="4" seed="9"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>
  <filter id="mottle"><feTurbulence type="fractalNoise" baseFrequency=".012 .02" numOctaves="4" seed="3"/><feColorMatrix values="0 0 0 0 .08  0 0 0 0 .04  0 0 0 0 .02  0 0 0 1.3 -.45"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 .95  0 0 0 0 .88  0 0 0 0 .7  0 0 0 .9 -.35"/></filter>
  <filter id="fibres"><feTurbulence type="fractalNoise" baseFrequency=".04 .6" numOctaves="3" seed="21"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .05  0 0 0 0 .02  0 0 0 1.2 -.5"/></filter>
  <radialGradient id="bg" cx=".42" cy=".5" r=".75"><stop offset="0" stop-color="#6A4424"/><stop offset=".6" stop-color="#432A17"/><stop offset="1" stop-color="#2A180C"/></radialGradient>
  <linearGradient id="brassRim" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#FFE9A0"/><stop offset=".35" stop-color="#E0A92F"/><stop offset=".7" stop-color="#A8701A"/><stop offset="1" stop-color="#5E390C"/></linearGradient>
  <radialGradient id="brassWell" cx=".42" cy=".4" r=".8"><stop offset="0" stop-color="#FBE08C"/><stop offset=".5" stop-color="#E0A92F"/><stop offset=".85" stop-color="#B07A20"/><stop offset="1" stop-color="#7A4A12"/></radialGradient>
  <radialGradient id="puriG" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#F8D486"/><stop offset=".6" stop-color="#DE9A3C"/><stop offset="1" stop-color="#A9601C"/></radialGradient>
  <linearGradient id="bowlG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2EBDA"/><stop offset=".5" stop-color="#E4DCC6"/><stop offset="1" stop-color="#B8B09C"/></linearGradient>
  <radialGradient id="chutney" cx=".4" cy=".4" r=".8"><stop offset="0" stop-color="#8DBA44"/><stop offset="1" stop-color="#4C7E22"/></radialGradient>
  <filter id="wash"><feTurbulence type="fractalNoise" baseFrequency=".02 .03" numOctaves="5" seed="14"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  1.6 0 0 0 -.1"/></filter>
  <clipPath id="sheet"><rect x="12" y="12" width="596" height="596" filter="url(#edge)"/></clipPath>
</defs>
<rect width="620" height="620" fill="#F2E6C8"/>
<g filter="url(#edge)"><rect x="12" y="12" width="596" height="596" fill="url(#bg)"/></g>
<g clip-path="url(#sheet)">
  <rect width="620" height="620" filter="url(#mottle)" opacity=".8"/>
  <rect width="620" height="620" filter="url(#fibres)" opacity=".35"/>
  ${thali(250, 365, 215, 158)}
  ${puri(468, 160, 84, -0.15)}${puri(535, 285, 58, 0.2)}
  ${bowl(458, 462)}
  <g transform="scale(1.45)">${sprig()}</g><g transform="translate(620 0) scale(-1.45 1.45)">${sprig()}</g>
  <g transform="translate(0 620) scale(1.45 -1.45)">${sprig()}</g><g transform="translate(620 620) scale(-1.45 -1.45)">${sprig()}</g>
  <rect width="620" height="620" filter="url(#wash)" opacity=".5" style="mix-blend-mode:soft-light"/>
  <rect width="620" height="620" filter="url(#grain)" opacity=".5"/>
</g>
<rect width="620" height="620" filter="url(#grain)" opacity=".18"/>
</svg>`;

const svgArg = process.argv.find((a) => a.startsWith('--svg='));
if (svgArg) await writeFile(svgArg.slice(6), svg);
await sharp(Buffer.from(svg)).webp({ quality: 88, effort: 6 }).toFile(path.join(ROOT, 'public/art/nayaplate.webp'));
console.log('wrote public/art/nayaplate.webp');
