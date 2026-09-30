#!/usr/bin/env node
/**
 * Extract the six unique card illustrations from the 750×1050 print-sheet fronts.
 *
 *   node scripts/extract-art.mjs            → writes public/art/<kind>.webp
 *   node scripts/extract-art.mjs --check    → detect + verify only, write nothing
 *
 * What it does
 *  1. For every front PNG (6 colours × 10 cards) it samples the frame fill colour.
 *  2. Per card, it stacks the 6 colour variants: pixels that are bit-identical
 *     across all colours are art (the frame fill differs by definition). The
 *     illustration square is the block of rows/columns that are mostly such
 *     pixels (the shared title / index circle are far too sparse to qualify),
 *     then shrunk until no edge row/column holds a single colour-dependent pixel
 *     — tight inside the painted square, keeping its own deckled paper edge. It
 *     also checks the 1px ring just outside the box is 100% frame fill.
 *  3. It verifies with pixel diffs that the art is identical across the 6 player
 *     colours and across panipuri_1..5, and reports the max channel diff.
 *  4. It writes public/art/{panipuri,akabare,vinegar,dahi,khali,chaat}.webp at
 *     native resolution, plus print/art-extract-report.json.
 */
import sharp from 'sharp';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = path.join(ROOT, 'source_assets/print_sheets');
const OUT_DIR = path.join(ROOT, 'public/art');
const REPORT = path.join(ROOT, 'print/art-extract-report.json');
const CHECK_ONLY = process.argv.includes('--check');

const COLORS = [
  ['player1', 'red'],
  ['player2', 'blue'],
  ['player3', 'yellow'],
  ['player4', 'green'],
  ['player5', 'purple'],
  ['player6', 'orange'],
];
/** art id → the print-sheet card names that carry it */
const ART = {
  panipuri: ['panipuri_1', 'panipuri_2', 'panipuri_3', 'panipuri_4', 'panipuri_5'],
  akabare: ['akabare'],
  vinegar: ['vinegar'],
  dahi: ['dahi'],
  khali: ['khali'],
  chaat: ['chaat'],
};

/** Channel distance at which a pixel counts as "not the frame fill". */
const FILL_TOL = 10;
/** Inside the inner cream line (measured: inner line is 3px wide centred on x/y = 39 and 711/1011). */
const INNER = { x0: 42, y0: 42, x1: 708, y1: 1008 };

async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 750 || info.height !== 1050) throw new Error(`${file}: expected 750×1050, got ${info.width}×${info.height}`);
  return { data, width: info.width, height: info.height };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Most common colour in the empty lower third — that's the frame fill. */
