/** #/g/<CODE>: join → lobby → table, all driven by useGame(code). */
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { MAX_NAME_LENGTH } from '../../server/types.ts';
import { useGame, type UseGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { LocalBadge, Wordmark } from '../common/Brand.tsx';
import { prefs } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { HOME } from '../router.ts';
import { Lobby } from './Lobby.tsx';
import { CodeTiles } from './ShareBlock.tsx';
import { Table } from '../table/Table.tsx';

const isColor = (v: string | null): v is ColorId => !!v && (COLORS as readonly string[]).includes(v);

export function GameRoute({ code }: { code: string }) {
  const game = useGame(code);
  const toast = useToast();
  const { actionError, clearActionError } = game;

  useEffect(() => {
    if (!actionError) return;
    toast(actionError.message, 'error');
    clearActionError();
  }, [actionError, clearActionError, toast]);

  useEffect(() => {
    document.title = `${code} · Akabare Panipuri`;
  }, [code]);

  switch (game.status) {
    case 'idle':
    case 'loading':
      return <Loading code={code} />;
    case 'error':
      return <GameError code={code} game={game} />;
    case 'needsJoin':
      return <JoinGame code={code} game={game} />;
    case 'ready': {
      const snap = game.snapshot;
      if (!snap) return <Loading code={code} />;
      if (snap.status === 'lobby') return <Lobby game={game} />;
      if (!snap.view) return <Loading code={code} />;
      return <Table key={`${snap.code}:${snap.youId}`} game={game} />;
    }
  }
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="tp-page">
      <div className="tp-container">
        <header className="tp-header">
          <Wordmark link />
        </header>
        {children}
      </div>
    </main>
  );
}

function Loading({ code }: { code: string }) {
  return (
    <Screen>
      <div className="tp-loading" role="status">
        <span className="tp-spinner" aria-hidden="true" />
        <p>
          Setting the table for <strong>{code}</strong>…
        </p>
      </div>
    </Screen>
  );
}

function GameError({ code, game }: { code: string; game: UseGame }) {
  const missing = game.errorCode === 'not_found';
  const started = game.errorCode === 'wrong_status';
  return (
    <Screen>
      <section className="tp-center-card" aria-labelledby="err-h">
        <span className="tp-eyebrow">{missing ? 'hmm…' : started ? 'too late' : 'oh no'}</span>
        <h1 className="tp-h1 tp-h1--md" id="err-h">
          {missing ? 'No table here' : started ? 'This game already started' : 'Something went wrong'}
        </h1>
        <p>
          {missing ? (
            <>
              We couldn’t find game <strong>{code}</strong>. The code may be mistyped, or the game has ended and been cleared away.
            </>
          ) : started ? (
            <>Game <strong>{code}</strong> is already under way, so new players can’t sit down now.</>
          ) : (
            <>We couldn’t reach the table ({game.error ?? 'unknown error'}). Check your connection and try again.</>
          )}
        </p>
        <div className="tp-join-actions">
          <a className="btn-cta red btn-cta--md" href={HOME}>
            ← Home
          </a>
          {!missing ? (
            <Button variant="ghost" onClick={game.refresh}>
              Try again
            </Button>
          ) : null}
        </div>
      </section>
    </Screen>
  );
}

function JoinGame({ code, game }: { code: string; game: UseGame }) {
  const suggested = game.suggestedSession;
  // With a seat already in this browser, a second player is joining from another tab:
  // don't prefill the first player's name and colour.
  const [name, setName] = useState(() => {
    const n = prefs.get('name') ?? '';
    return suggested && n.trim() === suggested.name ? '' : n;
  });
  const [color, setColor] = useState<ColorId | null>(() => {
    const c = prefs.get('color');
    return !suggested && isColor(c) ? c : null;
  });
  const trimmed = name.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    prefs.set('name', trimmed);
    if (color) prefs.set('color', color);
    await game.join(trimmed, color ?? undefined);
  };
  return (
    <Screen>
      <section className="tp-join-card" aria-labelledby="join-h">
        <span className="tp-eyebrow" id="join-h">
          you’re invited to table
        </span>
        <CodeTiles code={code} />
        {suggested ? (
          <div className="tp-join-suggest">
            <p>
              This browser already has a seat here as <strong>{suggested.name}</strong> (another tab, or an earlier visit).
            </p>
            <Button variant="primary" size="md" block onClick={() => game.continueAs(suggested)}>
              Continue as {suggested.name}
            </Button>
            <p className="tp-join-or">or join as a new player</p>
          </div>
        ) : null}
        <form onSubmit={submit} className="tp-join-form">
          <label className="tp-field">
            <span className="tp-label">Your name</span>
            <input
              className="tp-input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              placeholder="e.g. Ramesh"
              onChange={(e) => setName(e.target.value)}
              autoFocus={!suggested}
            />
          </label>
          <div className="tp-field">
            <span className="tp-label">Your colour</span>
            <ColorPicker value={color} onChange={setColor} size={32} />
            <span className="tp-field__hint">Pick one, or leave it and we’ll give you a free colour.</span>
          </div>
          <Button type="submit" variant={suggested ? 'secondary' : 'primary'} size={suggested ? 'lg' : 'md'} block busy={game.busy} disabled={!trimmed}>
            {suggested ? 'Join as a new player' : 'Join the table'}
          </Button>
        </form>
        <LocalBadge />
      </section>
    </Screen>
  );
}
