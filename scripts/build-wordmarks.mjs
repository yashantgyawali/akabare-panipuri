#!/usr/bin/env node
/**
 * Build outlined wordmarks for the card art.
 *
 *   node scripts/build-wordmarks.mjs                 → src/cards/wordmarks.ts + print/wordmark-check.png
 *   node scripts/build-wordmarks.mjs --font=yatra    → same strings in Yatra One (for comparison)
 *   node scripts/build-wordmarks.mjs --out=<file.ts> --png=<file.png>
 *
 * Text is SHAPED with HarfBuzz (harfbuzzjs), so Devanagari reordering, matras,
 * conjuncts and GPOS mark positioning come out exactly as the font intends —
 * never naive per-codepoint glyphs. Each shaped glyph is converted to an SVG
 * path, positioned by the shaper's advances/offsets, flipped to SVG's y-down
 * space and scaled so that the font's CAP HEIGHT = 100 units (in Rozha One the
 * Devanagari headline sits at the same height as the Latin caps, so one scale
 * serves both scripts). Baseline is y = 0, ink starts at x = 0.
 *
 * The emitted TS module is dependency-free and uses only erasable TS syntax so
 * Node (type-stripping), Vite and Deno can all import it.
 */
import * as hb from 'harfbuzzjs';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARD_INFO, BACK_COPY } from '../src/cards/content.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const FONTS = {
  rozha: { family: 'Rozha One', file: 'assets/fonts/RozhaOne-Regular.ttf' },
  yatra: { family: 'Yatra One', file: 'assets/fonts/YatraOne-Regular.ttf' },
  tiro: { family: 'Tiro Devanagari Hindi', file: 'assets/fonts/TiroDevanagariHindi-Regular.ttf' },
};
const FONT_KEY = arg('font', 'rozha');
const FONT = FONTS[FONT_KEY];
if (!FONT) throw new Error(`unknown --font=${FONT_KEY} (have: ${Object.keys(FONTS).join(', ')})`);
const OUT_TS = path.resolve(ROOT, arg('out', 'src/cards/wordmarks.ts'));
const OUT_PNG = path.resolve(ROOT, arg('png', 'print/wordmark-check.png'));

/** Every string the card art needs. The id IS the text. */
const STRINGS = [
  ...new Set([
    'AKABARE',
    'PANIPURI',
    BACK_COPY.puri.title,
    BACK_COPY.power.title,
    BACK_COPY.puri.devanagari,
    BACK_COPY.power.devanagari,
    ...Object.values(CARD_INFO).flatMap((c) => [c.title, c.devanagari]),
  ]),
];

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
const r1 = (v) => {
  const n = Math.round(v * 10) / 10;
  return Object.is(n, -0) ? 0 : n;
};
/** Compact number formatting for path data: "-0.5" → "-.5", "12.0" → "12". */
const fmt = (v) => {
  const s = String(r1(v));
  return s.replace(/^(-?)0\./, '$1.');
};

async function loadFont(file) {
  const data = await readFile(path.join(ROOT, file));
  const face = new hb.Face(new hb.Blob(data));
  const font = new hb.Font(face);
  const capGlyph = font.glyph('H'.codePointAt(0));
  const capFromGlyph = capGlyph ? font.glyphExtents(capGlyph)?.yBearing : undefined;
  let capHeight = 0;
  try { capHeight = font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) ?? 0; } catch { /* older builds */ }
  if (!capHeight) capHeight = capFromGlyph;
  return { face, font, upem: face.upem, capHeight };
}

/**
 * Shape `text` and return its outline as positioned parts.
 * Latin: one part per glyph cluster (so letters can be tracked apart).
 * Devanagari: one part per word (tracking must never break the headline).
 */
