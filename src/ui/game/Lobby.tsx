/** Lobby: share the code, gather players (and bots), host sets the rules, then start. */
import { useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, type ColorId, type GameConfig } from '../../engine/types.ts';
import { MAX_NAME_LENGTH, type LobbyPlayer } from '../../server/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { shareUrl } from '../../net/index.ts';
import type { UseGame } from '../../net/useGame.ts';
import { Button, IconButton } from '../common/Button.tsx';
import { ColorPicker } from '../common/ColorPicker.tsx';
import { ConfirmDialog } from '../common/Drawer.tsx';
import { Icon } from '../common/Icon.tsx';
import { LocalBadge, Wordmark } from '../common/Brand.tsx';
import { copyText, cx, prefs, useAfter, useRunner } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { HOME, RULES, navigate } from '../router.ts';
import { goalText } from '../text.ts';

export const PRESETS: { id: string; label: string; sub: string; config: Pick<GameConfig, 'targetScore' | 'maxRounds' | 'trapReward'> }[] = [
  { id: 'classic', label: 'Classic v0.6', sub: '30 pts or 5 rounds', config: { targetScore: 30, maxRounds: 5, trapReward: 2 } },
  { id: 'quick', label: 'Quick', sub: 'First to 15, no round limit', config: { targetScore: 15, maxRounds: null, trapReward: 2 } },
  { id: 'marathon', label: 'Marathon', sub: '30 pts, no round limit', config: { targetScore: 30, maxRounds: null, trapReward: 2 } },
];

