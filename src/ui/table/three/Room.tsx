/**
 * The tavern: dark plank floor and walls, a heavy round wooden table, chairs,
 * one warm hanging lamp (the only shadow-casting light), dust in the lamp
 * light, and the camera rig (your seat, turning a little toward whoever acts).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TABLE_R, cameraFor, type Vec2 } from './layout3d.ts';
import { woodTex } from './textures.ts';

const FLOOR_Y = -0.78;

/** 0 → 1 while `on` (and back), eased over about a second; read `.current` in useFrame. */
export function useBlend(on: boolean, reduced: boolean) {
  const v = useRef(on ? 1 : 0);
  useFrame((_, dt) => {
    v.current += ((on ? 1 : 0) - v.current) * (reduced ? 1 : Math.min(1, dt * 2.4));
  });
  return v;
}

export function Lights({
  flash,
  shadows,
  phone,
  overhead = false,
  reduced = false,
}: {
  flash: boolean;
  shadows: boolean;
  phone: boolean;
  /** The camera is (going) up above the lamp: hide the lamp, it would black out the view. */
  overhead?: boolean;
  reduced?: boolean;
}) {
  const spot = useRef<THREE.SpotLight>(null);
  const bulb = useRef<THREE.MeshBasicMaterial>(null);
  const lamp = useRef<THREE.Group>(null);
  const top = useBlend(overhead, reduced);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, -0.4, 0);
    return o;
  }, []);
  const flashAt = useRef(0);
  const wasFlash = useRef(false);
  if (flash && !wasFlash.current) flashAt.current = performance.now();
  wasFlash.current = flash;
  const warm = useMemo(() => new THREE.Color('#ffcf8a'), []);
  const red = useMemo(() => new THREE.Color('#ff3b22'), []);
  useFrame(({ clock }) => {
    const s = spot.current;
    if (!s) return;
    const t = (performance.now() - flashAt.current) / 1600;
    const k = flashAt.current && t < 1 ? Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t) : 0;
    s.color.copy(warm).lerp(red, k);
    // A slow, faint flicker.
    s.intensity = (phone ? 16 : 18) * (0.97 + 0.03 * Math.sin(clock.elapsedTime * 7.3) * Math.sin(clock.elapsedTime * 3.1));
    bulb.current?.color.copy(s.color).multiplyScalar(2.2);
    // The camera passes the shade about halfway up.
    if (lamp.current) lamp.current.visible = top.current < 0.5;
  });
  return (
    <>
      <hemisphereLight args={['#7a4a2a', '#140804', 0.6]} />
      <ambientLight color="#3a2414" intensity={0.25} />
      <primitive object={target} />
      <spotLight
        ref={spot}
        position={[0, 1.95, 0]}
        target={target}
        angle={0.95}
        penumbra={0.75}
        decay={1.6}
        distance={9}
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Wall lamps: the room reads (warm wood, shelves) instead of falling into black. */}
      {[
        [-3.4, 1.6, -3.2],
        [3.4, 1.6, -3.2],
        [0, 1.7, -4.6],
      ].map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <pointLight color="#ff9f55" intensity={4} distance={4.5} decay={1.6} />
          <mesh>
            <sphereGeometry args={[0.07, 12, 8]} />
            <meshBasicMaterial color="#ffc27a" toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* A dim warm fill from your side, so the faces across the table read. */}
      <directionalLight position={[0, 1.3, 2.6]} color="#ffc28a" intensity={0.8} />
      {/* Soft warm bounce from the table so faces aren't black. */}
      <pointLight position={[0, 0.35, 0]} color="#ff9a4a" intensity={0.5} distance={3.2} decay={1.5} />
      {/* The hanging lamp. */}
      <group ref={lamp} position={[0, 1.95, 0]}>
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 2.3, 6]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0.08, 0]}>
          <coneGeometry args={[0.26, 0.2, 32, 1, true]} />
          <meshStandardMaterial color="#2b1d12" metalness={0.6} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.0, 0]}>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshBasicMaterial ref={bulb} color="#ffe2b0" toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

