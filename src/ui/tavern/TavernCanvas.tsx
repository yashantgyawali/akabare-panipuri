/**
 * The tavern behind every screen before the game (lazy-loaded, shares the 3D
 * chunk with the table): the same room, lamp, table, plate and Nepali
 * villagers as the game.
 *
 * - mode 'orbit' (home, join, loading): everyone sits around the table, the
 *   camera circles slowly; drag to spin around, tap a villager to make them react.
 * - mode 'seat' (lobby): the game's own first-person camera from your seat;
 *   everyone else sits where they will play, with a name tag; seats pop in as
 *   players and bots join.
 */
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ColorId } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Villager, type Reaction, type ReactionKind } from '../table/three/Villager.tsx';
import { looksForTable } from '../table/three/looks.ts';
import { CameraRig, Chair, DRAG_PX, Dust, Lights, RoomShell, TableMesh } from '../table/three/Room.tsx';
import { Plate } from '../table/three/Pieces.tsx';
import { CursorSync } from '../table/three/Card3D.tsx';
import { Bowl, NEST } from '../table/three/Bowl3D.tsx';
import { ReleaseOnUnmount } from '../table/three/ReleaseOnUnmount.tsx';
import { SEAT_R, platePos3, seatSpot } from '../table/three/layout3d.ts';
import { sfx } from '../sound/sfx.ts';

export interface Guest {
  id: string;
  name: string;
  color: ColorId;
  /** The viewer (marked in orbit mode; the camera's seat in seat mode). */
  you?: boolean;
  /** The real seat number (lobby), so each looks the same at the table once the game starts. */
  seat?: number;
}

export interface TavernCanvasProps {
  mode: 'orbit' | 'seat';
  /** Seat order; in seat mode the viewer must be first. */
  guests: Guest[];
  phone: boolean;
  reduced: boolean;
  /** Name tags above heads (seat mode). */
  labels?: boolean;
  /** Seat mode: lay the table out for at least this many seats; the free ones show an empty chair. */
  slots?: number;
  onFail: (why: unknown) => void;
}

const REACTIONS: ReactionKind[] = ['cheer', 'yes', 'flinch', 'no', 'pick'];
const SOUND: Record<ReactionKind, () => void> = {
  cheer: sfx.success,
  yes: sfx.bid,
  flinch: sfx.bite,
  no: sfx.pass,
  pick: sfx.flip,
  reach: sfx.place,
  slump: sfx.bust,
};

class Boundary extends Component<{ onFail: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onFail(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Evenly around the table (orbit mode shows everyone, you included). */
function orbitSpot(i: number, n: number) {
  const angle = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / Math.max(2, n);
  const dir = { x: -Math.sin(angle), z: Math.cos(angle) };
  return { dir, seat: { x: dir.x * SEAT_R, z: dir.z * SEAT_R }, pile: { x: dir.x * 0.62, z: dir.z * 0.62 }, yaw: Math.atan2(dir.x, dir.z) };
}

/** Slowly circles the table; drag to spin around it (with a little inertia). */
function OrbitRig({ reduced, phone }: { reduced: boolean; phone: boolean }) {
  const { camera, gl, size } = useThree();
  const st = useRef({ angle: 0.6, vel: 0, drag: false, lastX: 0, id: -1, touches: 0 });
  useEffect(() => {
    const el = gl.domElement;
    // One primary pointer spins the room; a second finger (a pinch) or another button stops it.
    const down = (e: PointerEvent) => {
      const s = st.current;
      if (e.pointerType === 'touch') s.touches += 1;
      if (s.touches > 1) {
        s.drag = false;
        return;
      }
      if (!e.isPrimary || e.button !== 0) return;
      s.drag = true;
      s.id = e.pointerId;
      s.lastX = e.clientX;
      s.vel = 0;
    };
    const move = (e: PointerEvent) => {
      const s = st.current;
      if (!s.drag || e.pointerId !== s.id) return;
      // A release we never saw (a context menu ate it): stop following the bare mouse.
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        s.drag = false;
        return;
      }
      const dx = e.clientX - s.lastX;
      s.lastX = e.clientX;
      s.angle -= dx * 0.006;
      s.vel = -dx * 0.006;
    };
    const up = (e: PointerEvent) => {
      const s = st.current;
      if (e.pointerType === 'touch') s.touches = Math.max(0, s.touches - 1);
      if (e.pointerId === s.id) s.drag = false;
    };
    const stop = () => {
      st.current.drag = false;
      st.current.touches = 0;
    };
    el.style.touchAction = 'pan-y pinch-zoom';
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', stop);
    el.addEventListener('contextmenu', stop);
    return () => {
      (camera as THREE.PerspectiveCamera).clearViewOffset();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', stop);
      el.removeEventListener('contextmenu', stop);
    };
  }, [gl, camera]);
  useFrame((_, dt) => {
    const s = st.current;
    if (!s.drag) {
      s.angle += s.vel;
      s.vel *= Math.pow(0.04, dt);
      if (!reduced) s.angle += dt * 0.06;
    }
    const cam = camera as THREE.PerspectiveCamera;
    const wide = size.width / Math.max(1, size.height);
    const fov = phone ? 62 : wide < 1 ? 58 : 44;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const r = phone ? 3.9 : 3.5;
    cam.position.set(Math.sin(s.angle) * r, phone ? 2.4 : 1.95, Math.cos(s.angle) * r);
    cam.lookAt(0, phone ? 0.05 : 0.1, 0);
    // Keep the table clear of the glass panel: shift the picture right on desktop
    // (the panel is on the left) and up on phones (the panel is docked at the bottom).
    const w = size.width;
    const h = size.height;
    if (phone) cam.setViewOffset(w, h, 0, h * 0.2, w, h);
    else cam.setViewOffset(w, h, w < 900 ? 0 : -w * 0.17, 0, w, h);
  });
  return null;
}

/**
 * Lobby: the game's camera, with the picture nudged away from the glass panel
 * (left on desktop, where the panel is on the right; up on phones, where it is
 * docked at the bottom).
 */
function SeatShift({ phone }: { phone: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const { width: w, height: h } = size;
    if (phone) cam.setViewOffset(w, h, 0, h * 0.16, w, h);
    else cam.setViewOffset(w, h, w < 900 ? 0 : w * 0.11, 0, w, h);
    return () => cam.clearViewOffset();
  }, [camera, size, phone]);
  return null;
}

