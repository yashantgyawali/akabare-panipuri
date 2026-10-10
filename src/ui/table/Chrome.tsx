/** Table chrome: turn text, and the log / scores drawer contents (the header bar is in ChromeHeader.tsx). */
import type { GameEvent, PlayerId, PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { describeEvent, num, type NameBook } from '../text.ts';

export type DrawerName = 'rules' | 'log' | 'scores' | null;

export function turnText(view: PlayerView, names: NameBook): string {
  const you = view.youId;
  const pa = view.pendingActors;
  switch (view.phase) {
    case 'setup': {
      const left = view.players.filter((p) => !p.setupDone);
      if (left.length === 0) return 'All set';
      if (you && left.some((p) => p.id === you)) return 'Set up';
      return `Waiting (${left.length})`;
    }
    case 'bidding':
      if (view.bidding && view.players.length - view.bidding.passed.length <= 1) return 'Bids closed';
      return pa[0] === you ? 'Your turn' : `${names.name(pa[0])}’s turn`;
    case 'serving':
      return pa[0] === you ? 'Your turn' : `${names.name(pa[0])}’s turn`;
    case 'eating':
      return pa[0] === you ? 'Your turn' : `${names.name(pa[0])} eats`;
    case 'roundEnd': {
      // The pill already says "Round over"; say who we're waiting for instead.
      const waiting = view.players.filter((p) => !p.isBot && !p.ready);
      if (you && waiting.some((p) => p.id === you)) return 'Ready?';
      return waiting.length > 0 ? `Waiting (${waiting.length})` : 'Next round';
    }
    case 'gameOver': {
      const w = view.winners ?? [];
      return w.length === 1 ? (w[0] === you ? 'You win' : `${names.name(w[0])} wins`) : w.length > 1 ? 'Shared win' : 'Final scores';
    }
  }
}

export { TableHeader } from './ChromeHeader.tsx';

export function LogList({ log, names, trapReward }: { log: GameEvent[]; names: NameBook; trapReward: number }) {
  const items = [...log].reverse();
  return (
    <ol className="tp-log" aria-label="Newest first">
      {items.map((e) => {
        const line = describeEvent(e, names, trapReward);
        return (
          <li key={e.seq} className={cx('tp-log__item', `tp-log__item--${line.tone}`)}>
            <span className="tp-log__r" aria-label={`Round ${e.round}`}>
              R{e.round}
            </span>
            <span>{line.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ScoresPanel({
  view,
  hostId,
  isHost,
  busy,
  pending,
  onSetBot,
  onLeave,
}: {
  view: PlayerView;
  names?: NameBook;
  hostId: PlayerId;
  isHost: boolean;
  online?: PlayerId[];
  graceOver?: boolean;
  busy: boolean;
  pending: string | null;
  onSetBot: (id: PlayerId, isBot: boolean) => void;
  onLeave: () => void;
}) {
  const you = view.youId;
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  const finished = view.phase === 'gameOver';
  return (
    <div className="tp-scores">
      <table className="tp-scores__table">
        <caption className="tp-sr">Scores</caption>
        <tbody>
          {standings.map((p) => {
            const isYou = p.id === you;
            return (
              <tr key={p.id} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                <td className="tp-scores__dot">
                  <span className="tp-dot" aria-hidden="true" />
                </td>
                <th scope="row" className="tp-scores__name">
                  <span>{isYou ? 'You' : p.name}</span>
                  {p.id === hostId ? <Icon name="crown" size={14} className="tp-scores__crown" title="host" /> : null}
                  {p.isBot ? <Icon name="bot" size={14} className="tp-scores__crown" title="bot" /> : null}
                </th>
                <td className="tp-scores__seat">
                  {!finished && isYou ? (
                    <IconButton label={p.isBot ? 'Take my seat back' : 'Let a bot play for me'} aria-pressed={p.isBot} disabled={busy} onClick={() => onSetBot(p.id, !p.isBot)}>
                      <Icon name="bot" size={18} />
                    </IconButton>
                  ) : null}
                  {!finished && isHost && !isYou && !p.isBot ? (
                    <IconButton label={`Replace ${p.name} with a bot`} disabled={busy} className={cx(pending === `bot:${p.id}` && 'is-busy')} onClick={() => onSetBot(p.id, true)}>
                      <Icon name="bot" size={18} />
                    </IconButton>
                  ) : null}
                </td>
                <td className="tp-scores__pts">{num(p.score)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="tp-scores__foot">
        <Button variant="danger" size="sm" icon={<Icon name="leave" size={18} />} onClick={onLeave}>
          Leave
        </Button>
      </div>
    </div>
  );
}
