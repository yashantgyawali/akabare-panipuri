/** The game over dialog: winner, tie-break line, ranked standings, rematch. */
import { useId } from 'react';
import type { PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { cx } from '../common/hooks.ts';
import { HOME, navigate } from '../router.ts';
import { joinNames, num, type NameBook } from '../text.ts';
import { Overlay } from './OverlayShell.tsx';

/** Flat paper bits in brand colours: no glow, no blur. */
const BITS = ['#F16147', '#F3B952', '#5A3A1F', '#F16147', '#F3B952', '#B8331C'];

function Confetti() {
  return (
    <div className="tp-confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${((i * 13) % 20) / 10}s`,
            animationDuration: `${3.2 + ((i * 7) % 10) / 5}s`,
            background: BITS[i % BITS.length],
            ['--r' as string]: `${(i * 47) % 360}deg`,
            ['--w' as string]: `${6 + (i % 3) * 3}px`,
          }}
        />
      ))}
    </div>
  );
}

export function GameOverPanel({
  view,
  names,
  isHost,
  busy,
  pending,
  onRematch,
  onPeek,
}: {
  view: PlayerView;
  names: NameBook;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  onRematch: () => void;
  onPeek: () => void;
}) {
  const titleId = useId();
  const you = view.youId;
  // You first ("Shared win: You and Bikash!", never "Bikash and You!").
  const winners = [...(view.winners ?? [])].sort((a, b) => Number(b === view.youId) - Number(a === view.youId));
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  const top = standings[0]?.score ?? 0;
  const leaders = standings.filter((p) => p.score === top);
  const youWon = !!you && winners.includes(you);
  let tiebreak: string | null = null;
  if (leaders.length > 1 && winners.length < leaders.length) {
    const w = leaders.filter((p) => winners.includes(p.id));
    const l = leaders.filter((p) => !winners.includes(p.id));
    tiebreak = `Tied on ${top} points: ${joinNames(w.map((p) => names.who(p.id)))} ${w.length === 1 && w[0].id !== you ? 'wins' : 'win'} on fewer busts (${w[0].busts} vs ${l.map((p) => p.busts).join(', ')}).`;
  } else if (winners.length > 1) {
    tiebreak = `Tied on ${top} points and ${leaders[0].busts} bust${leaders[0].busts === 1 ? '' : 's'}: a shared win.`;
  }
  const title =
    winners.length === 1
      ? winners[0] === you
        ? 'You win!'
        : `${names.name(winners[0])} wins!`
      : `Shared win: ${joinNames(winners.map((id) => names.who(id)))}!`;
  let rank = 0;
  let prev: string | null = null;
  return (
    <Overlay className="tp-over" labelledBy={titleId} focusKey="gameover">
      <Confetti />
      <div className={cx('tp-dialog tp-over__card', youWon && 'is-you')}>
        <p className="tp-over__kicker">game over · round {view.round}</p>
        <h2 className="tp-over__title" id={titleId}>
          {title}
        </h2>
        {tiebreak ? <p className="tp-over__tie">{tiebreak}</p> : null}
        <ol className="tp-standings">
          {standings.map((p, i) => {
            const key = `${p.score}:${p.busts}`;
            if (key !== prev) rank = i + 1;
            prev = key;
            return (
              <li key={p.id} className={cx('tp-standings__row', winners.includes(p.id) && 'is-winner')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                <span className="tp-standings__rank">{rank}</span>
                <span className="tp-dot" aria-hidden="true" />
                <span className="tp-standings__name">{p.id === you ? 'You' : p.name}</span>
                <span className="tp-standings__busts">
                  {p.busts} bust{p.busts === 1 ? '' : 's'}
                </span>
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
          ) : (
            <p className="tp-small tp-muted">The host can start a rematch with the same players.</p>
          )}
          <Button variant="secondary" onClick={() => navigate(HOME)} data-autofocus={isHost ? undefined : ''}>
            Back home
          </Button>
          <button type="button" className="tp-link tp-link--quiet" onClick={onPeek}>
            Look at the table
          </button>
        </div>
      </div>
    </Overlay>
  );
}
