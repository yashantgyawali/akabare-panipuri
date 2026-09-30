import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { COLORS, POWER_KINDS, PURI_KINDS } from '../engine/types.ts';
import { PLAYER_PALETTE, CREAM, INK, contrastRatio, hexToOklch, oklchToHex, mixOklab } from './palette.ts';
import { CARD_INFO, BACK_COPY, artUrl, cardIndex } from './content.ts';
import { WORDMARKS, WORDMARK_IDS, isWordmarkId, wordmarkSvg, wordmarkMetrics } from './wordmarks.ts';

const HEX = /^#[0-9A-F]{6}$/;

describe('palette', () => {
  it('has every colour with valid hex shades', () => {
    for (const c of COLORS) {
      const p = PLAYER_PALETTE[c];
      for (const k of ['base', 'deep', 'darker', 'light', 'ink', 'onBase'] as const) expect(p[k]).toMatch(HEX);
      expect(hexToOklch(p.deep).l).toBeLessThan(hexToOklch(p.base).l);
      expect(hexToOklch(p.darker).l).toBeLessThan(hexToOklch(p.deep).l);
      expect(hexToOklch(p.light).l).toBeGreaterThan(hexToOklch(p.base).l);
      expect([CREAM, INK]).toContain(p.onBase);
      expect(contrastRatio(p.onBase, p.base)).toBeGreaterThan(3.5);
      expect(contrastRatio(p.ink, CREAM)).toBeGreaterThan(7);
    }
  });
  it('round-trips OKLCH', () => {
    for (const c of COLORS) expect(oklchToHex(hexToOklch(PLAYER_PALETTE[c].base))).toBe(PLAYER_PALETTE[c].base);
    expect(mixOklab('#000000', '#FFFFFF', 0)).toBe('#000000');
  });
});

describe('content', () => {
  it('covers every card kind with existing art', () => {
    for (const k of [...PURI_KINDS, ...POWER_KINDS]) {
      const info = CARD_INFO[k];
      expect(info.title).toBe(info.title.toUpperCase());
      expect(existsSync(new URL(`../../public${info.art}`, import.meta.url))).toBe(true);
      expect(info.family).toBe((PURI_KINDS as readonly string[]).includes(k) ? 'puri' : 'power');
    }
    expect(cardIndex('panipuri', 4)).toBe(4);
    expect(cardIndex('chaat')).toBe(10);
    expect(artUrl('dahi', '/akabare/')).toBe('/akabare/art/dahi.webp');
  });
});

describe('wordmarks', () => {
  it('has a shaped outline for every string the cards need', () => {
    const needed = [BACK_COPY.puri.title, BACK_COPY.puri.devanagari, BACK_COPY.power.title, BACK_COPY.power.devanagari,
      ...Object.values(CARD_INFO).flatMap((c) => [c.title, c.devanagari])];
    for (const t of needed) {
      expect(isWordmarkId(t)).toBe(true);
      const w = WORDMARKS[t as (typeof WORDMARK_IDS)[number]];
      expect(w.d).toMatch(/^M[-\d.]/);
      expect(w.width).toBeGreaterThan(0);
      expect(w.parts.length).toBe(w.slots.length);
    }
  });
  it('places and tracks', () => {
    const svg = wordmarkSvg('POWER', { x: 375, y: 800, height: 50, fill: '#123456', tracking: 6 });
    expect(svg.startsWith('<path d="M')).toBe(true);
    expect(svg).toContain('fill="#123456"');
    const m = wordmarkMetrics('POWER', { height: 50, tracking: 6 });
    expect(m.width).toBeCloseTo(WORDMARKS.POWER.width * 0.5 + 6 * 4, 5);
    expect(wordmarkMetrics('AKABARE PANIPURI', { height: 50, maxWidth: 300 }).width).toBe(300);
  });
});

describe('backs', () => {
  it('are standalone, deterministic SVGs with ids unique across all 12', async () => {
    const { puriBackSvg, powerBackSvg, backDataUri, ownerPips, BACK_VERSION } = await import('./backs.ts');
    expect(BACK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const all: string[] = [];
    for (const c of COLORS) for (const f of [puriBackSvg, powerBackSvg]) {
      const svg = f(c);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 1050"')).toBe(true);
      expect(f(c)).toBe(svg);
      expect(svg).not.toMatch(/<text[\s>]/);
      const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      for (const m of svg.matchAll(/(?:href="|url\()#([^")]+)/g)) expect(ids).toContain(m[1]);
      all.push(...ids);
    }
    expect(new Set(all).size).toBe(all.length);
    expect(backDataUri('puri', 'red').startsWith('data:image/svg+xml')).toBe(true);
    expect(COLORS.map(ownerPips)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
