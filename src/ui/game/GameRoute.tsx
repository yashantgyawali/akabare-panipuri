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

function Screen({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={wide ? 'ak-screen ak-screen--wide' : 'ak-screen'}>
      <header className="ak-screen__top">
        <Wordmark size="sm" link />
      </header>
      {children}
    </main>
  );
}

function Loading({ code }: { code: string }) {
  return (
    <Screen>
      <div className="ak-loading" role="status">
        <span className="ak-loading__puri" aria-hidden="true" />
        <p>
          Setting the table for <strong>{code}</strong>…
        </p>
      </div>
    </Screen>
  );
}

function GameError({ code, game }: { code: string; game: UseGame }) {
  const missing = game.errorCode === 'not_found';
  return (
    <Screen>
      <section className="ak-panel ak-paper ak-center-panel" aria-labelledby="err-h">
        <h1 className="ak-h1" id="err-h">
          {missing ? 'No table here' : 'Something went wrong'}
        </h1>
        <p>
          {missing ? (
            <>
              We couldn’t find game <strong>{code}</strong>. The code may be mistyped, or the game has ended and been cleared away.
            </>
          ) : (
            <>We couldn’t reach the table ({game.error ?? 'unknown error'}). Check your connection and try again.</>
          )}
        </p>
        <div className="ak-row">
          <a className="ak-btn ak-btn--primary ak-btn--md" href={HOME}>
            <span className="ak-btn__label">Back home</span>
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
      <section className="ak-join ak-paper" aria-labelledby="join-h">
        <p className="ak-kicker">You’re invited to table</p>
        <h1 className="ak-join__code" id="join-h">
          {code}
        </h1>
        {suggested ? (
          <div className="ak-join__suggest">
            <p>
              This browser already has a seat here as <strong>{suggested.name}</strong> (another tab, or an earlier visit).
            </p>
            <Button variant="primary" size="lg" block onClick={() => game.continueAs(suggested)}>
              Continue as {suggested.name}
            </Button>
            <p className="ak-join__or">
              <span>or join as a new player</span>
            </p>
          </div>
        ) : null}
        <form onSubmit={submit} className="ak-join__form">
          <label className="ak-field">
            <span className="ak-field__label">Your name</span>
            <input
              className="ak-input"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              placeholder="e.g. Ramesh"
              onChange={(e) => setName(e.target.value)}
              autoFocus={!suggested}
            />
          </label>
          <div className="ak-field">
            <span className="ak-field__label">Your colour</span>
            <ColorPicker value={color} onChange={setColor} />
            <span className="ak-field__hint">Pick one, or leave it and we’ll give you a free colour.</span>
          </div>
          <Button type="submit" variant={suggested ? 'secondary' : 'primary'} size="lg" block busy={game.busy} disabled={!trimmed}>
            {suggested ? 'Join as a new player' : 'Join the table'}
          </Button>
        </form>
        <LocalBadge />
      </section>
    </Screen>
  );
}
