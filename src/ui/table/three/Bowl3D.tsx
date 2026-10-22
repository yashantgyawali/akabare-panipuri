/**
 * Puri in areca-leaf bowls (instead of cards). Upside down, a bowl hides its
 * puri: you see the leaf dome, the owner's colour stamped on the base and a
 * band on the rim. Open, it shows a print of the puri inside: the Panipuri's
 * green puri or the Akabare's red chili (the card art), not a 3D model.
 *
 * Hidden information: nothing about a covered bowl depends on what's inside
 * (geometry, materials and textures are keyed by owner colour only); the only
 * extra is `peek`, the small letter on the base, which callers pass for the
 * viewer's own bowls (or once everything is revealed).
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ColorId, PuriKind } from '../../../engine/types.ts';
import { PLAYER_PALETTE, artUrl } from '../../../cards/index.ts';

/** The bowl is modelled at a real bowl's size and drawn this much bigger, so it reads across the table. */
const K = 1.45;
export const BOWL_R = 0.078 * K;
export const BOWL_H = 0.046 * K;
/** How much higher each upturned bowl sits on the one below (they nest). */
export const NEST = 0.017 * K;

// --- shared geometry -------------------------------------------------------
const PROFILE: [number, number][] = [
  [0, 0],
  [0.044, 0],
  [0.052, 0.004],
  [0.066, 0.018],
  [0.075, 0.035],
  [0.079, 0.046],
  [0.074, 0.046],
  [0.07, 0.037],
  [0.061, 0.021],
  [0.048, 0.008],
  [0, 0.006],
];
const bowlGeo = new THREE.LatheGeometry(
  PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
  44,
);
const rimGeo = new THREE.TorusGeometry(0.0765, 0.0035, 6, 44).rotateX(Math.PI / 2).translate(0, 0.0445, 0);
const stampGeo = new THREE.CircleGeometry(0.036, 32).rotateX(Math.PI / 2).translate(0, -0.0006, 0);
/** The print inside an open bowl: a flat disc just above the bottom. */
const printGeo = new THREE.CircleGeometry(0.064, 40).rotateX(-Math.PI / 2).translate(0, 0.0075, 0);

// --- textures and materials -------------------------------------------------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let leafMat: THREE.Material | null = null;
/** Pressed areca leaf: warm tan with long fibres running from base to rim, and a few darker veins. */
function leaf(): THREE.Material {
  if (leafMat) return leafMat;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tex = canvasTex(256, 128, (g) => {
    g.fillStyle = '#d6b483';
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 256;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '150,110,60' : '240,215,170'},${0.15 + rnd() * 0.25})`;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rnd() - 0.5) * 12, 40, x + (rnd() - 0.5) * 12, 90, x + (rnd() - 0.5) * 8, 128);
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(140,95,45,${0.12 + rnd() * 0.12})`;
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 128, 10 + rnd() * 30, 4 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  leafMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  return leafMat;
}

