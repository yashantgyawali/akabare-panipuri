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

/** The brass thali in the middle, inside a softly glowing ring (where the play happens). */
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
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0012, 0]}>
        <ringGeometry args={[0.46, 0.475, 96]} />
        <meshBasicMaterial color="#f3d27a" toneMapped={false} transparent opacity={0.75} />
      </mesh>
      <mesh position={[0, 0.001, 0]} receiveShadow castShadow>
        <latheGeometry args={[profile, 48]} />
        <meshStandardMaterial color="#c9953a" metalness={0.85} roughness={0.32} />
      </mesh>
    </group>
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

const SKIN = new THREE.MeshStandardMaterial({ color: '#d99a6c', roughness: 0.8 });
const SKIN_LIT = new THREE.MeshBasicMaterial({ color: '#c98a5e' });

/** A blocky hand (the Kenney characters' style): palm, fingers, thumb. `lit` = unlit, for in front of the camera. */
export function BlockHand({ lit = false, flip = false }: { lit?: boolean; flip?: boolean }) {
  const m = lit ? SKIN_LIT : SKIN;
  const f = flip ? -1 : 1;
  return (
    <group>
      <mesh material={m} position={[0, 0, 0]}>
        <boxGeometry args={[0.1, 0.11, 0.045]} />
      </mesh>
      <mesh material={m} position={[0, 0.07, 0.012]}>
        <boxGeometry args={[0.095, 0.045, 0.04]} />
      </mesh>
      <mesh material={m} position={[0.06 * f, 0.02, 0.02]} rotation={[0, 0, -0.5 * f]}>
        <boxGeometry args={[0.03, 0.07, 0.035]} />
      </mesh>
      <mesh material={m} position={[0, -0.1, -0.005]}>
        <boxGeometry args={[0.075, 0.1, 0.04]} />
      </mesh>
    </group>
  );
}

/**
 * Your cards held up in one hand like Liar's Bar: a small fan pivoting at your
 * fist, a little left of centre, with your other hand resting lower right.
 * Sized from the screen (about a third of the view tall, never too wide) and
 * lifted `insetPx` above the bottom so the floating controls never cover it.
 * Resting (nothing to pick) it drops lower, out of the way of the table.
 */
const TIP = -0.22;
/** Held cards: the face only (a thin box would show its square edges past the rounded corners). */
const heldGeo = new THREE.PlaneGeometry(CARD_W, CARD_H).rotateX(-Math.PI / 2);

export function Hand3D({ cards, onPick, phone, insetPx = 0 }: { cards: HandCard3D[]; onPick: (i: number) => void; phone: boolean; insetPx?: number }) {
  const { camera, size } = useThree();
  const root = useRef<THREE.Group>(null);
  const fist = useRef<THREE.Group>(null);
  const other = useRef<THREE.Group>(null);
  const items = useRef<(THREE.Group | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const n = cards.length;
  const active = cards.some((c) => c.pickable || c.selected);
  const rest = useRef(active ? 0 : 1);
  useFrame((_, dt) => {
    const r = root.current;
    if (!r) return;
    const cam = camera as THREE.PerspectiveCamera;
    r.position.copy(cam.position);
    r.quaternion.copy(cam.quaternion);
    rest.current += ((active ? 0 : 1) - rest.current) * Math.min(1, dt * 6);
    const d = 0.6;
    const halfH = d * Math.tan((cam.fov * Math.PI) / 360);
    const halfW = halfH * (size.width / Math.max(1, size.height));
    const px = (2 * halfH) / Math.max(1, size.height);
    const sc = Math.min((2 * halfH * (phone ? 0.21 : 0.25)) / CARD_H, (2 * halfW * 0.15) / CARD_W);
    const h = CARD_H * sc;
    const spread = n > 1 ? Math.min(0.26, 1.3 / (n - 1)) : 0;
    const R = h * 0.7;
    // The fist (fan pivot): low and a little left of centre; lower still when resting.
    // Held off to the left, so your own stack and power on the table stay in view.
    const pxX = phone ? -halfW * 0.26 : -halfW * 0.3;
    const pyY = -halfH + insetPx * px - h * 0.18 - rest.current * h * 0.4;
    cards.forEach((c, i) => {
      const it = items.current[i];
      if (!it) return;
      // The whole fan is held tipped a little to the left.
      const th = (i - (n - 1) / 2) * spread + TIP;
      const up = c.selected ? h * 0.22 : hover === i && c.pickable ? h * 0.08 : 0;
      const rr = R + up;
      it.scale.setScalar(sc);
      it.position.x = pxX + Math.sin(th) * rr;
      it.position.y += (pyY + Math.cos(th) * rr - it.position.y) * Math.min(1, dt * 12);
      it.position.z = -d + i * 0.0015;
      // Stand the card up to face the camera, leaned back a touch (X), turned in its own plane by the fan angle (Y, applied first).
      it.rotation.set(Math.PI / 2 - 0.22, -th, 0);
    });
    if (fist.current) {
      fist.current.position.set(pxX + h * 0.02, pyY + h * 0.12, -d + 0.03);
      fist.current.scale.setScalar(h * 2.6);
      fist.current.rotation.set(0, 0, -0.15 - TIP);
    }
    if (other.current) {
      other.current.position.set(halfW * (phone ? 0.55 : 0.38), -halfH + insetPx * px - h * 0.05, -d + 0.02);
      other.current.scale.setScalar(h * 2.4);
      other.current.rotation.set(-0.6, 0, 0.35);
    }
  });
  const anyPick = cards.some((x) => x.pickable);
  return (
    <group ref={root}>
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
          {c.selected || c.focus ? (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} scale={[CARD_W * 1.08, CARD_H * 1.06, 1]}>
              <planeGeometry />
              <meshBasicMaterial color={c.focus ? '#ffffff' : '#F16147'} toneMapped={false} />
            </mesh>
          ) : null}
          <mesh geometry={heldGeo} material={heldMaterials(c.tex, anyPick && !c.pickable && !c.selected)[2]} />
        </group>
      ))}
      <group ref={fist}>
        <BlockHand lit />
      </group>
      <group ref={other}>
        <BlockHand lit flip />
      </group>
    </group>
  );
}
