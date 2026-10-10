/**
 * The dock prompt: what YOU can do right now (title, one friendly sentence,
 * and the controls), driven only by view.legal (empty while events are still
 * playing back).
 */
import type { ReactNode } from 'react';
import type { Action, PlayerView, PuriKind } from '../../engine/types.ts';
import { Button } from '../common/Button.tsx';
import { cx } from '../common/hooks.ts';
import { joinNames, type NameBook } from '../text.ts';
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
  hint,
  waiting,
  turn,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  waiting?: boolean;
  turn?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cx('tp-prompt', turn && 'tp-prompt--turn')}>
      {title || hint ? (
        <div className="tp-prompt__text">
          {title ? (
            <h2 className="tp-prompt__title">
              {title}
              {waiting ? <Dots /> : null}
            </h2>
          ) : null}
          {hint ? <p className="tp-prompt__sentence">{hint}</p> : null}
        </div>
      ) : null}
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

  if (!you) return <Prompt title="Watching" waiting={playing} />;
  if (onTakeSeatBack && view.phase !== 'gameOver') {
    return (
      <Prompt title="Bot is playing">
        <Button variant="primary" size="md" busy={takingBack} disabled={busy} onClick={onTakeSeatBack}>
          Take seat back
        </Button>
      </Prompt>
    );
  }
  if (playing) return <Prompt title="Playing" waiting />;

  switch (view.phase) {
    case 'setup':
      return null; // the SetupPanel takes over the dock
    case 'serving': {
      if (legal.startBid) {
        return (
          <Prompt turn title={selectedKind ? 'Tap a stack' : 'Your turn'}>
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
      return <Prompt waiting title={turn ? `${names.name(turn)} is serving` : 'Serving'} />;
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
            aria-label="Pass: you are out of the bidding for this round"
            onClick={() => act('pass', { type: 'PASS' })}
          >
            Pass
          </Button>
        ) : null;
        return (
          <Prompt turn>
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
      const title = passed ? 'You passed' : b ? `${names.name(b.turnId)} is bidding` : 'Bidding';
      return <Prompt waiting title={title} />;
    }
    case 'eating': {
      const e = view.eating;
      if (!e) return null;
      if (e.eaterId !== you) {
        return (
          <Prompt waiting title={e.pendingAkabare ? `${names.name(e.eaterId)} is deciding` : `${names.name(e.eaterId)} is eating`}>
            {unpeek('Back to the bite')}
          </Prompt>
        );
      }
      if (legal.flipPuri.length === 0 && legal.flipPower.length === 0 && !legal.acceptBust) return <Prompt waiting title="Eating" />;
      const hint = e.freePlate ? 'Naya Plate: any stack' : e.skipNext ? 'Vinegar: next puri cancelled' : undefined;
      return (
        <Prompt turn title={`Eat ${e.target - e.eaten} more`} hint={hint}>
          {legal.acceptBust && !e.pendingAkabare ? (
            <Button variant="danger" size="lg" busy={pending === 'accept'} disabled={busy} aria-label={`Give up: bust, lose ${e.target}`} onClick={() => act('accept', { type: 'ACCEPT_BUST' })}>
              Give up
            </Button>
          ) : null}
        </Prompt>
      );
    }
    case 'roundEnd': {
      const { targetScore, maxRounds } = view.config;
      const last = (targetScore !== null && view.players.some((p) => p.score >= targetScore)) || (maxRounds !== null && view.round >= maxRounds);
      const waitText = pendingNames ? `Waiting for ${pendingNames}` : 'Next round';
      return (
        <Prompt waiting={!legal.ready} title={legal.ready ? 'Round over' : waitText}>
          {legal.ready ? (
            <Button variant="primary" size="md" busy={pending === 'ready'} disabled={busy} onClick={() => act('ready', { type: 'READY' })}>
              {last ? 'Final scores' : 'Ready'}
            </Button>
          ) : null}
          {unpeek('Result')}
        </Prompt>
      );
    }
    case 'gameOver':
      return (
        <Prompt title="Game over">
          {unpeek('Results')}
        </Prompt>
      );
  }
}