export function ShareBlock({ code, compact }: { code: string; compact?: boolean }) {
  const toast = useToast();
  const url = shareUrl(code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? 'Invite link copied.' : `Couldn’t copy. The link is ${url}`, ok ? 'good' : 'error');
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Akabare Panipuri', text: `Join my Akabare Panipuri table: ${code}`, url });
    } catch {
      // cancelled
    }
  };
  return (
    <div className={cx('ak-share', compact && 'ak-share--compact')}>
      <div className="ak-share__code" aria-label={`Game code ${code.split('').join(' ')}`}>
        {code.split('').map((ch, i) => (
          <span key={i} className="ak-share__ch" aria-hidden="true">
            {ch}
          </span>
        ))}
      </div>
      <div className="ak-share__actions">
        <Button variant="secondary" size="sm" onClick={copy} icon={<Icon name="copy" size={18} />}>
          Copy link
        </Button>
        {canShare ? (
          <Button variant="secondary" size="sm" onClick={share} icon={<Icon name="share" size={18} />}>
            Share
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PlayerRow({
  p,
  game,
  online,
  graceOver,
}: {
  p: LobbyPlayer;
  game: UseGame;
  online: boolean;
  graceOver: boolean;
}) {
  const snap = game.snapshot!;
  const you = p.id === snap.youId;
  const host = p.id === snap.hostId;
  const { pending, run } = useRunner();
  return (
    <li className={cx('ak-lplayer', you && 'ak-lplayer--you')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
      <span className="ak-lplayer__seat" aria-hidden="true">
        {p.seat + 1}
      </span>
      <span className="ak-lplayer__chip" aria-hidden="true">
        {p.name.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="ak-lplayer__name">
        {p.name}
        {you ? <span className="ak-tag ak-tag--you">you</span> : null}
        {host ? (
          <span className="ak-tag ak-tag--host" title="Host">
            <Icon name="crown" size={14} /> host
          </span>
        ) : null}
        {p.isBot ? (
          <span className="ak-tag ak-tag--bot">
            <Icon name="bot" size={14} /> bot
          </span>
        ) : null}
      </span>
      <span className="ak-lplayer__color">{PLAYER_PALETTE[p.color].name}</span>
      {!p.isBot ? (
        <span className={cx('ak-dot', online ? 'ak-dot--on' : graceOver && 'ak-dot--off')} title={online ? 'Online' : 'Offline'}>
          <span className="ak-sr">{online ? 'online' : 'offline'}</span>
        </span>
      ) : (
        <span className="ak-dot ak-dot--bot" aria-hidden="true" />
      )}
      {game.isHost && !host ? (
        <IconButton
          label={`Remove ${p.name}`}
          className="ak-iconbtn--ink ak-lplayer__kick"
          disabled={game.busy}
          onClick={() => void run('kick', () => game.removePlayer(p.id))}
        >
          {pending === 'kick' ? <span className="ak-spinner" /> : <Icon name="close" size={18} />}
        </IconButton>
      ) : (
        <span className="ak-lplayer__kick" />
      )}
    </li>
  );
}

function YouEditor({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const me = snap.players.find((p) => p.id === snap.youId)!;
  const [name, setName] = useState(me.name);
  useEffect(() => setName(me.name), [me.name]);
  const { pending, run } = useRunner();
  const taken: Partial<Record<ColorId, string>> = {};
  for (const p of snap.players) if (p.id !== me.id) taken[p.color] = p.name;
  const saveName = () => {
    const n = name.trim();
    if (!n || n === me.name) {
      setName(me.name);
      return;
    }
    prefs.set('name', n);
    void run('name', () => game.updateLobby({ name: n }));
  };
  return (
    <section className="ak-lobby__you ak-paper" aria-labelledby="you-h">
      <h2 className="ak-h3" id="you-h">
        Your seat
      </h2>
      {me.isBot ? (
        // A seat handed to a bot last game stays a bot through a rematch until you take it back.
        <div className="ak-lobby__botseat" role="status">
          <Icon name="bot" size={18} />
          <span>A bot will play your seat.</span>
          <Button size="sm" variant="primary" busy={pending === 'seat'} disabled={game.busy} onClick={() => void run('seat', () => game.setBot(me.id, false))}>
            Take my seat back
          </Button>
        </div>
      ) : null}
      <form
        className="ak-row ak-row--tight"
        onSubmit={(e) => {
          e.preventDefault();
          saveName();
        }}
      >
        <label className="ak-field ak-grow">
          <span className="ak-field__label">Name</span>
          <input className="ak-input" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
        </label>
        <Button type="submit" variant="secondary" busy={pending === 'name'} disabled={game.busy || name.trim() === me.name || !name.trim()}>
          Save
        </Button>
      </form>
      <div className="ak-field">
        <span className="ak-field__label">Colour</span>
        <ColorPicker
          value={me.color}
          taken={taken}
          disabled={game.busy}
          onChange={(c) => {
            prefs.set('color', c);
            void run('color', () => game.updateLobby({ color: c }));
          }}
        />
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const c = Math.min(max, Math.max(min, n));
    setText(String(c));
    if (c !== value) onCommit(c);
  };
  return (
    <label className="ak-numfield">
      <span className="ak-field__label">{label}</span>
      <span className="ak-numfield__row">
        <input
          className="ak-input ak-input--num"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        {suffix ? <span className="ak-numfield__suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

function RulesPanel({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const c = snap.config;
  const host = game.isHost;
  const [lastTarget, setLastTarget] = useState(c.targetScore ?? 30);
  const [lastRounds, setLastRounds] = useState(c.maxRounds ?? 5);
  useEffect(() => {
    if (c.targetScore !== null) setLastTarget(c.targetScore);
    if (c.maxRounds !== null) setLastRounds(c.maxRounds);
  }, [c.targetScore, c.maxRounds]);
  const { pending, run } = useRunner();
  const set = (key: string, patch: Partial<GameConfig>) => void run(key, () => game.updateLobby({ config: patch }));
  const active = PRESETS.find((p) => p.config.targetScore === c.targetScore && p.config.maxRounds === c.maxRounds && p.config.trapReward === c.trapReward);

  if (!host) {
    return (
      <section className="ak-lobby__rules ak-paper" aria-labelledby="rules-h">
        <h2 className="ak-h3" id="rules-h">
          House rules <span className="ak-muted ak-small">(set by the host)</span>
        </h2>
        <dl className="ak-rulelist">
          <div>
            <dt>Goal</dt>
            <dd>{goalText(c)}</dd>
          </div>
          <div>
            <dt>Trap reward</dt>
            <dd>{c.trapReward > 0 ? `+${c.trapReward} to the owner of the Akabare that busts the eater` : 'None'}</dd>
          </div>
          <div>
            <dt>Leftovers</dt>
            <dd>{c.revealOnRoundEnd ? 'Revealed at the end of each round' : 'Stay secret until the game ends'}</dd>
          </div>
        </dl>
        {active ? <p className="ak-muted ak-small">Preset: {active.label}</p> : null}
      </section>
    );
  }

  return (
    <section className="ak-lobby__rules ak-paper" aria-labelledby="rules-h">
      <h2 className="ak-h3" id="rules-h">
        House rules
      </h2>
      <div className="ak-presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cx('ak-preset', active?.id === p.id && 'ak-preset--on')}
            aria-pressed={active?.id === p.id}
            disabled={game.busy}
            onClick={() => set(p.id, p.config)}
          >
            <span className="ak-preset__label">{pending === p.id ? <span className="ak-spinner" /> : null}{p.label}</span>
            <span className="ak-preset__sub">{p.sub}</span>
          </button>
        ))}
      </div>
      <div className="ak-custom">
        <div className="ak-custom__item">
          <NumberField
            label="Target score"
            value={c.targetScore ?? lastTarget}
            min={1}
            max={1000}
            suffix="points"
            disabled={c.targetScore === null}
            onCommit={(n) => set('target', { targetScore: n })}
          />
          <label className={cx('ak-check', c.maxRounds === null && 'ak-check--disabled')}>
            <input
              type="checkbox"
              checked={c.targetScore === null}
              disabled={c.maxRounds === null}
              onChange={(e) => set('target', { targetScore: e.target.checked ? null : lastTarget })}
            />
            <span>No target (play every round)</span>
          </label>
        </div>
        <div className="ak-custom__item">
          <NumberField
            label="Rounds"
            value={c.maxRounds ?? lastRounds}
            min={1}
            max={100}
            suffix="max"
            disabled={c.maxRounds === null}
            onCommit={(n) => set('rounds', { maxRounds: n })}
          />
          <label className={cx('ak-check', c.targetScore === null && 'ak-check--disabled')}>
            <input
              type="checkbox"
              checked={c.maxRounds === null}
              disabled={c.targetScore === null}
              onChange={(e) => set('rounds', { maxRounds: e.target.checked ? null : lastRounds })}
            />
            <span>No round limit</span>
          </label>
        </div>
        <div className="ak-custom__item">
          <NumberField label="Trap reward" value={c.trapReward} min={0} max={100} suffix="points" onCommit={(n) => set('trap', { trapReward: n })} />
          <span className="ak-field__hint">Paid to the owner of the Akabare that busts someone else.</span>
        </div>
        <div className="ak-custom__item">
          <label className="ak-switch">
            <input
              type="checkbox"
              role="switch"
              checked={c.revealOnRoundEnd}
              onChange={(e) => set('reveal', { revealOnRoundEnd: e.target.checked })}
            />
            <span className="ak-switch__track" aria-hidden="true" />
            <span>Reveal leftover cards at the end of each round</span>
          </label>
        </div>
      </div>
      {c.targetScore === null || c.maxRounds === null ? (
        <p className="ak-muted ak-small">The game needs a target score or a round limit, so you can’t switch both off.</p>
      ) : null}
      <p className="ak-small ak-lobby__goal">
        <strong>Goal:</strong> {goalText(c)}.
      </p>
    </section>
  );
}

export function Lobby({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const players = [...snap.players].sort((a, b) => a.seat - b.seat);
  const n = players.length;
  const graceOver = useAfter(5000);
  const { pending, run } = useRunner();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const host = players.find((p) => p.id === snap.hostId);
  const startReason =
    n < MIN_PLAYERS ? `Need at least ${MIN_PLAYERS} players (${n} so far). Add a bot or wait for friends.` : n > MAX_PLAYERS ? `At most ${MAX_PLAYERS} players.` : null;
  const isOnline = (id: string) => id === snap.youId || game.online.includes(id);

  return (
    <main className="ak-screen ak-screen--wide ak-lobby">
      <header className="ak-screen__top">
        <Wordmark size="sm" link />
        <a className="ak-toplink" href={RULES} target="_blank" rel="noreferrer">
          <Icon name="book" size={18} /> Rules
        </a>
      </header>

      <section className="ak-lobby__hero" aria-labelledby="lobby-h">
        <p className="ak-kicker" id="lobby-h">
          Table code
        </p>
        <ShareBlock code={snap.code} />
        <p className="ak-muted ak-lobby__invite">Share the link or the code. Friends join from their own phones.</p>
        <LocalBadge />
      </section>

      <div className="ak-lobby__grid">
        <section className="ak-lobby__players ak-paper" aria-labelledby="players-h">
          <div className="ak-row ak-row--between">
            <h2 className="ak-h3" id="players-h">
              Players <span className="ak-muted">({n}/{MAX_PLAYERS})</span>
            </h2>
            {game.isHost && n < MAX_PLAYERS ? (
              <Button size="sm" variant="secondary" icon={<Icon name="bot" size={18} />} busy={pending === 'bot'} disabled={game.busy} onClick={() => void run('bot', game.addBot)}>
                Add a bot
              </Button>
            ) : null}
          </div>
          <ol className="ak-lplayers">
            {players.map((p) => (
              <PlayerRow key={p.id} p={p} game={game} online={isOnline(p.id)} graceOver={graceOver} />
            ))}
            {Array.from({ length: Math.max(0, MIN_PLAYERS - n) }, (_, i) => (
              <li key={`empty-${i}`} className="ak-lplayer ak-lplayer--empty">
                <span className="ak-lplayer__seat" aria-hidden="true">
                  {n + i + 1}
                </span>
                <span className="ak-lplayer__name ak-muted">Waiting for a player…</span>
              </li>
            ))}
          </ol>
          <p className="ak-muted ak-small">Seats go clockwise in this order. The first server is picked at random.</p>
        </section>

        <YouEditor game={game} />
        <RulesPanel game={game} />
      </div>

      <section className="ak-lobby__start" aria-live="polite">
        {game.isHost ? (
          <>
            <Button variant="primary" size="lg" busy={pending === 'start'} disabled={!!startReason || game.busy} onClick={() => void run('start', game.start)}>
              Start the game
            </Button>
            {startReason ? <p className="ak-lobby__reason">{startReason}</p> : <p className="ak-muted">Everyone’s here? Let’s eat.</p>}
          </>
        ) : (
          <div className="ak-waiting">
            <span className="ak-waiting__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <p>
              Waiting for the host{host ? ` (${host.name})` : ''} to start the game…
            </p>
          </div>
        )}
        <button type="button" className="ak-linkbtn ak-linkbtn--light" onClick={() => setConfirmLeave(true)}>
          Leave this table
        </button>
      </section>

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
