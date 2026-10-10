/** #/g/<CODE>: join → lobby → table, all driven by useGame(code). */
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { MAX_NAME_LENGTH } from '../../server/types.ts';
import { useGame, type UseGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { Wordmark } from '../common/Brand.tsx';
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
      return <Loading />;
    case 'error':
      return <GameError game={game} />;
    case 'needsJoin':
      return <JoinGame code={code} game={game} />;
    case 'ready': {
      const snap = game.snapshot;
      if (!snap) return <Loading />;
      if (snap.status === 'lobby') return <Lobby game={game} />;
      if (!snap.view) return <Loading />;
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

function Loading() {
  return (
    <Screen>
      <div className="tp-loading" role="status" aria-label="Loading">
        <span className="tp-spinner" aria-hidden="true" />
      </div>
    </Screen>
  );
}

function GameError({ game }: { game: UseGame }) {
  const missing = game.errorCode === 'not_found';
  const started = game.errorCode === 'wrong_status';
  return (
    <Screen>
      <section className="tp-center-card" aria-labelledby="err-h">
        <h1 className="tp-h1 tp-h1--md" id="err-h">
          {missing ? 'No table here' : started ? 'Game already started' : 'Can’t reach the table'}
        </h1>
        <div className="tp-join-actions">
          <a className="btn-cta red btn-cta--md" href={HOME}>
            Home
          </a>
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
      <section className="tp-join-card" aria-label="Join">
        <CodeTiles code={code} />
        {suggested ? (
          <Button variant="primary" size="md" block onClick={() => game.continueAs(suggested)}>
            Continue as {suggested.name}
          </Button>
        ) : null}
        <form onSubmit={submit} className="tp-join-form">
          <input
            className="tp-input"
            aria-label="Your name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            placeholder="Name"
            onChange={(e) => setName(e.target.value)}
            autoFocus={!suggested}
          />
          <ColorPicker value={color} onChange={setColor} size={32} />
          <Button type="submit" variant={suggested ? 'secondary' : 'primary'} size="md" block busy={game.busy} disabled={!trimmed}>
            Join
          </Button>
        </form>
      </section>
    </Screen>
  );
}
