/**
 * Where everything sits in the 3D room (world units, table top at y = 0,
 * table centre at the origin, the viewer's seat towards +z). Seats go
 * clockwise seen from above with the viewer at the bottom, so the next player
 * is on the viewer's LEFT (-x), like the CSS table.
 */

export const TABLE_R = 1.05;
/** Where a seated character's hips are, from the centre. */
export const SEAT_R = 1.42;
/** Where a seat's stack lies, from the centre. */
export const PILE_R = 0.66;
/** The power card sits beside the stack, this far to the seat's right. */
export const POWER_SIDE = 0.24;
export const PLATE_R = 0.3;
export const CARD_W = 0.17;
export const CARD_H = CARD_W * (88 / 63);
export const CARD_T = 0.0035;

export interface Vec2 {
  x: number;
  z: number;
}

export interface Seat3DSpot {
  /** Angle around the table (0 = the viewer, growing clockwise from above). */
  angle: number;
  /** Unit vector from the centre towards the seat. */
  dir: Vec2;
  seat: Vec2;
  pile: Vec2;
  power: Vec2;
  /** Y rotation that turns an object at the seat to face the centre (and a card's bottom edge towards the seat). */
  yaw: number;
}

export function seatSpot(i: number, n: number): Seat3DSpot {
  const angle = (i / Math.max(1, n)) * Math.PI * 2;
  const dir = { x: -Math.sin(angle), z: Math.cos(angle) };
  // The seat's own right, looking at the centre (the centre is -dir).
  const right = { x: -dir.z, z: dir.x };
  const pile = { x: dir.x * PILE_R, z: dir.z * PILE_R };
  return {
    angle,
    dir,
    seat: { x: dir.x * SEAT_R, z: dir.z * SEAT_R },
    pile,
    power: { x: pile.x + right.x * POWER_SIDE, z: pile.z + right.z * POWER_SIDE },
    yaw: Math.atan2(dir.x, dir.z),
  };
}

/** Eaten card i of n on the plate (phyllotaxis, so no two cards cover each other exactly). Tilt comes from the INDEX only. */
export function platePos3(i: number, n: number): { x: number; z: number; rot: number } {
  const total = Math.max(n, 5);
  const r = ((PLATE_R - CARD_W * 0.35) * Math.sqrt(i + 0.6)) / Math.sqrt(total + 0.6);
  const a = i * 2.399963;
  return { x: r * Math.cos(a), z: r * Math.sin(a), rot: ((((i * 53) % 25) - 12) * Math.PI) / 180 };
}

/** A tiny deterministic twist for card i of a stack (from its index, never its kind). */
export function stackJitter(i: number): { dx: number; dz: number; rot: number } {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  const f = s - Math.floor(s);
  const g = (Math.sin(i * 78.233) * 12345.678) % 1;
  return { dx: (f - 0.5) * 0.012, dz: (Math.abs(g) - 0.5) * 0.012, rot: (f - 0.5) * 0.14 };
}

/** Camera: horizontal field of view we want to keep, whatever the aspect ratio. */
export function cameraFor(aspect: number, phone: boolean): { fov: number; y: number; z: number; lookY: number; lookZ: number } {
  const hfov = phone ? 84 : 74;
  const vfov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / Math.max(0.3, aspect)) * 180) / Math.PI;
  const fov = Math.min(phone ? 102 : 62, Math.max(44, vfov));
  return phone ? { fov, y: 1.2, z: 1.55, lookY: -0.1, lookZ: -0.05 } : { fov, y: 0.92, z: 2.15, lookY: 0.0, lookZ: -0.3 };
}