function shapeText(F, text, scale) {
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(F.font, buf);
  const glyphs = buf.getGlyphInfosAndPositions();

  // UTF-16 cluster offsets → character index, to find word boundaries / letter slots.
  const isDeva = DEVANAGARI.test(text);
  const clusterSlot = (cluster) => {
    const before = text.slice(0, cluster);
    return isDeva ? before.split(' ').length - 1 : [...before].length;
  };

  let penX = 0;
  let penY = 0;
  const parts = new Map(); // slot → commands[]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const glyphLog = [];
  for (const g of glyphs) {
    const gid = g.codepoint;
    const ox = penX + (g.xOffset ?? 0);
    const oy = penY + (g.yOffset ?? 0);
    const cmds = F.font.glyphToJson(gid);
    glyphLog.push({ gid, name: safeName(F.font, gid), cluster: g.cluster, x: ox, y: oy, adv: g.xAdvance });
    if (cmds.length) {
      const slot = clusterSlot(g.cluster);
      const list = parts.get(slot) ?? [];
      for (const c of cmds) {
        const vals = [];
        for (let i = 0; i < c.values.length; i += 2) {
          const x = (c.values[i] + ox) * scale;
          const y = -(c.values[i + 1] + oy) * scale;
          vals.push(x, y);
          // Bounds from on-curve AND control points is conservative; refined below from on-curve only.
        }
        list.push({ type: c.type, vals });
      }
      parts.set(slot, list);
    }
    penX += g.xAdvance ?? 0;
    penY += g.yAdvance ?? 0;
  }
  // Tight ink bounds: sample the actual curves (quadratic/cubic) so control points don't inflate the box.
  for (const list of parts.values()) {
    let cx = 0, cy = 0;
    for (const c of list) {
      const v = c.vals;
      const pts = [];
      if (c.type === 'M' || c.type === 'L') pts.push([v[0], v[1]]);
      else if (c.type === 'Q') for (let t = 0; t <= 1.0001; t += 0.05) { const u = 1 - t; pts.push([u * u * cx + 2 * u * t * v[0] + t * t * v[2], u * u * cy + 2 * u * t * v[1] + t * t * v[3]]); }
      else if (c.type === 'C') for (let t = 0; t <= 1.0001; t += 0.05) { const u = 1 - t; pts.push([u * u * u * cx + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t * v[4], u * u * u * cy + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t * v[5]]); }
      for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (v.length >= 2) { cx = v[v.length - 2]; cy = v[v.length - 1]; }
    }
  }
  // Shift so ink starts at x = 0 (baseline stays at y = 0).
  const out = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([slot, list]) => ({
    slot,
    d: list.map((c) => {
      if (c.type === 'Z') return 'Z';
      const vs = [];
      for (let i = 0; i < c.vals.length; i += 2) vs.push(fmt(c.vals[i] - minX), fmt(c.vals[i + 1]));
      return c.type + vs.join(' ').replace(/ -/g, '-');
    }).join(''),
  }));
  return {
    parts: out,
    width: r1(maxX - minX),
    height: r1(maxY - minY),
    ascent: r1(-minY),
    advance: r1(penX * scale),
    glyphs: glyphLog,
  };
}

function safeName(font, gid) {
  try { return font.glyphName(gid); } catch { return String(gid); }
}

