/**
 * The seated characters: Kenney "Mini Characters" (CC0, see docs/ASSETS.md).
 * All share one 512px palette texture; each player's copy has the character's
 * shirt swatch repainted in the player's colour.
 */
import * as THREE from 'three';
import type { ColorId } from '../../../engine/types.ts';
import { PLAYER_PALETTE } from '../../../cards/index.ts';

export interface CharacterModel {
  url: string;
  /** The palette cell the shirt uses: column 0-15 (32px wide), row 0-3 (128px tall). */
  shirt: [number, number];
}

const BASE = import.meta.env.BASE_URL;

export const CHARACTERS: CharacterModel[] = [
  { url: `${BASE}models/characters/character-female-a.glb`, shirt: [15, 2] },
  { url: `${BASE}models/characters/character-male-a.glb`, shirt: [3, 2] },
  { url: `${BASE}models/characters/character-female-f.glb`, shirt: [5, 2] },
  { url: `${BASE}models/characters/character-male-b.glb`, shirt: [9, 2] },
  { url: `${BASE}models/characters/character-female-c.glb`, shirt: [9, 3] },
  { url: `${BASE}models/characters/character-male-e.glb`, shirt: [5, 2] },
];

const tinted = new Map<string, THREE.Texture>();

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The palette texture with `model`'s shirt cell painted in `color` (keeps the swatch's shading). */
export function tintedPalette(source: THREE.Texture, model: CharacterModel, color: ColorId): THREE.Texture {
  const key = `${model.url}:${color}`;
  let t = tinted.get(key);
  if (t) return t;
  const img = source.image as HTMLImageElement | ImageBitmap;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const cw = c.width / 16;
  const ch = c.height / 4;
  const [col, row] = model.shirt;
  const data = g.getImageData(col * cw, row * ch, cw, ch);
  const px = data.data;
  let mean = 0;
  for (let i = 0; i < px.length; i += 4) mean += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  mean /= px.length / 4;
  const [r, gg, b] = hexRgb(PLAYER_PALETTE[color].base);
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / Math.max(1, mean);
    const k = 0.75 + 0.25 * l;
    px[i] = Math.min(255, r * k);
    px[i + 1] = Math.min(255, gg * k);
    px[i + 2] = Math.min(255, b * k);
  }
  g.putImageData(data, col * cw, row * ch);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  tinted.set(key, t);
  return t;
}

/** The parts of a clip that move the upper body only (so a seated character stays seated). */
export const UPPER = ['torso', 'head', 'arm-left', 'arm-right'];
export const LOWER = ['root', 'leg-left', 'leg-right'];

export function onlyBones(clip: THREE.AnimationClip, bones: string[], name = clip.name): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => bones.some((b) => t.name.startsWith(`${b}.`)));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
