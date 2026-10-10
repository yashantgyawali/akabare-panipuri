/** Home: title, name + colour, Start, join by code, recent tables. */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { CODE_ALPHABET, CODE_LENGTH, MAX_NAME_LENGTH } from '../../server/types.ts';
import { createGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { LocalBadge } from '../common/Brand.tsx';
import { prefs } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { RULES, gameHref, navigate } from '../router.ts';
import { RecentGames } from './Recent.tsx';

const isColor = (v: string | null): v is ColorId => !!v && (COLORS as readonly string[]).includes(v);

export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH);
}

function CreateForm() {
  const toast = useToast();
  const [name, setName] = useState(() => prefs.get('name') ?? '');
  const [color, setColor] = useState<ColorId | null>(() => {
    const c = prefs.get('color');
    return isColor(c) ? c : 'red';
  });
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      toast('Enter a name', 'error');
      return;
    }
    setBusy(true);
    prefs.set('name', trimmed);
    if (color) prefs.set('color', color);
    try {
      const { session } = await createGame(trimmed, color ?? undefined);
      navigate(gameHref(session.code));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the game.', 'error');
      setBusy(false);
    }
  };
  return (
    <form className="tp-home-create" onSubmit={submit}>
      <div className="tp-home-create__row">
        <label className="tp-sr" htmlFor="home-name">
          Your name
        </label>
        <input
          id="home-name"
          className="tp-input tp-home-name"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
        />
        <ColorPicker value={color} onChange={setColor} label="Your colour" />
      </div>
      <div className="tp-home-create__cta">
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!trimmed}>
          Start
        </Button>
      </div>
    </form>
  );
}

function JoinForm() {
  const [code, setCode] = useState('');
  const ready = code.length === CODE_LENGTH;
  return (
    <form
      className="tp-home-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) navigate(gameHref(code));
      }}
    >
      <label className="tp-sr" htmlFor="home-code">
        Game code
      </label>
      <input
        id="home-code"
        className="tp-input tp-input--code"
        value={code}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="Code"
        maxLength={CODE_LENGTH + 4}
        onChange={(e) => setCode(cleanCode(e.target.value))}
      />
      <Button type="submit" variant="secondary" disabled={!ready}>
        Join
      </Button>
    </form>
  );
}

export function Home() {
  useEffect(() => {
    document.title = 'Akabare Panipuri';
  }, []);
  return (
    <div className="tp-page">
      <main className="tp-container tp-home">
        <a className="tp-link tp-home-rules" href={RULES}>
          Rules
        </a>
        <div className="tp-home-main">
          <h1 className="tp-h1">
            Akabare
            <br />
            Panipuri
          </h1>
          <LocalBadge className="tp-home-badge" />
          <CreateForm />
          <JoinForm />
          <RecentGames />
        </div>
      </main>
    </div>
  );
}
