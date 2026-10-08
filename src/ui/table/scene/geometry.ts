/**
 * Round-table geometry. Pure functions, no DOM.
 *
 * Plane coordinates are in units of the TABLE RADIUS, origin at the centre of
 * the table, +x to the right, +y towards the viewer (the camera sits at +y).
 * Seat 0 is the viewer, at the bottom. Seats run CLOCKWISE as seen from above,
 * so the next player clockwise sits on the viewer's LEFT.
 */

export interface SceneParams {
  /** Camera tilt of the table plane (deg, rotateX). */
  tilt: number;
  /** CSS perspective (px). */
  perspective: number;
  /** Allowed tilt range: the tilt adapts so the table ellipse fills the stage height. */
  tiltMin: number;
  tiltMax: number;
  /** Table diameter as a fraction of the stage width. */
  widthFrac: number;
  /** Stage height (px) kept free above the far rim (upright nameplates, ticker) and below the near rim (thickness). */
  padTop: number;
  padBottom: number;
  /** Distance of the pile centre from the table centre (table radii). */
  pileR: number;
  /** Distance of the nameplate foot from the table centre (table radii). */
  nameR: number;
  /** Extra nameplate distance for seats at the sides (x-weighted): room outside the rim on wide stages. */
  nameSide: number;
  /** Narrow stages: nameplates of side seats stand behind their pile (this many radii further away) instead of out at the rim. */
  sideLift: number;
  /** Seat stretch along y (1 = a circle on the table plane). */
  ky: number;
}

export const DESKTOP: SceneParams = { tilt: 56, perspective: 1400, tiltMin: 48, tiltMax: 56, widthFrac: 0.78, padTop: 58, padBottom: 28, pileR: 0.6, nameR: 0.95, nameSide: 0.35, sideLift: 0, ky: 1 };
export const TABLET: SceneParams = { tilt: 52, perspective: 1300, tiltMin: 42, tiltMax: 52, widthFrac: 0.92, padTop: 56, padBottom: 28, pileR: 0.6, nameR: 0.95, nameSide: 0, sideLift: 0.28, ky: 1 };
export const PHONE: SceneParams = { tilt: 42, perspective: 1100, tiltMin: 26, tiltMax: 50, widthFrac: 1.12, padTop: 70, padBottom: 26, pileR: 0.6, nameR: 0.97, nameSide: 0, sideLift: 0.3, ky: 1 };

export interface SeatSpot {
  /** 0 = the viewer; increases clockwise. */
  index: number;
  /** Degrees clockwise from the viewer's position (0 = bottom, 90 = left, 180 = top, 270 = right). */
  angle: number;
  /** Pile centre. */
  pile: { x: number; y: number };
  /** Nameplate foot (where the upright plate touches the table). */
  name: { x: number; y: number };
  /** Unit vector from the table centre towards the seat. */
  out: { x: number; y: number };
  /** rotateZ (deg) that turns a card so its bottom faces the seat. Equals `angle`. */
  rot: number;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function seatSpots(n: number, p: Pick<SceneParams, 'pileR' | 'nameR' | 'nameSide' | 'sideLift' | 'ky'>): SeatSpot[] {
  const count = Math.max(1, Math.floor(n));
  return Array.from({ length: count }, (_, i) => {
    const angle = (360 * i) / count;
    const a = (angle * Math.PI) / 180;
    // angle 0 → straight down the screen (+y); 90 → left (−x): clockwise from above.
    const out = { x: round(-Math.sin(a)), y: round(Math.cos(a)) };
    const nr = p.nameR + p.nameSide * Math.abs(out.x);
    // side seats on narrow stages: the plate stands behind the pile (up the screen), not at the rim
    const side = p.sideLift > 0 && Math.abs(out.x) > 0.3;
    return {
      index: i,
      angle,
      out,
      rot: angle,
      pile: { x: round(out.x * p.pileR), y: round(out.y * p.pileR * p.ky) },
      name: side ? { x: round(out.x * p.pileR), y: round(out.y * p.pileR * p.ky - p.sideLift) } : { x: round(out.x * nr), y: round(out.y * nr * p.ky) },
    };
  });
}

const rad = (d: number) => (d * Math.PI) / 180;

/** On-screen extent of the table ellipse above (far) and below (near) its centre, with perspective and the visible thickness. */
export function tableExtent(D: number, tilt: number, perspective: number): { far: number; near: number } {
  const R = D / 2;
  const c = R * Math.cos(rad(tilt));
  const z = R * Math.sin(rad(tilt));
  const P = perspective;
  return { far: (c * P) / (P + z), near: (c * P) / (P - z) + D * 0.045 * Math.sin(rad(tilt)) };
}

/**
 * Table diameter (px), tilt (deg) and centre (px from the stage top) for a
 * stage: as wide as the width allows, tilted as little as needed (within the
 * allowed range) for the whole ellipse to fit between the pads; if it still
 * does not fit at the steepest tilt, the table shrinks.
 */
export function tableFit(w: number, h: number, p: SceneParams): { D: number; tilt: number; cy: number } {
  const free = Math.max(120, h - p.padTop - p.padBottom);
  let D = Math.max(200, Math.round(w * p.widthFrac));
  let tilt = p.tiltMax;
  for (let i = 0; i < 60; i++) {
    let found = false;
    for (let t = p.tiltMin; t <= p.tiltMax + 1e-6; t += 0.5) {
      const e = tableExtent(D, t, p.perspective);
      if (e.far + e.near <= free) {
        tilt = t;
        found = true;
        break;
      }
    }
    if (found || D <= 200) break;
    D = Math.max(200, Math.round(D * 0.97));
  }
  const e = tableExtent(D, tilt, p.perspective);
  const cy = Math.round(p.padTop + (free - (e.far + e.near)) / 2 + e.far);
  return { D, tilt, cy };
}

export function paramsFor(w: number): SceneParams {
  return w <= 640 ? PHONE : w <= 900 ? TABLET : DESKTOP;
}