const mats = new Map<string, THREE.Material>();
function solid(color: string, opts: { rough?: number; emissive?: string; dim?: boolean } = {}): THREE.Material {
  const key = `${color}:${opts.rough ?? 0.8}:${opts.emissive ?? ''}:${opts.dim ? 1 : 0}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: opts.dim ? new THREE.Color(color).multiplyScalar(0.45) : color,
      roughness: opts.rough ?? 0.8,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissive ? 0.35 : 0,
    });
    mats.set(key, m);
  }
  return m;
}

/** The base stamp: the owner's colour, and (own / revealed bowls only) a small letter. */
const stamps = new Map<string, THREE.Material>();
function stamp(color: ColorId, peek: PuriKind | null): THREE.Material {
  const key = `${color}:${peek ?? ''}`;
  let m = stamps.get(key);
  if (!m) {
    const base = PLAYER_PALETTE[color].base;
    const tex = canvasTex(128, 128, (g) => {
      g.fillStyle = base;
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,240,215,0.75)';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(64, 64, 50, 0, Math.PI * 2);
      g.stroke();
      if (peek) {
        g.fillStyle = '#fff6e6';
        g.beginPath();
        g.arc(64, 64, 30, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = peek === 'akabare' ? '#c8321a' : '#3a2418';
        g.font = '800 44px Mukta, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(peek === 'akabare' ? 'A' : 'P', 64, 68);
      }
    });
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    stamps.set(key, m);
  }
  return m;
}

/**
 * The print inside an open bowl: the puri's card art (Panipuri: the green puri;
 * Akabare: the red chili) in a circle with a thin cream border, so it reads at a
 * glance from across the table or from straight above.
 */
const prints = new Map<string, THREE.Material>();
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}
function printMat(kind: PuriKind, dim: boolean): THREE.Material {
  const key = `${kind}:${dim ? 1 : 0}`;
  let m = prints.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = (art: HTMLImageElement | null) => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f5e8ca';
    g.beginPath();
    g.arc(128, 128, 127, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(128, 128, 116, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = kind === 'akabare' ? '#b8321e' : '#4f7a32';
    g.fillRect(0, 0, 256, 256);
    if (art) {
      // cover the circle with the middle of the art (the puri / the chili)
      const s = Math.max(232 / art.width, 232 / art.height) * 1.08;
      g.drawImage(art, 128 - (art.width * s) / 2, 128 - (art.height * s) / 2, art.width * s, art.height * s);
    }
    if (dim) {
      g.fillStyle = 'rgba(20,12,6,0.55)';
      g.fillRect(0, 0, 256, 256);
    }
    g.restore();
    tex.needsUpdate = true;
  };
  draw(null);
  void loadImage(artUrl(kind, import.meta.env.BASE_URL)).then(draw, () => {});
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, transparent: true, alphaTest: 0.5 });
  prints.set(key, m);
  return m;
}

// --- components --------------------------------------------------------------

/** What's in an open bowl: a print of the puri, not a model of it. */
function Contents({ kind, dim }: { kind: PuriKind; dim?: boolean }) {
  return <mesh geometry={printGeo} material={printMat(kind, !!dim)} />;
}

export interface BowlProps {
  color: ColorId;
  /** Open (showing the puri) or upside down. */
  up: boolean;
  /** Open bowls: what's inside. Covered bowls ignore it. */
  kind?: PuriKind | null;
  /** Covered bowls: the letter on the base (own / revealed only). */
  peek?: PuriKind | null;
  dim?: boolean;
}

/** One bowl sitting on the table at its local origin (open, or turned upside down over its puri). */
export function Bowl({ color, up, kind = null, peek = null, dim }: BowlProps) {
  const rim = PLAYER_PALETTE[color].base;
  return (
    <group position={[0, up ? 0 : BOWL_H, 0]} rotation={[up ? 0 : Math.PI, 0, 0]}>
      <group scale={K}>
        <mesh geometry={bowlGeo} material={dim ? solid('#8a7357') : leaf()} castShadow receiveShadow />
        <mesh geometry={rimGeo} material={solid(rim, { dim })} />
        <mesh geometry={stampGeo} material={stamp(color, up ? null : peek)} />
        {up && kind ? <Contents kind={kind} dim={dim} /> : null}
      </group>
    </group>
  );
}

/**
 * A bowl being eaten: it lifts off the stack still upside down, turns over in
 * the air (only then showing the puri) and lands open on the plate.
 */
export function FlippingBowl({ from, to, color, kind, dim, scale = 1, ms = 820 }: { from: THREE.Vector3 | null; to: THREE.Vector3; color: ColorId; kind: PuriKind; dim?: boolean; scale?: number; ms?: number }) {
  const g = useRef<THREE.Group>(null);
  const turn = useRef<THREE.Group>(null);
  const [start] = useState(() => performance.now());
  const [shown, setShown] = useState(!from);
  useFrame(() => {
    const grp = g.current;
    const t = from ? Math.min(1, (performance.now() - start) / ms) : 1;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    if (grp) {
      if (from) {
        grp.position.lerpVectors(from, to, e);
        grp.position.y += Math.sin(Math.PI * e) * 0.3;
      } else grp.position.copy(to);
    }
    // Upside down for the first half (contents hidden), then right way up.
    if (turn.current) turn.current.rotation.x = Math.PI * (1 - e);
    if (!shown && e >= 0.5) setShown(true);
  });
  return (
    <group ref={g} scale={scale}>
      {/* turn around the bowl's middle so it flips in place */}
      <group position={[0, BOWL_H / 2, 0]}>
        <group ref={turn}>
          <group position={[0, -BOWL_H / 2, 0]}>
            <Bowl color={color} up kind={shown ? kind : null} dim={dim} />
          </group>
        </group>
      </group>
    </group>
  );
}

/** A bowl flying, upside down, from someone's place to a stack (a 'place' move). */
export function FlyingBowl({ from, to, color, start, ms }: { from: THREE.Vector3; to: THREE.Vector3; color: ColorId; start: number; ms: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const t = Math.min(1, (performance.now() - start) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    grp.position.lerpVectors(from, to, e);
    grp.position.y += Math.sin(Math.PI * t) * 0.25;
    grp.rotation.set(0, (1 - e) * 1.2, (1 - e) * 0.4);
    grp.visible = t < 1;
  });
  return (
    <group ref={g} position={from} visible={performance.now() - start < ms}>
      <Bowl color={color} up={false} />
    </group>
  );
}

/** Stack of upturned bowls (bottom to top). Only the top one can hide while another flies in. */
export function useBowlStackGeometry(n: number) {
  return useMemo(() => Array.from({ length: n }, (_, i) => i * NEST), [n]);
}
