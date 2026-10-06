/** Home: hero with the create form, a join-by-code row, recent tables and three fanned cards. */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { CODE_ALPHABET, CODE_LENGTH, MAX_NAME_LENGTH } from '../../server/types.ts';
import { createGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { Wordmark, LocalBadge } from '../common/Brand.tsx';
import { prefs } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { RULES, gameHref, navigate } from '../router.ts';
import { HeroFan } from './HeroFan.tsx';
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
      toast('Enter your name first.', 'error');
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
          Start a table
        </Button>
        <span className="tp-small tp-muted">Add bots if you’re short of friends.</span>
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
      <label className="tp-strong" htmlFor="home-code">
        Got a code?
      </label>
      <input
        id="home-code"
        className="tp-input tp-input--code"
        value={code}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="ABCDE"
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
        <header className="tp-header">
          <Wordmark />
          <a className="tp-link" href={RULES}>
            How to play
          </a>
        </header>
        <section className="tp-home-hero">
          <HeroFan />
          <div className="tp-home-hero__text">
            <div className="tp-home-titleblock">
              <span className="tp-eyebrow">a street-food bluffing game · 3–6 players</span>
              <h1 className="tp-h1">
                Akabare
                <br />
                Panipuri
              </h1>
              <span className="tp-nepali tp-home-nepali" lang="ne">
                अकबरे पानीपुरी
              </span>
            </div>
            <p className="tp-home-tag">Stack the puri. Bluff the bid. Don’t bite the chili.</p>
            <LocalBadge />
            <CreateForm />
            <JoinForm />
            <RecentGames />
          </div>
        </section>
        <footer className="tp-home-footer tp-small tp-muted">
          <span>Rules v0.6</span>
          <span aria-hidden="true">·</span>
          <span>Spreading playfulness, one puri at a time.</span>
          <span aria-hidden="true">·</span>
          <a className="tp-link" href="#/cards">
            The cards
          </a>
        </footer>
      </main>
    </div>
  );
}