/** A small gem bobbing above your head (orbit mode). */
function YouGem({ at, color, reduced }: { at: THREE.Vector3 | null; color: string; reduced: boolean }) {
  const g = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!g.current || !at) return;
    const t = reduced ? 0 : clock.elapsedTime;
    g.current.position.set(at.x, at.y + 0.2 + Math.sin(t * 2.2) * 0.03, at.z);
    g.current.rotation.y = t * 1.4;
  });
  return (
    <mesh ref={g} visible={!!at}>
      <octahedronGeometry args={[0.06, 0]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.3} />
    </mesh>
  );
}

/** A villager that pops in when they first sit down. */
function Seated({ children, delay, reduced, x, z }: { children: ReactNode; delay: number; reduced: boolean; x: number; z: number }) {
  const g = useRef<THREE.Group>(null);
  const [born] = useState(() => performance.now() + delay);
  useFrame(() => {
    if (!g.current) return;
    const t = reduced ? 1 : Math.min(1, Math.max(0, (performance.now() - born) / 450));
    // ease out back: a little overshoot, like plopping into the chair
    const c = 1.7;
    const e = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    g.current.scale.setScalar(Math.max(0.001, e));
  });
  // Scale around the chair (children are placed in table coordinates, so shift them back).
  return (
    <group position={[x, 0, z]}>
      <group ref={g}>
        <group position={[-x, 0, -z]}>{children}</group>
      </group>
    </group>
  );
}