function sampleFill(img) {
  const counts = new Map();
  for (let y = 800; y < 900; y += 2) {
    for (let x = 60; x < 620; x += 2) {
      const k = px(img, x, y).join(',');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best[0].split(',').map(Number);
}

const isFill = (c, fill) =>
  Math.abs(c[0] - fill[0]) <= FILL_TOL && Math.abs(c[1] - fill[1]) <= FILL_TOL && Math.abs(c[2] - fill[2]) <= FILL_TOL;

/**
 * Find the illustration square for one card kind from its 6 colour variants.
 * The art is painted identically on every colour, the frame fill is not — so a
 * pixel that is bit-identical across all 6 colours is art (or the shared cream
 * lines / title / index circle, which are far too sparse to form dense rows).
 * (Testing "differs from the fill" instead fails: the red Akabare art and the
 * green Panipuri art both contain pixels within a few levels of their frame.)
 */
function detectBBox(variants) {
  const { x0, y0, x1, y1 } = INNER;
  const W = variants[0].img.width;
  const invariant = (x, y) => {
    const i = (y * W + x) * 3;
    const a = variants[0].img.data;
    for (let k = 1; k < variants.length; k++) {
      const b = variants[k].img.data;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
    }
    return true;
  };
  const w = x1 - x0;
  const rowCounts = [];
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (invariant(x, y)) n++;
    rowCounts.push(n);
  }
  // Longest run of rows that are mostly art.
  let best = null;
  let start = -1;
  for (let i = 0; i <= rowCounts.length; i++) {
    const dense = i < rowCounts.length && rowCounts[i] > 0.6 * w;
    if (dense && start < 0) start = i;
    if (!dense && start >= 0) {
      if (!best || i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  if (!best) throw new Error('no illustration rows found');
  let top = y0 + best[0];
  let bottom = y0 + best[1] - 1;
  const h = bottom - top + 1;
  const colCounts = [];
  for (let x = x0; x < x1; x++) {
    let n = 0;
    for (let y = top; y <= bottom; y++) if (invariant(x, y)) n++;
    colCounts.push(n);
  }
  let left = x0 + colCounts.findIndex((n) => n > 0.6 * h);
  let right = x0 + colCounts.length - 1 - [...colCounts].reverse().findIndex((n) => n > 0.6 * h);

  // Tighten until every edge row/column is 100% art: no pixel that varies with
  // the player colour (i.e. no frame fill or fill-blended anti-aliasing).
  const rowClean = (y) => { for (let x = left; x <= right; x++) if (!invariant(x, y)) return false; return true; };
  const colClean = (x) => { for (let y = top; y <= bottom; y++) if (!invariant(x, y)) return false; return true; };
  for (let guard = 0; guard < 40; guard++) {
    let changed = false;
    if (!rowClean(top)) { top++; changed = true; }
    if (!rowClean(bottom)) { bottom--; changed = true; }
    if (!colClean(left)) { left++; changed = true; }
    if (!colClean(right)) { right--; changed = true; }
    if (!changed) break;
  }
  // How much of the ring just outside the box is frame fill (should be ~100%).
  let ring = 0;
  let ringFill = 0;
  const v0 = variants[0];
  for (let x = left - 1; x <= right + 1; x++) for (const y of [top - 1, bottom + 1]) { ring++; if (isFill(px(v0.img, x, y), v0.fill)) ringFill++; }
  for (let y = top; y <= bottom; y++) for (const x of [left - 1, right + 1]) { ring++; if (isFill(px(v0.img, x, y), v0.fill)) ringFill++; }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1, outsideRingFill: +(ringFill / ring).toFixed(4) };
}

function crop(img, b) {
  const out = Buffer.alloc(b.width * b.height * 3);
  for (let y = 0; y < b.height; y++) {
    const src = ((b.y + y) * img.width + b.x) * 3;
    img.data.copy(out, y * b.width * 3, src, src + b.width * 3);
  }
  return out;
}

function diff(a, b) {
  let max = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    if (d) n++;
  }
  return { max, differing: n };
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

async function main() {
  const report = { fills: {}, bboxes: {}, verification: {}, outputs: {} };
  const bboxes = [];
  const crops = {}; // art → [{ name, buf }]
  const images = {}; // file → img

  for (const [player, color] of COLORS) {
    for (const cards of Object.values(ART)) {
      for (const card of cards) {
        const name = `${player}_${color}_${card}.png`;
        const img = await load(path.join(SHEETS, name));
        const fill = sampleFill(img);
        images[name] = { img, fill };
        report.fills[color] ??= hex(fill);
        if (report.fills[color] !== hex(fill)) throw new Error(`${name}: fill ${hex(fill)} ≠ ${report.fills[color]}`);
      }
    }
  }
  // Detect per card name (e.g. "vinegar", "panipuri_3") across the 6 colours.
  for (const cards of Object.values(ART)) {
    for (const card of cards) {
      const variants = COLORS.map(([player, color]) => images[`${player}_${color}_${card}.png`]);
      bboxes.push({ name: card, ...detectBBox(variants) });
    }
  }

  // One common bbox: the intersection of every per-file box (they should all agree).
  const common = bboxes.reduce(
    (acc, b) => ({
      x0: Math.max(acc.x0, b.x), y0: Math.max(acc.y0, b.y),
      x1: Math.min(acc.x1, b.x + b.width - 1), y1: Math.min(acc.y1, b.y + b.height - 1),
    }),
    { x0: 0, y0: 0, x1: 749, y1: 1049 },
  );
  const bbox = { x: common.x0, y: common.y0, width: common.x1 - common.x0 + 1, height: common.y1 - common.y0 + 1 };
  const distinct = [...new Set(bboxes.map((b) => `${b.x},${b.y},${b.width}x${b.height}`))];
  report.bbox = bbox;
  report.bboxes = Object.fromEntries(bboxes.map(({ name, ...b }) => [name, b]));
  console.log(`bbox: x ${bbox.x}–${bbox.x + bbox.width - 1}, y ${bbox.y}–${bbox.y + bbox.height - 1} (${bbox.width}×${bbox.height})`);
  if (distinct.length > 1) console.log(`  per-card boxes varied: ${distinct.join(' | ')}`);
  console.log(`  frame fill on the 1px ring outside the box: ${Math.min(...bboxes.map((b) => b.outsideRingFill)) * 100}% (min over cards)`);
  console.log('frame fills:', report.fills);

  for (const [player, color] of COLORS) {
    for (const [art, cards] of Object.entries(ART)) {
      for (const card of cards) {
        const name = `${player}_${color}_${card}.png`;
        (crops[art] ??= []).push({ name, buf: crop(images[name].img, bbox) });
      }
    }
  }

  let worst = 0;
  for (const [art, list] of Object.entries(crops)) {
    const ref = list[0];
    let max = 0;
    let differing = 0;
    for (const c of list.slice(1)) {
      const d = diff(ref.buf, c.buf);
      max = Math.max(max, d.max);
      differing = Math.max(differing, d.differing);
    }
    worst = Math.max(worst, max);
    report.verification[art] = { variants: list.length, maxChannelDiff: max, maxDifferingBytes: differing };
    console.log(`verify ${art.padEnd(8)} ${String(list.length).padStart(2)} variants → max channel diff ${max}, differing bytes ${differing}`);
  }

  if (CHECK_ONLY) return;
  await mkdir(OUT_DIR, { recursive: true });
  for (const [art, list] of Object.entries(crops)) {
    let buf = list[0].buf;
    if (report.verification[art].maxChannelDiff > 0) {
      // Not bit-identical: use the per-byte median of all variants (robust to stray pixels).
      buf = Buffer.alloc(list[0].buf.length);
      const vals = new Array(list.length);
      for (let i = 0; i < buf.length; i++) {
        for (let k = 0; k < list.length; k++) vals[k] = list[k].buf[i];
        vals.sort((a, b) => a - b);
        buf[i] = vals[vals.length >> 1];
      }
    }
    const out = path.join(OUT_DIR, `${art}.webp`);
    await sharp(buf, { raw: { width: bbox.width, height: bbox.height, channels: 3 } })
      .webp({ quality: 88, smartSubsample: true, effort: 6 })
      .toFile(out);
    const { size } = await stat(out);
    report.outputs[art] = { file: path.relative(ROOT, out), width: bbox.width, height: bbox.height, bytes: size };
    console.log(`wrote ${path.relative(ROOT, out)}  ${bbox.width}×${bbox.height}  ${(size / 1024).toFixed(1)} KB`);
  }
  await mkdir(path.dirname(REPORT), { recursive: true });
  await writeFile(REPORT, JSON.stringify({ ...report, worstChannelDiff: worst }, null, 2) + '\n');
  console.log(`report → ${path.relative(ROOT, REPORT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
