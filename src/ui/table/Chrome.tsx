/** Table chrome: turn text, and the log / scores drawer contents (the header bar is in ChromeHeader.tsx). */
import type { GameEvent, PlayerId, PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { describeEvent, num, signed, type NameBook } from '../text.ts';

export type DrawerName = 'rules' | 'log' | 'scores' | null;

export function turnText(view: PlayerView, names: NameBook): string {
  const you = view.youId;
  const pa = view.pendingActors;
  switch (view.phase) {
    case 'setup': {
      const left = view.players.filter((p) => !p.setupDone);
      if (left.length === 0) return 'Everyone is set';
      if (you && left.some((p) => p.id === you)) return 'Set up your stack';
      return `Waiting for ${left.length} to set up`;
    }
    case 'bidding':
      if (view.bidding && view.players.length - view.bidding.passed.length <= 1) return 'Bidding is over';
      return pa[0] === you ? 'Your turn' : `${names.name(pa[0])}’s turn`;
    case 'serving':
      return pa[0] === you ? 'Your turn' : `${names.name(pa[0])}’s turn`;
    case 'eating':
      return pa[0] === you ? 'Your turn to eat' : `${names.name(pa[0])} is eating`;
    case 'roundEnd': {
      // The pill already says "Round over"; say who we're waiting for instead.
      const waiting = view.players.filter((p) => !p.isBot && !p.ready);
      if (you && waiting.some((p) => p.id === you)) return 'Ready when you are';
      return waiting.length > 0 ? `Waiting for ${waiting.length === 1 ? names.name(waiting[0].id) : `${waiting.length} players`}` : 'Next round…';
    }
    case 'gameOver': {
      const w = view.winners ?? [];
      return w.length === 1 ? (w[0] === you ? 'You win!' : `${names.name(w[0])} wins`) : w.length > 1 ? 'Shared win' : 'Final scores';
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
      {items.length === 0 ? <li className="tp-muted">Nothing has happened yet.</li> : null}
    </ol>
  );
}

function historyText(r: PlayerView['results'][number], names: NameBook, you: PlayerId | null): string {
  if (r.outcome === 'success') return `${names.who(r.eaterId)} ate ${r.target}`;
  if (r.bustReason === 'emptyTable') return `${names.who(r.eaterId)} ran out (${r.eaten}/${r.target})`;
  const own = r.akabareOwnerId === r.eaterId ? (r.eaterId === you ? 'your own' : 'their own') : names.whose(r.akabareOwnerId);
  return `${names.who(r.eaterId)} bit ${own} Akabare`;
}

export function ScoresPanel({
  view,
  names,
  hostId,
  isHost,
  online,
  graceOver,
  busy,
  pending,
  onSetBot,
  onLeave,
}: {
  view: PlayerView;
  names: NameBook;
  hostId: PlayerId;
  isHost: boolean;
  online: PlayerId[];
  graceOver: boolean;
  busy: boolean;
  pending: string | null;
  onSetBot: (id: PlayerId, isBot: boolean) => void;
  onLeave: () => void;
}) {
  const you = view.youId;
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  const finished = view.phase === 'gameOver';
  const mine = view.players.find((p) => p.id === you);
  const { targetScore, maxRounds } = view.config;
  return (
    <div className="tp-scores">
      <table className="tp-scores__table">
        <caption className="tp-sr">Scores</caption>
        <thead className="tp-sr">
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Busts</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((p) => (
            <tr key={p.id} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
              <td className="tp-scores__dot">
                <span className="tp-dot" aria-hidden="true" />
              </td>
              <th scope="row" className="tp-scores__name">
                <span>{p.id === you ? 'You' : p.name}</span>
                {p.id === hostId ? <Icon name="crown" size={14} className="tp-scores__crown" title="host" /> : null}
                {p.isBot ? <span className="tp-tag">bot</span> : null}
              </th>
              <td className="tp-scores__busts">
                {p.busts} bust{p.busts === 1 ? '' : 's'}
              </td>
              <td className="tp-scores__pts">{num(p.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tp-scores__note">
        {targetScore !== null ? `First to ${targetScore}` : 'No target'}
        {maxRounds !== null ? `, ${maxRounds} round${maxRounds === 1 ? '' : 's'} max` : ', no round limit'}. Ties go to fewer busts; still tied, you share the win.
      </p>

      {view.results.length > 0 ? (
        <section className="tp-scores__sec">
          <h3 className="tp-h3">Rounds</h3>
          <ol className="tp-history">
            {[...view.results].reverse().map((r) => (
              <li key={r.round} className="tp-history__row">
                <span className="tp-history__r">R{r.round}</span>
                <span>
                  {historyText(r, names, you)}
                  {r.trapRewardTo ? ` · ${names.who(r.trapRewardTo)} +${view.config.trapReward}` : ''}
                </span>
                <span className={cx('tp-history__d', r.outcome === 'success' ? 'is-up' : 'is-down')}>{signed(r.outcome === 'success' ? r.target : -r.target)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="tp-scores__sec">
        <h3 className="tp-h3">Seats</h3>
        <ul className="tp-seatlist">
          {[...view.players]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => {
              const isYou = p.id === you;
              const on = isYou || online.includes(p.id);
              return (
                <li key={p.id} className="tp-seatlist__row" style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                  <span className="tp-dot" aria-hidden="true" />
                  <span className="tp-seatlist__name">
                    <strong>{isYou ? 'You' : p.name}</strong>
                    <span className="tp-muted tp-small">
                      {p.isBot ? (isYou ? 'a bot is playing for you' : 'bot') : on ? 'online' : graceOver ? 'offline' : 'connecting'}
                    </span>
                  </span>
                  {!finished && isHost && !isYou && !p.isBot ? (
                    <Button size="sm" variant={on ? 'secondary' : 'danger'} busy={pending === `bot:${p.id}`} disabled={busy} onClick={() => onSetBot(p.id, true)}>
                      Replace with bot
                    </Button>
                  ) : null}
                </li>
              );
            })}
        </ul>
      </section>

      <div className="tp-scores__foot">
        {!finished && mine ? (
          <Button variant="secondary" busy={pending === `bot:${mine.id}`} disabled={busy} onClick={() => onSetBot(mine.id, !mine.isBot)}>
            {mine.isBot ? 'Take my seat back' : 'Let a bot play for me'}
          </Button>
        ) : null}
        <Button variant="danger" icon={<Icon name="leave" size={18} />} onClick={onLeave}>
          Leave game
        </Button>
        <p className="tp-small tp-muted">A bot takes over your seat so the others can keep playing.</p>
      </div>
    </div>
  );
}
