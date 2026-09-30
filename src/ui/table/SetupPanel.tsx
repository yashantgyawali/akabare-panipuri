/**
 * Setup: fill the stack slots (bottom → top) from your hand and pick one power.
 * Re-submittable until everyone is done ("Change setup").
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColorId, PlayerView, PowerKind, PuriKind } from '../../engine/types.ts';
import { POWER_KINDS } from '../../engine/types.ts';
import { CARD_INFO, Card } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { powerName, type NameBook } from '../text.ts';
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

export function WaitingList({ view, names }: { view: PlayerView; names: NameBook }) {
  const players = [...view.players].sort((a, b) => a.seat - b.seat);
  return (
    <ul className="ak-waitlist" aria-label="Who has set up">
      {players.map((p) => (
        <li key={p.id} className={cx('ak-waitlist__item', p.setupDone && 'is-done')} style={{ ['--c' as string]: `var(--pc-${p.color})` }}>
          <span className="ak-waitlist__mark" aria-hidden="true">
            {p.setupDone ? <Icon name="check" size={14} /> : <span className="ak-waitlist__pending" />}
          </span>
          <span>{names.who(p.id)}</span>
          <span className="ak-sr">{p.id === view.youId ? (p.setupDone ? ' are set' : ' are still setting up') : p.setupDone ? ' is set' : ' is still setting up'}</span>
        </li>
      ))}
    </ul>
  );
}

export function SetupPanel({
  view,
  names,
  color,
  busy,
  pending,
  phone,
  botSeat = false,
  onSubmit,
}: {
  view: PlayerView;
  names: NameBook;
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

  const cardW = phone ? 54 : 68;
  const powerW = phone ? 60 : 72;
  const complete = slots.every((s) => s !== null) && power !== null;
  const canEdit = !!legal && !botSeat;

  if (botSeat && !submitted) {
    return (
      <section className="ak-setup ak-setup--done ak-paper" aria-labelledby="setup-h">
        <h2 className="ak-h3" id="setup-h">
          A bot is setting up for you
        </h2>
        <WaitingList view={view} names={names} />
      </section>
    );
  }

  if (submitted && (!editing || botSeat)) {
    return (
      <section className="ak-setup ak-setup--done ak-paper" aria-labelledby="setup-h">
        <div className="ak-setup__donehead">
          <h2 className="ak-h3" id="setup-h">
            <Icon name="check" /> Locked in
          </h2>
          <div className="ak-setup__mini" aria-label={`Your stack, bottom to top: ${submitted.stack.join(', ')}; power: ${powerName(submitted.power)}`}>
            {submitted.stack.map((k, i) => (
              <Card key={i} back="puri" color={color} face={k} width={34} decorative />
            ))}
            <span className="ak-setup__plus" aria-hidden="true">+</span>
            <Card back="power" color={color} face={submitted.power} width={34} decorative />
          </div>
          {canEdit ? (
            <Button size="sm" variant="ghost" icon={<Icon name="edit" size={16} />} onClick={() => setEditing(true)}>
              Change setup
            </Button>
          ) : null}
        </div>
        {canEdit ? <p className="ak-muted ak-small">You can change it until the last player locks in.</p> : null}
        <WaitingList view={view} names={names} />
      </section>
    );
  }

  const fill = (kind: PuriKind) => {
    const i = slots.findIndex((s) => s === null);
    if (i < 0) return;
    setSlots(slots.map((s, j) => (j === i ? kind : s)));
  };
  const clear = (i: number) => setSlots(slots.map((s, j) => (j === i ? null : s)));

  return (
    <section className="ak-setup ak-paper" aria-labelledby="setup-h">
      <header className="ak-setup__head">
        <h2 className="ak-h3" id="setup-h">
          Round {view.round}: set up
        </h2>
        <p className="ak-muted ak-small">
          Hide {size} puri face down on your own stack and put one power beside it. Only you will know what they are.
        </p>
      </header>
      <div className="ak-setup__grid">
        <div className="ak-setup__col">
          <h3 className="ak-setup__label">1 · Tap cards from your hand</h3>
          <Hand
            cards={handCards(remaining)}
            color={color}
            width={cardW}
            selected={null}
            pickable={slots.some((s) => s === null) ? (['panipuri', 'akabare'] as const) : null}
            onPick={(_, c) => fill(c.kind)}
            label="Your puri set"
            emptyText="All your cards are placed."
            className="ak-setup__hand"
          />
        </div>
        <div className="ak-setup__col">
          <h3 className="ak-setup__label">2 · Your stack (bottom → top)</h3>
          <ol className="ak-slots" aria-label="Your stack slots, bottom to top">
            {slots.map((s, i) => (
              <li key={i} className="ak-slot">
                {s ? (
                  <button type="button" className="ak-slot__btn" onClick={() => clear(i)} aria-label={`${slotName(i, size)}: ${s}. Tap to take it back.`}>
                    <Card back="puri" color={color} face={s} width={cardW} decorative />
                    <span className="ak-slot__x" aria-hidden="true">
                      <Icon name="close" size={14} />
                    </span>
                  </button>
                ) : (
                  <span className="ak-slot__empty" style={{ width: cardW, height: Math.round(cardW * (88 / 63)) }} aria-label={`${slotName(i, size)}: empty`}>
                    <span aria-hidden="true">{i + 1}</span>
                  </span>
                )}
                <span className="ak-slot__cap">{slotName(i, size)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="ak-setup__col ak-setup__col--powers">
          <h3 className="ak-setup__label">3 · Pick one power</h3>
          <ul className="ak-powerpick" role="radiogroup" aria-label="Power card">
            {POWER_KINDS.map((k) => {
              const ok = available.includes(k);
              const r = ok ? null : usedInRound(view, k);
              return (
                <li key={k} className={cx('ak-powerpick__item', !ok && 'is-off', power === k && 'is-on')}>
                  <Card
                    back="power"
                    color={color}
                    face={k}
                    width={powerW}
                    state={power === k ? 'selected' : ok ? 'selectable' : 'dim'}
                    onClick={ok ? () => setPower(k) : undefined}
                    ariaLabel={ok ? `${powerName(k)}: ${CARD_INFO[k].short}${power === k ? ' (chosen)' : ''}` : `${powerName(k)}: used${r ? ` in round ${r}` : ''}`}
                  />
                  <span className="ak-powerpick__name">{powerName(k)}</span>
                  <span className="ak-powerpick__rule">{ok ? CARD_INFO[k].short : r ? `Used in round ${r}` : 'Used'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <footer className="ak-setup__foot">
        <WaitingList view={view} names={names} />
        <div className="ak-row ak-row--tight">
          {submitted ? (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Keep my setup
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            busy={pending}
            disabled={!complete || busy || !canEdit}
            onClick={async () => {
              if (!complete) return;
              const ok = await onSubmit(slots as PuriKind[], power!);
              if (ok) setEditing(false);
            }}
          >
            {submitted ? 'Update setup' : 'Lock in my setup'}
          </Button>
        </div>
      </footer>
      {!complete ? (
        <p className="ak-setup__todo ak-small" aria-live="polite">
          {(() => {
            const empty = slots.filter((x) => x === null).length;
            const parts = [empty > 0 ? `fill ${empty} more stack slot${empty === 1 ? '' : 's'}` : '', !power ? 'pick a power' : ''].filter(Boolean);
            const t = parts.join(' and ');
            return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : '';
          })()}
        </p>
      ) : null}
    </section>
  );
}
