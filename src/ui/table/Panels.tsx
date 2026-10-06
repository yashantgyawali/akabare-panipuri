/**
 * The dock prompt: what YOU can do right now (title, one friendly sentence,
 * and the controls), driven only by view.legal (empty while events are still
 * playing back).
 */
import type { ReactNode } from 'react';
import type { Action, PlayerView, PuriKind } from '../../engine/types.ts';
import { Button } from '../common/Button.tsx';
import { cx } from '../common/hooks.ts';
import { joinNames, powerName, type NameBook } from '../text.ts';
import { BidControl } from './DockBid.tsx';

export { BidControl };

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
  /** A bot plays your seat: the dock says so and offers the seat back. */
  onTakeSeatBack?: () => void;
  takingBack?: boolean;
}

function Dots() {
  return (
    <span className="tp-dots" aria-hidden="true">
      <span>•</span>
      <span>•</span>
      <span>•</span>
    </span>
  );
}

function Prompt({
  title,
  text,
  waiting,
  turn,
  children,
}: {
  title: ReactNode;
  text?: ReactNode;
  waiting?: boolean;
  turn?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cx('tp-prompt', turn && 'tp-prompt--turn')}>
      <div className="tp-prompt__text">
        <h2 className="tp-prompt__title">
          {title}
          {waiting ? <Dots /> : null}
        </h2>
        {text ? <p className="tp-prompt__sentence">{text}</p> : null}
      </div>
      {children ? <div className="tp-prompt__controls">{children}</div> : null}
    </div>
  );
}

