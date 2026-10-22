/**
 * A card lying in the 3D room: a thin box whose top face shows one texture
 * (a back, or a front the viewer may see). Shared geometry and cached
 * materials keep dozens of cards cheap. Glow = a soft plane under the card.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W } from './layout3d.ts';
import { cardAlpha } from './textures.ts';
import { DRAG_PX } from './Room.tsx';

export const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
const edgeMat = new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.9 });
const mats = new Map<string, THREE.Material[]>();

export function cardMaterials(tex: THREE.Texture, dim = false): THREE.Material[] {
  const key = `${tex.uuid}:${dim ? 1 : 0}`;
  let m = mats.get(key);
  if (!m) {
    const face = new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: cardAlpha(),
      alphaTest: 0.5,
      roughness: 0.62,
      metalness: 0,
      color: dim ? '#6b625a' : '#ffffff',
    });
    const under = new THREE.MeshStandardMaterial({ color: '#d9ccb0', alphaMap: cardAlpha(), alphaTest: 0.5, roughness: 0.9 });
    m = [edgeMat, edgeMat, face, under, edgeMat, edgeMat];
    mats.set(key, m);
  }
  return m;
}

const handMats = new Map<string, THREE.Material[]>();
/** Unlit card materials for the cards held in front of the camera (the lamp is behind them). */
export function heldMaterials(tex: THREE.Texture, dim = false): THREE.Material[] {
  const key = `${tex.uuid}:${dim ? 1 : 0}`;
  let m = handMats.get(key);
  if (!m) {
    const face = new THREE.MeshBasicMaterial({ map: tex, alphaMap: cardAlpha(), alphaTest: 0.5, color: dim ? '#6f655c' : '#e9ddc8' });
    const edge = new THREE.MeshBasicMaterial({ color: '#cbb995' });
    m = [edge, edge, face, edge, edge, edge];
    handMats.set(key, m);
  }
  return m;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 88;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 44, 10, 32, 44, 44);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 88);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export type Glow = 'selectable' | 'focus' | 'danger' | 'good' | null;
const GLOW_COLOR: Record<Exclude<Glow, null>, string> = { selectable: '#F3B952', focus: '#ffffff', danger: '#F16147', good: '#8fd16a' };

/** A soft halo lying on the table under a card or pile. */
export function GlowPad({ glow, scale = 1, pulse = true }: { glow: Glow; scale?: number; pulse?: boolean }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  useFrame(({ clock }) => {
    if (!glow) return;
    mat.color.set(GLOW_COLOR[glow]);
    mat.opacity = pulse ? 0.55 + 0.35 * Math.sin(clock.elapsedTime * 4) : 0.85;
  });
  if (!glow) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} scale={[CARD_W * 1.9 * scale, CARD_H * 1.6 * scale, 1]} material={mat} renderOrder={1}>
      <planeGeometry />
    </mesh>
  );
}

export interface Card3DProps {
  tex: THREE.Texture;
  position?: [number, number, number];
  rotation?: [number, number, number];
  dim?: boolean;
  castShadow?: boolean;
  children?: ReactNode;
}

export function Card3D({ tex, position, rotation, dim, castShadow, children }: Card3DProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={cardGeo} material={cardMaterials(tex, dim)} castShadow={castShadow} receiveShadow />
      {children}
    </group>
  );
}

/** Pointer helpers for things you can click (CursorSync shows the hand cursor over them). */
export function clickProps(onClick?: () => void) {
  if (!onClick) return {};
  return {
    userData: { clickable: true },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // The end of a drag to look around is not a click.
      if (e.delta > DRAG_PX) return;
      onClick();
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => e.stopPropagation(),
  };
}

/**
 * The hand cursor, worked out every frame from what is actually under the
 * pointer (a clickable that stops being clickable, or unmounts, never leaves it stuck).
 */
export function CursorSync() {
  const get = useThree((s) => s.get);
  const was = useRef(false);
  useFrame(() => {
    let on = false;
    for (const h of get().internal.hovered.values()) {
      if (h.eventObject.userData?.clickable) {
        on = true;
        break;
      }
    }
    if (on !== was.current) {
      was.current = on;
      document.body.style.cursor = on ? 'pointer' : '';
    }
  });
  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );
  return null;
}

/** Animates a group along an arc from `from` to `to` over `ms`, starting at `start` (performance.now()). */
export function useArc(from: THREE.Vector3 | null, to: THREE.Vector3, start: number, ms: number, lift = 0.35) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (!from) {
      g.position.copy(to);
      return;
    }
    const t = Math.min(1, Math.max(0, (performance.now() - start) / ms));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    g.position.lerpVectors(from, to, e);
    g.position.y += Math.sin(Math.PI * e) * lift;
  });
  return ref;
}
