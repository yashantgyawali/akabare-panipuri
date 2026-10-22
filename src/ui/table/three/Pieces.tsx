/**
 * What lies on the table: each seat's pile of upturned bowls + power card, the
 * brass plate with the eaten bowls (and flipped powers), and the high-bid token.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W, PLATE_R, platePos3, stackJitter, type Seat3DSpot } from './layout3d.ts';
import { Card3D, GlowPad, cardGeo, cardMaterials, clickProps, type Glow } from './Card3D.tsx';
import { numberTex } from './textures.ts';
import type { ColorId, PuriKind } from '../../../engine/types.ts';
import { BOWL_R, Bowl, FlippingBowl, NEST } from './Bowl3D.tsx';
import { useBlend } from './Room.tsx';

const MAX_SHOWN = 14;
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

/**
 * A brief glow after an event touched this pile. Pinned to the last event that
 * did (its seq and tone): the cue going back to null when the next event plays
 * must not cancel the timer that turns the glow off, or it stays on for good.
 */
function useCueGlow(seq: number | null, tone: Glow, ms = 1100): Glow {
  const [on, setOn] = useState<Glow>(null);
  const last = useRef<{ seq: number; tone: Glow } | null>(null);
  if (seq !== null && last.current?.seq !== seq) last.current = { seq, tone };
  const key = last.current?.seq ?? null;
  useEffect(() => {
    if (key === null || !last.current) return;
    setOn(last.current.tone);
    const t = setTimeout(() => setOn(null), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}

export interface PileProps {
  spot: Seat3DSpot;
  /** Upturned bowls, bottom to top: owner colour, and the letter for bowls you may know. */
  bowls: { color: ColorId; peek: PuriKind | null }[];
  stackGlow: Glow;
  dimStack?: boolean;
  onStack?: () => void;
  power: { tex: THREE.Texture; glow: Glow; up: boolean; onClick?: () => void } | null;
  /** performance.now() at which a card that is flying in lands (its top card hides until then). */
  landAt: number;
  cue: { part: 'stack' | 'power' | 'seat'; seq: number; tone?: 'good' | 'bad' } | null;
  phone: boolean;
}

export function Pile({ spot, bowls, stackGlow, dimStack, onStack, power, landAt, cue, phone }: PileProps) {
  const shown = bowls.slice(-MAX_SHOWN);
  // The top bowl hides until a bowl flying in lands. When the stack changes, the
  // bowl that was on top must be shown again (visible is set imperatively).
  const top = useRef<THREE.Group | null>(null);
  const setTop = useCallback((g: THREE.Group | null) => {
    if (top.current && top.current !== g) top.current.visible = true;
    top.current = g;
  }, []);
  useFrame(() => {
    if (top.current) top.current.visible = performance.now() >= landAt;
  });
  const cueTone: Glow = cue?.tone === 'bad' ? 'danger' : cue?.tone === 'good' ? 'good' : 'selectable';
  const stackCue = useCueGlow(cue && cue.part === 'stack' ? cue.seq : null, cueTone);
  const powerCue = useCueGlow(cue && cue.part === 'power' ? cue.seq : null, cueTone);
  // Tap targets grow outward and in depth, but not toward the neighbouring card
  // (the power lies to the stack's right), so on phones a tap can't hit the wrong one.
  const hit = phone ? 1.6 : 1.25;
  const hitW = (CARD_W * (1 + hit)) / 2;
  const hitOff = (CARD_W * (hit - 1)) / 4;
  const count = bowls.length > 2 ? numberTex(String(bowls.length), '#2a170c', '#f5e8ca') : null;
  return (
    <group>
      <group position={[spot.pile.x, 0, spot.pile.z]} rotation={[0, spot.yaw, 0]}>
        <GlowPad glow={stackCue ?? stackGlow} scale={0.72} />
        {shown.length === 0 ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
            <ringGeometry args={[BOWL_R * 0.8, BOWL_R, 32]} />
            <meshStandardMaterial color="#000" transparent opacity={0.18} roughness={1} />
          </mesh>
        ) : null}
        {/* upturned bowls nest on each other; each sits a little higher and turned a touch (by index only) */}
        {shown.map((b, i) => {
          const j = stackJitter(i);
          const isTop = i === shown.length - 1;
          return (
            <group key={i} ref={isTop ? setTop : undefined} position={[j.dx * 0.5, i * NEST, j.dz * 0.5]} rotation={[0, j.rot * 4, 0]}>
              <Bowl color={b.color} up={false} peek={b.peek} dim={dimStack} />
            </group>
          );
        })}
        {count ? (
          <mesh position={[BOWL_R * 1.55, 0.006, -BOWL_R * 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.042, 28]} />
            <meshStandardMaterial map={count} roughness={0.5} metalness={0.3} />
          </mesh>
        ) : null}
        <mesh {...clickProps(onStack)} position={[hitOff, 0.03, 0]} material={hitMat} visible={!!onStack}>
          <boxGeometry args={[hitW, 0.08, CARD_H * hit]} />
        </mesh>
      </group>
      {power ? (
        <group position={[spot.power.x, 0, spot.power.z]} rotation={[0, spot.yaw + 0.12, 0]}>
          <GlowPad glow={powerCue ?? power.glow} scale={0.85} />
          <Card3D tex={power.tex} position={[0, CARD_T / 2 + 0.0015, 0]} rotation={[0, 0, 0]} />
          <mesh {...clickProps(power.onClick)} position={[-hitOff, 0.03, 0]} material={hitMat} visible={!!power.onClick}>
            <boxGeometry args={[hitW, 0.08, CARD_H * hit]} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/** The brass thali in the middle, inside a softly glowing ring (where the play happens). */
export function Plate({ overhead = false, reduced = false }: { overhead?: boolean; reduced?: boolean }) {
  const brass = useRef<THREE.MeshStandardMaterial>(null);
  const top = useBlend(overhead, reduced);
  // Seen from straight above, the polished brass mirrors the lamp into a white blaze: go satin.
  useFrame(() => {
    const m = brass.current;
    if (!m) return;
    m.roughness = 0.32 + 0.33 * top.current;
    m.metalness = 0.85 - 0.25 * top.current;
  });
  const profile = useMemo(() => {
    const pts = [
      [0, 0],
      [PLATE_R * 0.86, 0],
      [PLATE_R * 0.9, 0.008],
      [PLATE_R * 0.97, 0.022],
      [PLATE_R * 1.02, 0.03],
      [PLATE_R * 1.0, 0.034],
      [PLATE_R * 0.95, 0.026],
      [PLATE_R * 0.88, 0.012],
      [0, 0.012],
    ];
    return pts.map(([x, y]) => new THREE.Vector2(x, y));
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0012, 0]}>
        <ringGeometry args={[0.46, 0.475, 96]} />
        <meshBasicMaterial color="#f3d27a" toneMapped={false} transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, 0.001, 0]} receiveShadow castShadow>
        <latheGeometry args={[profile, 48]} />
        <meshStandardMaterial ref={brass} color="#c9953a" metalness={0.85} roughness={0.32} />
      </mesh>
    </group>
  );
}

export type PlateCard =
  | {
      key: string;
      /** An eaten puri: its bowl lands open on the plate. */
      bowl: { kind: PuriKind; color: ColorId };
      dim: boolean;
      /** Where it flies in from (a stack), when it just landed. */
      from: THREE.Vector3 | null;
    }
  | {
      key: string;
      bowl?: undefined;
      front: THREE.Texture;
      back: THREE.Texture;
      dim: boolean;
      from: THREE.Vector3 | null;
    };

function EatenBowl({ c, i, n, reduced }: { c: Extract<PlateCard, { bowl: object }>; i: number; n: number; reduced: boolean }) {
  const p = platePos3(i, n);
  const to = useMemo(() => new THREE.Vector3(p.x, 0.013, p.z), [p.x, p.z]);
  // Pinned when it lands (see EatenCard).
  const [from] = useState(() => (reduced ? null : (c.from?.clone() ?? null)));
  return <FlippingBowl from={from} to={to} color={c.bowl.color} kind={c.bowl.kind} dim={c.dim} scale={0.62} />;
}

function EatenCard({ c, i, n, reduced }: { c: Extract<PlateCard, { front: THREE.Texture }>; i: number; n: number; reduced: boolean }) {
  const p = platePos3(i, n);
  const to = useMemo(() => new THREE.Vector3(p.x, 0.016 + i * CARD_T, p.z), [p.x, p.z, i]);
  // Start time and origin are pinned when the card lands on the plate: the next
  // event replacing `current` mid-flight must not snap it onto the plate.
  const [{ start, from }] = useState(() => ({ start: performance.now(), from: reduced ? null : (c.from?.clone() ?? null) }));
  const ms = 820;
  const g = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const front = cardMaterials(c.front, c.dim);
  const back = cardMaterials(c.back);
  useFrame(() => {
    const grp = g.current;
    const m = mesh.current;
    if (!grp || !m) return;
    const t = from ? Math.min(1, (performance.now() - start) / ms) : 1;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    if (from) {
      grp.position.lerpVectors(from, to, e);
      grp.position.y += Math.sin(Math.PI * e) * 0.32;
    } else grp.position.copy(to);
    // Flip over the long edge on the way: back up for the first half, front up for the second.
    m.material = e < 0.5 ? back : front;
    m.rotation.z = e < 0.5 ? Math.PI * e : Math.PI * e - Math.PI;
  });
  return (
    <group ref={g} rotation={[0, p.rot, 0]}>
      <mesh ref={mesh} geometry={cardGeo} material={front} receiveShadow castShadow />
    </group>
  );
}

/**
 * Each card keeps the plate spot it landed on: slots go by first appearance (a
 * power flipped earlier doesn't move when another puri lands), and the spiral is
 * sized for a steady count so earlier cards don't shift as the plate fills.
 */
export function PlateCards({ cards, reduced }: { cards: PlateCard[]; reduced: boolean }) {
  const slots = useRef(new Map<string, number>());
  if (cards.length < slots.current.size) slots.current.clear(); // a new round
  for (const c of cards) if (!slots.current.has(c.key)) slots.current.set(c.key, slots.current.size);
  const total = Math.max(10, slots.current.size);
  return (
    <group>
      {cards.map((c) =>
        c.bowl ? (
          <EatenBowl key={c.key} c={c} i={slots.current.get(c.key)!} n={total} reduced={reduced} />
        ) : (
          <EatenCard key={c.key} c={c} i={slots.current.get(c.key)!} n={total} reduced={reduced} />
        ),
      )}
    </group>
  );
}

/** The high bid: a brass token with the number, rimmed in the high bidder's colour; it hops when the bid changes. */
export function BidToken({ amount, rim }: { amount: number; rim: string }) {
  const g = useRef<THREE.Group>(null);
  const changed = useRef({ amount, at: performance.now() });
  if (changed.current.amount !== amount) changed.current = { amount, at: performance.now() };
  useFrame(() => {
    if (!g.current) return;
    const t = (performance.now() - changed.current.at) / 600;
    const hop = t < 1 ? Math.sin(Math.PI * t) * 0.12 : 0;
    g.current.position.y = 0.03 + hop;
    g.current.rotation.y = t < 1 ? t * Math.PI * 2 : 0;
  });
  return (
    <group ref={g} position={[0, 0.03, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.03, 40]} />
        <meshStandardMaterial attach="material-0" color="#9a6c22" metalness={0.8} roughness={0.35} />
        <meshStandardMaterial attach="material-1" map={numberTex(String(amount), '#2a170c', rim)} metalness={0.4} roughness={0.4} />
        <meshStandardMaterial attach="material-2" color="#7a5418" metalness={0.8} roughness={0.4} />
      </mesh>
    </group>
  );
}
