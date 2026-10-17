/**
 * What lies on the table: each seat's pile + power card, the brass plate with
 * the eaten cards, the high-bid token, a card in flight, and your own hand
 * held up in front of the camera.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W, PLATE_R, platePos3, stackJitter, type Seat3DSpot } from './layout3d.ts';
import { Card3D, GlowPad, cardGeo, cardMaterials, clickProps, heldMaterials, type Glow } from './Card3D.tsx';
import { numberTex } from './textures.ts';

const MAX_SHOWN = 14;
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

/** A brief glow after an event touched this pile (keyed by the event seq). */
function useCueGlow(seq: number | null, tone: Glow, ms = 1100): Glow {
  const [on, setOn] = useState<Glow>(null);
  useEffect(() => {
    if (seq === null) return;
    setOn(tone);
    const t = setTimeout(() => setOn(null), ms);
    return () => clearTimeout(t);
  }, [seq, tone, ms]);
  return on;
}

export interface PileProps {
  spot: Seat3DSpot;
  /** Bottom to top. */
  cards: { tex: THREE.Texture }[];
  stackGlow: Glow;
  dimStack?: boolean;
  onStack?: () => void;
  power: { tex: THREE.Texture; glow: Glow; up: boolean; onClick?: () => void } | null;
  /** performance.now() at which a card that is flying in lands (its top card hides until then). */
  landAt: number;
  cue: { part: 'stack' | 'power' | 'seat'; seq: number; tone?: 'good' | 'bad' } | null;
  phone: boolean;
}

