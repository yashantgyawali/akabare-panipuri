/**
 * Full-screen moments: the Akabare bite (its own dramatic screen), the round
 * result, and game over. All are sequenced by event playback: they only open
 * once the events before them have played.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Action, ColorId, PlayerId, PlayerView, PowerKind, RoundResult } from '../../engine/types.ts';
import { Card, PLAYER_PALETTE, type FaceKind } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { HOME, navigate } from '../router.ts';
import { joinNames, num, powerName, signed, type NameBook } from '../text.ts';

export interface Moment {
  eaterId: PlayerId;
  owner: PlayerId;
  fromStackOf: PlayerId;
  stage: 'bitten' | 'saved' | 'failed' | 'bust';
  power?: { kind: PowerKind; owner: PlayerId };
  trapRewardTo?: PlayerId | null;
  target?: number;
}

function Overlay({ className, labelledBy, children, focusKey }: { className?: string; labelledBy: string; children: ReactNode; focusKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Move focus into the overlay when it opens (or its stage changes), so keyboard users land on the choices.
    const el = ref.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    target.focus({ preventScroll: true });
  }, [focusKey]);
  useEffect(() => {
    // Focus that lands behind the overlay (e.g. a closing drawer hands it back
    // to the covered header button) comes back in. Open dialogs and toasts sit
    // above the overlay and keep theirs.
    const el = ref.current;
    if (!el) return;
    const into = () => (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true });
    const pull = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || el.contains(t) || t.closest('dialog[open], .ak-toasts')) return;
      into();
    };
    // While a modal dialog was open the overlay couldn't take focus (the page is
    // inert); when it closes, focus often just drops to <body>: take it then.
    let timer: number | undefined;
    const closed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const at = document.activeElement;
        if (!document.querySelector('dialog[open]') && (!at || !el.contains(at))) into();
      }, 0);
    };
    document.addEventListener('focusin', pull);
    document.addEventListener('close', closed, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', pull);
      document.removeEventListener('close', closed, true);
    };
  }, []);
  // aria-modal: keep Tab inside the overlay instead of wandering into the table hidden behind it.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (e.key !== 'Tab' || !el) return;
    const items = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(
      (x) => x.offsetParent !== null,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div ref={ref} className={cx('ak-overlay', className)} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={trapTab}>
      {children}
    </div>
  );
}

/** A card that turns face up just after it appears. */
function RevealCard({ back, color, face, width, state, delay = 120 }: { back: 'puri' | 'power'; color: ColorId; face: FaceKind; width: number; state?: 'danger' | 'selected' | 'idle'; delay?: number }) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setUp(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <Card back={back} color={color} face={face} faceUp={up} width={width} state={state} decorative flipMs={700} />;
}

