#!/usr/bin/env node
/** Render print/palette-check.png: every player's shades + the fixed accents, for eyeballing. */
import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as P from '../src/cards/palette.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'print/palette-check.png');
const keys = ['base', 'deep', 'darker', 'light', 'ink', 'onBase'];
const W = 150, H = 110, PAD = 20, LABEL = 110;
const colors = Object.keys(P.PLAYER_PALETTE);
let svg = '';
colors.forEach((c, r) => {
  const pal = P.PLAYER_PALETTE[c];
  const y = PAD + r * (H + 14);
  svg += `<text x="${PAD}" y="${y + H / 2 + 6}" font-family="Helvetica" font-size="20" fill="${P.CREAM}">${pal.name}</text>`;
  keys.forEach((k, i) => {
    const x = PAD + LABEL + i * (W + 10);
    const txt = P.contrastRatio(pal[k], P.CREAM) > P.contrastRatio(pal[k], P.INK) ? P.CREAM : P.INK;
    svg += `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10" fill="${pal[k]}" stroke="${P.CREAM}" stroke-opacity=".5"/>`;
    svg += `<text x="${x + 10}" y="${y + 24}" font-family="Helvetica" font-size="15" fill="${txt}">${k}</text>`;
    svg += `<text x="${x + 10}" y="${y + H - 12}" font-family="Menlo" font-size="15" fill="${txt}">${pal[k]}</text>`;
  });
  // cream + ink on base legibility sample
  const x = PAD + LABEL + keys.length * (W + 10);
  svg += `<rect x="${x}" y="${y}" width="${W + 40}" height="${H}" rx="10" fill="${pal.base}"/>`;
  svg += `<text x="${x + 12}" y="${y + 44}" font-family="Helvetica" font-weight="bold" font-size="28" fill="${pal.onBase}">PURI</text>`;
  svg += `<text x="${x + 12}" y="${y + 86}" font-family="Helvetica" font-size="16" fill="${pal.onBase}">${P.contrastRatio(pal.onBase, pal.base).toFixed(2)}:1 onBase</text>`;
});
const accents = { CREAM: P.CREAM, CREAM_BRIGHT: P.CREAM_BRIGHT, PAPER: P.PAPER, INK: P.INK, INK_SOFT: P.INK_SOFT, GOLD: P.GOLD, CHILI: P.CHILI, LEAF: P.LEAF, 'PURI light': P.PURI_GOLD.light, 'PURI mid': P.PURI_GOLD.mid, 'PURI deep': P.PURI_GOLD.deep };
const ay = PAD + colors.length * (H + 14) + 10;
Object.entries(accents).forEach(([k, v], i) => {
  const x = PAD + i * 118;
  const light = P.contrastRatio(v, P.INK) > P.contrastRatio(v, P.CREAM);
  svg += `<rect x="${x}" y="${ay}" width="108" height="${H}" rx="10" fill="${v}" stroke="${P.CREAM}" stroke-opacity=".25"/>`;
  svg += `<text x="${x + 8}" y="${ay + 22}" font-family="Helvetica" font-size="13" fill="${light ? P.INK : P.CREAM}">${k}</text>`;
  svg += `<text x="${x + 8}" y="${ay + H - 12}" font-family="Menlo" font-size="13" fill="${light ? P.INK : P.CREAM}">${v}</text>`;
});
const width = PAD * 2 + Math.max(LABEL + keys.length * (W + 10) + W + 40, Object.keys(accents).length * 118);
const height = ay + H + PAD;
await mkdir(path.dirname(OUT), { recursive: true });
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#241611"/>${svg}</svg>`)).png().toFile(OUT);
console.log(JSON.stringify(P.PLAYER_PALETTE, null, 1));
console.log('→', path.relative(ROOT, OUT));
