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
        return (
          <li key={p.id} className="tp-resrows__row" style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
            <span className="tp-dot" aria-hidden="true" />
            <span className="tp-resrows__name">{p.id === view.youId ? 'You' : p.name}</span>
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
  onTakeSeatBack,
}: {
  view: PlayerView;
  names: NameBook;
  result: RoundResult;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  act: (key: string, action: Action) => void;
  /** Unused: kept so callers need not change. */
  onPeek?: () => void;
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
  const who = eater === you ? 'You' : names.name(eater);
  return (
    <Overlay className="tp-result" labelledBy={titleId} focusKey={`r${result.round}:${youReady}:${!!onTakeSeatBack}`}>
      <div className={cx('tp-dialog tp-result__card', !success && 'tp-dialog--red')}>
        <div className="tp-result__head">
          <h2 className="tp-result__title" id={titleId}>
            {success ? `${who} ate ${result.target}` : `${who} ${eater === you ? 'bust' : 'busts'}`}
          </h2>
          <span className={cx('tp-result__big', !success && 'is-bust')} aria-hidden="true">
            {signed(success ? result.target : -result.target)}
          </span>
        </div>
        <ResultLines result={result} view={view} />
        <div className="tp-result__actions">
          {onTakeSeatBack ? (
            <Button variant="primary" size="md" busy={pending === `bot:${you}`} disabled={busy} onClick={onTakeSeatBack} data-autofocus="">
              Take back
            </Button>
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
              {willEnd ? 'See results' : 'Ready'}
            </Button>
          ) : (
            <p className="tp-result__status" role="status">
              <Icon name="check" size={18} /> Ready
              <span className="tp-sr">{waiting.length > 0 ? `. Waiting for ${joinNames(waiting.map((p) => names.name(p.id)))}` : ''}</span>
            </p>
          )}
          {view.legal.forceContinue && isHost && waiting.some((p) => p.id !== you) ? (
            <Button variant="ghost" size="sm" busy={pending === 'force'} disabled={busy} onClick={() => act('force', { type: 'FORCE_CONTINUE' })}>
              Skip waiting
            </Button>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
}
