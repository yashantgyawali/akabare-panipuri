/** The round result dialog (after the eating ends, until everyone is ready). */
import { useId } from 'react';
import type { Action, PlayerView, RoundResult } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { joinNames, num, signed, type NameBook } from '../text.ts';
import { Overlay } from './OverlayShell.tsx';

function ResultLines({ result, view }: { result: RoundResult; view: PlayerView }) {
  const rows = [...view.players].sort((a, b) => (result.scoresAfter[b.id] ?? 0) - (result.scoresAfter[a.id] ?? 0));
  return (
    <ul className="tp-resrows">
      {rows.map((p) => {
        const d = result.scoreDeltas[p.id] ?? 0;
        const why = p.id === result.eaterId ? (result.outcome === 'success' ? 'ate the bid' : 'bust') : p.id === result.trapRewardTo ? 'trap reward' : '';
        return (
          <li key={p.id} className="tp-resrows__row" style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
            <span className="tp-dot" aria-hidden="true" />
            <span className="tp-resrows__name">{p.id === view.youId ? 'You' : p.name}</span>
            <span className="tp-resrows__why">{why}</span>
            <span className={cx('tp-resrows__d', d > 0 && 'is-up', d < 0 && 'is-down')}>{d === 0 ? '·' : signed(d)}</span>
            <span className="tp-resrows__score">{num(result.scoresAfter[p.id] ?? p.score)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RoundEndPanel({
  view,
  names,
  result,
  isHost,
  busy,
  pending,
  act,
  onPeek,
  onTakeSeatBack,
}: {
  view: PlayerView;
  names: NameBook;
  result: RoundResult;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  act: (key: string, action: Action) => void;
  onPeek: () => void;
  /** Set while a bot plays the viewer's seat: the banner with this button is hidden behind the overlay. */
  onTakeSeatBack?: () => void;
}) {
  const titleId = useId();
  const you = view.youId;
  const eater = result.eaterId;
  const success = result.outcome === 'success';
  const { targetScore, maxRounds } = view.config;
  const willEnd = (targetScore !== null && view.players.some((p) => p.score >= targetScore)) || (maxRounds !== null && view.round >= maxRounds);
  const waiting = view.players.filter((p) => !p.isBot && !p.ready);
  // Whether YOU are ready comes from your seat, not from legal.ready: legal is
  // empty for a moment whenever someone else's Ready plays back.
  const mine = view.players.find((p) => p.id === you);
  const youReady = !mine || mine.isBot || mine.ready;
  const reason =
    result.outcome === 'bust'
      ? result.bustReason === 'emptyTable'
        ? 'The table ran out before the bid was eaten.'
        : result.akabareOwnerId
          ? result.akabareOwnerId === eater
            ? `Bit ${eater === you ? 'your' : 'their'} own Akabare: no trap reward.`
            : `Bit ${result.akabareOwnerId === you ? 'your' : `${names.name(result.akabareOwnerId)}’s`} Akabare.`
          : 'Bust.'
      : result.eaten > result.target
        ? `Overshot to ${result.eaten}, but the score is the bid.`
        : null;
  return (
    <Overlay className="tp-result" labelledBy={titleId} focusKey={`r${result.round}:${youReady}:${!!onTakeSeatBack}`}>
      <div className={cx('tp-dialog tp-result__card', !success && 'tp-dialog--red')}>
        <p className="tp-result__kicker">round {result.round} result</p>
        <div className="tp-result__head">
          <h2 className="tp-result__title" id={titleId}>
            {success ? `${eater === you ? 'You' : names.name(eater)} ate ${result.target}!` : `${eater === you ? 'You' : names.name(eater)} ${eater === you ? 'bust' : 'busts'}!`}
          </h2>
          <span className={cx('tp-result__big', !success && 'is-bust')} aria-hidden="true">
            {signed(success ? result.target : -result.target)}
          </span>
        </div>
        <p className="tp-result__facts">
          Bid {result.bid} · ate {result.eaten}
          {reason ? ` · ${reason}` : ''}
        </p>
        {result.trapRewardTo ? (
          <p className="tp-result__trap">
            <Icon name="chili" size={18} /> {names.who(result.trapRewardTo)} {result.trapRewardTo === you ? 'get' : 'gets'} +{view.config.trapReward} for the trap.
          </p>
        ) : null}
        <ResultLines result={result} view={view} />
        {view.revealed ? (
          <p className="tp-small tp-muted">
            Leftover cards are face up on the table.{' '}
            <button type="button" className="tp-link tp-link--quiet" onClick={onPeek}>
              Look at the table
            </button>
          </p>
        ) : null}
        <div className="tp-result__actions">
          {onTakeSeatBack ? (
            <>
              <p className="tp-result__status" role="status">
                <Icon name="bot" size={18} /> A bot is playing your seat.
              </p>
              <Button variant="primary" size="md" busy={pending === `bot:${you}`} disabled={busy} onClick={onTakeSeatBack} data-autofocus="">
                Take my seat back
              </Button>
            </>
          ) : !youReady ? (
            <Button
              variant="primary"
              size="md"
              busy={pending === 'ready'}
              disabled={busy}
              // Not `disabled` while a move plays back: that would drop keyboard focus.
              aria-disabled={!view.legal.ready || undefined}
              onClick={() => {
                if (view.legal.ready) act('ready', { type: 'READY' });
              }}
              data-autofocus=""
            >
              {willEnd ? 'See the final scores' : `Ready for round ${view.round + 1}`}
            </Button>
          ) : (
            <p className="tp-result__status" role="status">
              <Icon name="check" size={18} /> You’re ready.{' '}
              {waiting.length > 0 ? `Waiting for ${joinNames(waiting.map((p) => names.name(p.id)))}…` : ''}
            </p>
          )}
          {view.legal.forceContinue && isHost && waiting.some((p) => p.id !== you) ? (
            <Button variant="secondary" size="sm" busy={pending === 'force'} disabled={busy} onClick={() => act('force', { type: 'FORCE_CONTINUE' })}>
              Continue now
            </Button>
          ) : null}
          {!view.revealed ? (
            <button type="button" className="tp-link tp-link--quiet" onClick={onPeek}>
              Look at the table
            </button>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
}
