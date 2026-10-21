/**
 * Lobby: glass panels over the tavern table (seen from your seat, with everyone
 * who has joined sitting at it): the code and invite link, the players (and
 * bots), the host's presets and Start.
 */
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { ConfirmDialog } from '../common/Drawer.tsx';
import { LocalBadge } from '../common/Brand.tsx';
import { TavernTitle } from '../tavern/TavernTitle.tsx';
import { useAfter, useRunner } from '../common/hooks.ts';
import { HOME, navigate } from '../router.ts';
import { PlayersColumn } from './LobbyPlayers.tsx';
import { Presets } from './LobbyRules.tsx';
import { CodeTiles, CopyLink } from './ShareBlock.tsx';

export function Lobby({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const n = snap.players.length;
  const graceOver = useAfter(5000);
  const { pending, run } = useRunner();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const startReason = n < MIN_PLAYERS ? `Need ${MIN_PLAYERS} players` : n > MAX_PLAYERS ? `At most ${MAX_PLAYERS} players` : null;

  return (
    <>
      <header className="tv-lobby__top">
        <a href={HOME} className="tv-chip tv-lobby__home" aria-label="Akabare Panipuri: home">
          <TavernTitle size="sm" as="div" />
        </a>
        <button type="button" className="tv-chip" onClick={() => setConfirmLeave(true)}>
          Leave
        </button>
      </header>

      <main className="tv-lobby" aria-labelledby="lobby-h">
        <h1 className="tp-sr" id="lobby-h">
          Lobby {snap.code}
        </h1>
        <div className="tv-glass tv-lobby__code">
          <CodeTiles code={snap.code} />
          <CopyLink code={snap.code} />
        </div>

        <section className="tv-glass tv-lobby__panel" aria-label="Players">
        <LocalBadge className="tv-lobby__badge" />
        <PlayersColumn game={game} graceOver={graceOver} />
        <Presets game={game} />
        <div className="tp-lobby-start" aria-live="polite">
          {game.isHost ? (
            <button
              type="button"
              className="btn-cta red tp-lobby-start__cta"
              disabled={!!startReason || game.busy || pending === 'start'}
              aria-busy={pending === 'start' || undefined}
              aria-label={startReason ?? 'Start'}
              title={startReason ?? undefined}
              onClick={() => void run('start', game.start)}
            >
              {pending === 'start' ? <span className="tp-spinner" aria-hidden="true" /> : null}
              Start
            </button>
          ) : (
            <span className="tp-lobby-waiting">Waiting for host</span>
          )}
        </div>
        </section>
      </main>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave the table?"
        confirmLabel="Leave"
        danger
        busy={pending === 'leave'}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() =>
          void run('leave', async () => {
            const ok = await game.leave();
            setConfirmLeave(false);
            if (ok) navigate(HOME);
          })
        }
      />
    </>
  );
}
