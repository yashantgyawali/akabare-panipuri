import { describe, expect, it } from 'vitest';
import { DESKTOP, PHONE, paramsFor, seatSpots, tableExtent, tableFit } from './geometry.ts';

describe('seatSpots', () => {
  it('puts the viewer at the bottom', () => {
    const [me] = seatSpots(4, DESKTOP);
    expect(me.pile.x).toBeCloseTo(0);
    expect(me.pile.y).toBeGreaterThan(0.5);
    expect(me.rot).toBe(0);
  });
  it('goes clockwise: the next seat is on the viewer’s left', () => {
    const s = seatSpots(4, DESKTOP);
    expect(s[1].pile.x).toBeLessThan(-0.5);
    expect(s[2].pile.y).toBeLessThan(-0.5);
    expect(s[3].pile.x).toBeGreaterThan(0.5);
  });
  it('spaces 3-6 seats equally on a circle', () => {
    for (const n of [3, 4, 5, 6]) {
      const s = seatSpots(n, DESKTOP);
      expect(s).toHaveLength(n);
      for (const k of s) expect(Math.hypot(k.pile.x, k.pile.y)).toBeCloseTo(DESKTOP.pileR, 4);
      const d0 = Math.hypot(s[0].pile.x - s[1].pile.x, s[0].pile.y - s[1].pile.y);
      for (let i = 0; i < n; i++) {
        const a = s[i].pile;
        const b = s[(i + 1) % n].pile;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(d0, 4);
      }
    }
  });
  it('turns each pile so its bottom faces the seat', () => {
    const s = seatSpots(6, DESKTOP);
    expect(s.map((k) => k.rot)).toEqual([0, 60, 120, 180, 240, 300]);
  });
  it('keeps the nameplate beyond the pile, on the same ray (wide stages)', () => {
    for (const k of seatSpots(5, DESKTOP)) {
      expect(Math.hypot(k.name.x, k.name.y)).toBeGreaterThan(Math.hypot(k.pile.x, k.pile.y));
      expect(k.name.x * k.pile.y - k.name.y * k.pile.x).toBeCloseTo(0, 4);
    }
  });
});

describe('narrow stages', () => {
  it('stands side nameplates behind their pile, the viewer and far seats at the rim', () => {
    const s = seatSpots(4, PHONE);
    expect(s[1].name.x).toBeCloseTo(s[1].pile.x);
    expect(s[1].name.y).toBeLessThan(s[1].pile.y);
    expect(s[0].name.y).toBeGreaterThan(s[0].pile.y);
    expect(s[2].name.y).toBeLessThan(s[2].pile.y);
  });
});

describe('table size', () => {
  it('fits the stage', () => {
    const d = tableFit(1280, 560, DESKTOP);
    expect(d.D).toBeLessThanOrEqual(1280 * 0.78);
    expect(tableFit(375, 500, PHONE).D).toBeLessThanOrEqual(375 * PHONE.widthFrac);
    expect(tableFit(100, 100, PHONE).D).toBeGreaterThanOrEqual(200);
  });
  it('keeps the whole ellipse inside the stage', () => {
    for (const [w, h, p] of [[1280, 560, DESKTOP], [1280, 400, DESKTOP], [375, 450, PHONE], [375, 340, PHONE]] as const) {
      const f = tableFit(w, h, p);
      const e = tableExtent(f.D, f.tilt, p.perspective);
      expect(f.cy - e.far).toBeGreaterThanOrEqual(p.padTop - 1);
      expect(f.cy + e.near).toBeLessThanOrEqual(h - p.padBottom + 1);
    }
  });
  it('keeps the tilt in range', () => {
    for (const [w, h] of [[1280, 300], [1280, 900], [375, 300], [375, 900]]) {
      for (const p of [DESKTOP, PHONE]) {
        const { tilt } = tableFit(w, h, p);
        expect(tilt).toBeGreaterThanOrEqual(p.tiltMin);
        expect(tilt).toBeLessThanOrEqual(p.tiltMax);
      }
    }
  });
  it('picks parameters by width', () => {
    expect(paramsFor(375)).toBe(PHONE);
    expect(paramsFor(1280)).toBe(DESKTOP);
    expect(paramsFor(800).tilt).toBeLessThan(DESKTOP.tilt);
  });
});
