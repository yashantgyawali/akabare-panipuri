/**
 * The real-3D table (WebGL, lazy-loaded): first person at your seat, the
 * other players as seated characters, cards lying on a round wooden table
 * under a hanging lamp. Everything renders from the same displayed view and
 * the same Clickables as the CSS scene; a visually hidden DOM layer keeps the
 * stacks/powers keyboard- and screen-reader-operable (same data hooks and
 * aria-labels), and nameplates are DOM pinned above the characters' heads.
 */
import { Component, Suspense, type FocusEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import type { GameEvent, PlateCardView, PlayerId, PuriKind } from '../../../engine/types.ts';
import { PLAYER_PALETTE } from '../../../cards/index.ts';
import { cx } from '../../common/hooks.ts';
import { powerName } from '../../text.ts';
import type { HandCard } from '../Hand.tsx';
import type { SeatBase } from '../scene/SeatsLayer.tsx';
import { Nameplate } from '../scene/Nameplate.tsx';
import { stackItems } from '../scene/seatData.ts';
import type { PlatePower } from '../scene/Plate3D.tsx';
import { CARD_T, seatSpot, type Seat3DSpot } from './layout3d.ts';
import { backTex, frontTex, peekTex } from './textures.ts';
import { CHARACTERS } from './characters.ts';
import { Character, type Reaction } from './Character.tsx';
import { BidToken, FlyingCard, Hand3D, Pile, Plate, PlateCards, type PlateCard } from './Pieces.tsx';
import { CameraRig, Chair, Dust, Lights, RoomShell, TableMesh } from './Room.tsx';
import type { Glow } from './Card3D.tsx';

export interface Table3DProps {
  seats: SeatBase[];
  current: GameEvent | null;
  flash: boolean;
  reduced: boolean;
  phone: boolean;
  bid: { amount: number; rim: string } | null;
  plate: { cards: PlateCardView[]; powers: PlatePower[] } | null;
  hand: { cards: HandCard[]; selected: number | null; pickable: readonly PuriKind[] | null; onPick: (i: number) => void; orders?: (number | null)[] } | null;
  overlay?: ReactNode;
  onFail: (why: unknown) => void;
}

const PLACE_MS = 700;

// Start fetching the characters as soon as the 3D table's code loads.
for (const c of CHARACTERS) useLoader.preload(GLTFLoader, c.url);

function actorOf(e: GameEvent | null): PlayerId | null {
  if (!e) return null;
  switch (e.type) {
    case 'place':
    case 'bidStart':
    case 'raise':
    case 'pass':
    case 'eater':
    case 'setupDone':
    case 'ready':
      return e.playerId;
    case 'flipPuri':
    case 'flipPower':
    case 'bite':
    case 'success':
    case 'bust':
      return e.eaterId;
    default:
      return null;
  }
}

function reactionFor(id: PlayerId, e: GameEvent | null): Reaction | null {
  if (!e) return null;
  const seq = e.seq;
  switch (e.type) {
    case 'place':
      return e.playerId === id ? { kind: 'reach', seq } : null;
    case 'bidStart':
    case 'raise':
      return e.playerId === id ? { kind: 'yes', seq } : null;
    case 'pass':
      return e.playerId === id ? { kind: 'no', seq } : null;
    case 'eater':
      return e.playerId === id ? { kind: 'cheer', seq } : null;
    case 'flipPuri':
    case 'flipPower':
      return e.eaterId === id ? { kind: 'pick', seq } : null;
    case 'bite':
      return e.eaterId === id ? { kind: 'flinch', seq } : e.owner === id ? { kind: 'yes', seq } : null;
    case 'success':
      return e.eaterId === id ? { kind: 'cheer', seq } : null;
    case 'bust':
      return e.eaterId === id ? { kind: 'slump', seq } : e.trapRewardTo === id ? { kind: 'cheer', seq } : null;
    default:
      return null;
  }
}

class Boundary extends Component<{ onFail: (why: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onFail(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const glowOf = (state: string): Glow => (state === 'selectable' ? 'selectable' : state === 'selected' ? 'focus' : state === 'danger' ? 'danger' : null);

export default function Table3D({ seats, current, flash, reduced, phone, bid, plate, hand, overlay, onFail }: Table3DProps) {
  const n = seats.length;
  const spots = useMemo(() => seats.map((_, i) => seatSpot(i, n)), [n, seats]);
  const spotOf = useCallback((id: PlayerId): Seat3DSpot | null => {
    const i = seats.findIndex((s) => s.p.id === id);
    return i < 0 ? null : spots[i];
  }, [seats, spots]);
  const youId = seats[0]?.view.youId ?? null;
  // Characters stay the same per player for the whole game: by seat number.
  const modelOf = (seat: number) => CHARACTERS[seat % CHARACTERS.length];

  // Keyboard focus on the hidden controls lights up the matching thing on the table.
  const [focused, setFocused] = useState<string | null>(null);

  // A card in flight for a 'place' move.
  const flight = useMemo(() => {
    if (!current || current.type !== 'place' || reduced) return null;
    const to = spotOf(current.onStackOf);
    const by = spotOf(current.playerId);
    if (!to || !by) return null;
    const target = seats.find((s) => s.p.id === current.onStackOf)!;
    const actor = seats.find((s) => s.p.id === current.playerId)!;
    const fromV = current.playerId === youId ? new THREE.Vector3(0, 0.45, 1.25) : new THREE.Vector3(by.seat.x * 0.82, 0.35, by.seat.z * 0.82);
    const h = target.p.stack.length;
    return {
      seq: current.seq,
      to: current.onStackOf,
      start: performance.now(),
      from: fromV,
      dest: new THREE.Vector3(to.pile.x, CARD_T * h + 0.003, to.pile.z),
      yaw: to.yaw,
      tex: backTex('puri', actor.p.color),
    };
  }, [current, reduced, spotOf, seats, youId]);

  // Eaten cards: the newest one flies in from the stack it was eaten from.
  const plateCards: PlateCard[] = useMemo(() => {
    if (!plate) return [];
    const from = current?.type === 'flipPuri' ? spotOf(current.fromStackOf) : current?.type === 'flipPower' ? spotOf(current.fromStackOf) : null;
    const src = from ? new THREE.Vector3((current?.type === 'flipPower' ? from.power : from.pile).x, 0.05, (current?.type === 'flipPower' ? from.power : from.pile).z) : null;
    const owners = seats.map((s) => s.p);
    const colorOf = (id: PlayerId) => owners.find((p) => p.id === id)?.color ?? 'red';
    const eaten = plate.cards.map((c, i) => ({
      key: `c${i}`,
      front: frontTex(c.kind, colorOf(c.owner)),
      back: backTex('puri', colorOf(c.owner)),
      dim: c.cancelled,
      from: current?.type === 'flipPuri' && i === plate.cards.length - 1 ? src : null,
    }));
    const pw = plate.powers.map((p, j) => ({
      key: `p${j}`,
      front: frontTex(p.kind, colorOf(p.owner)),
      back: backTex('power', colorOf(p.owner)),
      dim: p.effect === 'wasted' || p.effect === 'failedSave',
      from: current?.type === 'flipPower' && j === plate.powers.length - 1 ? src : null,
    }));
    return [...eaten, ...pw];
  }, [plate, current, spotOf, seats]);

  const acting = actorOf(current);
  const focusSpot = acting && acting !== youId ? spotOf(acting) : null;

  // Nameplates follow the heads (written straight to the DOM every frame).
  const plates = useRef(new Map<PlayerId, HTMLDivElement>());
  const size = useRef({ w: 1, h: 1 });
  const camRef = useRef<THREE.Camera | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const headAt = useCallback((id: PlayerId, v: THREE.Vector3) => {
    const el = plates.current.get(id);
    const cam = camRef.current;
    if (!el || !cam) return;
    tmp.copy(v);
    tmp.y += 0.4;
    tmp.project(cam);
    const half = el.offsetWidth / 2 + 8;
    const x = Math.min(size.current.w - half, Math.max(half, ((tmp.x + 1) / 2) * size.current.w));
    const y = Math.max(el.offsetHeight + 8, ((1 - tmp.y) / 2) * size.current.h);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = tmp.z < 1 ? '1' : '0';
  }, [tmp]);

  const handCards = useMemo(
    () =>
      hand
        ? hand.cards.map((c, i) => ({
            tex: frontTex(c.kind, seats[0]?.p.color ?? 'red'),
            pickable: !!hand.pickable?.includes(c.kind) || hand.orders?.[i] != null,
            selected: hand.selected === i,
            order: hand.orders?.[i] ?? null,
            focus: focused === `hand:${i}`,
          }))
        : [],
    [hand, seats, focused],
  );

  const shadows = !phone;
  // How far the floating controls reach up over the bottom of the view where your hand is held.
  const roomRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const canvas = roomRef.current?.querySelector('canvas');
      const panel = document.querySelector('.tp-tablescreen.is-3d .tp-dock__prompt, .tp-tablescreen.is-3d .tp-setup');
      let px = 0;
      if (canvas && panel) {
        const c = canvas.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const handL = c.left + c.width * 0.2;
        const handR = c.left + c.width * 0.6;
        if (p.width > 0 && p.top > c.top + c.height * 0.5 && p.left < handR && p.right > handL) px = Math.max(0, Math.round(c.bottom - p.top + 10));
      }
      setInset((v) => (Math.abs(v - px) > 2 ? px : v));
    };
    measure();
    const t = setInterval(measure, 400);
    return () => clearInterval(t);
  }, []);
  // The renderer drops its context on unmount too: only a loss while we're on screen means trouble.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const me = seats[0];
  return (
    <div ref={roomRef} className={cx('tp-room', 'tp-room--3d', flash && 'is-flash')}>
      <Boundary onFail={onFail}>
        <Canvas
          className="tp-gl"
          shadows={shadows}
          dpr={phone ? [1, 1.5] : [1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 55, near: 0.05, far: 30, position: [0, 0.8, 1.85] }}
          onCreated={({ gl, camera, size: s }) => {
            camRef.current = camera;
            size.current = { w: s.width, h: s.height };
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.15;
            gl.domElement.addEventListener('webglcontextlost', () => alive.current && onFail('WebGL context lost'), { once: true });
          }}
          onPointerMissed={() => {
            document.body.style.cursor = '';
          }}
          resize={{ debounce: 0 }}
        >
          <SizeSync size={size} camRef={camRef} />
          <color attach="background" args={['#1a0d06']} />
          <fog attach="fog" args={['#1a0d06', 4.5, 11]} />
          <Lights flash={flash} shadows={shadows} phone={phone} />
          <RoomShell />
          <TableMesh />
          <Plate />
          {!reduced ? <Dust count={phone ? 60 : 140} /> : null}
          <CameraRig focus={focusSpot ? focusSpot.pile : null} phone={phone} reduced={reduced} />
          {seats.map((s, i) => {
            const spot = spots[i];
            const you = s.p.id === youId;
            const items = stackItems(s.p, s.view, s.names);
            const cards = items.map((it) => ({
              tex: it.faceUp && it.face ? frontTex(it.face, it.color) : it.peek ? peekTex('puri', it.color, it.peek) : backTex('puri', it.color),
            }));
            const pw = s.p.power;
            const pwUp = !!pw && (pw.revealed || s.view.revealed) && pw.kind !== null;
            const power = pw
              ? {
                  tex: pwUp ? frontTex(pw.kind!, s.p.color) : you && pw.kind ? peekTex('power', s.p.color, pw.kind) : backTex('power', s.p.color),
                  up: pwUp,
                  glow: focused === `power:${s.p.id}` ? ('focus' as Glow) : glowOf(s.power.state),
                  onClick: s.power.onClick,
                }
              : null;
            const landAt = flight && flight.to === s.p.id ? flight.start + PLACE_MS : 0;
            return (
              <group key={s.p.id}>
                <Pile
                  spot={spot}
                  cards={cards}
                  stackGlow={focused === `stack:${s.p.id}` ? 'focus' : glowOf(s.stack.state)}
                  dimStack={s.stack.state === 'dim'}
                  onStack={s.stack.onClick}
                  power={power}
                  landAt={landAt}
                  cue={s.cue}
                  phone={phone}
                />
                {!you ? (
                  <>
                    <Chair at={{ x: spot.seat.x * 1.08, z: spot.seat.z * 1.08 }} yaw={spot.yaw + Math.PI} />
                    <Suspense fallback={null}>
                      <Character
                        model={modelOf(s.p.seat)}
                        color={s.p.color}
                        x={spot.seat.x}
                        z={spot.seat.z}
                        yaw={spot.yaw + Math.PI}
                        reaction={reactionFor(s.p.id, current)}
                        lean={s.turn ? 1 : 0}
                        seed={s.p.seat + 1}
                        reduced={reduced}
                        shadows={shadows}
                        onHead={(v) => headAt(s.p.id, v)}
                      />
                    </Suspense>
                  </>
                ) : null}
              </group>
            );
          })}
          {bid ? <BidToken amount={bid.amount} rim={bid.rim} /> : null}
          {plate ? <PlateCards cards={plateCards} reduced={reduced} /> : null}
          {flight ? <FlyingCard key={flight.seq} from={flight.from} to={flight.dest} yaw={flight.yaw} tex={flight.tex} start={flight.start} ms={PLACE_MS} /> : null}
          {hand && handCards.length > 0 ? <Hand3D cards={handCards} onPick={hand.onPick} phone={phone} insetPx={inset} /> : null}
        </Canvas>
      </Boundary>
      <div className="tp-room__vignette" aria-hidden="true" />
      <div className="tp-np3d-layer">
        {seats.map((s) =>
          s.p.id === youId ? null : (
            <div
              key={s.p.id}
              className="tp-np3d"
              data-seat={s.p.id}
              ref={(el) => {
                if (el) plates.current.set(s.p.id, el);
                else plates.current.delete(s.p.id);
              }}
              style={{ ['--c' as string]: PLAYER_PALETTE[s.p.color].base, ['--c-ink' as string]: PLAYER_PALETTE[s.p.color].onBase } as CSSProperties}
            >
              <SeatPlate s={s} />
            </div>
          ),
        )}
        {me ? (
          <div className="tp-np3d tp-np3d--you" data-seat={me.p.id} style={{ ['--c' as string]: PLAYER_PALETTE[me.p.color].base, ['--c-ink' as string]: PLAYER_PALETTE[me.p.color].onBase } as CSSProperties}>
            <SeatPlate s={me} />
          </div>
        ) : null}
      </div>
      <A11yLayer seats={seats} hand={hand} onFocusTarget={setFocused} />
      {overlay ? <div className="tp-room__overlay">{overlay}</div> : null}
    </div>
  );
}

function SeatPlate({ s }: { s: SeatBase }) {
  const pulse = s.cue?.part === 'seat' ? cx(s.cue.seq % 2 ? 'tp-cue-a' : 'tp-cue-b', s.cue.tone && `tp-cue--${s.cue.tone}`) : undefined;
  return (
    <Nameplate
      name={s.p.name}
      initial={s.names.initial(s.p.id)}
      score={s.p.score}
      you={s.p.id === s.view.youId}
      isHost={s.isHost}
      isBot={s.p.isBot}
      online={s.online}
      turn={s.turn}
      status={s.status}
      pulse={pulse}
    />
  );
}

/** Keeps the nameplate projection in sync with the canvas size. */
function SizeSync({ size, camRef }: { size: RefObject<{ w: number; h: number }>; camRef: RefObject<THREE.Camera | null> }) {
  const { size: s, camera } = useThree();
  useEffect(() => {
    size.current = { w: s.width, h: s.height };
    camRef.current = camera;
  }, [s.width, s.height, camera, size, camRef]);
  return null;
}

/**
 * The same controls as the CSS table, for keyboard and screen readers: one
 * button per stack/power you may act on (same `[data-stack-of] > button`
 * hooks and labels Table.tsx restores focus with). Visually hidden; focusing
 * one lights up the matching thing on the table.
 */
function A11yLayer({ seats, hand, onFocusTarget }: { seats: SeatBase[]; hand: Table3DProps['hand']; onFocusTarget: (k: string | null) => void }) {
  // Only a keyboard focus lights things up on the table (not a programmatic focus after a click).
  const onFocus = (k: string) => (e: FocusEvent<HTMLElement>) => onFocusTarget(e.currentTarget.matches(':focus-visible') ? k : null);
  const onBlur = () => onFocusTarget(null);
  return (
    <div className="tp-seats tp-a11y3d">
      {hand && hand.cards.length > 0 ? (
        <div className="tp-a11y3d__hand" role="group" aria-label="Your hand">
          {hand.cards.map((c, i) =>
            hand.pickable?.includes(c.kind) || hand.orders?.[i] != null ? (
              <button
                key={i}
                type="button"
                aria-pressed={hand.selected === i || hand.orders?.[i] != null}
                aria-label={`${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} in your hand${hand.orders?.[i] != null ? `, picked ${hand.orders[i]}` : ''}`}
                onClick={() => hand.onPick(i)}
                onFocus={onFocus(`hand:${i}`)}
                onBlur={onBlur}
              />
            ) : (
              <span key={i} role="img" aria-label={`${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} in your hand`} />
            ),
          )}
        </div>
      ) : null}
      {seats.map((s) => {
        const you = s.p.id === s.view.youId;
        const pw = s.p.power;
        const pwUp = !!pw && (pw.revealed || s.view.revealed) && pw.kind !== null;
        const pwLabel = !pw
          ? ''
          : s.power.onClick
            ? s.power.label
            : pwUp
              ? `${s.names.Whose(s.p.id)} power, face up: ${powerName(pw.kind!)}`
              : you && pw.kind
                ? `Your power, face down: ${powerName(pw.kind)}`
                : `${s.names.Whose(s.p.id)} power, face down`;
        return (
          <section key={s.p.id} aria-label={`${you ? 'You' : s.p.name}${s.turn ? ', to act' : ''}`} data-seat-a11y={s.p.id}>
            <div data-stack-of={s.p.id}>
              {s.stack.onClick ? (
                <button
                  type="button"
                  className={cx('ak-card-stack--button', s.stack.state === 'selectable' && 'ak-card-stack--selectable', s.stack.state === 'dim' && 'ak-card-stack--dim')}
                  aria-label={s.stack.label}
                  onClick={s.stack.onClick}
                  onFocus={onFocus(`stack:${s.p.id}`)}
                  onBlur={onBlur}
                />
              ) : (
                <span role="img" aria-label={s.stack.label} />
              )}
            </div>
            {pw ? (
              <div data-power-of={s.p.id}>
                {s.power.onClick ? (
                  <button
                    type="button"
                    className={cx(s.power.state === 'selectable' && 'ak-card--selectable')}
                    aria-label={pwLabel}
                    onClick={s.power.onClick}
                    onFocus={onFocus(`power:${s.p.id}`)}
                    onBlur={onBlur}
                  />
                ) : (
                  <span role="img" aria-label={pwLabel} />
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
