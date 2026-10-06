#!/usr/bin/env node
/**
 * Render card backs from a generator module and build a review contact sheet.
 *
 *   node scripts/render-backs.mjs <generatorModulePath> <outDir> [--colors=red,blue] [--no-contact] [--renderer=resvg]
 *
 * Renderer: sharp/librsvg by default; --renderer=resvg uses @resvg/resvg-js, whose
 * filter pipeline (feTurbulence, feDisplacementMap, …) is closer to Chrome's —
 * render with both to be sure a design is robust before print export.
 *
 * The generator module (.ts with erasable syntax, or .mjs/.js) must export
 *   puriBackSvg(color: ColorId): string   // 750×1050 viewBox
 *   powerBackSvg(color: ColorId): string  // 750×1050 viewBox
 *
 * Writes
 *   <outDir>/puri-<color>.svg|.png, <outDir>/power-<color>.svg|.png   (750×1050, all 6 colours)
 *   <outDir>/contact.png
 *       row 1  the 6 puri backs (250px wide)
 *       row 2  the 6 power backs
 *       row 3  one print-sheet front per card type, each under its matching-colour backs
 *       strip  every back at 44px wide (the in-game phone size), shuffled puri/power, plus
 *              fanned 44px stacks with a power card beside each — the real table situation
 *   <outDir>/strip-44.png   the 44px strip alone at native pixels (view this 1:1)
 */
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COLORS } from '../src/engine/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = path.join(ROOT, 'source_assets/print_sheets');
const W = 750;
const H = 1050;
const THUMB = 250;
const TINY = 44;
const BG = '#221510'; // dark cloth table
const LABEL = '#E9D9B6';

const [genArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!genArg || !outArg) {
  console.error('usage: node scripts/render-backs.mjs <generatorModulePath> <outDir> [--colors=red,blue] [--no-contact]');
  process.exit(2);
}
const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}`));
const colorsFlag = flag('colors=');
const colors = colorsFlag ? colorsFlag.split('=')[1].split(',') : [...COLORS];
for (const c of colors) if (!COLORS.includes(c)) throw new Error(`unknown colour ${c}`);
const OUT = path.resolve(process.cwd(), outArg);
const PLAYER_FILE = { red: 'player1_red', blue: 'player2_blue', yellow: 'player3_yellow', green: 'player4_green', purple: 'player5_purple', orange: 'player6_orange' };
/** Row 3: one front per card type; the type sits in the column of the colour listed here. */
const FRONTS = [
  ['red', 'panipuri_1', 'puri'],
  ['blue', 'akabare', 'puri'],
  ['yellow', 'vinegar', 'power'],
  ['green', 'dahi', 'power'],
  ['purple', 'panipuri_2', 'puri'], // (nayaplate has no print-sheet front)
  ['orange', 'chaat', 'power'],
];

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const label = (x, y, text, size = 18, anchor = 'start', weight = 'normal') =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${LABEL}" text-anchor="${anchor}">${esc(text)}</text>`;

function checkSvg(svg, name) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error(`${name}: generator did not return an SVG string`);
  const vb = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (!vb || vb[1].trim().split(/[\s,]+/).map(Number).join(' ') !== `0 0 ${W} ${H}`) {
    console.warn(`  ! ${name}: expected viewBox="0 0 ${W} ${H}", got ${vb ? `"${vb[1]}"` : 'none'}`);
  }
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(svg)) throw new Error(`${name}: root <svg> needs xmlns="http://www.w3.org/2000/svg"`);
}

const RENDERER = (flag('renderer=') ?? '--renderer=sharp').split('=')[1];
if (!['sharp', 'resvg'].includes(RENDERER)) throw new Error(`--renderer must be sharp or resvg, got ${RENDERER}`);

async function renderPng(svg, width = W, height = H) {
  if (RENDERER === 'resvg') {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
    return sharp(png).resize(width, height, { fit: 'fill' }).png().toBuffer();
  }
  // density 72 → 1 viewBox unit = 1px; resize guarantees exact output size.
  return sharp(Buffer.from(svg), { density: 72 }).resize(width, height, { fit: 'fill' }).png().toBuffer();
}

const thumb = (png, width) => sharp(png).resize(width, Math.round((width * H) / W), { kernel: 'lanczos3' }).png().toBuffer();