export function AkabareMoment({
  moment,
  view,
  names,
  phone,
  busy,
  pending,
  act,
  onDismiss,
  watch,
}: {
  moment: Moment;
  view: PlayerView;
  names: NameBook;
  phone: boolean;
  busy: boolean;
  pending: string | null;
  act: (key: string, action: Action) => void;
  onDismiss: () => void;
  /** Set for everyone but the deciding eater while they decide (stage 'bitten'). */
  watch?: {
    /** The eater seems to be offline (after the presence grace period). */
    offline: boolean;
    /** Host only: hand the eater's seat to a bot so the game can go on. */
    onReplace?: () => void;
    replacing: boolean;
    /** Set the overlay aside to look at the table (and reach the header). */
    onPeek: () => void;
  };
}) {
  const titleId = useId();
  const you = view.youId;
  const eaterIsYou = moment.eaterId === you;
  // A bot playing your seat decides for you: you watch like everyone else.
  const youDecide = eaterIsYou && !watch;
  const ownerText =
    moment.owner === moment.eaterId ? (eaterIsYou ? 'your own' : 'their own') : moment.owner === you ? 'your' : `${names.name(moment.owner)}’s`;
  const legal = view.legal;
  const choices = moment.stage === 'bitten' && youDecide ? legal.flipPower : [];
  const canAccept = moment.stage === 'bitten' && youDecide && legal.acceptBust;
  const target = moment.target ?? view.eating?.target ?? 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  // Leave room for the choices under the chili card: one row of picks is ~150px tall.
  // Phones lay the picks out in a grid of >= 96px columns (see overlays.css).
  const pickW = phone ? 96 : 132;
  const pickGap = phone ? 8 : 10;
  const avail = phone ? vw - 44 : Math.min(760, vw - 32) - 32;
  const perRow = Math.max(1, Math.floor((avail + pickGap) / (pickW + pickGap)));
  const rows = choices.length > 0 ? Math.ceil(choices.length / perRow) : 0;
  const reserve = moment.stage === 'bitten' && youDecide ? (phone ? 440 : 500) + Math.max(0, rows - 1) * (phone ? 136 : 150) : 330;
  const bigW = Math.round(Math.min(phone ? 124 : 180, Math.max(phone ? 72 : 96, (vh - reserve) * 0.72)));
  const trap = moment.trapRewardTo;
  const stageClass = `ak-bite--${moment.stage}`;

  let headline: string;
  let sub: ReactNode = null;
  switch (moment.stage) {
    case 'bitten':
      headline = eaterIsYou ? `You bit ${ownerText} Akabare!` : `${names.name(moment.eaterId)} bit ${ownerText} Akabare…`;
      sub = youDecide ? (
        choices.length > 0 ? (
          'Only Dahi can save you now.'
        ) : (
          'No power flips left to save you…'
        )
      ) : watch?.offline ? (
        <>Waiting on {names.who(moment.eaterId)}, who seems to be offline.</>
      ) : (
        <>
          {moment.eaterId === you ? 'Your bot decides: will it find Dahi?' : 'will they find Dahi?'}
          <span className="ak-waiting__dots ak-waiting__dots--light" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </>
      );
      break;
    case 'saved':
      headline = 'Saved by Dahi!';
      sub = eaterIsYou
        ? 'Cool yoghurt, calm tongue. Keep eating.'
        : moment.owner === you
          ? `Your chili is wasted: ${names.name(moment.eaterId)} is safe and keeps eating.`
          : moment.power?.owner === you
            ? `Your Dahi saved ${names.name(moment.eaterId)}, who keeps eating.`
            : `${names.name(moment.eaterId)} is safe and keeps eating.`;
      break;
    case 'failed':
      headline = moment.power ? `It’s ${powerName(moment.power.kind)}. No Dahi…` : 'No Dahi…';
      sub = eaterIsYou ? 'The chili wins this one.' : `${names.name(moment.eaterId)} is in trouble.`;
      break;
    case 'bust':
      headline = eaterIsYou ? `You bust! ${signed(-target)}` : `${names.name(moment.eaterId)} busts! ${signed(-target)}`;
      sub = trap ? (
        <>
          <strong>{names.who(trap)}</strong> {trap === you ? 'get' : 'gets'} +{view.config.trapReward} for the trap.
        </>
      ) : moment.owner === moment.eaterId ? (
        eaterIsYou ? 'Your own chili: no trap reward.' : 'Their own chili: no trap reward.'
      ) : null;
      break;
  }

  return (
    <Overlay className={cx('ak-bite', stageClass)} labelledBy={titleId} focusKey={`${moment.stage}:${choices.length}`}>
      <div className="ak-bite__vignette" aria-hidden="true" />
      <div className="ak-bite__content">
        <div className="ak-bite__cards">
          <div className="ak-bite__chili">
            <RevealCard back="puri" color={names.color(moment.owner)} face="akabare" width={bigW} state={moment.stage === 'saved' ? 'idle' : 'danger'} />
            <span className="ak-bite__owner" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(moment.owner)].base }}>
              {moment.owner === you ? 'Your' : `${names.name(moment.owner)}’s`} Akabare
            </span>
          </div>
          {moment.power && moment.stage !== 'bitten' ? (
            <div className="ak-bite__power">
              <RevealCard back="power" color={names.color(moment.power.owner)} face={moment.power.kind} width={Math.round(bigW * 0.72)} state={moment.power.kind === 'dahi' ? 'selected' : 'danger'} delay={60} />
              <span className="ak-bite__owner" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(moment.power.owner)].base }}>
                {moment.power.owner === you ? 'Your' : `${names.name(moment.power.owner)}’s`} power
              </span>
            </div>
          ) : null}
        </div>
        <h2 className="ak-bite__title" id={titleId} aria-live="assertive">
          {headline}
        </h2>
        {sub ? <p className="ak-bite__sub">{sub}</p> : null}

        {choices.length > 0 || canAccept ? (
          <div className="ak-bite__choices">
            {choices.length > 0 ? (
              <>
                <h3 className="ak-bite__choose">Flip a power and pray for Dahi</h3>
                <ul className="ak-bite__powers">
                  {choices.map((id) => {
                    const p = view.players.find((x) => x.id === id);
                    const pw = p?.power;
                    const known = id === you && pw?.kind ? pw.kind : null;
                    const who = known ? `Your ${powerName(known)}` : `${names.name(id)}’s power`;
                    const what = known ? (known === 'dahi' ? 'safe!' : 'won’t save you') : 'blind gamble';
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={cx('ak-bite__pick', known === 'dahi' && 'ak-bite__pick--safe')}
                          disabled={busy}
                          onClick={() => act(`power:${id}`, { type: 'FLIP_POWER', targetPlayerId: id })}
                          data-autofocus={id === choices[0] ? '' : undefined}
                        >
                          <Card back="power" color={names.color(id)} peek={known} badge={names.initial(id)} width={phone ? 46 : 58} decorative />
                          <span className="ak-bite__picktext">
                            <span className="ak-bite__pickwho">{who}:</span> <span className="ak-bite__pickwhat">{what}</span>
                          </span>
                          {pending === `power:${id}` ? <span className="ak-spinner" aria-hidden="true" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            {canAccept ? (
              <Button variant="ghost" className="ak-bite__accept" busy={pending === 'accept'} disabled={busy} onClick={() => act('accept', { type: 'ACCEPT_BUST' })} data-autofocus={choices.length === 0 ? '' : undefined}>
                Accept the bust ({signed(-target)})
              </Button>
            ) : null}
          </div>
        ) : null}

        {moment.stage === 'bitten' && watch ? (
          <div className="ak-bite__watch">
            {watch.offline && watch.onReplace ? (
              <Button variant="secondary" busy={watch.replacing} disabled={busy} onClick={watch.onReplace}>
                Replace {names.name(moment.eaterId)} with a bot
              </Button>
            ) : null}
            <button type="button" className="ak-linkbtn ak-linkbtn--light" onClick={watch.onPeek} data-autofocus="">
              <Icon name="eye" size={16} /> Look at the table
            </button>
          </div>
        ) : null}

        {moment.stage === 'saved' ? (
          <Button variant="leaf" size="lg" onClick={onDismiss} data-autofocus="">
            {eaterIsYou ? 'Keep eating' : moment.owner === you ? 'Oh well' : 'Carry on'}
          </Button>
        ) : null}
      </div>
    </Overlay>
  );
}

function ResultLines({ result, view, names }: { result: RoundResult; view: PlayerView; names: NameBook }) {
  const rows = [...view.players].sort((a, b) => (result.scoresAfter[b.id] ?? 0) - (result.scoresAfter[a.id] ?? 0));
  return (
    <ul className="ak-deltas">
      {rows.map((p) => {
        const d = result.scoreDeltas[p.id] ?? 0;
        const why = p.id === result.eaterId ? (result.outcome === 'success' ? 'ate the bid' : 'bust') : p.id === result.trapRewardTo ? 'trap reward' : '';
        return (
          <li key={p.id} className={cx('ak-deltas__row', d > 0 && 'is-up', d < 0 && 'is-down')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
            <span className="ak-deltas__chip" aria-hidden="true">
              {names.initial(p.id)}
            </span>
            <span className="ak-deltas__name">{p.id === view.youId ? 'You' : p.name}</span>
            <span className="ak-deltas__why">{why}</span>
            <span className="ak-deltas__d">{d === 0 ? '·' : signed(d)}</span>
            <span className="ak-deltas__score">{num(result.scoresAfter[p.id] ?? p.score)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RoundEndPanel({
  view,
  names,
  result,
  isHost,
  busy,
  pending,
  act,
  onPeek,
  onTakeSeatBack,
}: {
  view: PlayerView;
  names: NameBook;
  result: RoundResult;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  act: (key: string, action: Action) => void;
  onPeek: () => void;
  /** Set while a bot plays the viewer's seat: the banner with this button is hidden behind the overlay. */
  onTakeSeatBack?: () => void;
}) {
  const titleId = useId();
  const you = view.youId;
  const eater = result.eaterId;
  const success = result.outcome === 'success';
  const { targetScore, maxRounds } = view.config;
  const willEnd = (targetScore !== null && view.players.some((p) => p.score >= targetScore)) || (maxRounds !== null && view.round >= maxRounds);
  const waiting = view.players.filter((p) => !p.isBot && !p.ready);
  // Whether YOU are ready comes from your seat, not from legal.ready: legal is
  // empty for a moment whenever someone else's Ready plays back.
  const mine = view.players.find((p) => p.id === you);
  const youReady = !mine || mine.isBot || mine.ready;
  const reason =
    result.outcome === 'bust'
      ? result.bustReason === 'emptyTable'
        ? 'The table ran out before the bid was eaten.'
        : result.akabareOwnerId
          ? result.akabareOwnerId === eater
            ? `Bit ${eater === you ? 'your' : 'their'} own Akabare: no trap reward.`
            : `Bit ${result.akabareOwnerId === you ? 'your' : `${names.name(result.akabareOwnerId)}’s`} Akabare.`
          : 'Bust.'
      : result.eaten > result.target
        ? `Overshot to ${result.eaten}, but the score is the bid.`
        : null;
  return (
    <Overlay className="ak-result" labelledBy={titleId} focusKey={`r${result.round}:${youReady}:${!!onTakeSeatBack}`}>
      <div className={cx('ak-result__card ak-paper', success ? 'is-success' : 'is-bust')}>
        <p className="ak-kicker ak-kicker--ink">Round {result.round} result</p>
        <h2 className="ak-result__title" id={titleId}>
          {success ? `${eater === you ? 'You' : names.name(eater)} ate ${result.target}!` : `${eater === you ? 'You' : names.name(eater)} ${eater === you ? 'bust' : 'busts'}!`}
          <span className="ak-result__big">{signed(success ? result.target : -result.target)}</span>
        </h2>
        <p className="ak-result__facts">
          Bid {result.bid}
          {result.target !== result.bid ? (
            <>
              {' '}
              <span aria-hidden="true">→</span> {result.target} <span className="ak-muted">(Khali Puri)</span>
            </>
          ) : null}{' '}
          · ate {result.eaten}
        </p>
        {reason ? <p className="ak-result__reason">{reason}</p> : null}
        {result.trapRewardTo ? (
          <p className="ak-result__trap">
            <Icon name="chili" size={18} /> {names.who(result.trapRewardTo)} {result.trapRewardTo === you ? 'get' : 'gets'} +{view.config.trapReward} for the trap.
          </p>
        ) : null}
        <ResultLines result={result} view={view} names={names} />
        {view.revealed ? (
          <p className="ak-small ak-muted">
            Leftover cards are face up on the table.{' '}
            <button type="button" className="ak-linkbtn" onClick={onPeek}>
              Look at the table
            </button>
          </p>
        ) : null}
        <div className="ak-result__actions">
          {onTakeSeatBack ? (
            <>
              <p className="ak-result__waiting" role="status">
                <Icon name="bot" size={18} /> A bot is playing your seat.
              </p>
              <Button variant="primary" busy={pending === `bot:${you}`} disabled={busy} onClick={onTakeSeatBack} data-autofocus="">
                Take my seat back
              </Button>
            </>
          ) : !youReady ? (
            <Button
              variant="primary"
              size="lg"
              busy={pending === 'ready'}
              disabled={busy}
              // Not `disabled` while a move plays back: that would drop keyboard focus.
              aria-disabled={!view.legal.ready || undefined}
              onClick={() => {
                if (view.legal.ready) act('ready', { type: 'READY' });
              }}
              data-autofocus=""
            >
              {willEnd ? 'See the final scores' : `Ready for round ${view.round + 1}`}
            </Button>
          ) : (
            <p className="ak-result__waiting" role="status">
              <Icon name="check" size={18} /> You’re ready.{' '}
              {waiting.length > 0 ? `Waiting for ${joinNames(waiting.map((p) => names.name(p.id)))}…` : ''}
            </p>
          )}
          {view.legal.forceContinue && isHost && waiting.some((p) => p.id !== you) ? (
            <Button variant="ghost" busy={pending === 'force'} disabled={busy} onClick={() => act('force', { type: 'FORCE_CONTINUE' })}>
              Continue now
            </Button>
          ) : null}
          {!view.revealed ? (
            <button type="button" className="ak-linkbtn" onClick={onPeek}>
              <Icon name="eye" size={16} /> Look at the table
            </button>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
}

const CONFETTI_COLORS = ['#C8321A', '#D99A22', '#4F7A32', '#2D6281', '#F4E7C8', '#C66D38', '#71506F'];

function Confetti() {
  return (
    <div className="ak-confetti" aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = ((i * 13) % 20) / 10;
        const dur = 3 + ((i * 7) % 10) / 5;
        const rot = (i * 47) % 360;
        return (
          <i
            key={i}
            style={{
              left: `${left}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              ['--r' as string]: `${rot}deg`,
              ['--s' as string]: i % 3 === 0 ? 'circle(50%)' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

export function GameOverPanel({
  view,
  names,
  isHost,
  busy,
  pending,
  onRematch,
  onPeek,
}: {
  view: PlayerView;
  names: NameBook;
  isHost: boolean;
  busy: boolean;
  pending: string | null;
  onRematch: () => void;
  onPeek: () => void;
}) {
  const titleId = useId();
  const you = view.youId;
  // You first ("Shared win: You and Bikash!", never "Bikash and You!").
  const winners = [...(view.winners ?? [])].sort((a, b) => Number(b === view.youId) - Number(a === view.youId));
  const standings = [...view.players].sort((a, b) => b.score - a.score || a.busts - b.busts || a.seat - b.seat);
  const top = standings[0]?.score ?? 0;
  const leaders = standings.filter((p) => p.score === top);
  const youWon = !!you && winners.includes(you);
  let tiebreak: string | null = null;
  if (leaders.length > 1 && winners.length < leaders.length) {
    const w = leaders.filter((p) => winners.includes(p.id));
    const l = leaders.filter((p) => !winners.includes(p.id));
    tiebreak = `Tied on ${top} points: ${joinNames(w.map((p) => names.who(p.id)))} ${w.length === 1 && w[0].id !== you ? 'wins' : 'win'} on fewer busts (${w[0].busts} vs ${l.map((p) => p.busts).join(', ')}).`;
  } else if (winners.length > 1) {
    tiebreak = `Tied on ${top} points and ${leaders[0].busts} bust${leaders[0].busts === 1 ? '' : 's'}: a shared win.`;
  }
  const title =
    winners.length === 1
      ? winners[0] === you
        ? 'You win!'
        : `${names.name(winners[0])} wins!`
      : `Shared win: ${joinNames(winners.map((id) => names.who(id)))}!`;
  let rank = 0;
  let prev: string | null = null;
  return (
    <Overlay className="ak-gameover" labelledBy={titleId} focusKey="gameover">
      <Confetti />
      <div className={cx('ak-result__card ak-gameover__card ak-paper', youWon && 'is-you')}>
        <p className="ak-kicker ak-kicker--ink">Game over · round {view.round}</p>
        <div className="ak-gameover__winners" aria-hidden="true">
          {winners.map((id) => (
            <span key={id} className="ak-gameover__crown" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(id)].base }}>
              <Icon name="crown" size={22} />
              <span>{names.initial(id)}</span>
            </span>
          ))}
        </div>
        <h2 className="ak-result__title ak-gameover__title" id={titleId}>
          {title}
        </h2>
        {tiebreak ? <p className="ak-result__reason">{tiebreak}</p> : null}
        <ol className="ak-standings">
          {standings.map((p, i) => {
            const key = `${p.score}:${p.busts}`;
            if (key !== prev) rank = i + 1;
            prev = key;
            return (
              <li key={p.id} className={cx('ak-standings__row', winners.includes(p.id) && 'is-winner')} style={{ ['--c' as string]: PLAYER_PALETTE[p.color].base }}>
                <span className="ak-standings__rank">{rank}</span>
                <span className="ak-deltas__chip" aria-hidden="true">
                  {names.initial(p.id)}
                </span>
                <span className="ak-standings__name">{p.id === you ? 'You' : p.name}</span>
                <span className="ak-standings__busts">
                  {p.busts} bust{p.busts === 1 ? '' : 's'}
                </span>
                <span className="ak-standings__score">{num(p.score)}</span>
              </li>
            );
          })}
        </ol>
        <div className="ak-result__actions">
          {isHost ? (
            <Button variant="primary" size="lg" busy={pending === 'rematch'} disabled={busy} onClick={onRematch} data-autofocus="">
              Rematch
            </Button>
          ) : (
            <p className="ak-muted ak-small">The host can start a rematch with the same players.</p>
          )}
          <Button variant="ghost" onClick={() => navigate(HOME)} icon={<Icon name="arrowLeft" size={18} />}>
            Back home
          </Button>
          <button type="button" className="ak-linkbtn" onClick={onPeek}>
            <Icon name="eye" size={16} /> Look at the table
          </button>
        </div>
      </div>
    </Overlay>
  );
}
