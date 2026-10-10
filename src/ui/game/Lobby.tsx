/** Lobby: code, invite link, players (and bots), host's presets and Start. */
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { ConfirmDialog } from '../common/Drawer.tsx';
import { LocalBadge, Wordmark } from '../common/Brand.tsx';
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
    <main className="tp-page tp-lobby">
      <div className="tp-container">
        <header className="tp-header">
          <Wordmark link />
          <button type="button" className="tp-link tp-link--quiet tp-lobby-leave" onClick={() => setConfirmLeave(true)}>
            Leave
          </button>
        </header>

        <div className="tp-lobby-body">
          <div className="tp-lobby-codebar">
            <CodeTiles code={snap.code} />
            <CopyLink code={snap.code} />
          </div>
          <LocalBadge />

          <PlayersColumn game={game} graceOver={graceOver} />
          {game.isHost ? <Presets game={game} /> : null}

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
        </div>
      </div>

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
    </main>
  );
}
