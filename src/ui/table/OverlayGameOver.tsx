/** The game over dialog: winner, tie-break line, ranked standings, rematch. */
import { useId } from 'react';
import type { PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { cx } from '../common/hooks.ts';
import { HOME, navigate } from '../router.ts';
import { joinNames, num, type NameBook } from '../text.ts';
import { Overlay } from './OverlayShell.tsx';

export function GameOverPanel({
  view,
  names,
  isHost,
  busy,
  pending,
  onRematch,
}: {
  view: PlayerView;
  names: NameBook;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  onRematch: () => void;
  /** Unused: kept so callers need not change. */
  onPeek?: () => void;
}) {
  const titleId = useId();
  const you = view.youId;
  // You first ("Shared win: You and Bikash!", never "Bikash and You!").
  const winners = [...(view.winners ?? [])].sort((a, b) => Number(b === view.youId) - Number(a === view.youId));
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  const youWon = !!you && winners.includes(you);
  const title =
    winners.length === 1
      ? winners[0] === you
        ? 'You win'
        : `${names.name(winners[0])} wins`
      : `${joinNames(winners.map((id) => names.who(id)))} win`;
  let rank = 0;
  let prev: string | null = null;
  return (
    <Overlay className="tp-over" labelledBy={titleId} focusKey="gameover">
      <div className={cx('tp-dialog tp-over__card', youWon && 'is-you')}>
        <h2 className="tp-over__title" id={titleId}>
          {title}
        </h2>
        <ol className="tp-standings">
          {standings.map((p, i) => {
            const key = `${p.score}:${p.busts}`;
            if (key !== prev) rank = i + 1;
            prev = key;
            const tied = key === (standings[i + 1] && `${standings[i + 1].score}:${standings[i + 1].busts}`) || (i > 0 && rank !== i + 1);
            return (
              <li key={p.id} className={cx('tp-standings__row', winners.includes(p.id) && 'is-winner')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                <span className="tp-standings__rank">{tied ? '=' : rank}</span>
                <span className="tp-dot" aria-hidden="true" />
                <span className="tp-standings__name">{p.id === you ? 'You' : p.name}</span>
                <span className="tp-standings__score">{num(p.score)}</span>
              </li>
            );
          })}
        </ol>
        <div className="tp-result__actions">
          {isHost ? (
            <Button variant="primary" size="md" busy={pending === 'rematch'} disabled={busy} onClick={onRematch} data-autofocus="">
              Rematch
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => navigate(HOME)} data-autofocus={isHost ? undefined : ''}>
            Home
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
