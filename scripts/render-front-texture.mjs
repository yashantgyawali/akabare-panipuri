#!/usr/bin/env node
/**
 * Paper textures for the HTML/CSS card fronts (src/cards/Card.tsx, cards.css).
 *
 *   node scripts/render-front-texture.mjs [--preview]
 *
 * Writes two neutral-grey images that cards.css blends onto the owner colour with
 * `background-blend-mode: soft-light` (grey 128 = no change), so ONE pair of files
 * serves all six colours and costs nothing per card:
 *
 *   public/art/front-wash.webp   375×525  low-frequency gouache mottling + a soft vignette,
 *                                          stretched to the card (it is smooth, so 1x is enough)
 *   public/art/front-grain.webp  256×256  seamless fine paper tooth, tiled at 1/3 card width
 *
 * --preview also writes print/front-texture-check.png (the textures on every owner colour).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COLORS } from '../src/engine/types.ts';
import { PLAYER_PALETTE } from '../src/cards/palette.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/art');

// Wash: two octaves of low-frequency noise (big soft blooms + smaller pigment pooling),
// pushed into a narrow band round mid-grey, then a radial vignette darkens the edges.
const W = 375;
const H = 525;
const washSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="wash" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.009" numOctaves="3" seed="7" result="big"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="21" result="small"/>
      <feComposite in="big" in2="small" operator="arithmetic" k1="0" k2="0.72" k3="0.28" k4="0"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.62" intercept="0.19"/>
        <feFuncG type="linear" slope="0.62" intercept="0.19"/>
        <feFuncB type="linear" slope="0.62" intercept="0.19"/>
        <feFuncA type="linear" slope="0" intercept="1"/>
      </feComponentTransfer>
    </filter>
    <radialGradient id="vig" cx="50%" cy="44%" r="72%">
      <stop offset="0" stop-color="#9a9a9a" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#808080" stop-opacity="0"/>
      <stop offset="1" stop-color="#303030" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#808080"/>
  <rect width="${W}" height="${H}" filter="url(#wash)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;

// Grain: seamless (stitchTiles) high-frequency tooth, low contrast.
const G = 256;
const grainSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${G}" height="${G}" viewBox="0 0 ${G} ${G}">
  <defs>
    <filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="3" seed="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0.8" intercept="0.1"/>
        <feFuncG type="linear" slope="0.8" intercept="0.1"/>
        <feFuncB type="linear" slope="0.8" intercept="0.1"/>
        <feFuncA type="linear" slope="0" intercept="1"/>
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="${G}" height="${G}" filter="url(#g)"/>
</svg>`;

async function toGreyWebp(svg, quality) {
  // Re-centre on 128 so soft-light is neutral on average, whatever the noise mean came out as.
  const raw = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) sum += data[i];
  const shift = 128 - sum / (data.length / info.channels);
  const grey = Buffer.alloc(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) grey[j] = Math.max(0, Math.min(255, Math.round(data[i] + shift)));
  const img = sharp(grey, { raw: { width: info.width, height: info.height, channels: 1 } });
  return { buf: await img.clone().toColourspace('srgb').webp({ quality, effort: 6 }).toBuffer(), shift };
}

await mkdir(OUT, { recursive: true });
const wash = await toGreyWebp(washSvg, 82);
const grain = await toGreyWebp(grainSvg, 70);
await writeFile(path.join(OUT, 'front-wash.webp'), wash.buf);
await writeFile(path.join(OUT, 'front-grain.webp'), grain.buf);
console.log(`→ public/art/front-wash.webp  ${W}×${H}  ${(wash.buf.length / 1024).toFixed(1)} KB (mean shift ${wash.shift.toFixed(1)})`);
console.log(`→ public/art/front-grain.webp ${G}×${G}  ${(grain.buf.length / 1024).toFixed(1)} KB (mean shift ${grain.shift.toFixed(1)})`);

if (process.argv.includes('--preview')) {
  // Approximate CSS soft-light (W3C formula) per colour so the effect can be judged without a browser.
  const wRaw = await sharp(wash.buf).greyscale().raw().toBuffer();
  const gRaw = await sharp(grain.buf).greyscale().raw().toBuffer();
  const soft = (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  };
  const tiles = [];
  for (const [i, c] of COLORS.entries()) {
    const hex = PLAYER_PALETTE[c].base;
    const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    const px = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ws = wRaw[y * W + x] / 255;
      const gs = gRaw[((y * 3) % G) * G + ((x * 3) % G)] / 255; // tile at ~1/3 card width
      for (let k = 0; k < 3; k++) px[(y * W + x) * 3 + k] = Math.round(soft(soft(rgb[k], gs), ws) * 255);
    }
    tiles.push({ input: await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(), left: 20 + i * (W + 20), top: 20 });
  }
  await sharp({ create: { width: 20 + COLORS.length * (W + 20), height: H + 40, channels: 3, background: '#221510' } })
    .composite(tiles)
    .png()
    .toFile(path.join(ROOT, 'print/front-texture-check.png'));
  console.log('→ print/front-texture-check.png');
}
