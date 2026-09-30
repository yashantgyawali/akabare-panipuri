/** Table chrome: header bar, menu, banners, and the log / scores drawers. */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { GameEvent, PlayerId, PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { shareUrl } from '../../net/index.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { Wordmark } from '../common/Brand.tsx';
import { copyText, cx } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { PHASE_LABELS, describeEvent, num, roundText, signed, type NameBook } from '../text.ts';

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
    case 'roundEnd':
      return 'Round over';
    case 'gameOver':
      return 'Game over';
  }
}

export function TableHeader({
  view,
  names,
  code,
  phone,
  onOpen,
  onLeave,
}: {
  view: PlayerView;
  names: NameBook;
  code: string;
  phone: boolean;
  onOpen: (d: Exclude<DrawerName, null>) => void;
  onLeave: () => void;
}) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setMenu(false);
        return;
      }
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  const copy = async () => {
    const ok = await copyText(shareUrl(code));
    toast(ok ? 'Invite link copied.' : shareUrl(code), ok ? 'good' : 'info');
    setMenu(false);
  };
  const turn = turnText(view, names);
  const yourTurn = turn.startsWith('Your turn') || turn === 'Set up your stack';
  const goal = view.config.targetScore !== null ? `to ${view.config.targetScore}` : 'no target';
  return (
    <header className="ak-thead">
      <div className="ak-thead__brand">
        <Wordmark size="sm" link />
      </div>
      <div className="ak-thead__round">
        <span className="ak-thead__r">{roundText(view.round, view.config, phone)}</span>
        <span className="ak-thead__goal">{goal}</span>
      </div>
      <div className={cx('ak-thead__phase', yourTurn && 'is-you')} aria-live="polite">
        <span className="ak-thead__phasename">{PHASE_LABELS[view.phase]}</span>
        <span className="ak-thead__turn">{turn}</span>
      </div>
      <div className="ak-thead__tools">
        {!phone ? (
          <button type="button" className="ak-codechip" onClick={copy} title="Copy invite link" aria-label={`Game code ${code}: copy invite link`}>
            {code}
            <Icon name="copy" size={15} />
          </button>
        ) : null}
        {!phone ? (
          <IconButton label="Rules" onClick={() => onOpen('rules')}>
            <Icon name="book" />
          </IconButton>
        ) : null}
        <IconButton label="Game log" onClick={() => onOpen('log')}>
          <Icon name="scroll" />
        </IconButton>
        <IconButton label="Scores and players" onClick={() => onOpen('scores')}>
          <Icon name="trophy" />
        </IconButton>
        <div className="ak-menu" ref={menuRef}>
          <IconButton label="Menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="dots" />
          </IconButton>
          {menu ? (
            <div className="ak-menu__list ak-paper" role="menu">
              {phone ? (
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onOpen('rules'))}>
                  <Icon name="book" size={18} /> Rules
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={copy}>
                <Icon name="copy" size={18} /> Copy invite link ({code})
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onOpen('scores'))}>
                <Icon name="users" size={18} /> Players &amp; seats
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => (setMenu(false), onLeave())}>
                <Icon name="leave" size={18} /> Leave game
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function LogList({ log, names, trapReward }: { log: GameEvent[]; names: NameBook; trapReward: number }) {
  const items = [...log].reverse();
  const rows: JSX.Element[] = [];
  let round = -1;
  for (const e of items) {
    if (e.round !== round) {
      round = e.round;
      rows.push(
        <li key={`r${e.round}-${e.seq}`} className="ak-log__round" aria-hidden="true">
          Round {e.round}
        </li>,
      );
    }
    const line = describeEvent(e, names, trapReward);
    rows.push(
      <li key={e.seq} className={cx('ak-log__item', `ak-log__item--${line.tone}`)}>
        <span className="ak-log__dot" style={{ background: line.actor ? PLAYER_PALETTE[names.color(line.actor)].base : 'transparent' }} aria-hidden="true" />
        <span>{line.text}</span>
      </li>,
    );
  }
  return (
    <ol className="ak-log" aria-label="Newest first">
      {rows}
      {items.length === 0 ? <li className="ak-muted">Nothing has happened yet.</li> : null}
    </ol>
  );
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
  return (
    <div className="ak-scores">
      <table className="ak-scoretable">
        <caption className="ak-sr">Scores</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Points</th>
            <th scope="col">Busts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((p) => (
            <tr key={p.id} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
              <th scope="row">
                <span className="ak-deltas__chip" aria-hidden="true">
                  {names.initial(p.id)}
                </span>
                {p.id === you ? 'You' : p.name}
                {p.id === hostId ? <Icon name="crown" size={14} className="ak-scoretable__crown" title="host" /> : null}
                {p.isBot ? <span className="ak-tag ak-tag--bot">bot</span> : null}
              </th>
              <td className="ak-scoretable__pts">{num(p.score)}</td>
              <td>{p.busts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ak-small ak-muted">
        Ties go to fewer busts; still tied, you share the win.{' '}
        {view.config.targetScore !== null ? `First to ${view.config.targetScore}` : 'No target'}
        {view.config.maxRounds !== null ? ` · ${view.config.maxRounds} rounds max.` : ' · no round limit.'}
      </p>

      {view.results.length > 0 ? (
        <>
          <h3 className="ak-h3">Rounds</h3>
          <ol className="ak-history">
            {[...view.results].reverse().map((r) => (
              <li key={r.round} className={cx('ak-history__row', r.outcome === 'success' ? 'is-success' : 'is-bust')}>
                <span className="ak-history__r">R{r.round}</span>
                <span className="ak-history__what">
                  {names.who(r.eaterId)} {r.outcome === 'success' ? `ate ${r.target}` : r.bustReason === 'emptyTable' ? `ran out (${r.eaten}/${r.target})` : `bit ${r.akabareOwnerId === r.eaterId ? (r.eaterId === you ? 'your own' : 'their own') : names.whose(r.akabareOwnerId)} Akabare`}
                  {r.trapRewardTo ? ` · ${names.who(r.trapRewardTo)} +${view.config.trapReward}` : ''}
                </span>
                <span className="ak-history__d">{signed(r.outcome === 'success' ? r.target : -r.target)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <h3 className="ak-h3">Seats</h3>
      <ul className="ak-seatlist">
        {[...view.players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => {
            const isYou = p.id === you;
            const on = isYou || online.includes(p.id);
            return (
              <li key={p.id} className="ak-seatlist__row" style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                <span className="ak-deltas__chip" aria-hidden="true">
                  {names.initial(p.id)}
                </span>
                <span className="ak-seatlist__name">
                  {isYou ? 'You' : p.name}
                  <span className="ak-muted ak-small">
                    {p.isBot ? (isYou ? ' · a bot is playing for you' : ' · bot') : on ? ' · online' : graceOver ? ' · offline' : ''}
                  </span>
                </span>
                {!finished && isYou && p.isBot ? (
                  <Button size="sm" variant="primary" busy={pending === `bot:${p.id}`} disabled={busy} onClick={() => onSetBot(p.id, false)}>
                    Take my seat back
                  </Button>
                ) : !finished && isHost && !isYou && !p.isBot ? (
                  <Button size="sm" variant={on ? 'ghost' : 'secondary'} busy={pending === `bot:${p.id}`} disabled={busy} onClick={() => onSetBot(p.id, true)}>
                    Replace with bot
                  </Button>
                ) : !finished && isYou && !p.isBot ? (
                  <Button size="sm" variant="ghost" busy={pending === `bot:${p.id}`} disabled={busy} onClick={() => onSetBot(p.id, true)}>
                    Let a bot play for me
                  </Button>
                ) : null}
              </li>
            );
          })}
      </ul>
      <div className="ak-scores__leave">
        <Button variant="danger" icon={<Icon name="leave" size={18} />} onClick={onLeave}>
          Leave game
        </Button>
        <p className="ak-small ak-muted">A bot takes over your seat so the others can keep playing.</p>
      </div>
    </div>
  );
}
