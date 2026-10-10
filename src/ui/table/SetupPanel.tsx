/**
 * Setup (in the dock): fill the stack slots (bottom → top) from your hand and
 * pick one power. Re-submittable until everyone is done.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColorId, PlayerView, PowerKind, PuriKind } from '../../engine/types.ts';
import { POWER_KINDS } from '../../engine/types.ts';
import { CARD_INFO, Card } from '../../cards/index.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { powerName } from '../text.ts';
import { Hand, handCards } from './Hand.tsx';

export function usedInRound(view: PlayerView, kind: PowerKind): number | null {
  const picks = view.me?.powerPicks ?? [];
  for (let i = picks.length - 1; i >= 0; i--) if (picks[i] === kind) return i + 1;
  return null;
}

function slotName(i: number, n: number): string {
  if (n === 1) return 'Your card';
  if (i === 0) return 'Bottom';
  if (i === n - 1) return 'Top';
  return `Card ${i + 1}`;
}

export function SetupPanel({
  view,
  color,
  busy,
  pending,
  phone,
  botSeat = false,
  onSubmit,
}: {
  view: PlayerView;
  color: ColorId;
  busy: boolean;
  pending: boolean;
  phone: boolean;
  /** A bot is playing this seat: show, don't edit. */
  botSeat?: boolean;
  onSubmit: (stack: PuriKind[], power: PowerKind) => Promise<boolean>;
}) {
  const legal = view.legal.setup;
  const size = legal?.stackSize ?? view.config.startingStack;
  const full = legal?.hand ?? { panipuri: view.config.panipuriPerPlayer, akabare: 1 };
  const available = legal?.availablePowers ?? view.me?.availablePowers ?? [];
  const submitted = view.me?.setup ?? null;
  const [slots, setSlots] = useState<(PuriKind | null)[]>(() => submitted?.stack.slice(0, size) ?? Array(size).fill(null));
  const [power, setPower] = useState<PowerKind | null>(() => submitted?.power ?? (available.length === 1 ? available[0] : null));
  // The tapped card leaves the hand (or the slot button turns into an empty slot), which would drop keyboard focus on <body>: keep it nearby.
  const rootRef = useRef<HTMLElement>(null);
  const refocus = useRef<{ from: 'hand' | 'slot'; idx: number } | null>(null);
  useEffect(() => {
    const want = refocus.current;
    refocus.current = null;
    const root = rootRef.current;
    if (!want || !root || (document.activeElement && document.activeElement !== document.body && root.contains(document.activeElement))) return;
    const hand = [...root.querySelectorAll<HTMLElement>('.tp-hand-row__card button')];
    const target = want.from === 'hand' ? hand[Math.min(want.idx, hand.length - 1)] : hand[0];
    (target ?? root.querySelector<HTMLElement>('.tp-slot__btn, .tp-setup__powers button:not(:disabled)'))?.focus();
  }, [slots]);
  const [editing, setEditing] = useState(!submitted);

  // A fresh round (nothing submitted) opens the editor; a setup that lands from elsewhere
  // (a bot playing your seat, another tab) closes it.
  const hadSetup = useRef(!!submitted);
  useEffect(() => {
    if (!submitted) setEditing(true);
    else if (!hadSetup.current) setEditing(false);
    hadSetup.current = !!submitted;
  }, [submitted, view.round]);
  useEffect(() => {
    if (power && !available.includes(power)) setPower(null);
  }, [available, power]);

  const remaining = useMemo(() => {
    const used = { panipuri: 0, akabare: 0 };
    for (const s of slots) if (s) used[s]++;
    return { panipuri: full.panipuri - used.panipuri, akabare: full.akabare - used.akabare };
  }, [slots, full.panipuri, full.akabare]);

  const cardW = phone ? 44 : 42;
  const complete = slots.every((s) => s !== null) && power !== null;
  const canEdit = !!legal && !botSeat;

  if (submitted && (!editing || botSeat)) {
    return (
      <section className="tp-setup tp-setup--done" aria-label="Locked in">
        <div
          className="tp-setup__mini"
          aria-label={`Your stack, bottom to top: ${submitted.stack.join(', ')}; power: ${powerName(submitted.power)}`}
        >
          {submitted.stack.map((k, i) => (
            <Card key={i} back="puri" color={color} face={k} width={phone ? 40 : 52} decorative />
          ))}
          <Card back="power" color={color} face={submitted.power} width={phone ? 40 : 52} decorative />
        </div>
        {canEdit ? (
          <IconButton label="Change setup" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} />
          </IconButton>
        ) : null}
      </section>
    );
  }

  const fill = (kind: PuriKind) => {
    const i = slots.findIndex((s) => s === null);
    if (i < 0) return;
    const hand = [...(rootRef.current?.querySelectorAll<HTMLElement>('.tp-hand-row__card button') ?? [])];
    const at = hand.indexOf(document.activeElement as HTMLElement);
    if (at >= 0) refocus.current = { from: 'hand', idx: at };
    setSlots(slots.map((s, j) => (j === i ? kind : s)));
  };
  const clear = (i: number) => {
    refocus.current = { from: 'slot', idx: i };
    setSlots(slots.map((s, j) => (j === i ? null : s)));
  };
  const empty = slots.filter((x) => x === null).length;
  const todo = [empty > 0 ? `fill ${empty} more slot${empty === 1 ? '' : 's'}` : '', !power ? 'pick a power' : ''].filter(Boolean).join(' and ');

  return (
    <section
      className="tp-setup"
      aria-label="Set up your stack"
      ref={rootRef}
      style={{ ['--cw' as string]: cardW, ['--slots' as string]: size, ['--hand-n' as string]: full.panipuri + full.akabare }}
    >
      <div className="tp-setup__sections">
        <div className="tp-setup__col tp-setup__col--hand">
          <Hand
            cards={handCards(remaining)}
            color={color}
            width={cardW}
            selected={null}
            pickable={slots.some((s) => s === null) ? (['panipuri', 'akabare'] as const) : null}
            onPick={(_, c) => fill(c.kind)}
            label="Your puri set"
            emptyText=""
            className="tp-setup__hand"
          />
        </div>
        <div className="tp-setup__col tp-setup__col--slots">
          <ol className="tp-setup__slots" aria-label="Your stack slots, bottom to top">
            {slots.map((s, i) => (
              <li key={i} className="tp-slot">
                {s ? (
                  <button type="button" className="tp-slot__btn" onClick={() => clear(i)} aria-label={`${slotName(i, size)}: ${s}. Tap to take it back.`}>
                    <Card back="puri" color={color} face={s} width={cardW} decorative />
                  </button>
                ) : (
                  <span className="tp-slot__empty" style={{ width: cardW, height: Math.round(cardW * (88 / 63)) }} aria-label={`${slotName(i, size)}: empty`}>
                    <span aria-hidden="true">{i + 1}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="tp-setup__col">
          <ul className="tp-setup__powers" role="radiogroup" aria-label="Power card">
            {POWER_KINDS.map((k) => {
              const ok = available.includes(k);
              const r = ok ? null : usedInRound(view, k);
              return (
                <li key={k} className={cx('tp-pick', !ok && 'is-off', power === k && 'is-on')} title={ok ? powerName(k) : `${powerName(k)} used`}>
                  <Card
                    back="power"
                    color={color}
                    face={k}
                    width={cardW}
                    state={power === k ? 'selected' : ok ? 'selectable' : 'dim'}
                    onClick={ok ? () => setPower(k) : undefined}
                    ariaLabel={ok ? `${powerName(k)}: ${CARD_INFO[k].short}${power === k ? ' (chosen)' : ''}` : `${powerName(k)}: used${r ? ` in round ${r}` : ''}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        <div className="tp-setup__col tp-setup__col--cta">
          <span className="tp-sr" aria-live="polite">
            {todo ? `${todo[0].toUpperCase()}${todo.slice(1)}.` : 'Ready.'}
          </span>
          <Button
            variant="primary"
            size="md"
            busy={pending}
            disabled={!complete || busy || !canEdit}
            onClick={async () => {
              if (!complete) return;
              const ok = await onSubmit(slots as PuriKind[], power!);
              if (ok) setEditing(false);
            }}
          >
            Lock in
          </Button>
        </div>
      </div>
    </section>
  );
}