function emitTs(entries, meta) {
  const ids = entries.map((e) => e.id);
  const q = (s) => JSON.stringify(s);
  const rows = entries.map((e) => [
    `  ${q(e.id)}: {`,
    `    width: ${e.width}, height: ${e.height}, ascent: ${e.ascent},`,
    `    slots: [${e.parts.map((p) => p.slot).join(', ')}],`,
    `    parts: [`,
    ...e.parts.map((p) => `      ${q(p.d)},`),
    `    ],`,
    `  },`,
  ].join('\n'));
  return `/**
 * AUTO-GENERATED by scripts/build-wordmarks.mjs — do not edit by hand.
 *
 * Outlined, HarfBuzz-shaped wordmarks in ${meta.family} (${meta.file}, SIL OFL 1.1).
 * Units: the font's cap height = 100 (Devanagari headline sits at the same
 * height in this face). Baseline at y = 0 (SVG y-down: ink above the baseline
 * is negative y), ink starts at x = 0.
 *
 *   width   ink width
 *   height  ink height (ascent + descent)
 *   ascent  ink top above the baseline
 *   d       the whole outline as one absolute path (M/L/Q/C/Z only)
 *
 * Use wordmarkSvg() to place one: it returns a single '<path …/>' string that
 * renders identically in browsers, librsvg (sharp) and resvg — no font needed.
 */

export const WORDMARK_FONT = {
  family: ${q(meta.family)},
  file: ${q(meta.file)},
  upem: ${meta.upem},
  /** Cap height in font units; 1 wordmark unit = capHeight / 100 font units. */
  capHeight: ${meta.capHeight},
} as const;

export const WORDMARK_IDS = [
${ids.map((id) => `  ${q(id)},`).join('\n')}
] as const;

export type WordmarkId = (typeof WORDMARK_IDS)[number];

export interface Wordmark {
  text: string;
  d: string;
  width: number;
  height: number;
  ascent: number;
  /**
   * The outline split into trackable parts (Latin: one per letter;
   * Devanagari: one per word, so the headline never breaks).
   */
  parts: readonly string[];
  /** Tracking multiplier per part: part i moves right by slots[i] × tracking. */
  slots: readonly number[];
}

interface RawWordmark {
  width: number;
  height: number;
  ascent: number;
  slots: number[];
  parts: string[];
}

const RAW: Record<WordmarkId, RawWordmark> = {
${rows.join('\n')}
};

export const WORDMARKS = Object.fromEntries(
  WORDMARK_IDS.map((id) => [id, { text: id, ...RAW[id], d: RAW[id].parts.join('') }]),
) as unknown as Record<WordmarkId, Wordmark>;

export function isWordmarkId(text: string): text is WordmarkId {
  return (WORDMARK_IDS as readonly string[]).includes(text);
}

export interface WordmarkOptions {
  /** Anchor x (see \`anchor\`). Default 0. */
  x?: number;
  /** Anchor y (see \`valign\`). Default 0. */
  y?: number;
  /** Rendered CAP height in output units (the 100-unit reference). Default 100. */
  height?: number;
  /** Shrink (never grow) so the ink width fits. */
  maxWidth?: number;
  /** Extra space between letters (Latin) / words (Devanagari), in OUTPUT units. Default 0. */
  tracking?: number;
  fill?: string;
  stroke?: string;
  /** Stroke width in OUTPUT units (compensated for the scale). */
  strokeWidth?: number;
  /** Horizontal anchor on the ink box. Default 'middle'. */
  anchor?: 'start' | 'middle' | 'end';
  /** Vertical anchor: baseline (default), ink top, ink middle, ink bottom, or middle of the cap height. */
  valign?: 'baseline' | 'top' | 'middle' | 'bottom' | 'cap-middle';
  /** Extra raw attributes, e.g. 'filter="url(#ink)" opacity=".9"'. */
  attrs?: string;
}

/** Move every x coordinate of an absolute M/L/Q/C/Z path by dx. */
function shiftPath(d: string, dx: number): string {
  if (!dx) return d;
  let i = 0;
  return d.replace(/[MLQCZ]|-?(?:\\d+\\.?\\d*|\\.\\d+)/g, (tok) => {
    if (/[MLQCZ]/.test(tok)) { i = 0; return tok; }
    const v = i++ % 2 === 0 ? Math.round((parseFloat(tok) + dx) * 10) / 10 : parseFloat(tok);
    return (v < 0 ? '' : ' ') + String(v);
  }).replace(/([MLQCZ]) /g, '$1');
}

/** Size of a placed wordmark in OUTPUT units (before x/y anchoring). */
export function wordmarkMetrics(id: WordmarkId, opts: Pick<WordmarkOptions, 'height' | 'maxWidth' | 'tracking'> = {}): {
  scale: number; width: number; ascent: number; descent: number; capHeight: number;
} {
  const w = WORDMARKS[id];
  const maxSlot = w.slots.length ? w.slots[w.slots.length - 1] - w.slots[0] : 0;
  let scale = (opts.height ?? 100) / 100;
  const tracking = opts.tracking ?? 0;
  let width = w.width * scale + tracking * maxSlot;
  if (opts.maxWidth && width > opts.maxWidth) {
    // tracking is in output units, so only the glyph part scales
    scale = Math.max(0, (opts.maxWidth - tracking * maxSlot) / w.width);
    width = opts.maxWidth;
  }
  return { scale, width, ascent: w.ascent * scale, descent: (w.height - w.ascent) * scale, capHeight: 100 * scale };
}

/** Place a wordmark: returns one '<path …/>' string. */
export function wordmarkSvg(id: WordmarkId, opts: WordmarkOptions = {}): string {
  const w = WORDMARKS[id];
  const m = wordmarkMetrics(id, opts);
  const s = m.scale;
  const tracking = opts.tracking ?? 0;
  const d = tracking && s
    ? w.parts.map((p, i) => shiftPath(p, ((w.slots[i] - w.slots[0]) * tracking) / s)).join('')
    : w.d;
  const anchor = opts.anchor ?? 'middle';
  const x0 = (opts.x ?? 0) - (anchor === 'middle' ? m.width / 2 : anchor === 'end' ? m.width : 0);
  const va = opts.valign ?? 'baseline';
  const base =
    va === 'top' ? m.ascent :
    va === 'bottom' ? -m.descent :
    va === 'middle' ? (m.ascent - m.descent) / 2 :
    va === 'cap-middle' ? m.capHeight / 2 : 0;
  const y0 = (opts.y ?? 0) + base;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const attrs = [
    \`d="\${d}"\`,
    \`transform="translate(\${r(x0)} \${r(y0)}) scale(\${r(s)})"\`,
    \`fill="\${opts.fill ?? 'currentColor'}"\`,
    opts.stroke ? \`stroke="\${opts.stroke}" stroke-width="\${r((opts.strokeWidth ?? 1) / (s || 1))}" stroke-linejoin="round" paint-order="stroke"\` : '',
    opts.attrs ?? '',
  ].filter(Boolean);
  return \`<path \${attrs.join(' ')}/>\`;
}
`;
}

