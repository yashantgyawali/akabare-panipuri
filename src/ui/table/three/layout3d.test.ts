import { describe, expect, it } from 'vitest';
import { PILE_R, SEAT_R, cameraFor, platePos3, seatSpot, stackJitter } from './layout3d.ts';

describe('3D table layout', () => {
  it('puts the viewer nearest the camera and the next seat on their left', () => {
    const you = seatSpot(0, 4);
    expect(you.seat.z).toBeCloseTo(SEAT_R);
    expect(you.seat.x).toBeCloseTo(0);
    const next = seatSpot(1, 4);
    expect(next.seat.x).toBeLessThan(0);
    expect(Math.abs(next.seat.z)).toBeLessThan(1e-9);
  });

  it('keeps seats in clockwise order and clear of the camera with 5 or 6 players', () => {
    for (const n of [5, 6]) {
      const spots = Array.from({ length: n }, (_, i) => seatSpot(i, n));
      for (let i = 1; i < n; i++) {
        expect(spots[i].angle).toBeGreaterThan(spots[i - 1].angle);
        expect(spots[i].seat.z).toBeLessThan(SEAT_R * 0.27);
      }
      // piles of neighbouring seats don't overlap
      for (let i = 1; i < n; i++) expect(Math.hypot(spots[i].pile.x - spots[i - 1].pile.x, spots[i].pile.z - spots[i - 1].pile.z)).toBeGreaterThan(0.4);
    }
  });

  it('keeps every pile on its seat side, facing the seat', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let i = 0; i < n; i++) {
        const s = seatSpot(i, n);
        expect(Math.hypot(s.pile.x, s.pile.z)).toBeCloseTo(PILE_R);
        expect(s.pile.x * s.dir.x + s.pile.z * s.dir.z).toBeGreaterThan(0);
        // yaw turns +z (a card's bottom edge) towards the seat
        expect(Math.sin(s.yaw)).toBeCloseTo(s.dir.x);
        expect(Math.cos(s.yaw)).toBeCloseTo(s.dir.z);
      }
    }
  });

  it('spreads eaten cards on the plate without exact overlaps', () => {
    const pts = Array.from({ length: 12 }, (_, i) => platePos3(i, 12));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(0.005);
  });

  it('derives stack jitter from the index only', () => {
    expect(stackJitter(3)).toEqual(stackJitter(3));
    expect(Math.abs(stackJitter(5).rot)).toBeLessThan(0.08);
  });

  it('keeps a sane field of view for any screen', () => {
    for (const a of [0.4, 0.75, 1.3, 2.4]) {
      for (const phone of [true, false]) {
        const c = cameraFor(a, phone);
        expect(c.fov).toBeGreaterThanOrEqual(44);
        expect(c.fov).toBeLessThanOrEqual(102);
      }
    }
  });
});
