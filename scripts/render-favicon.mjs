#!/usr/bin/env node
/**
 * The favicon: one of the tavern villagers (Dai: Dhaka topi, moustache, a red
 * waistcoat) as 32x32 pixel art, with an akabare chili tucked behind his ear
 * like a pencil. Writes public/favicon.svg (crisp pixels) and PNG sizes for
 * browsers and home screens (favicon-32.png, apple-touch-icon.png, icon-192/512.png).
 *
 *   node scripts/render-favicon.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const N = 32;
const grid = Array.from({ length: N }, () => Array(N).fill(null));
const set = (x, y, c) => {
  if (x >= 0 && x < N && y >= 0 && y < N) grid[y][x] = c;
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
};

const C = {
  hair: '#1b1410',
  skin: '#c98e62',
  skinDark: '#a8714a',
  cheek: '#e0866f',
  white: '#ffffff',
  mouth: '#5a1f17',
  topiBase: '#f3ead8',
  red: '#d42a1e',
  orange: '#f28a1c',
  green: '#2d8a3e',
  blue: '#2350a8',
  vest: '#b84a3a',
  vestDark: '#8e3428',
  daura: '#efe6d2',
  chili: '#c8321a',
  chiliHi: '#f26b4a',
  chiliDark: '#8f1f10',
  stem: '#3f7a2a',
};

// --- shoulders: red waistcoat over a cream daura collar
rect(5, 27, 26, 31, C.vest);
rect(4, 29, 27, 31, C.vest);
rect(13, 27, 18, 27, C.daura);
rect(14, 28, 17, 28, C.daura);
rect(15, 29, 16, 31, C.daura);
set(14, 30, C.vestDark);
set(17, 30, C.vestDark);
// neck
rect(12, 25, 19, 26, C.skinDark);

// --- head
rect(8, 9, 23, 24, C.skin);
rect(23, 10, 23, 24, C.skinDark); // the side of the block, in shade
rect(9, 24, 22, 24, C.skinDark); // under the chin
// hair under the topi and sideburns
rect(8, 9, 23, 9, C.hair);
rect(8, 10, 8, 13, C.hair);
rect(23, 10, 23, 12, C.hair);
// brows
rect(10, 12, 13, 12, C.hair);
rect(18, 12, 21, 12, C.hair);
// eyes, with a highlight
rect(11, 14, 12, 16, C.hair);
rect(19, 14, 20, 16, C.hair);
set(11, 14, C.white);
set(19, 14, C.white);
// nose
rect(15, 16, 16, 19, C.skinDark);
// cheeks
rect(9, 19, 10, 19, C.cheek);
rect(21, 19, 22, 19, C.cheek);
// moustache
rect(12, 20, 19, 21, C.hair);
set(11, 22, C.hair);
set(20, 22, C.hair);
// mouth
rect(14, 23, 17, 23, C.mouth);
// left ear
rect(6, 14, 7, 18, C.skinDark);
set(6, 16, C.skin);

// --- the akabare, tucked behind the right ear: fat under its green cap, tapering
// down behind the ear, the curled tip peeking out by the jaw
const body = [
  // [y, x0, x1]
  [8, 27, 29],
  [9, 26, 29],
  [10, 26, 29],
  [11, 25, 28],
  [12, 25, 28],
  [13, 25, 27],
  [14, 25, 27],
  [15, 25, 27],
  [16, 25, 27],
  [17, 24, 26],
  [18, 24, 26],
  [19, 24, 26],
  [20, 24, 25],
  [21, 24, 25],
  [22, 25, 25],
  [23, 26, 26],
];
for (const [y, x0, x1] of body) {
  rect(x0, y, x1, y, C.chili);
  if (x1 > x0) set(x1, y, C.chiliDark);
  if (y >= 9 && y <= 13) set(x0, y, C.chiliHi);
}
// green cap and stem, curving up and out
rect(26, 7, 30, 7, C.stem);
rect(27, 6, 29, 6, C.stem);
set(29, 5, C.stem);
set(30, 4, C.stem);
set(31, 3, C.stem);

// --- right ear, in front of the chili
rect(24, 14, 26, 18, C.skin);
rect(26, 14, 26, 18, C.skinDark);
set(25, 15, C.skinDark);
set(25, 16, C.skinDark);

// --- Dhaka topi: a slanted cap, higher on the right, in bands of the weave
const topiRows = [
  { y: 2, x0: 19, colors: [C.red, C.topiBase] },
  { y: 3, x0: 15, colors: [C.topiBase, C.hair] },
  { y: 4, x0: 11, colors: [C.orange, C.topiBase] },
  { y: 5, x0: 8, colors: [C.topiBase, C.green] },
  { y: 6, x0: 8, colors: [C.red, C.red, C.topiBase] },
  { y: 7, x0: 8, colors: [C.topiBase, C.blue] },
  { y: 8, x0: 8, colors: [C.hair] },
];
for (const { y, x0, colors } of topiRows) {
  for (let x = x0; x <= 23; x++) set(x, y, colors[(x + y) % colors.length]);
}

// --- SVG with one rect per run of same-coloured pixels
let rects = '';
for (let y = 0; y < N; y++) {
  let x = 0;
  while (x < N) {
    const c = grid[y][x];
    if (!c) {
      x++;
      continue;
    }
    let w = 1;
    while (x + w < N && grid[y][x + w] === c) w++;
    rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`;
    x += w;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>\n`;
const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
writeFileSync(pub('favicon.svg'), svg);

// PNGs: nearest-neighbour upscales of the pixel art; the home-screen icons sit on the tavern brown.
const raw = Buffer.from(svg);
const crisp = (size) => sharp(raw, { density: 72 }).resize(size, size, { kernel: 'nearest' });
await crisp(32).png().toFile(pub('favicon-32.png'));
const onTavern = async (size, file) => {
  const pad = Math.round(size * 0.1);
  const inner = await crisp(size - pad * 2).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#2a170c' } })
    .composite([{ input: inner, left: pad, top: pad }])
    .png()
    .toFile(pub(file));
};
await onTavern(180, 'apple-touch-icon.png');
await onTavern(192, 'icon-192.png');
await onTavern(512, 'icon-512.png');
console.log('wrote public/favicon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png');