async function main() {
  const gen = await import(pathToFileURL(path.resolve(process.cwd(), genArg)).href);
  if (typeof gen.puriBackSvg !== 'function' || typeof gen.powerBackSvg !== 'function') {
    throw new Error(`${genArg} must export puriBackSvg(color) and powerBackSvg(color)`);
  }
  await mkdir(OUT, { recursive: true });

  const pngs = { puri: {}, power: {} };
  for (const color of colors) {
    for (const [kind, fn] of [['puri', gen.puriBackSvg], ['power', gen.powerBackSvg]]) {
      const t0 = performance.now();
      const svg = fn(color);
      const name = `${kind}-${color}`;
      checkSvg(svg, name);
      await writeFile(path.join(OUT, `${name}.svg`), svg);
      const png = await renderPng(svg);
      await writeFile(path.join(OUT, `${name}.png`), png);
      pngs[kind][color] = png;
      console.log(`  ${name.padEnd(14)} svg ${(svg.length / 1024).toFixed(1).padStart(6)} KB  png ${(png.length / 1024).toFixed(0).padStart(5)} KB  ${(performance.now() - t0).toFixed(0).padStart(5)} ms`);
    }
  }
  if (flag('no-contact')) return;

  // ---------------------------------------------------------------- contact sheet
  const GAP = 24;
  const M = 40;
  const TH = Math.round((THUMB * H) / W); // 350
  const cols = colors.length;
  const sheetW = M * 2 + cols * THUMB + (cols - 1) * GAP;
  const comps = [];
  let svgOverlay = '';
  let y = M + 30;
  const genAbs = path.resolve(process.cwd(), genArg);
  const genName = genAbs.startsWith(ROOT + path.sep) ? path.relative(ROOT, genAbs) : path.basename(genAbs);
  svgOverlay += label(M, M + 8, `Card backs — ${genName} (${RENDERER})`, 24, 'start', 'bold');
  y += 14;

  const rowTitle = (text) => { svgOverlay += label(M, y + 2, text, 18, 'start', 'bold'); y += 18; };
  // Row 1 + 2
  for (const kind of ['puri', 'power']) {
    rowTitle(kind === 'puri' ? 'Puri backs (Panipuri + Akabare — the bluff surface)' : 'Power backs (Vinegar · Dahi · Naya Plate · Chaat)');
    for (const [i, color] of colors.entries()) {
      const x = M + i * (THUMB + GAP);
      comps.push({ input: await thumb(pngs[kind][color], THUMB), left: x, top: y });
      svgOverlay += label(x + THUMB / 2, y + TH + 22, `${kind} · ${color}`, 15, 'middle');
    }
    y += TH + 64;
  }
  // Row 3: fronts under their matching-colour backs
  rowTitle('Print-sheet fronts, each under its own colour’s backs (style comparison)');
  for (const [i, color] of colors.entries()) {
    const front = FRONTS.find((f) => f[0] === color) ?? FRONTS[i % FRONTS.length];
    const file = path.join(SHEETS, `${PLAYER_FILE[color]}_${front[1]}.png`);
    const x = M + i * (THUMB + GAP);
    comps.push({ input: await sharp(file).resize(THUMB, TH, { kernel: 'lanczos3' }).png().toBuffer(), left: x, top: y });
    svgOverlay += label(x + THUMB / 2, y + TH + 22, `${front[1].replace('_1', '')} front · ${front[2]} back`, 15, 'middle');
  }
  y += TH + 64;

  // Strip at 44px: shuffled puri / power so distinguishability is tested, not pattern-matched.
  const tinyH = Math.round((TINY * H) / W); // 62
  const order = [];
  colors.forEach((c, i) => {
    const a = ['puri', 'power'];
    if (i % 2) a.reverse();
    order.push(...a.map((k) => [k, c]));
  });
  for (let i = order.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const tiny = {};
  for (const kind of ['puri', 'power']) for (const c of colors) tiny[`${kind}-${c}`] = await thumb(pngs[kind][c], TINY);

  const stripGap = 10;
  const stripW = order.length * TINY + (order.length - 1) * stripGap;
  // Fanned stacks: 3 puri backs of mixed owners, 14px vertical offset, power card beside each.
  const stacks = colors.map((c, i) => ({ owner: c, cards: [colors[(i + 2) % cols], colors[(i + 4) % cols], c] }));
  const FAN = 14;
  const stackBlockW = TINY * 2 + 6;
  const stackH = tinyH + FAN * 2;

  async function stripComposite(ox, oy) {
    const list = [];
    order.forEach(([k, c], i) => list.push({ input: tiny[`${k}-${c}`], left: ox + i * (TINY + stripGap), top: oy }));
    const sy = oy + tinyH + 34;
    stacks.forEach((s, i) => {
      const sx = ox + i * (stackBlockW + 22);
      s.cards.forEach((c, j) => list.push({ input: tiny[`puri-${c}`], left: sx, top: sy + j * FAN }));
      list.push({ input: tiny[`power-${s.owner}`], left: sx + TINY + 6, top: sy + FAN * 2 });
    });
    return { list, height: tinyH + 34 + stackH };
  }

  rowTitle('In-game size: every back at 44px wide (shuffled) · fanned stacks with the owner’s power beside each');
  const strip = await stripComposite(M, y + 8);
  comps.push(...strip.list);
  // answer key under the strip
  order.forEach(([k], i) => { svgOverlay += label(M + i * (TINY + stripGap) + TINY / 2, y + 8 + tinyH + 16, k === 'puri' ? 'pu' : 'pw', 11, 'middle'); });
  y += 8 + strip.height + M;
  const sheetH = y;
  const sheetWidth = Math.max(sheetW, M * 2 + stripW, M * 2 + cols * (stackBlockW + 22));

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetH}">${svgOverlay}</svg>`);
  await sharp({ create: { width: sheetWidth, height: sheetH, channels: 3, background: BG } })
    .composite([...comps, { input: overlay, left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT, 'contact.png'));

  // Native-pixel strip on its own (a downscaled contact sheet would lie about 44px legibility).
  const own = await stripComposite(16, 16);
  await sharp({ create: { width: Math.max(stripW, cols * (stackBlockW + 22)) + 32, height: own.height + 32, channels: 3, background: BG } })
    .composite(own.list)
    .png()
    .toFile(path.join(OUT, 'strip-44.png'));

  console.log(`→ ${path.relative(process.cwd(), path.join(OUT, 'contact.png'))} (${sheetWidth}×${sheetH})`);
  console.log(`→ ${path.relative(process.cwd(), path.join(OUT, 'strip-44.png'))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