async function renderCheck(entries, meta, file) {
  // Row per string: outlined path (ours) on the left, the system's own shaped
  // text rendering (Pango/HarfBuzz via librsvg, system Devanagari font) on the
  // right for comparison, plus baseline / cap-height / ink-box guides.
  const H = 64; // cap height px
  const rowH = 150;
  const leftX = 40;
  const refX = 1000;
  const width = Math.max(1800, ...entries.map((e) => Math.max(refX, leftX + e.width * 0.64 + 60) + e.width * 0.64 * 1.2 + 40));
  const height = 110 + entries.length * rowH;
  const { wordmarkSvg } = await import(`${pathToFileURL(OUT_TS).href}?t=${Date.now()}`);
  let body = '';
  entries.forEach((e, i) => {
    const y = 110 + i * rowH + 100; // baseline
    const s = H / 100;
    const w = e.width * s;
    body += `<line x1="${leftX - 10}" x2="${leftX + w + 10}" y1="${y}" y2="${y}" stroke="#7aa0ff" stroke-width="1"/>`;
    body += `<line x1="${leftX - 10}" x2="${leftX + w + 10}" y1="${y - H}" y2="${y - H}" stroke="#7aa0ff" stroke-width="1" stroke-dasharray="4 4"/>`;
    body += `<rect x="${leftX}" y="${y - e.ascent * s}" width="${w}" height="${e.height * s}" fill="none" stroke="#e98" stroke-width="1" stroke-dasharray="2 3"/>`;
    body += wordmarkSvg(e.id, { x: leftX, y, height: H, anchor: 'start', fill: '#3A2418' });
    // tracked variant for Latin, to prove the parts line up
    body += `<text x="${leftX}" y="${y + 38}" font-family="Menlo, monospace" font-size="15" fill="#6B4A33">${escapeXml(e.id)} · w ${e.width} h ${e.height} asc ${e.ascent} · ${e.glyphs.length} glyphs: ${escapeXml(e.glyphs.map((g) => g.name).join(' '))}</text>`;
    body += `<text x="${Math.max(refX, leftX + w + 60)}" y="${y}" font-family="${DEVANAGARI.test(e.id) ? 'Kohinoor Devanagari, Devanagari Sangam MN, ITF Devanagari, sans-serif' : 'Georgia, serif'}" font-size="${H * 1.4}" fill="#8a7a6a">${escapeXml(e.id)}</text>`;
  });
  body += `<text x="${leftX}" y="50" font-family="Helvetica" font-size="24" font-weight="bold" fill="#3A2418">Wordmarks — ${escapeXml(meta.family)} outlined via HarfBuzz (left) · system-shaped reference text (right, grey)</text>`;
  body += `<text x="${leftX}" y="80" font-family="Helvetica" font-size="16" fill="#6B4A33">blue solid = baseline, blue dashed = cap height (100 units), red dotted = ink box (width × height, ascent)</text>`;
  // A tracked sample
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 120}"><rect width="100%" height="100%" fill="#F5E8CA"/>${body}
    ${wordmarkSvg('AKABARE PANIPURI', { x: width / 2, y: height + 60, height: 48, tracking: 10, fill: '#B84A3A', stroke: '#3A2418', strokeWidth: 3 })}
    <text x="${leftX}" y="${height + 100}" font-family="Helvetica" font-size="15" fill="#6B4A33">tracked (10px) + stroked sample via wordmarkSvg()</text></svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
}

const escapeXml = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

async function main() {
  const F = await loadFont(FONT.file);
  const scale = 100 / F.capHeight;
  const entries = STRINGS.map((text) => ({ id: text, ...shapeText(F, text, scale) }));
  const meta = { ...FONT, upem: F.upem, capHeight: F.capHeight };
  const ts = emitTs(entries, meta);
  await mkdir(path.dirname(OUT_TS), { recursive: true });
  await writeFile(OUT_TS, ts);
  console.log(`${FONT.family}: upem ${F.upem}, cap height ${F.capHeight} → scale ${scale.toFixed(5)}`);
  for (const e of entries) {
    console.log(`  ${e.id.padEnd(18)} w ${String(e.width).padStart(6)} h ${String(e.height).padStart(6)} asc ${String(e.ascent).padStart(6)}  ${e.glyphs.map((g) => g.name).join(' ')}`);
  }
  console.log(`→ ${path.relative(ROOT, OUT_TS)} (${(ts.length / 1024).toFixed(1)} KB)`);
  await renderCheck(entries, meta, OUT_PNG);
  console.log(`→ ${path.relative(ROOT, OUT_PNG)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
