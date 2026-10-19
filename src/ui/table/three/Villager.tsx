/**
 * A seated Nepali player, built in code from blocky pieces (no model files):
 * a head with eyes, brows, nose and a mouth that changes, hair or a Dhaka /
 * Bhadgaule topi, jewellery (tika, pote, phuli, bangles), a garment in the
 * player's colour, and arms resting on the table. Everything moves in code:
 * breathing, looking around, blinking, and a reaction to each move the player
 * makes (nod, head shake, reach, pick up, slump, cheer, flinch).
 * Faces +z; the parent turns it to face the table.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ColorId } from '../../../engine/types.ts';
import { PLAYER_PALETTE } from '../../../cards/index.ts';
import { bodyColor, dhakaTex, frontTex, lowerColor, shade, sleeve } from './garments.ts';
import type { Look } from './looks.ts';

export type ReactionKind = 'yes' | 'no' | 'reach' | 'pick' | 'slump' | 'cheer' | 'flinch';
export interface Reaction {
  kind: ReactionKind;
  seq: number;
}

/** Hips below the table top (seated on the chair). */
const HIP_Y = -0.24;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const mats = new Map<string, THREE.Material>();
function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string } = {}): THREE.Material {
  const key = `${color}:${opts.rough ?? 0.85}:${opts.metal ?? 0}:${opts.emissive ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissive ? 0.25 : 0 });
    mats.set(key, m);
  }
  return m;
}

/** The topi: a box whose top slopes up toward one side, like a Dhaka topi. */
function topiGeometry(w: number, h: number, d: number, slope: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h * 0.9) p.setY(i, p.getY(i) + slope * (p.getX(i) / (w / 2)) * 0.5 + slope * 0.5);
  }
  g.computeVertexNormals();
  return g;
}
const DHAKA_GEO = topiGeometry(0.33, 0.1, 0.3, 0.05);
const BHAD_GEO = topiGeometry(0.33, 0.12, 0.3, 0.035);

const DUR: Record<ReactionKind, number> = { yes: 1.1, no: 1.1, reach: 1.0, pick: 1.2, slump: 2.4, cheer: 1.7, flinch: 0.9 };

/** 0 → 1 → 0 over the reaction, with short ease in/out. */
function env(a: number, dur: number, ramp = 0.18): number {
  if (a <= 0 || a >= dur) return 0;
  const r = Math.min(ramp, dur / 3);
  const up = Math.min(1, a / r);
  const down = Math.min(1, (dur - a) / r);
  const s = Math.min(up, down);
  return s * s * (3 - 2 * s);
}

function Box({ size, at, color, material, cast, rot }: { size: [number, number, number]; at: [number, number, number]; color?: string; material?: THREE.Material | THREE.Material[]; cast?: boolean; rot?: [number, number, number] }) {
  return <mesh geometry={BOX} material={material ?? mat(color!)} scale={size} position={at} rotation={rot} castShadow={cast} />;
}

export function Villager({
  look,
  color,
  x,
  z,
  yaw,
  reaction,
  lean,
  seed,
  reduced,
  shadows,
  onHead,
}: {
  look: Look;
  color: ColorId;
  x: number;
  z: number;
  /** Angle that faces the table centre. */
  yaw: number;
  reaction: Reaction | null;
  /** 0..1: leaning in (their turn). */
  lean: number;
  seed: number;
  reduced: boolean;
  shadows: boolean;
  onHead?: (v: THREE.Vector3) => void;
}) {
  const base = PLAYER_PALETTE[color].base;
  const skin = look.skin;
  const skinDark = shade(skin, -0.14);
  const sl = sleeve(look.top, base);
  // Clothes glow faintly in their own colour so a player's colour still reads under the warm lamp.
  const cloth = (c: string) => mat(c, { emissive: shade(c, -0.35) });
  const torsoMats = useMemo(() => {
    const side = cloth(bodyColor(look.top, base, !!look.vest));
    const front = new THREE.MeshStandardMaterial({ map: frontTex(look.top, base, !!look.vest), roughness: 0.85, emissive: '#ffffff', emissiveMap: frontTex(look.top, base, !!look.vest), emissiveIntensity: 0.14 });
    return [side, side, side, side, front, side];
  }, [look.top, look.vest, base]);

  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const brows = useRef<THREE.Group>(null);
  const mouthMid = useRef<THREE.Mesh>(null);
  const cornerL = useRef<THREE.Mesh>(null);
  const cornerR = useRef<THREE.Mesh>(null);
  const headTop = useRef<THREE.Object3D>(null);
  const v = useMemo(() => new THREE.Vector3(), []);

  // Reactions are pinned by seq (the same reaction staying current must not restart).
  const react = useRef<{ seq: number; kind: ReactionKind; at: number } | null>(null);
  if (reaction && react.current?.seq !== reaction.seq) react.current = { seq: reaction.seq, kind: reaction.kind, at: performance.now() };
  const blink = useRef({ next: 1 + (seed % 3), until: 0 });
  const leanNow = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed * 1.7;
    const live = !reduced;
    const r = react.current;
    const a = r ? (performance.now() - r.at) / 1000 : 99;
    const k = r ? r.kind : null;
    const e = k ? env(a, DUR[k]) : 0;
    leanNow.current += (lean - leanNow.current) * Math.min(1, dt * 3);

    // torso: breathing, leaning in on their turn, reactions
    if (torso.current) {
      const breathe = live ? Math.sin(t * 1.7) * 0.012 : 0;
      let pitch = leanNow.current * 0.14;
      let lift = 0;
      if (k === 'slump') pitch += 0.38 * e;
      if (k === 'flinch') pitch -= 0.22 * e;
      if (k === 'reach' || k === 'pick') pitch += 0.12 * e;
      if (k === 'cheer') lift = Math.abs(Math.sin(a * Math.PI * 3)) * 0.03 * e;
      torso.current.rotation.x = pitch;
      torso.current.position.y = lift;
      torso.current.scale.y = 1 + breathe;
    }
    // head: looking around, nods, shakes
    if (head.current) {
      let ry = live ? Math.sin(t * 0.37) * 0.16 + Math.sin(t * 0.91) * 0.05 : 0;
      let rx = live ? Math.sin(t * 0.29 + 1) * 0.05 : 0;
      if (k === 'yes') rx += Math.sin(a * Math.PI * 4) * 0.28 * e;
      if (k === 'no') ry += Math.sin(a * Math.PI * 4) * 0.4 * e;
      if (k === 'slump') rx += 0.45 * e;
      if (k === 'flinch') rx -= 0.25 * e;
      if (k === 'cheer') rx -= 0.15 * e;
      if (k === 'pick') rx += 0.15 * e;
      head.current.rotation.set(rx, ry, live ? Math.sin(t * 0.23) * 0.03 : 0);
    }
    // arms: resting forward on the table; reactions move them
    const rest = { sx: -0.95, ex: -0.62 };
    let lS = rest.sx + (live ? Math.sin(t * 0.8) * 0.02 : 0);
    let lE = rest.ex;
    let rS = rest.sx + (live ? Math.sin(t * 0.8 + 1.3) * 0.02 : 0);
    let rE = rest.ex;
    if (k === 'reach') {
      rS += -0.45 * e;
      rE += 0.42 * e;
    } else if (k === 'pick') {
      const p1 = env(a, 0.55, 0.15);
      const p2 = a > 0.45 ? env(a - 0.45, DUR.pick - 0.45, 0.2) : 0;
      rS += -0.4 * p1 - 0.9 * p2;
      rE += 0.35 * p1 - 1.2 * p2;
    } else if (k === 'cheer') {
      lS += -1.75 * e;
      rS += -1.75 * e;
      lE += 0.25 * e;
      rE += 0.25 * e;
    } else if (k === 'slump') {
      lS += 0.75 * e;
      rS += 0.75 * e;
      lE += 0.3 * e;
      rE += 0.3 * e;
    } else if (k === 'flinch') {
      lS += 0.35 * e;
      rS += 0.35 * e;
      lE += -0.6 * e;
      rE += -0.6 * e;
    } else if (k === 'no') {
      rE += Math.sin(a * Math.PI * 4) * 0.25 * e;
    }
    armL.current?.rotation.set(lS, 0, 0.08);
    armR.current?.rotation.set(rS, 0, -0.08);
    elbowL.current?.rotation.set(lE, 0, 0);
    elbowR.current?.rotation.set(rE, 0, 0);
    // face: blinking, brows, mouth shape
    const now = clock.elapsedTime;
    if (live && now > blink.current.next) {
      blink.current.until = now + 0.12;
      blink.current.next = now + 2 + ((seed * 7 + now * 13) % 3.5);
    }
    const shut = live && now < blink.current.until;
    const wide = k === 'flinch' ? 1 + 0.35 * e : 1;
    eyes.current?.scale.set(1, shut ? 0.12 : wide, 1);
    if (brows.current) brows.current.position.y = (k === 'yes' || k === 'cheer' || k === 'flinch' ? 0.018 * e : 0) - (k === 'slump' || k === 'no' ? 0.01 * e : 0);
    const open = k === 'cheer' || k === 'flinch' ? e : 0;
    const frown = k === 'slump' || k === 'no' ? e : 0;
    if (mouthMid.current) mouthMid.current.scale.set(0.07 - 0.02 * open, 0.014 + 0.035 * open, 0.01);
    for (const [c, side] of [
      [cornerL.current, -1],
      [cornerR.current, 1],
    ] as const) {
      if (!c) continue;
      c.position.y = 0.008 * (1 - open) * (1 - 2 * frown) - 0.004;
      c.position.x = side * (0.042 - 0.012 * open);
      c.visible = open < 0.5;
    }
    if (onHead && headTop.current) {
      headTop.current.getWorldPosition(v);
      onHead(v);
    }
  });

  const hair = mat(look.hair, { rough: 0.95 });
  const gold = mat('#d4a52a', { rough: 0.3, metal: 0.8 });
  const dark = mat('#1c140f', { rough: 0.6 });
  const lower = lowerColor(look.top, base);
  const upper = sl.color;
  const fore = sl.bareForearm ? skin : sl.color;
  const browCol = look.old ? shade(look.hair, 0.1) : look.hair;

  // Arms turn in toward the middle so the forearms rest on the table, hands near each other.
  const arm = (side: -1 | 1, shoulderRef: typeof armL, elbowRef: typeof elbowL) => (
    <group position={[side * 0.235, 0.355, 0]} rotation={[0, -side * 0.42, 0]}>
    <group ref={shoulderRef}>
      <Box size={[0.1, 0.2, 0.11]} at={[0, -0.095, 0]} material={cloth(upper)} cast={shadows} />
      <group ref={elbowRef} position={[0, -0.2, 0]}>
        <Box size={[0.09, 0.16, 0.1]} at={[0, -0.08, 0]} material={sl.bareForearm ? mat(fore) : cloth(fore)} cast={shadows} />
        {sl.bareForearm || look.top === 'daura' ? null : <Box size={[0.095, 0.03, 0.105]} at={[0, -0.15, 0]} color={shade(fore, -0.2)} />}
        <Box size={[0.08, 0.075, 0.09]} at={[0, -0.195, 0.005]} color={skin} cast={shadows} />
        {look.bangles ? (
          <>
            <Box size={[0.1, 0.014, 0.11]} at={[0, -0.14, 0]} material={mat('#c8321a', { rough: 0.4, emissive: '#5a0d05' })} />
            <Box size={[0.1, 0.012, 0.11]} at={[0, -0.122, 0]} material={mat('#2f7a3a', { rough: 0.4, emissive: '#0d3010' })} />
            <Box size={[0.1, 0.008, 0.11]} at={[0, -0.108, 0]} material={gold} />
          </>
        ) : null}
      </group>
    </group>
    </group>
  );

  return (
    <group position={[x, HIP_Y, z]} rotation={[0, yaw, 0]}>
      {/* seated legs (mostly under the table) */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box size={[0.14, 0.13, 0.36]} at={[s * 0.095, 0, 0.14]} color={lower} />
          <Box size={[0.12, 0.34, 0.12]} at={[s * 0.095, -0.2, 0.31]} color={lower} />
          <Box size={[0.13, 0.06, 0.18]} at={[s * 0.095, -0.38, 0.35]} color="#2b1c12" />
        </group>
      ))}
      <group ref={torso}>
        <mesh geometry={BOX} material={torsoMats} scale={[0.4, 0.4, 0.25]} position={[0, 0.2, 0]} castShadow={shadows} />
        {look.top === 'sari' ? <Box size={[0.41, 0.07, 0.26]} at={[0, 0.06, 0]} material={cloth(base)} /> : null}
        {look.top === 'shawl' ? <Box size={[0.44, 0.08, 0.28]} at={[0, 0.37, 0]} material={cloth(base)} /> : null}
        {look.top === 'cholo' ? <Box size={[0.41, 0.08, 0.26]} at={[0, 0.04, 0]} color="#f0e2c4" /> : null}
        {look.pote ? (
          <group position={[0, 0.36, 0.128]}>
            {Array.from({ length: 9 }, (_, i) => {
              const ang = ((i - 4) / 4) * 1.05;
              return <Box key={i} size={[0.022, 0.022, 0.012]} at={[Math.sin(ang) * 0.095, -Math.cos(ang) * 0.09 + 0.02, 0]} material={mat('#1f8a3c', { rough: 0.3, emissive: '#0b3a17' })} />;
            })}
            <mesh geometry={BOX} material={gold} scale={[0.028, 0.05, 0.014]} position={[0, -0.09, 0.002]} />
          </group>
        ) : null}
        {/* neck */}
        <Box size={[0.13, 0.06, 0.13]} at={[0, 0.425, 0]} color={skinDark} />
        {arm(-1, armL, elbowL)}
        {arm(1, armR, elbowR)}
        {/* head */}
        <group ref={head} position={[0, 0.45, 0]}>
          <Box size={[0.34, 0.31, 0.3]} at={[0, 0.155, 0]} color={skin} cast={shadows} />
          <object3D ref={headTop} position={[0, 0.34, 0]} />
          {/* ears */}
          <Box size={[0.03, 0.07, 0.05]} at={[-0.18, 0.15, 0]} color={skinDark} />
          <Box size={[0.03, 0.07, 0.05]} at={[0.18, 0.15, 0]} color={skinDark} />
          {look.earrings ? (
            <>
              <mesh geometry={SPHERE} material={gold} scale={0.016} position={[-0.19, 0.1, 0.01]} />
              <mesh geometry={SPHERE} material={gold} scale={0.016} position={[0.19, 0.1, 0.01]} />
            </>
          ) : null}
          {/* face, on the front at z = 0.15 */}
          <group position={[0, 0.155, 0.151]}>
            <group ref={eyes} position={[0, 0.02, 0]}>
              {[-1, 1].map((s) => (
                <group key={s} position={[s * 0.072, 0, 0]}>
                  <mesh geometry={BOX} material={dark} scale={[0.042, 0.058, 0.01]} />
                  <mesh geometry={BOX} material={mat('#ffffff', { rough: 0.3 })} scale={[0.014, 0.016, 0.004]} position={[0.008, 0.012, 0.006]} />
                </group>
              ))}
            </group>
            <group ref={brows} position={[0, 0.083, 0]}>
              {[-1, 1].map((s) => (
                <mesh key={s} geometry={BOX} material={mat(browCol)} scale={[0.07, 0.016, 0.01]} position={[s * 0.072, 0, 0.002]} rotation={[0, 0, s * -0.12]} />
              ))}
            </group>
            <mesh geometry={BOX} material={mat(skinDark)} scale={[0.045, 0.055, 0.032]} position={[0, -0.022, 0.012]} />
            {look.phuli ? <mesh geometry={SPHERE} material={gold} scale={0.009} position={[-0.026, -0.035, 0.03]} /> : null}
            {[-1, 1].map((s) => (
              <mesh key={s} geometry={BOX} material={mat('#e0866f', { rough: 0.9 })} scale={[0.05, 0.026, 0.004]} position={[s * 0.105, -0.045, 0.001]} />
            ))}
            {look.mustache ? <mesh geometry={BOX} material={mat(look.mustache)} scale={[0.11, 0.024, 0.014]} position={[0, -0.058, 0.01]} /> : null}
            <group position={[0, -0.082, 0.002]}>
              <mesh ref={mouthMid} geometry={BOX} material={mat('#5a1f17')} scale={[0.07, 0.014, 0.01]} />
              <mesh ref={cornerL} geometry={BOX} material={mat('#5a1f17')} scale={[0.016, 0.014, 0.01]} position={[-0.042, 0.004, 0]} />
              <mesh ref={cornerR} geometry={BOX} material={mat('#5a1f17')} scale={[0.016, 0.014, 0.01]} position={[0.042, 0.004, 0]} />
            </group>
            {look.tika ? <mesh geometry={BOX} material={mat('#d0201a', { rough: 0.4, emissive: '#600a06' })} scale={[0.024, 0.034, 0.006]} position={[0, 0.112, 0.003]} /> : null}
            {look.old ? (
              <>
                <mesh geometry={BOX} material={mat(skinDark)} scale={[0.1, 0.006, 0.004]} position={[0, 0.125, 0.001]} />
                <mesh geometry={BOX} material={mat(skinDark)} scale={[0.08, 0.006, 0.004]} position={[0, 0.138, 0.001]} />
              </>
            ) : null}
            {look.glasses ? (
              <group position={[0, 0.02, 0.012]}>
                {[-1, 1].map((s) => (
                  <group key={s} position={[s * 0.072, 0, 0]}>
                    <mesh geometry={BOX} material={dark} scale={[0.085, 0.01, 0.008]} position={[0, 0.042, 0]} />
                    <mesh geometry={BOX} material={dark} scale={[0.085, 0.01, 0.008]} position={[0, -0.042, 0]} />
                    <mesh geometry={BOX} material={dark} scale={[0.01, 0.085, 0.008]} position={[-0.042, 0, 0]} />
                    <mesh geometry={BOX} material={dark} scale={[0.01, 0.085, 0.008]} position={[0.042, 0, 0]} />
                  </group>
                ))}
                <mesh geometry={BOX} material={dark} scale={[0.06, 0.01, 0.008]} />
              </group>
            ) : null}
          </group>
          {/* hair */}
          <Box size={[0.36, look.hat ? 0.04 : 0.075, 0.32]} at={[0, look.hat ? 0.3 : 0.32, 0]} material={hair} />
          <Box size={[0.36, look.female ? 0.26 : 0.2, 0.06]} at={[0, look.female ? 0.15 : 0.19, -0.14]} material={hair} />
          <Box size={[0.03, 0.12, 0.24]} at={[-0.17, 0.24, -0.02]} material={hair} />
          <Box size={[0.03, 0.12, 0.24]} at={[0.17, 0.24, -0.02]} material={hair} />
          {look.female ? <Box size={[0.34, 0.05, 0.05]} at={[0, 0.29, 0.135]} material={hair} /> : null}
          {look.hairStyle === 'side' ? <Box size={[0.22, 0.06, 0.08]} at={[-0.06, 0.3, 0.13]} material={hair} rot={[0, 0, 0.12]} /> : null}
          {look.hairStyle === 'bun' ? <Box size={[0.15, 0.13, 0.12]} at={[0, 0.27, -0.2]} material={hair} /> : null}
          {look.hairStyle === 'braid' ? (
            <group position={[0, 0.1, -0.18]}>
              {[0, 1, 2, 3].map((i) => (
                <Box key={i} size={[0.075 - i * 0.008, 0.075, 0.07]} at={[0, -i * 0.075, -0.01 * i]} material={hair} />
              ))}
              <Box size={[0.06, 0.04, 0.06]} at={[0, -0.31, -0.03]} material={mat('#c8321a', { rough: 0.5 })} />
            </group>
          ) : null}
          {look.hat === 'dhaka' ? (
            <mesh geometry={DHAKA_GEO} material={dhakaMat()} position={[0, 0.3, 0]} rotation={[0, 0, -0.06]} castShadow={shadows} />
          ) : null}
          {look.hat === 'bhadgaule' ? <mesh geometry={BHAD_GEO} material={mat('#191512', { rough: 0.7 })} position={[0, 0.3, 0]} rotation={[0, 0, -0.04]} castShadow={shadows} /> : null}
        </group>
      </group>
    </group>
  );
}

let dhaka: THREE.Material | null = null;
function dhakaMat(): THREE.Material {
  if (!dhaka) {
    const t = dhakaTex().clone();
    t.repeat.set(2, 1);
    t.needsUpdate = true;
    dhaka = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.12 });
  }
  return dhaka;
}