export function ActionPanel(props: PanelProps) {
  const { view, names, busy, pending, playing, selectedKind, onClearSelection, act, onUnpeek, onTakeSeatBack, takingBack } = props;
  const legal = view.legal;
  const you = view.youId;
  const pendingNames = joinNames(view.pendingActors.filter((id) => id !== you).map((id) => names.name(id)));
  const unpeek = (label: string) =>
    onUnpeek ? (
      <Button variant="leaf" size="sm" onClick={onUnpeek}>
        {label}
      </Button>
    ) : null;

  if (!you) return <Prompt title="You’re watching" text={playing ? 'Playing the table…' : 'The table updates as everyone plays.'} />;
  if (onTakeSeatBack && view.phase !== 'gameOver') {
    return (
      <Prompt title="A bot is playing your seat" text="Take it back any time.">
        <Button variant="primary" size="md" busy={takingBack} disabled={busy} onClick={onTakeSeatBack}>
          Take my seat back
        </Button>
      </Prompt>
    );
  }
  if (playing) return <Prompt title="Playing the table" waiting />;

  switch (view.phase) {
    case 'setup':
      return null; // the SetupPanel takes over the dock
    case 'serving': {
      if (legal.startBid) {
        const kind = selectedKind === 'akabare' ? 'Akabare' : 'Panipuri';
        return (
          <Prompt
            turn
            title="Your turn to serve"
            text={
              !legal.place
                ? 'Your hand is empty, so you must open the bid.'
                : selectedKind
                  ? `Now tap any stack (yours too) to slip your ${kind} on top.`
                  : 'Pick a card from your hand, then tap a stack. Or stop serving and open the bid.'
            }
          >
            {selectedKind ? (
              <button type="button" className="tp-link tp-prompt__cancel" onClick={onClearSelection}>
                Cancel
              </button>
            ) : null}
            <BidControl
              min={legal.startBid.min}
              tableMax={view.tableMax}
              verb="Start the bid"
              busy={busy}
              pending={pending === 'bid'}
              onBid={(amount) => act('bid', { type: 'START_BID', amount })}
            />
          </Prompt>
        );
      }
      const turn = view.serving?.turnId;
      return <Prompt waiting title={turn ? `${names.name(turn)} is serving` : 'Serving'} text="On your turn: place a card on any stack, or open the bid." />;
    }
    case 'bidding': {
      const b = view.bidding;
      if (legal.raise || legal.pass) {
        const passBtn = legal.pass ? (
          <Button
            variant="secondary"
            size="lg"
            busy={pending === 'pass'}
            disabled={busy}
            aria-label="Pass: you're out of the bidding for this round"
            onClick={() => act('pass', { type: 'PASS' })}
          >
            Pass
          </Button>
        ) : null;
        return (
          <Prompt turn title="Raise or pass?" text={b ? `High bid ${b.highBid} by ${names.who(b.highBidderId)}. The last one standing eats.` : undefined}>
            {legal.raise ? (
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
            )}
          </Prompt>
        );
      }
      const passed = !!you && !!b?.passed.includes(you);
      const title = passed ? 'You passed' : b?.highBidderId === you ? `You hold the high bid (${b?.highBid})` : b ? `High bid ${b.highBid} by ${names.who(b.highBidderId)}` : 'Bidding';
      return <Prompt waiting title={title} text={b ? `Waiting for ${names.name(b.turnId)} to raise or pass.` : undefined} />;
    }
    case 'eating': {
      const e = view.eating;
      if (!e) return null;
      if (e.eaterId !== you) {
        // Only tease the trap reward when your Akabare is actually out on the table.
        const trapSet = view.config.trapReward > 0 && view.players.some((p) => p.stack.some((c) => c.owner === you && c.kind === 'akabare'));
        return (
          <Prompt
            waiting
            title={e.pendingAkabare ? `${names.name(e.eaterId)} bit an Akabare and is deciding` : `${names.name(e.eaterId)} is eating ${e.target}`}
            text={trapSet ? `Watch the plate. If they bite your Akabare, you get +${view.config.trapReward}.` : 'Watch the plate.'}
          >
            {unpeek('Back to the bite')}
          </Prompt>
        );
      }
      if (legal.flipPuri.length === 0 && legal.flipPower.length === 0 && !legal.acceptBust) return <Prompt waiting title="Eating" />;
      const tableEmpty = legal.flipPuri.length === 0 && !e.pendingAkabare;
      const mine = view.players.find((p) => p.id === you)?.power;
      const canNaya = !!mine && !mine.revealed && mine.kind === 'nayaplate';
      let text = tableEmpty
        ? 'The table’s empty. Hope for Chaat, or give up.'
        : e.freePlate
          ? 'Naya Plate: tap any glowing stack, yours included.'
          : !e.ownStackEmpty
            ? `Finish your own stack first: tap it to eat${canNaya ? ', or flip your Naya Plate to eat from any stack' : ''}.`
            : 'Tap any glowing stack to eat its top card.';
      if (legal.flipPower.length > 0) {
        text += ` ${tableEmpty ? 'Flip' : 'Or flip'} a glowing power (${view.config.powerFlipsMax - e.powersFlipped} left)${
          mine && !mine.revealed && mine.kind ? `. Yours is ${powerName(mine.kind)}; the rest are blind gambles.` : '. Each one is a blind gamble.'
        }`;
      }
      return (
        <Prompt turn title={`Eat ${e.target - e.eaten} more`} text={text}>
          {legal.acceptBust && !e.pendingAkabare ? (
            <Button variant="danger" size="lg" busy={pending === 'accept'} disabled={busy} onClick={() => act('accept', { type: 'ACCEPT_BUST' })}>
              Give up (bust −{e.target})
            </Button>
          ) : null}
        </Prompt>
      );
    }
    case 'roundEnd': {
      const { targetScore, maxRounds } = view.config;
      const last = (targetScore !== null && view.players.some((p) => p.score >= targetScore)) || (maxRounds !== null && view.round >= maxRounds);
      const waitText = pendingNames ? `Waiting for ${pendingNames}` : last ? 'Final scores coming up' : 'Next round coming up';
      return (
        <Prompt
          waiting={!legal.ready}
          title={legal.ready ? `Round ${view.round} is over` : waitText}
          text={view.revealed ? 'Leftover cards are face up on the table.' : 'Leftover cards stay secret.'}
        >
          {legal.ready ? (
            <Button variant="primary" size="md" busy={pending === 'ready'} disabled={busy} onClick={() => act('ready', { type: 'READY' })}>
              {last ? 'See the final scores' : 'Ready for the next round'}
            </Button>
          ) : null}
          {unpeek('Back to the result')}
        </Prompt>
      );
    }
    case 'gameOver':
      return (
        <Prompt title="Game over" text={view.revealed ? 'Leftover cards are face up on the table.' : 'Leftover cards stay secret.'}>
          {unpeek('Back to the results')}
        </Prompt>
      );
  }
}
