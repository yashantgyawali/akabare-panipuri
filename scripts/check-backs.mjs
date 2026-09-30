#!/usr/bin/env node
/**
 * Check a card-back generator module for the properties docs/CARD_BACKS.md promises.
 *
 *   node scripts/check-backs.mjs [generatorModule=src/cards/backs.ts] [--full] [--diff=<dir>]
 *
 * 1. Structure: standalone <svg> with xmlns and viewBox 0 0 750 1050, no <text>, no external
 *    href/url(), every id unique and namespaced to one back, every #ref resolves.
 * 2. Determinism: two calls return the same string.
 * 3. Point symmetry (no-cheat): with the noise-only filters stripped (paper grain, edge wobble,
 *    crust relief: the deliberately non-symmetric micro texture), the render is compared with
 *    itself turned 180°. Mean and max channel difference are reported; mean must stay < 0.6/255.
 *    --diff=<dir> writes the difference images (×4) there.
 * 4. Owner legibility at phone size: mean OKLab colour of every back at 44 px, the distance
 *    between the risky owner pairs, and per owner the puri/power separation (mean lightness
 *    difference and the share of light parchment pixels).
 *
 * Renders at half size (375 px) unless --full. Exit code 1 if a structural or symmetry check fails.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COLORS } from '../src/engine/types.ts';

const args = process.argv.slice(2);
const modArg = args.find((a) => !a.startsWith('--')) ?? 'src/cards/backs.ts';
const FULL = args.includes('--full');
const diffDir = args.find((a) => a.startsWith('--diff='))?.split('=')[1];
const mod = await import(pathToFileURL(path.resolve(modArg)).href);
const KINDS = { puri: mod.puriBackSvg, power: mod.powerBackSvg };
const W = 750, H = 1050;
const density = FULL ? 72 : 36;
let failed = 0;
const fail = (msg) => { failed++; console.log(`  ✗ ${msg}`); };

// --- 1 + 2: structure and determinism --------------------------------------------------------
console.log('Structure and determinism');
const svgs = {};
for (const [kind, fn] of Object.entries(KINDS)) for (const c of COLORS) {
  const name = `${kind}-${c}`;
  const svg = fn(c);
  svgs[name] = svg;
  if (fn(c) !== svg) fail(`${name}: not deterministic`);
  if (!/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) fail(`${name}: must start with <svg xmlns=…>`);
  if (!svg.includes(`viewBox="0 0 ${W} ${H}"`)) fail(`${name}: viewBox`);
  if (/<text[\s>]/.test(svg)) fail(`${name}: contains <text>`);
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) fail(`${name}: duplicate ids`);
  const prefixes = new Set(ids.map((i) => i.split('-').slice(0, 3).join('-')));
  if (prefixes.size > 1) fail(`${name}: ids not namespaced to one back (${[...prefixes].join(', ')})`);
  for (const m of svg.matchAll(/href="([^"]*)"/g)) if (!m[1].startsWith('#') || !idSet.has(m[1].slice(1))) fail(`${name}: bad href ${m[1]}`);
  for (const m of svg.matchAll(/url\(([^)]*)\)/g)) if (!m[1].startsWith('#') || !idSet.has(m[1].slice(1))) fail(`${name}: bad url(${m[1]})`);
  console.log(`  ${name.padEnd(14)} ${(svg.length / 1024).toFixed(1).padStart(5)} KB  ${ids.length} ids, prefix ${[...prefixes][0]}`);
}
const allIds = Object.values(svgs).flatMap((s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
if (new Set(allIds).size !== allIds.length) fail('ids collide between backs (inlining several would break)');
else console.log(`  ✓ all ${allIds.length} ids unique across the 12 backs`);

// --- 3: point symmetry ------------------------------------------------------------------------
console.log(`\nPoint symmetry (noise filters stripped, ${FULL ? 750 : 375} px)`);
if (diffDir) await mkdir(diffDir, { recursive: true });
// noise-driven filters by id suffix (this module's names and the concepts'): overlays are dropped,
// displacement/relief filters are unhooked
const OVERLAY = /<rect[^>]*filter="url\(#[^)]*-(grain|tooth)\)"[^>]*\/>/g;
const NOISE = /\sfilter="url\(#[^)]*-(rough\w*|wob\w*|crust|ink|wobble|grain|tooth)\)"/g;
for (const [name, svg0] of Object.entries(svgs)) {
  const svg = svg0.replace(OVERLAY, '').replace(NOISE, '');
  const { data, info } = await sharp(Buffer.from(svg), { density }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  let sum = 0, max = 0;
  const diff = diffDir ? Buffer.alloc(w * h) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * w + x) * ch, b = ((h - 1 - y) * w + (w - 1 - x)) * ch;
    const d = (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])) / 3;
    sum += d; if (d > max) max = d;
    if (diff) diff[y * w + x] = Math.min(255, d * 4);
  }
  const mean = sum / (w * h);
  console.log(`  ${mean < 0.6 ? '✓' : '✗'} ${name.padEnd(14)} mean ${mean.toFixed(3)}  max ${max.toFixed(0)}`);
  if (mean >= 0.6) failed++;
  if (diff) await sharp(diff, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path.join(diffDir, `symdiff-${name}.png`));
}

// --- 4: colour legibility at 44 px ------------------------------------------------------------
console.log('\nPhone size (44 px): mean OKLab colour, risky owner pairs, puri/power separation');
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const stats = {};
for (const [name, svg] of Object.entries(svgs)) {
  const big = await sharp(Buffer.from(svg), { density }).png().toBuffer();
  const { data } = await sharp(big).resize({ width: 44 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let L = 0, A = 0, B = 0, light = 0, n = 0;
  for (let i = 0; i < data.length; i += 3) { const [l, a, b] = oklab(data[i], data[i + 1], data[i + 2]); L += l; A += a; B += b; if (l > 0.82) light++; n++; }
  stats[name] = { lab: [L / n, A / n, B / n], light: light / n };
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
for (const kind of Object.keys(KINDS)) {
  const pairs = [['red', 'orange'], ['yellow', 'orange'], ['red', 'purple'], ['blue', 'green'], ['green', 'yellow']];
  console.log(`  ${kind.padEnd(6)} ` + pairs.map(([a, b]) => `${a}/${b} ${dist(stats[`${kind}-${a}`].lab, stats[`${kind}-${b}`].lab).toFixed(1)}`).join('  '));
  let min = Infinity, arg = '';
  for (const a of COLORS) for (const b of COLORS) if (a < b) { const d = dist(stats[`${kind}-${a}`].lab, stats[`${kind}-${b}`].lab); if (d < min) { min = d; arg = `${a}/${b}`; } }
  console.log(`         closest owners ${arg} ${min.toFixed(1)}  (ΔOKLab ×100; ~2 is a just-noticeable difference)`);
}
for (const c of COLORS) {
  const pu = stats[`puri-${c}`], pw = stats[`power-${c}`];
  console.log(`  ${c.padEnd(7)} power − puri lightness ${(pw.lab[0] - pu.lab[0]).toFixed(3)}   parchment pixels puri ${(pu.light * 100).toFixed(0)}% / power ${(pw.light * 100).toFixed(0)}%`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
