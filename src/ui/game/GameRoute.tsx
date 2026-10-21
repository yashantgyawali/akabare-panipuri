/**
 * #/g/<CODE>: join → lobby → table, all driven by useGame(code). Everything
 * before the table happens in the tavern: one live backdrop stays mounted
 * through loading, joining and the lobby (where the camera takes your seat).
 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { MAX_NAME_LENGTH } from '../../server/types.ts';
import { useGame, type UseGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { TavernBackdrop, type Guest } from '../tavern/TavernBackdrop.tsx';
import { TavernTitle } from '../tavern/TavernTitle.tsx';
import { castWith } from '../tavern/cast.ts';
import { MIN_PLAYERS } from '../../engine/types.ts';
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

  const snap = game.status === 'ready' ? game.snapshot : null;
  const lobby = snap?.status === 'lobby' ? snap : null;
  // Lobby: everyone at the table in seat order, starting from you (the camera's seat).
  const seated = useMemo<Guest[] | null>(() => {
    if (!lobby) return null;
    const bySeat = [...lobby.players].sort((a, b) => a.seat - b.seat);
    const at = Math.max(0, bySeat.findIndex((p) => p.id === lobby.youId));
    return [...bySeat.slice(at), ...bySeat.slice(0, at)].map((p) => ({ id: p.id, name: p.name, color: p.color, seat: p.seat, you: p.id === lobby.youId }));
  }, [lobby]);
  const regulars = useMemo(() => castWith(null), []);

  if (snap && snap.status !== 'lobby' && snap.view) return <Table key={`${snap.code}:${snap.youId}`} game={game} />;

  let content;
  switch (game.status) {
    case 'idle':
    case 'loading':
      content = <Loading />;
      break;
    case 'error':
      content = <GameError game={game} />;
      break;
    case 'needsJoin':
      content = <JoinGame code={code} game={game} />;
      break;
    case 'ready':
      content = lobby ? <Lobby game={game} /> : <Loading />;
      break;
  }
  return (
    <div className={`tv-page tv-screen${lobby ? ' tv-screen--lobby' : ''}`}>
      <TavernBackdrop mode={seated ? 'seat' : 'orbit'} guests={seated ?? regulars} labels={!!seated} slots={seated ? Math.max(MIN_PLAYERS + 1, seated.length) : 0} />
      {content}
    </div>
  );
}

/** A centred glass card over the tavern, with the title linking home. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="tv-screen__center">
      <a href={HOME} className="tv-screen__home" aria-label="Akabare Panipuri: home">
        <TavernTitle size="sm" as="div" />
      </a>
      {children}
    </main>
  );
}

function Loading() {
  return (
    <Screen>
      <div className="tv-glass tv-card tv-card--loading" role="status" aria-label="Loading">
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
      <section className="tv-glass tv-card" aria-labelledby="err-h">
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
      <section className="tv-glass tv-card tp-join-card" aria-label="Join">
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
