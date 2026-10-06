/** Lobby left column: the seat list, the host's "add a bot", and your own name + colour. */
import { useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, type ColorId } from '../../engine/types.ts';
import { MAX_NAME_LENGTH, type LobbyPlayer } from '../../server/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import type { UseGame } from '../../net/useGame.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx, prefs, useRunner } from '../common/hooks.ts';

function PlayerRow({ p, game, online, graceOver }: { p: LobbyPlayer; game: UseGame; online: boolean; graceOver: boolean }) {
  const snap = game.snapshot!;
  const you = p.id === snap.youId;
  const host = p.id === snap.hostId;
  const { pending, run } = useRunner();
  const hex = PLAYER_PALETTE[p.color].base;
  return (
    <li className={cx('tp-lobby-row', you && 'tp-lobby-row--you')} style={{ ['--c' as string]: hex }}>
      <span className="tp-lobby-row__seat tp-num" aria-hidden="true">
        {p.seat + 1}
      </span>
      <span className="tp-avatar" aria-hidden="true">
        {p.name.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="tp-lobby-row__name">{p.name}</span>
      <span className="tp-lobby-row__tags">
        {you ? <span className="tp-tag tp-tag--beige">you</span> : null}
        {host ? (
          <span className="tp-tag tp-tag--yellow" title="Host">
            host
          </span>
        ) : null}
        {p.isBot ? <span className="tp-tag">bot</span> : null}
      </span>
      {!p.isBot ? (
        <span
          className={cx('tp-lobby-presence', online ? 'tp-lobby-presence--on' : graceOver && 'tp-lobby-presence--off')}
          title={online ? 'Online' : 'Offline'}
        >
          <span className="tp-sr">{online ? 'online' : 'offline'}</span>
        </span>
      ) : null}
      {game.isHost && !host ? (
        <IconButton label={`Remove ${p.name}`} className="tp-lobby-row__kick" disabled={game.busy} onClick={() => void run('kick', () => game.removePlayer(p.id))}>
          {pending === 'kick' ? <span className="tp-spinner" /> : <Icon name="close" size={18} />}
        </IconButton>
      ) : null}
    </li>
  );
}

function YouEditor({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const me = snap.players.find((p) => p.id === snap.youId)!;
  const [name, setName] = useState(me.name);
  useEffect(() => setName(me.name), [me.name]);
  const { pending, run } = useRunner();
  const taken: Partial<Record<ColorId, string>> = {};
  for (const p of snap.players) if (p.id !== me.id) taken[p.color] = p.name;
  const saveName = () => {
    const n = name.trim();
    if (!n || n === me.name) {
      setName(me.name);
      return;
    }
    prefs.set('name', n);
    void run('name', () => game.updateLobby({ name: n }));
  };
  return (
    <section className="tp-lobby-you" aria-labelledby="you-h">
      <h3 className="tp-label" id="you-h">
        You
      </h3>
      {me.isBot ? (
        // A seat handed to a bot last game stays a bot through a rematch until you take it back.
        <div className="tp-panel tp-lobby-botseat" role="status">
          <span>A bot will play your seat.</span>
          <Button size="sm" variant="primary" busy={pending === 'seat'} disabled={game.busy} onClick={() => void run('seat', () => game.setBot(me.id, false))}>
            Take my seat back
          </Button>
        </div>
      ) : null}
      <form
        className="tp-lobby-you__form"
        onSubmit={(e) => {
          e.preventDefault();
          saveName();
        }}
      >
        <input
          className="tp-input"
          aria-labelledby="you-h"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
        <ColorPicker
          value={me.color}
          taken={taken}
          disabled={game.busy}
          size={28}
          onChange={(c) => {
            prefs.set('color', c);
            void run('color', () => game.updateLobby({ color: c }));
          }}
        />
        {pending === 'name' ? <span className="tp-spinner" aria-label="Saving" /> : null}
      </form>
    </section>
  );
}

export function PlayersColumn({ game, graceOver }: { game: UseGame; graceOver: boolean }) {
  const snap = game.snapshot!;
  const players = [...snap.players].sort((a, b) => a.seat - b.seat);
  const n = players.length;
  const { pending, run } = useRunner();
  const isOnline = (id: string) => id === snap.youId || game.online.includes(id);
  return (
    <section className="tp-lobby-col" aria-labelledby="players-h">
      <div className="tp-lobby-col__head">
        <h2 className="tp-h2" id="players-h">
          Players{' '}
          <span className="tp-muted" style={{ fontWeight: 600 }}>
            {n}/{MAX_PLAYERS}
          </span>
        </h2>
        {game.isHost && n < MAX_PLAYERS ? (
          <Button size="sm" busy={pending === 'bot'} disabled={game.busy} onClick={() => void run('bot', game.addBot)}>
            + Add a bot
          </Button>
        ) : null}
      </div>
      <ol className="tp-lobby-rows">
        {players.map((p) => (
          <PlayerRow key={p.id} p={p} game={game} online={isOnline(p.id)} graceOver={graceOver} />
        ))}
        {Array.from({ length: Math.max(0, MIN_PLAYERS - n) }, (_, i) => (
          <li key={`empty-${i}`} className="tp-lobby-row tp-lobby-row--empty">
            <span className="tp-lobby-row__seat tp-num" aria-hidden="true">
              {n + i + 1}
            </span>
            <span className="tp-lobby-row__name">Waiting for a player…</span>
          </li>
        ))}
      </ol>
      <p className="tp-small tp-muted">Seats go clockwise in this order. The first server is picked at random.</p>
      <YouEditor game={game} />
    </section>
  );
}