export function Pile({ spot, cards, stackGlow, dimStack, onStack, power, landAt, cue, phone }: PileProps) {
  const shown = cards.slice(-MAX_SHOWN);
  const top = useRef<THREE.Group>(null);
  useFrame(() => {
    if (top.current) top.current.visible = performance.now() >= landAt;
  });
  const cueTone: Glow = cue?.tone === 'bad' ? 'danger' : cue?.tone === 'good' ? 'good' : 'selectable';
  const stackCue = useCueGlow(cue && cue.part === 'stack' ? cue.seq : null, cueTone);
  const powerCue = useCueGlow(cue && cue.part === 'power' ? cue.seq : null, cueTone);
  const hit = phone ? 1.6 : 1.25;
  const count = cards.length > 3 ? numberTex(String(cards.length), '#2a170c', '#f5e8ca') : null;
  return (
    <group>
      <group position={[spot.pile.x, 0, spot.pile.z]} rotation={[0, spot.yaw, 0]}>
        <GlowPad glow={stackCue ?? stackGlow} />
        {shown.length === 0 ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshStandardMaterial color="#000" transparent opacity={0.12} roughness={1} />
          </mesh>
        ) : null}
        {shown.map((c, i) => {
          const j = stackJitter(i);
          const isTop = i === shown.length - 1;
          return (
            <group key={i} ref={isTop ? top : undefined} position={[j.dx, CARD_T * (i + 0.5) + 0.0015, j.dz]} rotation={[0, j.rot, 0]}>
              <mesh geometry={cardGeo} material={cardMaterials(c.tex, dimStack)} receiveShadow castShadow={false} />
            </group>
          );
        })}
        {count ? (
          <mesh position={[CARD_W * 0.62, 0.006, -CARD_H * 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.042, 28]} />
            <meshStandardMaterial map={count} roughness={0.5} metalness={0.3} />
          </mesh>
        ) : null}
        <mesh {...clickProps(onStack)} position={[0, 0.03, 0]} material={hitMat} visible={!!onStack}>
          <boxGeometry args={[CARD_W * hit, 0.08, CARD_H * hit]} />
        </mesh>
      </group>
      {power ? (
        <group position={[spot.power.x, 0, spot.power.z]} rotation={[0, spot.yaw + 0.12, 0]}>
          <GlowPad glow={powerCue ?? power.glow} scale={0.85} />
          <Card3D tex={power.tex} position={[0, CARD_T / 2 + 0.0015, 0]} rotation={[0, 0, 0]} />
          <mesh {...clickProps(power.onClick)} position={[0, 0.03, 0]} material={hitMat} visible={!!power.onClick}>
            <boxGeometry args={[CARD_W * hit, 0.08, CARD_H * hit]} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/** The brass thali in the middle. */
export function Plate() {
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
    <mesh position={[0, 0.001, 0]} receiveShadow castShadow>
      <latheGeometry args={[profile, 48]} />
      <meshStandardMaterial color="#c9953a" metalness={0.85} roughness={0.32} />
    </mesh>
  );
}

export interface PlateCard {
  key: string;
  front: THREE.Texture;
  back: THREE.Texture;
  dim: boolean;
  /** Where it flies in from (a stack), when it just landed. */
  from: THREE.Vector3 | null;
}

function EatenCard({ c, i, n, reduced }: { c: PlateCard; i: number; n: number; reduced: boolean }) {
  const p = platePos3(i, n);
  const to = useMemo(() => new THREE.Vector3(p.x, 0.016 + i * CARD_T, p.z), [p.x, p.z, i]);
  const [start] = useState(() => performance.now());
  const from = reduced ? null : c.from;
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

export function PlateCards({ cards, reduced }: { cards: PlateCard[]; reduced: boolean }) {
  return (
    <group>
      {cards.map((c, i) => (
        <EatenCard key={c.key} c={c} i={i} n={cards.length} reduced={reduced} />
      ))}
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

/** A card flying from someone's hands to a stack (a 'place' move). */
export function FlyingCard({ from, to, yaw, tex, start, ms }: { from: THREE.Vector3; to: THREE.Vector3; yaw: number; tex: THREE.Texture; start: number; ms: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const t = Math.min(1, (performance.now() - start) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    grp.position.lerpVectors(from, to, e);
    grp.position.y += Math.sin(Math.PI * t) * 0.25;
    grp.rotation.set(0, yaw + (1 - e) * 1.4, (1 - e) * 0.5);
    grp.visible = t < 1;
  });
  return (
    <group ref={g} position={from}>
      <mesh geometry={cardGeo} material={cardMaterials(tex)} castShadow />
    </group>
  );
}

export interface HandCard3D {
  tex: THREE.Texture;
  pickable: boolean;
  selected: boolean;
  /** Keyboard focus is on this card's hidden control. */
  focus?: boolean;
}

/** Your cards, held up at the bottom of your view (fanned), like holding them in your hands. */
export function Hand3D({ cards, onPick, phone }: { cards: HandCard3D[]; onPick: (i: number) => void; phone: boolean }) {
  const { camera } = useThree();
  const root = useRef<THREE.Group>(null);
  const items = useRef<(THREE.Group | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const n = cards.length;
  // Held low (resting) unless you're picking a card to place.
  const active = cards.some((c) => c.pickable || c.selected);
  const rest = useRef(active ? 0 : -0.16);
  useFrame((_, dt) => {
    const r = root.current;
    if (!r) return;
    rest.current += ((active ? 0 : -0.16) - rest.current) * Math.min(1, dt * 6);
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    cards.forEach((c, i) => {
      const it = items.current[i];
      if (!it) return;
      const a = (i - (n - 1) / 2) * (phone ? 0.2 : 0.17);
      const up = c.selected ? 0.06 : hover === i && c.pickable ? 0.025 : 0;
      const ty = Math.cos(a) * 0.55 - 0.55 + up + rest.current;
      it.position.x = Math.sin(a) * 0.55;
      it.position.y += (ty - it.position.y) * Math.min(1, dt * 12);
      it.position.z = -i * 0.002;
      // Stand the card up to face the camera (X), fanned in its own plane (Y, applied first).
      it.rotation.set(Math.PI / 2, a, 0);
    });
  });
  const s = phone ? 0.6 : 0.5;
  return (
    <group ref={root}>
      <group position={[phone ? 0 : -0.06, phone ? -0.3 : -0.19, -0.6]} rotation={[-0.12, 0, 0]} scale={s}>
        {cards.map((c, i) => (
          <group
            key={i}
            ref={(el) => {
              items.current[i] = el;
            }}
            {...clickProps(c.pickable ? () => onPick(i) : undefined)}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
          >
            {c.selected || c.pickable || c.focus ? (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} scale={[CARD_W * 1.18, CARD_H * 1.12, 1]}>
                <planeGeometry />
                <meshBasicMaterial color={c.focus ? '#ffffff' : c.selected ? '#F16147' : '#F3B952'} toneMapped={false} transparent opacity={c.selected || c.focus ? 1 : 0.7} />
              </mesh>
            ) : null}
            <mesh geometry={cardGeo} material={heldMaterials(c.tex, !c.pickable && !c.selected && cards.some((x) => x.pickable))} />
          </group>
        ))}
      </group>
    </group>
  );
}
