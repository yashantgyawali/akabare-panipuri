/** Lobby: share the code, gather players (and bots), host sets the rules, then start. */
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { ConfirmDialog } from '../common/Drawer.tsx';
import { LocalBadge, Wordmark } from '../common/Brand.tsx';
import { useAfter, useRunner } from '../common/hooks.ts';
import { HOME, RULES, navigate } from '../router.ts';
import { PlayersColumn } from './LobbyPlayers.tsx';
import { RulesColumn } from './LobbyRules.tsx';
import { CodeTiles, ShareBlock } from './ShareBlock.tsx';

export { PRESETS } from './LobbyRules.tsx';
export { ShareBlock } from './ShareBlock.tsx';

export function Lobby({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const n = snap.players.length;
  const graceOver = useAfter(5000);
  const { pending, run } = useRunner();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const host = snap.players.find((p) => p.id === snap.hostId);
  const startReason =
    n < MIN_PLAYERS ? `Need at least ${MIN_PLAYERS} players (${n} so far). Add a bot or wait for friends.` : n > MAX_PLAYERS ? `At most ${MAX_PLAYERS} players.` : null;

  return (
    <main className="tp-page tp-lobby">
      <div className="tp-container">
        <header className="tp-header">
          <Wordmark link />
          <nav className="tp-lobby-nav" aria-label="Lobby">
            <a className="tp-link" href={RULES} target="_blank" rel="noreferrer">
              Rules
            </a>
            <button type="button" className="tp-link tp-link--quiet" onClick={() => setConfirmLeave(true)}>
              Leave
            </button>
          </nav>
        </header>

        <section className="tp-lobby-hero" aria-labelledby="lobby-h">
          <div className="tp-lobby-hero__code">
            <span className="tp-eyebrow" id="lobby-h">
              your table code
            </span>
            <CodeTiles code={snap.code} />
          </div>
          <ShareBlock code={snap.code} />
        </section>
        <LocalBadge />

        <div className="tp-lobby-grid">
          <PlayersColumn game={game} graceOver={graceOver} />
          <RulesColumn game={game} />
        </div>

        <section className="tp-lobby-start" aria-live="polite">
          {game.isHost ? (
            <>
              <button type="button" className="btn-cta red tp-lobby-start__cta" disabled={!!startReason || game.busy || pending === 'start'} aria-busy={pending === 'start' || undefined} onClick={() => void run('start', game.start)}>
                {pending === 'start' ? <span className="tp-spinner" aria-hidden="true" /> : null}
                Start the game
              </button>
              <span className="tp-lobby-start__reason">{startReason ?? 'Everyone’s here? Let’s eat.'}</span>
            </>
          ) : (
            <span className="tp-lobby-waiting">
              Waiting for {host ? host.name : 'the host'} to start the game…
            </span>
          )}
        </section>
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
      >
        <p>{game.isHost ? 'Someone else will become the host.' : 'You can join again with the code while the game is in the lobby.'}</p>
      </ConfirmDialog>
    </main>
  );
}
