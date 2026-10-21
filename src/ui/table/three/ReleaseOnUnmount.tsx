/**
 * Our geometries, materials and textures are cached and shared between scenes
 * (the tavern, the table). three.js hangs a 'dispose' listener on each one for
 * the renderer that drew it, so a closed scene's renderer stays reachable
 * through the cache and leaks on every Home -> game -> Home trip. This keeps a
 * running list of everything the scene draws and disposes it all when the
 * Canvas goes away: the old renderer lets go, and the next scene simply
 * uploads them again.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function ReleaseOnUnmount() {
  const scene = useThree((s) => s.scene);
  const seen = useRef(new Set<Disposable>()).current;
  const frame = useRef(0);
  useFrame(() => {
    // Cheap enough once a second; the scene changes slowly.
    if (frame.current++ % 60 !== 0) return;
    collect(scene, seen);
  });
  useEffect(() => {
    collect(scene, seen);
    return () => {
      collect(scene, seen);
      for (const r of seen) r.dispose();
      seen.clear();
    };
  }, [scene, seen]);
  return null;
}

type Disposable = { dispose: () => void };

function collect(scene: THREE.Scene, into: Set<Disposable>) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) into.add(m.geometry);
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      into.add(mat);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) into.add(v);
    }
  });
}
