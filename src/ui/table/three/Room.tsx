/**
 * The tavern: dark plank floor and walls, a heavy round wooden table, chairs,
 * one warm hanging lamp (the only shadow-casting light), dust in the lamp
 * light, and the camera rig (your seat, turning a little toward whoever acts).
 */
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TABLE_R, cameraFor, type Vec2 } from './layout3d.ts';
import { woodTex } from './textures.ts';

const FLOOR_Y = -0.78;

export function Lights({ flash, shadows, phone }: { flash: boolean; shadows: boolean; phone: boolean }) {
  const spot = useRef<THREE.SpotLight>(null);
  const bulb = useRef<THREE.MeshBasicMaterial>(null);
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
  });
  return (
    <>
      <hemisphereLight args={['#5a3a20', '#0a0503', 0.35]} />
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
      {/* A dim warm fill from your side, so the faces across the table read. */}
      <directionalLight position={[0, 1.3, 2.6]} color="#ffb877" intensity={0.55} />
      {/* Soft warm bounce from the table so faces aren't black. */}
      <pointLight position={[0, 0.35, 0]} color="#ff9a4a" intensity={0.5} distance={3.2} decay={1.5} />
      {/* The hanging lamp. */}
      <group position={[0, 1.95, 0]}>
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
    const t = woodTex('wall', [52, 32, 20], false).clone();
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

/** Your eyes: seated at your place, turning a little toward `focus` (a point on the table), breathing gently. */
export function CameraRig({ focus, phone, reduced }: { focus: Vec2 | null; phone: boolean; reduced: boolean }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3());
  const want = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const c = cameraFor(size.width / Math.max(1, size.height), phone);
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    const t = clock.elapsedTime;
    const sway = reduced ? 0 : 1;
    cam.position.set(Math.sin(t * 0.31) * 0.012 * sway, c.y + Math.sin(t * 0.47) * 0.008 * sway, c.z);
    want.set((focus?.x ?? 0) * 0.32, c.lookY, c.lookZ + (focus ? (focus.z - c.lookZ) * 0.22 : 0));
    const k = reduced ? 1 : Math.min(1, dt * 2.2);
    look.current.lerp(want, k);
    cam.lookAt(look.current);
  });
  return null;
}