export function RoomShell() {
  const floor = useMemo(() => {
    const t = woodTex('planks', [46, 29, 17], false).clone();
    t.repeat.set(6, 6);
    t.needsUpdate = true;
    return t;
  }, []);
  const wall = useMemo(() => {
    const t = woodTex('wall', [92, 48, 30], false).clone();
    t.rotation = Math.PI / 2;
    t.repeat.set(10, 2);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial map={floor} roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[5, 5, 4.2, 40, 1, true]} />
        <meshStandardMaterial map={wall} side={THREE.BackSide} roughness={0.9} color="#8a6a50" />
      </mesh>
      {/* Armchairs and a bookshelf around the walls. */}
      {[
        [-3.2, -2.2, 0.9],
        [3.3, -1.6, -0.9],
      ].map(([x, z, r], i) => (
        <group key={`a${i}`} position={[x, FLOOR_Y, z]} rotation={[0, r, 0]}>
          <mesh position={[0, 0.25, 0]}>
            <boxGeometry args={[0.9, 0.5, 0.8]} />
            <meshStandardMaterial color="#5a2418" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.7, -0.33]}>
            <boxGeometry args={[0.9, 0.6, 0.18]} />
            <meshStandardMaterial color="#5a2418" roughness={0.9} />
          </mesh>
          {[-0.4, 0.4].map((ax) => (
            <mesh key={ax} position={[ax, 0.45, 0]}>
              <boxGeometry args={[0.14, 0.4, 0.8]} />
              <meshStandardMaterial color="#4a1d12" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      <group position={[-1.7, FLOOR_Y, -4.4]} rotation={[0, 0.35, 0]}>
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[1.4, 2, 0.4]} />
          <meshStandardMaterial color="#3b2010" roughness={0.8} />
        </mesh>
        {[0.45, 0.95, 1.45].map((y, i) => (
          <mesh key={i} position={[0, y, 0.12]}>
            <boxGeometry args={[1.2, 0.32, 0.2]} />
            <meshStandardMaterial color={['#6b2f1e', '#2f4a3a', '#7a5a2a'][i]} roughness={0.85} />
          </mesh>
        ))}
      </group>
      {/* A few barrels and a shelf of bottles far back in the dark. */}
      {[
        [-2.6, -3.4],
        [2.9, -3.1],
        [-3.6, 1.2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, FLOOR_Y + 0.45, z]} castShadow={false}>
          <cylinderGeometry args={[0.38, 0.34, 0.9, 20]} />
          <meshStandardMaterial color="#4a2e18" roughness={0.8} />
        </mesh>
      ))}
      <group position={[0, 0.55, -4.85]}>
        <mesh>
          <boxGeometry args={[2.6, 0.06, 0.3]} />
          <meshStandardMaterial color="#3b2414" />
        </mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[-1.1 + i * 0.27, 0.18, 0]}>
            <cylinderGeometry args={[0.045, 0.05, 0.3, 10]} />
            <meshStandardMaterial color={['#2f5a35', '#5a2a1a', '#6b5a2a'][i % 3]} roughness={0.2} metalness={0.1} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function TableMesh() {
  const top = useMemo(() => woodTex('top', [104, 62, 32], true, 512), []);
  const side = useMemo(() => {
    const t = woodTex('side', [90, 56, 30], false).clone();
    t.repeat.set(8, 0.2);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <group>
      <mesh position={[0, -0.04, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R * 0.98, 0.08, 72]} />
        <meshStandardMaterial attach="material-0" map={side} roughness={0.6} />
        <meshStandardMaterial attach="material-1" map={top} roughness={0.55} />
        <meshStandardMaterial attach="material-2" color="#2a170c" />
      </mesh>
      {/* Worn darker rim and a brass inlay ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0006, 0]} receiveShadow>
        <ringGeometry args={[TABLE_R * 0.9, TABLE_R, 72]} />
        <meshStandardMaterial color="#3d2410" roughness={0.5} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0008, 0]}>
        <ringGeometry args={[TABLE_R * 0.885, TABLE_R * 0.895, 96]} />
        <meshStandardMaterial color="#c9953a" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, (FLOOR_Y - 0.08) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, -FLOOR_Y - 0.08, 20]} />
        <meshStandardMaterial color="#3d2410" roughness={0.7} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.03, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.5, 0.56, 0.06, 32]} />
        <meshStandardMaterial color="#2e1a0c" roughness={0.7} />
      </mesh>
    </group>
  );
}

/** A plain tavern chair behind a seated player. */
export function Chair({ at, yaw }: { at: Vec2; yaw: number }) {
  return (
    <group position={[at.x, FLOOR_Y, at.z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.42, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.05, 0.46]} />
        <meshStandardMaterial color="#4a2c16" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.82, -0.24]} castShadow>
        <boxGeometry args={[0.5, 0.75, 0.05]} />
        <meshStandardMaterial color="#3d2410" roughness={0.75} />
      </mesh>
    </group>
  );
}

/** Dust drifting in the lamp light. */
export function Dust({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 0.75;
      p[i * 3] = Math.cos(a) * d;
      p[i * 3 + 1] = 0.3 + r() * 1.4;
      p[i * 3 + 2] = Math.sin(a) * d;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.02;
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.2) * 0.05;
    }
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#ffd9a0" size={0.006} sizeAttenuation transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

const ZOOM_MIN = 0.62;
const ZOOM_MAX = 1.3;

// How far a drag can swing the camera around the table, in radians.
const YAW_MAX = 0.75;
const PITCH_MIN = -0.3;
const PITCH_MAX = 0.4;
/** Pointer travel (px) before a press counts as a drag rather than a click. */
export const DRAG_PX = 8;

/**
 * Your eyes: seated at your place, turning a little toward `focus` (a point on
 * the table), breathing gently. Wheel / trackpad or a two-finger pinch moves
 * you closer to or further from the table, within a small range; click and drag
 * (one finger on a phone) swings you around it a little. Double-click recentres.
 */
export function CameraRig({
  focus,
  phone,
  reduced,
  zoom: zoom0 = 1,
  overhead = false,
}: {
  focus: Vec2 | null;
  phone: boolean;
  reduced: boolean;
  /** Starting distance (1 = the game's seat). */
  zoom?: number;
  /** Glide up to a top-down view of the middle of the table (while the eater reveals puri). */
  overhead?: boolean;
}) {
  const { camera, size, gl } = useThree();
  const look = useRef(new THREE.Vector3());
  const want = useMemo(() => new THREE.Vector3(), []);
  const seatPos = useMemo(() => new THREE.Vector3(), []);
  const upPos = useMemo(() => new THREE.Vector3(), []);
  const upLook = useMemo(() => new THREE.Vector3(), []);
  const ov = useBlend(overhead, reduced);
  const zoom = useRef({ now: zoom0, to: zoom0 });
  const orbit = useRef({ yaw: 0, pitch: 0, toYaw: 0, toPitch: 0 });
  const sph = useMemo(() => new THREE.Spherical(), []);
  const off = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const el = gl.domElement;
    const set = (z: number) => {
      zoom.current.to = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      set(zoom.current.to * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; z: number } | null = null;
    let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
    const o = orbit.current;
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const endDrag = () => {
      drag = null;
      el.style.cursor = '';
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          pinch = { d: dist(), z: zoom.current.to };
          endDrag();
          return;
        }
      } else if (e.button !== 0) return;
      if (!drag) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: o.toYaw, pitch: o.toPitch, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size === 2) set(pinch.z * (pinch.d / Math.max(1, dist())));
      }
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        drag.moved = true;
        el.style.cursor = 'grabbing';
        // Keep the drag when the pointer leaves the canvas (over a panel, or off the window).
        if (el.hasPointerCapture && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture?.(e.pointerId);
      }
      // The table follows the pointer: a drag across the whole view is about 90°.
      const k = 1.6 / Math.max(320, el.clientWidth);
      o.toYaw = Math.min(YAW_MAX, Math.max(-YAW_MAX, drag.yaw - dx * k));
      o.toPitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, drag.pitch + dy * k));
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (drag && e.pointerId === drag.id) endDrag();
    };
    const recentre = () => {
      o.toYaw = 0;
      o.toPitch = 0;
    };
    el.style.touchAction = 'none';
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', recentre);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('dblclick', recentre);
      el.style.cursor = '';
    };
  }, [gl]);
  useFrame(({ clock }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const c = cameraFor(size.width / Math.max(1, size.height), phone);
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    const t = clock.elapsedTime;
    const sway = reduced ? 0 : 1;
    // Ease between your seat and the top-down view (smoothstep, about a second each way).
    const o = ov.current * ov.current * (3 - 2 * ov.current);
    seatPos.set(Math.sin(t * 0.31) * 0.012 * sway, c.y + Math.sin(t * 0.47) * 0.008 * sway, c.z);
    // Straight above the plate, tipped just enough that the far side still reads.
    // A phone is narrow: go only as high as it takes for the table to fill its width.
    const upY = phone ? (TABLE_R * 1.15) / (Math.tan((cam.fov * Math.PI) / 360) * cam.aspect) : 2.3;
    upPos.set(0, upY, upY * (phone ? 0.15 : 0.22));
    upLook.set(0, 0, phone ? 0.02 : 0.06);
    cam.position.lerpVectors(seatPos, upPos, o);
    want.set((focus?.x ?? 0) * 0.32, c.lookY, c.lookZ + (focus ? (focus.z - c.lookZ) * 0.22 : 0));
    want.lerp(upLook, o);
    const k = reduced ? 1 : Math.min(1, dt * 2.2);
    look.current.lerp(want, k);
    // Zoom = slide along the line from where you look to where you sit.
    const z = zoom.current;
    z.now += (z.to - z.now) * (reduced ? 1 : Math.min(1, dt * 8));
    off.copy(cam.position).sub(look.current).multiplyScalar(z.now);
    // Swing around where you look, as far as you've dragged.
    const ob = orbit.current;
    const ko = reduced ? 1 : Math.min(1, dt * 10);
    ob.yaw += (ob.toYaw - ob.yaw) * ko;
    ob.pitch += (ob.toPitch - ob.pitch) * ko;
    sph.setFromVector3(off);
    sph.theta += ob.yaw;
    sph.phi = Math.min(1.45, Math.max(0.02, sph.phi - ob.pitch));
    off.setFromSpherical(sph);
    cam.position.copy(look.current).add(off);
    cam.lookAt(look.current);
  });
  return null;
}
