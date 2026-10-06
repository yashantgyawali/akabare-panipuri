/**
 * The action panel under the table: what YOU can do right now, driven only by
 * view.legal (empty while events are still playing back).
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Action, PlayerView, PuriKind } from '../../engine/types.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { Stepper } from '../common/Stepper.tsx';
import { cx } from '../common/hooks.ts';
import { joinNames, powerName, type NameBook } from '../text.ts';

/** Bid stepper + soft warning above tableMax ("more than anyone could eat") that still lets you confirm. */
export function BidControl({
  min,
  tableMax,
  verb,
  busy,
  pending,
  onBid,
  initial,
  extra,
}: {
  min: number;
  tableMax: number;
  verb: 'Start the bid' | 'Raise';
  busy: boolean;
  pending: boolean;
  onBid: (amount: number) => void;
  initial?: number;
  /** Rendered at the end of the stepper row (e.g. the Pass button). */
  extra?: ReactNode;
}) {
  const [amount, setAmount] = useState(Math.max(min, initial ?? min));
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setAmount((a) => Math.max(min, a));
  }, [min]);
  useEffect(() => setConfirming(false), [amount, min]);
  const over = amount > tableMax;
  const label = verb === 'Raise' ? `Raise to ${amount}` : `Bid ${amount}`;
  return (
    <div className={cx('ak-bid', confirming && 'ak-bid--confirm')}>
      <div className="ak-bid__row">
        <Stepper value={amount} min={min} onChange={setAmount} label={verb === 'Raise' ? 'Raise to' : 'Opening bid'} size="lg" disabled={busy} />
        {!confirming ? (
          <Button
            variant="primary"
            size="lg"
            busy={pending}
            disabled={busy}
            onClick={() => {
              if (over) setConfirming(true);
              else onBid(amount);
            }}
          >
            {label}
          </Button>
        ) : null}
        {!confirming ? extra : null}
      </div>
      {over && !confirming ? (
        <p className="ak-bid__hint ak-small">
          Heads up: at most {tableMax} can be eaten right now ({'face-down puri + 2 per power flip'}).
        </p>
      ) : null}
      {confirming ? (
        <div className="ak-bid__warn" role="alertdialog" aria-labelledby="bidwarn">
          <p id="bidwarn">
            <strong>{amount}?</strong> That’s more than anyone could possibly eat (at most {tableMax}). Sure?
          </p>
          <div className="ak-row ak-row--tight">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} autoFocus>
              Change it
            </Button>
            <Button variant="danger" size="sm" busy={pending} disabled={busy} onClick={() => onBid(amount)}>
              Yes, {label.toLowerCase()}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface PanelProps {
  view: PlayerView;
  names: NameBook;
  busy: boolean;
  pending: string | null;
  playing: boolean;
  selectedKind: PuriKind | null;
  onClearSelection: () => void;
  act: (key: string, action: Action) => void;
  /** Set while an overlay (the round result, or a bite you are watching) is set aside to look at the table: brings it back. */
  onUnpeek?: () => void;
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="ak-panel__waiting">
      <span className="ak-waiting__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {text}
    </p>
  );
}

export function ActionPanel(props: PanelProps) {
  const { view, names, busy, pending, playing, selectedKind, onClearSelection, act, onUnpeek } = props;
  const legal = view.legal;
  const you = view.youId;
  const pendingNames = joinNames(view.pendingActors.filter((id) => id !== you).map((id) => names.name(id)));

  if (playing) {
    return (
      <div className="ak-panel ak-panel--quiet">
        <Waiting text="Playing the table…" />
      </div>
    );
  }

  switch (view.phase) {
    case 'setup':
      return null; // the SetupPanel takes over the dock
    case 'serving': {
      if (legal.startBid) {
        const handEmpty = !legal.place;
        return (
          <div className="ak-panel ak-panel--turn" aria-labelledby="turn-h">
            <h2 className="ak-panel__title" id="turn-h">
              Your turn to serve
            </h2>
            {handEmpty ? (
              <p className="ak-panel__text">Your hand is empty, so you must start the bid.</p>
            ) : selectedKind ? (
              <p className="ak-panel__text">
                Now tap <strong>any stack</strong> (yours too) to slip your {selectedKind === 'akabare' ? 'Akabare' : 'Panipuri'} on top.{' '}
                <button type="button" className="ak-linkbtn" onClick={onClearSelection}>
                  Cancel
                </button>
              </p>
            ) : (
              <p className="ak-panel__text">Pick a card from your hand, then tap a stack. Or stop serving and open the bid:</p>
            )}
            <BidControl
              min={legal.startBid.min}
              tableMax={view.tableMax}
              verb="Start the bid"
              busy={busy}
              pending={pending === 'bid'}
              onBid={(amount) => act('bid', { type: 'START_BID', amount })}
            />
          </div>
        );
      }
      const turn = view.serving?.turnId;
      return (
        <div className="ak-panel">
          <Waiting text={turn ? `Waiting for ${names.name(turn)} to serve…` : 'Serving…'} />
          <p className="ak-panel__text ak-small">On your turn: place a card on any stack, or start the bid.</p>
        </div>
      );
    }
    case 'bidding': {
      const b = view.bidding;
      if (legal.raise || legal.pass) {
        return (
          <div className="ak-panel ak-panel--turn" aria-labelledby="turn-h">
            <h2 className="ak-panel__title" id="turn-h">
              Raise or pass?
            </h2>
            {b ? (
              <p className="ak-panel__text ak-panel__text--bidinfo">
                High bid <strong>{b.highBid}</strong> by {names.who(b.highBidderId)}. The last one standing eats.
              </p>
            ) : null}
            {(() => {
              const passBtn = legal.pass ? (
                <Button
                  variant="ghost"
                  size="lg"
                  className="ak-bid__pass"
                  busy={pending === 'pass'}
                  disabled={busy}
                  aria-label="Pass: you're out of the bidding for this round"
                  onClick={() => act('pass', { type: 'PASS' })}
                >
                  Pass
                </Button>
              ) : null;
              return legal.raise ? (
                <BidControl
                  min={legal.raise.min}
                  tableMax={view.tableMax}
                  verb="Raise"
                  busy={busy}
                  pending={pending === 'raise'}
                  onBid={(amount) => act('raise', { type: 'RAISE', amount })}
                  extra={passBtn}
                />
              ) : (
                passBtn
              );
            })()}
          </div>
        );
      }
      const passed = !!you && !!b?.passed.includes(you);
      return (
        <div className="ak-panel">
          {passed ? <p className="ak-panel__text">You passed: you’re out of the bidding this round.</p> : null}
          {b?.highBidderId === you ? <p className="ak-panel__text">You hold the high bid ({b?.highBid}).</p> : null}
          <Waiting text={b ? `Waiting for ${names.name(b.turnId)} to raise or pass…` : 'Bidding…'} />
        </div>
      );
    }
    case 'eating': {
      const e = view.eating;
      if (!e) return null;
      if (e.eaterId !== you) {
        // Only tease the trap reward when your Akabare is actually out on the table.
        const trapSet = view.config.trapReward > 0 && view.players.some((p) => p.stack.some((c) => c.owner === you && c.kind === 'akabare'));
        return (
          <div className="ak-panel">
            <Waiting text={e.pendingAkabare ? `${names.name(e.eaterId)} bit an Akabare and is deciding…` : `${names.name(e.eaterId)} is eating ${e.target}…`} />
            <p className="ak-panel__text ak-small">
              {trapSet ? `Watch the plate. If they bite your Akabare, you get +${view.config.trapReward}.` : 'Watch the plate.'}
            </p>
            {onUnpeek ? (
              <Button variant="secondary" size="sm" onClick={onUnpeek} icon={<Icon name="chili" size={16} />}>
                Back to the bite
              </Button>
            ) : null}
          </div>
        );
      }
      if (legal.flipPuri.length === 0 && legal.flipPower.length === 0 && !legal.acceptBust) {
        return (
          <div className="ak-panel">
            <Waiting text="Eating…" />
          </div>
        );
      }
      const tableEmpty = legal.flipPuri.length === 0 && !e.pendingAkabare;
      const ownFirst = !e.ownStackEmpty;
      return (
        <div className="ak-panel ak-panel--turn" aria-labelledby="turn-h">
          <h2 className="ak-panel__title" id="turn-h">
            Eat {e.target - e.eaten} more
          </h2>
          {tableEmpty ? (
            <p className="ak-panel__text">
              <strong>Table’s empty.</strong> Flip a power and hope for Chaat, or give up.
            </p>
          ) : e.freePlate ? (
            <p className="ak-panel__text">
              <strong>Naya Plate:</strong> pick any stack, yours included. Tap a glowing stack to eat its top card.
            </p>
          ) : ownFirst ? (
            <p className="ak-panel__text">
              Finish your own stack first: tap it to eat
              {(() => {
                const mine = view.players.find((p) => p.id === you)?.power;
                return mine && !mine.revealed && mine.kind === 'nayaplate' ? ', or flip your Naya Plate to eat from any stack.' : '.';
              })()}
            </p>
          ) : (
            <p className="ak-panel__text">Tap any glowing stack to eat its top card.</p>
          )}
          {legal.flipPower.length > 0 ? (
            <p className="ak-panel__text ak-small">
              Or flip a glowing power ({view.config.powerFlipsMax - e.powersFlipped} left).
              {(() => {
                const mine = view.players.find((p) => p.id === you)?.power;
                return mine && !mine.revealed && mine.kind ? ` Yours is ${powerName(mine.kind)}; the rest are blind gambles.` : ' Each one is a blind gamble.';
              })()}
            </p>
          ) : null}
          {legal.acceptBust && !e.pendingAkabare ? (
            <Button variant="danger" busy={pending === 'accept'} disabled={busy} onClick={() => act('accept', { type: 'ACCEPT_BUST' })}>
              Give up (bust −{e.target})
            </Button>
          ) : null}
        </div>
      );
    }
    case 'roundEnd': {
      const { targetScore, maxRounds } = view.config;
      const last = (targetScore !== null && view.players.some((p) => p.score >= targetScore)) || (maxRounds !== null && view.round >= maxRounds);
      return (
        <div className="ak-panel">
          <div className="ak-row">
            {legal.ready ? (
              <Button variant="primary" busy={pending === 'ready'} disabled={busy} onClick={() => act('ready', { type: 'READY' })}>
                {last ? 'See the final scores' : 'Ready for the next round'}
              </Button>
            ) : (
              <Waiting text={pendingNames ? `Waiting for ${pendingNames}…` : last ? 'Final scores coming up…' : 'Next round coming up…'} />
            )}
            {onUnpeek ? (
              <Button variant="secondary" onClick={onUnpeek}>
                Back to the result
              </Button>
            ) : null}
          </div>
        </div>
      );
    }
    case 'gameOver':
      return (
        <div className="ak-panel">
          <p className="ak-panel__text">
            <Icon name="trophy" size={18} /> Game over.
          </p>
          {onUnpeek ? (
            <Button variant="primary" onClick={onUnpeek}>
              Back to the results
            </Button>
          ) : null}
        </div>
      );
  }
}
