/**
 * One seated player: a CC0 Kenney character in the player's colour, sitting
 * (legs from the 'sit' clip), breathing (upper body from 'idle', each at its
 * own phase) and reacting to what that player just did (upper-body clips
 * only, so nobody stands up from the table).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { ColorId } from '../../../engine/types.ts';
import { LOWER, UPPER, onlyBones, tintedPalette, type CharacterModel } from './characters.ts';

export type ReactionKind = 'yes' | 'no' | 'reach' | 'pick' | 'slump' | 'cheer' | 'flinch';
export interface Reaction {
  kind: ReactionKind;
  seq: number;
}

const CLIP: Record<ReactionKind, { name: string; reps: number; speed: number; hold?: number }> = {
  yes: { name: 'emote-yes', reps: 2, speed: 1 },
  no: { name: 'emote-no', reps: 2, speed: 1 },
  reach: { name: 'interact-right', reps: 1, speed: 0.7 },
  pick: { name: 'pick-up', reps: 1, speed: 0.55, hold: 0.35 },
  slump: { name: 'die', reps: 1, speed: 0.5, hold: 1.6 },
  cheer: { name: 'emote-yes', reps: 3, speed: 1.4 },
  flinch: { name: 'emote-no', reps: 1, speed: 1.8 },
};

/** Model scale and how far below the table top the model's origin sits when seated. */
export const CHAR_SCALE = 0.95;
export const CHAR_Y = -0.04;

export function Character({
  model,
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
  model: CharacterModel;
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
  /** Reports the head's world position every frame (for the nameplate). */
  onHead?: (v: THREE.Vector3) => void;
}) {
  const gltf = useLoader(GLTFLoader, model.url);
  const { root, head } = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    let source: THREE.Texture | null = null;
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = shadows;
      m.receiveShadow = false;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      source ??= mat.map;
      if (source?.image) mat.map = tintedPalette(source, model, color);
      mat.roughness = 0.85;
      mat.metalness = 0;
      m.material = mat;
    });
    return { root, head: root.getObjectByName('head') ?? root };
  }, [gltf, model, color, shadows]);

  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const clips = gltf.animations;
  useEffect(() => {
    const find = (n: string) => clips.find((c) => c.name === n);
    const sit = find('sit');
    const idle = find('idle');
    if (sit) {
      const a = mixer.clipAction(onlyBones(sit, LOWER, 'sit-lower'));
      a.play();
    }
    if (idle) {
      const a = mixer.clipAction(onlyBones(idle, UPPER, 'idle-upper'));
      a.timeScale = reduced ? 0 : 0.55 + ((seed * 37) % 10) / 40;
      a.time = (seed * 0.37) % idle.duration;
      a.play();
    }
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    };
  }, [mixer, clips, root, seed, reduced]);

  const uppers = useMemo(() => new Map<string, THREE.AnimationClip>(), [clips]);
  const last = useRef<number | null>(null);
  const active = useRef<{ action: THREE.AnimationAction; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    if (!reaction || reaction.seq === last.current) return;
    last.current = reaction.seq;
    const spec = CLIP[reaction.kind];
    const clip = clips.find((c) => c.name === spec.name);
    if (!clip) return;
    if (active.current) {
      clearTimeout(active.current.timer);
      active.current.action.fadeOut(0.15);
    }
    let upper = uppers.get(spec.name);
    if (!upper) uppers.set(spec.name, (upper = onlyBones(clip, UPPER, `${spec.name}-upper`)));
    const action = mixer.clipAction(upper);
    action.reset();
    action.setLoop(THREE.LoopRepeat, spec.reps);
    action.clampWhenFinished = true;
    action.timeScale = reduced ? spec.speed * 2 : spec.speed;
    action.setEffectiveWeight(1);
    action.fadeIn(0.15).play();
    const total = (clip.duration * spec.reps) / action.timeScale + (spec.hold ?? 0.1);
    active.current = { action, timer: setTimeout(() => action.fadeOut(0.35), total * 1000) };
  }, [reaction, clips, mixer, reduced, uppers]);
  useEffect(() => () => clearTimeout(active.current?.timer), []);

  const body = useRef<THREE.Group>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  const leanNow = useRef(0);
  useFrame((_, dt) => {
    mixer.update(Math.min(dt, 0.1));
    leanNow.current += (lean - leanNow.current) * Math.min(1, dt * 3);
    if (body.current) body.current.rotation.x = leanNow.current * 0.14;
    if (onHead) {
      head.getWorldPosition(v);
      onHead(v);
    }
  });

  return (
    <group position={[x, CHAR_Y, z]} rotation={[0, yaw, 0]}>
      <group ref={body}>
        <primitive object={root} scale={CHAR_SCALE} />
      </group>
    </group>
  );
}