export default function TavernCanvas({ mode, guests, phone, reduced, labels, slots = 0, onFail }: TavernCanvasProps) {
  const seat = mode === 'seat';
  const n = seat ? Math.max(guests.length, slots) : guests.length;
  const lookKey = guests.map((g) => `${g.id}:${g.name}:${g.seat ?? ''}`).join('|');
  const looks = useMemo(() => looksForTable(guests.map((g, i) => ({ id: g.id, name: g.name, seat: g.seat ?? i }))), [lookKey]);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const seqRef = useRef(1);
  const poke = (id: string) => {
    const kind = REACTIONS[seqRef.current % REACTIONS.length];
    seqRef.current += 1;
    setReactions((r) => ({ ...r, [id]: { kind, seq: seqRef.current } }));
    SOUND[kind]();
  };
  // Name tags (seat mode), written straight to the DOM every frame.
  const tags = useRef(new Map<string, HTMLDivElement>());
  const size = useRef({ w: 1, h: 1 });
  const camRef = useRef<THREE.Camera | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const youHead = useRef<THREE.Vector3 | null>(null);
  const [youAt, setYouAt] = useState<THREE.Vector3 | null>(null);
  const headAt = (id: string, v: THREE.Vector3, you: boolean) => {
    if (you && !seat) {
      if (!youHead.current) {
        youHead.current = v.clone();
        setYouAt(youHead.current);
      } else youHead.current.copy(v);
    }
    const el = tags.current.get(id);
    const cam = camRef.current;
    if (!el || !cam) return;
    tmp.copy(v);
    tmp.y += 0.36;
    tmp.project(cam);
    // Keep tags on screen and below the code bar.
    const half = el.offsetWidth / 2 + 8;
    const x = Math.min(size.current.w - half, Math.max(half, ((tmp.x + 1) / 2) * size.current.w));
    const y = Math.max(el.offsetHeight + 84, ((1 - tmp.y) / 2) * size.current.h);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = tmp.z < 1 ? '1' : '0';
  };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const you = guests.find((g) => g.you);
  const shadows = !phone;

  // Decorative cards: a little stack in front of everyone, and a few eaten ones on the plate.
  const plateCards = useMemo(
    () => [
      { face: 'panipuri' as const, color: guests[1]?.color ?? 'red' },
      { face: 'panipuri' as const, color: guests[2]?.color ?? 'blue' },
      { face: 'akabare' as const, color: guests[0]?.color ?? 'yellow' },
    ],
    [guests],
  );

  return (
    <div className="tv-canvas">
      <Boundary onFail={onFail}>
        <Canvas
          shadows={shadows}
          dpr={phone ? [1, 1.5] : [1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 50, near: 0.05, far: 30, position: [0, 1.5, 3] }}
          onCreated={({ gl, camera, size: s }) => {
            camRef.current = camera;
            size.current = { w: s.width, h: s.height };
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.15;
            const el = gl.domElement;
            el.addEventListener('webglcontextlost', () => alive.current && el.isConnected && onFail('WebGL context lost'), { once: true });
          }}
        >
          <SizeSync size={size} camRef={camRef} />
          <CursorSync />
          <ReleaseOnUnmount />
          <color attach="background" args={['#1a0d06']} />
          <fog attach="fog" args={['#1a0d06', 4.5, 11]} />
          <Lights flash={false} shadows={shadows} phone={phone} />
          <RoomShell />
          <TableMesh />
          <Plate />
          {!reduced ? <Dust count={phone ? 50 : 120} /> : null}
          {seat ? (
            <>
              <CameraRig focus={null} phone={phone} reduced={reduced} zoom={phone ? 1.15 : 1.22} />
              <SeatShift phone={phone} />
            </>
          ) : (
            <OrbitRig reduced={reduced} phone={phone} />
          )}
          {/* a few eaten puri, open in their bowls on the plate */}
          {plateCards.map((c, i) => {
            const p = platePos3(i, 6);
            return (
              <group key={i} position={[p.x, 0.013, p.z]} rotation={[0, p.rot, 0]} scale={0.62}>
                <Bowl color={c.color} up kind={c.face} />
              </group>
            );
          })}
          {guests.map((g, i) => {
            const spot = seat ? seatSpot(i, n) : orbitSpot(i, n);
            const isYou = !!g.you;
            if (seat && isYou) {
              return (
                <group key={g.id}>
                  {[0, 1].map((k) => (
                    <group key={k} position={[spot.pile.x, k * NEST, spot.pile.z]} rotation={[0, spot.yaw + k * 0.3, 0]}>
                      <Bowl color={g.color} up={false} />
                    </group>
                  ))}
                </group>
              );
            }
            return (
              <group key={g.id}>
                <Chair at={{ x: spot.seat.x * 1.08, z: spot.seat.z * 1.08 }} yaw={spot.yaw + Math.PI} />
                <group position={[spot.pile.x, 0, spot.pile.z]} rotation={[0, spot.yaw, 0]}>
                  <Bowl color={g.color} up={false} />
                </group>
                <Seated delay={seat ? 0 : i * 120} reduced={reduced} x={spot.seat.x} z={spot.seat.z}>
                  <group
                    userData={{ clickable: true }}
                    onClick={(e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation();
                      // A drag to spin the room isn't a tap.
                      if (e.delta <= DRAG_PX) poke(g.id);
                    }}
                    onPointerOver={(e: ThreeEvent<PointerEvent>) => e.stopPropagation()}
                  >
                    <Villager
                      look={looks.get(g.id)!}
                      color={g.color}
                      x={spot.seat.x}
                      z={spot.seat.z}
                      yaw={spot.yaw + Math.PI}
                      reaction={reactions[g.id] ?? null}
                      lean={0}
                      seed={i + 1}
                      reduced={reduced}
                      shadows={shadows}
                      onHead={(v) => headAt(g.id, v, isYou)}
                    />
                  </group>
                </Seated>
              </group>
            );
          })}
          {seat
            ? Array.from({ length: n - guests.length }, (_, k) => {
                const spot = seatSpot(guests.length + k, n);
                return <Chair key={`free${k}`} at={{ x: spot.seat.x * 1.08, z: spot.seat.z * 1.08 }} yaw={spot.yaw + Math.PI} />;
              })
            : null}
          {!seat && you ? <YouGem at={youAt} color={PLAYER_PALETTE[you.color].base} reduced={reduced} /> : null}
        </Canvas>
      </Boundary>
      {labels ? (
        <div className="tv-tags" aria-hidden="true">
          {guests.map((g) =>
            g.you ? null : (
              <div
                key={g.id}
                className="tv-tag"
                ref={(el) => {
                  if (el) tags.current.set(g.id, el);
                  else tags.current.delete(g.id);
                }}
                style={{ ['--c' as string]: PLAYER_PALETTE[g.color].base } as CSSProperties}
              >
                <span className="tv-tag__dot" />
                {g.name}
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function SizeSync({ size, camRef }: { size: React.RefObject<{ w: number; h: number }>; camRef: React.RefObject<THREE.Camera | null> }) {
  const { size: s, camera } = useThree();
  useEffect(() => {
    size.current = { w: s.width, h: s.height };
    camRef.current = camera;
  }, [s.width, s.height, camera, size, camRef]);
  return null;
}
