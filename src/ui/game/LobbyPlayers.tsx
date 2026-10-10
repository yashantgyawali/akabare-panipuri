/** Lobby player list: avatar + name, host crown, bot icon, presence dot, host's remove and + bot. */
import { MAX_PLAYERS } from '../../engine/types.ts';
import type { LobbyPlayer } from '../../server/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import type { UseGame } from '../../net/useGame.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx, useRunner } from '../common/hooks.ts';

function PlayerRow({ p, game, online, graceOver }: { p: LobbyPlayer; game: UseGame; online: boolean; graceOver: boolean }) {
  const snap = game.snapshot!;
  const you = p.id === snap.youId;
  const host = p.id === snap.hostId;
  const { pending, run } = useRunner();
  return (
    <li className={cx('tp-lobby-row', you && 'tp-lobby-row--you')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
      <span className="tp-avatar" aria-hidden="true">
        {p.name.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="tp-lobby-row__name">{p.name}</span>
      {host ? (
        <span className="tp-lobby-row__icon" title="Host">
          <Icon name="crown" size={18} />
          <span className="tp-sr">host</span>
        </span>
      ) : null}
      {p.isBot ? (
        <span className="tp-lobby-row__icon" title="Bot">
          <Icon name="bot" size={18} />
          <span className="tp-sr">bot</span>
        </span>
      ) : (
        <span className={cx('tp-lobby-presence', online ? 'tp-lobby-presence--on' : graceOver && 'tp-lobby-presence--off')} title={online ? 'Online' : 'Offline'}>
          <span className="tp-sr">{online ? 'online' : 'offline'}</span>
        </span>
      )}
      {you && p.isBot ? (
        // A seat handed to a bot last game stays a bot through a rematch until you take it back.
        <Button size="sm" variant="primary" busy={pending === 'seat'} disabled={game.busy} onClick={() => void run('seat', () => game.setBot(p.id, false))}>
          Take seat
        </Button>
      ) : null}
      {game.isHost && !host ? (
        <IconButton label={`Remove ${p.name}`} className="tp-lobby-row__kick" disabled={game.busy} onClick={() => void run('kick', () => game.removePlayer(p.id))}>
          {pending === 'kick' ? <span className="tp-spinner" /> : <Icon name="close" size={18} />}
        </IconButton>
      ) : null}
    </li>
  );
}

export function PlayersColumn({ game, graceOver }: { game: UseGame; graceOver: boolean }) {
  const snap = game.snapshot!;
  const players = [...snap.players].sort((a, b) => a.seat - b.seat);
  const { pending, run } = useRunner();
  const isOnline = (id: string) => id === snap.youId || game.online.includes(id);
  return (
    <section className="tp-lobby-col" aria-label="Players">
      <ol className="tp-lobby-rows">
        {players.map((p) => (
          <PlayerRow key={p.id} p={p} game={game} online={isOnline(p.id)} graceOver={graceOver} />
        ))}
      </ol>
      {game.isHost && players.length < MAX_PLAYERS ? (
        <Button size="sm" className="tp-lobby-addbot" busy={pending === 'bot'} disabled={game.busy} onClick={() => void run('bot', game.addBot)}>
          + bot
        </Button>
      ) : null}
    </section>
  );
}
