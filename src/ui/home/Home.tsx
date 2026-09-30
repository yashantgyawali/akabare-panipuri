/** Home: hero, create a game, join with a code, recent games, how-to-play teaser. */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { COLORS, type ColorId } from '../../engine/types.ts';
import { Card } from '../../cards/index.ts';
import { CODE_ALPHABET, CODE_LENGTH, MAX_NAME_LENGTH } from '../../server/types.ts';
import { clearSession, listSessions, saveSession, type Session } from '../../net/index.ts';
import { createGame } from '../../net/useGame.ts';
import { Button } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { Icon } from '../common/Icon.tsx';
import { LocalBadge, Wordmark } from '../common/Brand.tsx';
import { prefs, usePhone } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { RULES, gameHref, navigate } from '../router.ts';

const isColor = (v: string | null): v is ColorId => !!v && (COLORS as readonly string[]).includes(v);

export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH);
}

function HeroFan() {
  const phone = usePhone();
  const w = phone ? 84 : 124;
  const cards: { back: 'puri' | 'power'; color: ColorId; face: 'panipuri' | 'akabare' | 'chaat' | 'dahi' | null; badge?: string }[] = [
    { back: 'power', color: 'blue', face: null, badge: 'S' },
    { back: 'puri', color: 'yellow', face: 'panipuri' },
    { back: 'puri', color: 'red', face: 'akabare' },
    { back: 'power', color: 'green', face: 'chaat' },
    { back: 'puri', color: 'purple', face: null, badge: 'P' },
  ];
  return (
    <div className="ak-hero__fan" aria-hidden="true" style={{ ['--w' as string]: `${w}px` }}>
      {cards.map((c, i) => (
        <div key={i} className="ak-hero__fancard" style={{ ['--i' as string]: i - 2 }}>
          <Card back={c.back} color={c.color} face={c.face} faceUp={!!c.face} badge={c.badge} width={w} decorative />
        </div>
      ))}
    </div>
  );
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
    <form className="ak-home__card ak-paper" onSubmit={submit}>
      <h2 className="ak-h2">Start a table</h2>
      <p className="ak-muted">You'll get a 5-letter code to share. Add bots if you're short of friends.</p>
      <label className="ak-field">
        <span className="ak-field__label">Your name</span>
        <input
          className="ak-input"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          placeholder="e.g. Sita"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="ak-field__hint">{MAX_NAME_LENGTH - name.length} characters left</span>
      </label>
      <div className="ak-field">
        <span className="ak-field__label" id="create-color">
          Your colour
        </span>
        <ColorPicker value={color} onChange={setColor} label="Your colour" />
      </div>
      <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={!trimmed}>
        Create a game
      </Button>
    </form>
  );
}

function JoinForm() {
  const [code, setCode] = useState('');
  const ready = code.length === CODE_LENGTH;
  return (
    <form
      className="ak-home__card ak-paper"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) navigate(gameHref(code));
      }}
    >
      <h2 className="ak-h2">Join with a code</h2>
      <p className="ak-muted">Someone shared a code or a link? Pop it in.</p>
      <label className="ak-field">
        <span className="ak-field__label">Game code</span>
        <input
          className="ak-input ak-input--code"
          value={code}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCDE"
          maxLength={CODE_LENGTH + 4}
          aria-describedby="join-hint"
          onChange={(e) => setCode(cleanCode(e.target.value))}
        />
        <span className="ak-field__hint" id="join-hint">
          {CODE_LENGTH} letters and numbers
        </span>
      </label>
      <Button type="submit" variant="secondary" size="lg" block disabled={!ready} icon={<Icon name="arrowRight" />}>
        Join the table
      </Button>
    </form>
  );
}

function RecentGames() {
  const [sessions, setSessions] = useState<Session[]>(() => listSessions());
  useEffect(() => {
    const on = () => setSessions(listSessions());
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  if (sessions.length === 0) return null;
  return (
    <section className="ak-home__recent ak-paper" aria-labelledby="recent-h">
      <h2 className="ak-h2" id="recent-h">
        Your recent games
      </h2>
      <ul className="ak-recent">
        {sessions.slice(0, 6).map((s) => (
          <li key={s.code} className="ak-recent__row">
            <span className="ak-recent__code">{s.code}</span>
            <span className="ak-recent__as">as {s.name}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                saveSession(s);
                navigate(gameHref(s.code));
              }}
            >
              Rejoin
            </Button>
            <button
              type="button"
              className="ak-linkbtn"
              onClick={() => {
                clearSession(s.code, s.playerId);
                setSessions(listSessions());
              }}
              aria-label={`Forget game ${s.code}`}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Teaser() {
  const steps = useMemo(
    () => [
      {
        n: '1',
        title: 'Stack',
        text: 'Hide 2 puri face down on your own stack, then take turns slipping cards onto anyone’s stack. One of yours is the Akabare chili.',
        card: { back: 'puri' as const, color: 'green' as ColorId, face: null, badge: 'A' },
      },
      {
        n: '2',
        title: 'Bid',
        text: 'Say how many Panipuri you’ll eat. Raise or pass. Only the highest bidder eats.',
        card: { back: 'puri' as const, color: 'yellow' as ColorId, face: 'panipuri' as const },
      },
      {
        n: '3',
        title: 'Eat',
        text: 'Flip your own stack, then dig into others’. Bite an Akabare without Dahi and you bust.',
        card: { back: 'puri' as const, color: 'red' as ColorId, face: 'akabare' as const },
      },
    ],
    [],
  );
  return (
    <section className="ak-teaser" aria-labelledby="teaser-h">
      <h2 className="ak-h2 ak-teaser__h" id="teaser-h">
        How to play, in three bites
      </h2>
      <ol className="ak-teaser__steps">
        {steps.map((s) => (
          <li key={s.n} className="ak-teaser__step">
            <Card back={s.card.back} color={s.card.color} face={s.card.face} badge={s.card.badge} width={64} decorative />
            <div>
              <h3 className="ak-teaser__title">
                <span className="ak-teaser__n">{s.n}</span> {s.title}
              </h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <a className="ak-btn ak-btn--ghost ak-btn--md" href={RULES}>
        <Icon name="book" />
        <span className="ak-btn__label">Read the full rules</span>
      </a>
    </section>
  );
}

export function Home() {
  useEffect(() => {
    document.title = 'Akabare Panipuri';
  }, []);
  return (
    <main className="ak-home">
      <section className="ak-hero">
        <div className="ak-hero__text">
          <p className="ak-hero__kicker">A street-food bluffing game · 3–6 players</p>
          <h1 className="ak-hero__title">
            <Wordmark size="xl" />
          </h1>
          <p className="ak-hero__tag">Stack the puri. Bluff the bid. Don’t bite the chili.</p>
          <LocalBadge />
        </div>
        <HeroFan />
      </section>
      <div className="ak-home__grid">
        <CreateForm />
        <JoinForm />
      </div>
      <RecentGames />
      <Teaser />
      <footer className="ak-footer">
        <a href={RULES}>Rules</a>
        <span aria-hidden="true">·</span>
        <a href="#/cards">The cards</a>
        <span aria-hidden="true">·</span>
        <span>Rules v0.6</span>
      </footer>
    </main>
  );
}
