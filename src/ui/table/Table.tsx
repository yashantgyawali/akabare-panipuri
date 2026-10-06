/**
 * The table (playing / finished). Everything renders from `view` = the live
 * PlayerView rewound to the playback cursor (see ../playback), so bots' and
 * other players' moves play one at a time and the table always matches the
 * announcer. Actions come only from view.legal (empty while events play).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent, PlayerId, PlayerView, PublicPlayerView } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { noLegalActions } from '../../engine/index.ts';
import { Button } from '../common/Button.tsx';
import { ConfirmDialog, Drawer } from '../common/Drawer.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx, useAfter, useMediaQuery, usePhone, useReducedMotion, useRunner } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { HOME, navigate } from '../router.ts';
import { RulesContent } from '../rules/Rules.tsx';
import { usePlayback } from '../playback/usePlayback.ts';
import { describeEvent, makeNameBook, powerName } from '../text.ts';
import { LogList, ScoresPanel, TableHeader, turnText, type DrawerName } from './Chrome.tsx';
import { EatingHud } from './EatingHud.tsx';
import { Hand, handCards } from './Hand.tsx';
import { AkabareMoment, GameOverPanel, RoundEndPanel, type Moment } from './Overlays.tsx';
import { ActionPanel } from './Panels.tsx';
import { Seat, stackLabel, type Clickable, type SeatProps, type SeatStatus } from './Seat.tsx';
import { SetupPanel } from './SetupPanel.tsx';

const NO_LEGAL = noLegalActions();

function seatOrder(players: readonly PublicPlayerView[], you: PlayerId | null): PublicPlayerView[] {
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);
  const i = Math.max(0, bySeat.findIndex((p) => p.id === you));
  return [...bySeat.slice(i), ...bySeat.slice(0, i)];
}

function statusFor(p: PublicPlayerView, view: PlayerView): SeatStatus | null {
  switch (view.phase) {
    case 'setup':
      return p.setupDone ? { label: 'set ✓', tone: 'done' } : { label: 'setting up…', tone: 'wait' };
    case 'serving':
      if (view.serving?.turnId === p.id) return { label: 'serving', tone: 'turn' };
      return view.firstPlayerId === p.id ? { label: 'served first', tone: 'wait' } : null;
    case 'bidding': {
      const b = view.bidding;
      if (!b) return null;
      if (b.passed.includes(p.id)) return { label: 'passed', tone: 'passed' };
      if (b.turnId === p.id) return { label: 'deciding…', tone: 'turn' };
      if (b.highBidderId === p.id) return { label: `high bid ${b.highBid}`, tone: 'high' };
      return null;
    }
    case 'eating': {
      const e = view.eating;
      if (e?.eaterId === p.id) return { label: `eating ${e.eaten}/${e.target}`, tone: 'eater' };
      return view.bidding?.passed.includes(p.id) ? { label: 'watching', tone: 'passed' } : null;
    }
    case 'roundEnd': {
      const r = view.results.find((x) => x.round === view.round);
      if (r?.eaterId === p.id) return r.outcome === 'success' ? { label: `ate ${r.target}`, tone: 'done' } : { label: 'bust', tone: 'bust' };
      return p.isBot || p.ready ? { label: 'ready', tone: 'done' } : { label: 'reading…', tone: 'wait' };
    }
    case 'gameOver':
      return view.winners?.includes(p.id) ? { label: 'winner', tone: 'win' } : null;
  }
}

function cueFor(p: PublicPlayerView, e: GameEvent | null): SeatProps['cue'] {
  if (!e) return null;
  switch (e.type) {
    case 'place':
      if (e.onStackOf === p.id) return { part: 'stack', seq: e.seq };
      return e.playerId === p.id ? { part: 'seat', seq: e.seq } : null;
    case 'flipPuri':
      return e.fromStackOf === p.id ? { part: 'stack', seq: e.seq, tone: e.kind === 'akabare' && !e.cancelled ? 'bad' : undefined } : null;
    case 'flipPower':
      return e.fromStackOf === p.id
        ? { part: 'power', seq: e.seq, tone: e.effect === 'saved' || e.effect === 'plusTwo' || e.effect === 'numb' ? 'good' : e.effect === 'wasted' ? undefined : 'bad' }
        : null;
    case 'bidStart':
    case 'raise':
    case 'pass':
    case 'setupDone':
    case 'ready':
      return e.playerId === p.id ? { part: 'seat', seq: e.seq } : null;
    case 'eater':
      return e.playerId === p.id ? { part: 'seat', seq: e.seq, tone: 'good' } : null;
    case 'success':
      return e.eaterId === p.id ? { part: 'seat', seq: e.seq, tone: 'good' } : null;
    case 'bust':
      return e.eaterId === p.id ? { part: 'seat', seq: e.seq, tone: 'bad' } : e.trapRewardTo === p.id ? { part: 'seat', seq: e.seq, tone: 'good' } : null;
    default:
      return null;
  }
}

/** The Akabare moment after `e` plays (bite → saved | failed → bust; cleared by later events). */
function nextMoment(m: Moment | null, e: GameEvent): Moment | null {
  if (e.type === 'bite') return { eaterId: e.eaterId, owner: e.owner, fromStackOf: e.fromStackOf, stage: 'bitten' };
  if (e.type === 'flipPower' && (e.effect === 'saved' || e.effect === 'failedSave')) {
    return {
      eaterId: e.eaterId,
      owner: m?.owner ?? e.owner,
      fromStackOf: m?.fromStackOf ?? e.fromStackOf,
      stage: e.effect === 'saved' ? 'saved' : 'failed',
      power: { kind: e.kind, owner: e.owner },
    };
  }
  if (e.type === 'bust' && e.reason === 'akabare') {
    return m
      ? { ...m, stage: 'bust', trapRewardTo: e.trapRewardTo, target: e.target }
      : { eaterId: e.eaterId, owner: e.akabareOwnerId ?? e.eaterId, fromStackOf: e.eaterId, stage: 'bust', trapRewardTo: e.trapRewardTo, target: e.target };
  }
  if (e.type === 'roundEnd' || e.type === 'roundStart' || e.type === 'success' || e.type === 'flipPuri') {
    return m && (e.type !== 'flipPuri' || m.stage === 'saved') ? null : m;
  }
  return m;
}

/** Where keyboard focus was when you acted: a stable selector for "the same control", '*' for "whatever you can do next". */
function focusMemoOf(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  if (el.closest('.ak-overlay, .tp-scrim, .tp-bite, .tp-overlay')) return '*';
  const stack = el.closest<HTMLElement>('[data-stack-of]');
  if (stack?.dataset.stackOf) return `[data-stack-of="${CSS.escape(stack.dataset.stackOf)}"] > button`;
  const power = el.closest<HTMLElement>('[data-power-of]');
  if (power?.dataset.powerOf) return `[data-power-of="${CSS.escape(power.dataset.powerOf)}"] > button`;
  if (el.closest('.tp-dock__prompt') && el.classList.contains('btn-cta')) return '.tp-dock__prompt .btn-cta';
  return el.closest('.tp-tablescreen') ? '*' : null;
}

/** The control to focus for a remembered spot: the same one if it's still actionable, else the first thing you can act on. */
function focusTargetFor(memo: string): HTMLElement | null {
  const usable = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && !(el as HTMLButtonElement).disabled && el.offsetParent !== null && !el.classList.contains('ak-card-stack--dim');
  if (memo !== '*') {
    const same = document.querySelector(memo);
    if (usable(same)) return same;
  }
  const next = [
    ...document.querySelectorAll('.tp-seats [data-stack-of] > button.ak-card-stack--selectable'),
    ...document.querySelectorAll('.tp-seats [data-power-of] > button.ak-card--selectable'),
    ...document.querySelectorAll('.tp-dock__hand button, .tp-dock__prompt .btn-cta, .tp-dock__prompt button, .tp-dock button'),
  ];
  return next.find(usable) ?? null;
}

export function Table({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const live = snap.view!;
  const you = snap.youId;
  const reduced = useReducedMotion();
  const phone = usePhone();
  const narrow = useMediaQuery('(min-width: 641px) and (max-width: 900px)');
  const pb = usePlayback(live, you, reduced);
  const view = pb.display ?? live;
  const names = useMemo(() => makeNameBook(view.players, you), [view.players, you]);
  const toast = useToast();
  const { pending, run } = useRunner();
  const busy = game.busy;
  const gameAct = game.act;
  // Keyboard focus: the control you act with usually unmounts (a stack is a
  // <button> only while you may tap it, and the panel shows "Playing…" while
  // your move plays back). Remember where you were and put focus back on the
  // same control, or the next thing you can act on, once the table settles.
  const focusWant = useRef<string | null>(null);
  const act = useCallback(
    (key: string, action: Action) => {
      focusWant.current = focusMemoOf(document.activeElement);
      void run(key, () => gameAct(action));
    },
    [run, gameAct],
  );
  const graceOver = useAfter(6000);
  const [drawer, setDrawer] = useState<DrawerName>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);

  const me = view.players.find((p) => p.id === you) ?? null;
  // While a bot plays your seat you only watch (take the seat back to act again).
  const legal = me?.isBot ? NO_LEGAL : view.legal;
  const actView = me?.isBot && view.legal !== NO_LEGAL ? { ...view, legal: NO_LEGAL } : view;
  const hand = handCards(view.me?.hand ?? { panipuri: 0, akabare: 0 });
  const selKind = sel !== null && legal.place ? (hand[sel]?.kind ?? null) : null;

  useEffect(() => {
    if (!legal.place) setSel(null);
  }, [legal.place]);
  useEffect(() => setSel(null), [view.me?.hand.panipuri, view.me?.hand.akabare]);
  useEffect(() => setPeek(false), [view.phase, view.round]);

  // The Akabare moment follows the playback: bite → (saved | failed) → bust.
  // Derived during render (not in an effect) so the overlay never drops out
  // for a frame between stages, which would remount it and replay the flips.
  const current = pb.current;
  const [momentState, setMomentState] = useState<{ seq: number | null; cursor: number; moment: Moment | null }>(() => ({ seq: null, cursor: pb.cursor, moment: null }));
  let moment = momentState.moment;
  if (current && current.seq !== momentState.seq) {
    moment = nextMoment(moment, current);
    setMomentState({ seq: current.seq, cursor: pb.cursor, moment });
  } else if (!current && pb.cursor !== momentState.cursor) {
    // Playback jumped (skip, or a gap too long to replay): no played event led
    // here, so an earlier moment is stale. A live bite is re-derived below.
    moment = null;
    setMomentState({ seq: null, cursor: pb.cursor, moment: null });
  }
  const setMoment = useCallback((m: Moment | null) => setMomentState((st) => ({ ...st, moment: m })), []);
  useEffect(() => {
    if (moment?.stage !== 'saved') return;
    const t = setTimeout(() => setMoment(null), 2600);
    return () => clearTimeout(t);
  }, [moment]);
  // Skipping ahead past the moment closes it.
  useEffect(() => {
    if (!pb.playing && moment && moment.stage !== 'saved' && view.phase !== 'eating') setMoment(null);
  }, [pb.playing, moment, view.phase]);

  const bite = view.phase === 'eating' ? (view.eating?.pendingAkabare ?? null) : null;
  const eaterId = view.eating?.eaterId ?? null;
  // A 'bitten' moment only stands while it IS the bite on the table (same eater, owner and stack).
  const sameBite = (x: Moment) => !!bite && x.eaterId === eaterId && x.owner === bite.owner && x.fromStackOf === bite.fromStackOf;
  const momentNow: Moment | null =
    moment && (moment.stage !== 'bitten' || sameBite(moment))
      ? moment
      : bite && eaterId
        ? { eaterId, owner: bite.owner, fromStackOf: bite.fromStackOf, stage: 'bitten' }
        : null;
  // Watchers may set the suspense aside to look at the table (and reach the
  // header, e.g. to replace an eater who went offline). Keyed to this bite.
  const biteKey = bite && view.eating ? `${view.round}:${view.eating.plate.length}:${bite.fromStackOf}` : null;
  const [bitePeek, setBitePeek] = useState<string | null>(null);
  const watchingBite = momentNow?.stage === 'bitten' && (momentNow.eaterId !== you || !!me?.isBot);
  const peekingBite = watchingBite && biteKey !== null && bitePeek === biteKey;
  const shownMoment = peekingBite ? null : momentNow;

  const result = view.phase === 'roundEnd' || view.phase === 'gameOver' ? (view.results.find((r) => r.round === view.round) ?? null) : null;
  const showResult = view.phase === 'roundEnd' && !!result && !shownMoment && !peek;
  const showGameOver = view.phase === 'gameOver' && !shownMoment && !peek;
  const overlayKey = shownMoment ? `m:${shownMoment.stage}` : showResult ? `r:${view.round}` : showGameOver ? 'over' : null;

  // An overlay can't take focus while a drawer (a native modal <dialog>) is
  // open, and closing the drawer later would hand focus back to the covered
  // header. So a new overlay closes the drawer; when an overlay goes away,
  // focus goes back to the table.
  const mounted = useRef(false);
  useEffect(() => {
    if (overlayKey) setDrawer(null);
    else if (mounted.current && (!document.activeElement || document.activeElement === document.body)) focusWant.current ??= '*';
    mounted.current = true;
  }, [overlayKey]);
  useEffect(() => {
    const clear = (e: FocusEvent) => {
      if (e.target !== document.body) focusWant.current = null;
    };
    document.addEventListener('focusin', clear);
    return () => document.removeEventListener('focusin', clear);
  }, []);
  useEffect(() => {
    const want = focusWant.current;
    if (!want || pb.playing || overlayKey) return;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    const el = focusTargetFor(want);
    if (!el) return; // nothing to act on yet (not your turn): try again on a later render
    focusWant.current = null;
    el.focus({ preventScroll: true });
  });

  // Browser tab title: nudge when it's your move.
  const yourMove =
    !pb.playing &&
    !me?.isBot &&
    (!!live.legal.startBid || !!live.legal.raise || live.legal.flipPuri.length > 0 || live.legal.flipPower.length > 0 || live.legal.acceptBust || (!!live.legal.setup && !live.legal.setup.submitted) || live.legal.ready);
  useEffect(() => {
    document.title = `${yourMove ? '● Your move · ' : ''}${snap.code} · Akabare Panipuri`;
  }, [yourMove, snap.code]);

  const line = current ? describeEvent(current, names, view.config.trapReward) : null;

  const setBot = (id: PlayerId, isBot: boolean) => void run(`bot:${id}`, () => game.setBot(id, isBot));
  const offlineWaiting = graceOver
    ? live.pendingActors.filter((id) => {
        const p = live.players.find((x) => x.id === id);
        return !!p && !p.isBot && id !== you && !game.online.includes(id);
      })
    : [];

  const ordered = seatOrder(view.players, you);
  const n = ordered.length;
  const cardW = phone ? 54 : narrow ? 62 : n <= 2 ? 84 : n === 3 ? 76 : n === 4 ? 70 : 60;
  const stackMax = phone ? 150 : 240;
  const handW = phone ? 46 : 60;
  const plateW = phone ? 44 : 56;

  const stackClick = (p: PublicPlayerView): Clickable => {
    const label = stackLabel(p, names);
    if (legal.place && selKind && legal.place.targets.includes(p.id)) {
      return {
        state: 'selectable',
        label: `${label}. Place your ${selKind === 'akabare' ? 'Akabare' : 'Panipuri'} here.`,
        onClick: () => {
          if (!busy) act('place', { type: 'PLACE_PURI', kind: selKind, targetPlayerId: p.id });
        },
      };
    }
    if (legal.flipPuri.includes(p.id)) {
      return {
        state: 'selectable',
        label: `${label}. Eat the top card.`,
        onClick: () => {
          if (!busy) act(`flip:${p.id}`, { type: 'FLIP_PURI', targetPlayerId: p.id });
        },
      };
    }
    if (view.phase === 'eating' && view.eating?.eaterId === you && legal.flipPuri.length > 0 && p.stack.length > 0) {
      return {
        state: 'dim',
        label: `${label}. Finish your own stack first.`,
        onClick: () => toast('Finish your own stack first.', 'info', 2200),
      };
    }
    return { state: 'idle', label };
  };
  const powerClick = (p: PublicPlayerView): Clickable => {
    if (legal.flipPower.includes(p.id) && !shownMoment) {
      const known = p.id === you && p.power?.kind ? p.power.kind : null;
      return {
        state: 'selectable',
        label: known ? `Flip your ${powerName(known)}` : `Blind gamble: flip ${names.whose(p.id)} power`,
        onClick: () => {
          if (!busy) act(`power:${p.id}`, { type: 'FLIP_POWER', targetPlayerId: p.id });
        },
      };
    }
    return { state: 'idle', label: '' };
  };
  const seatProps = (p: PublicPlayerView): SeatProps => ({
    p,
    view,
    names,
    isHost: p.id === snap.hostId,
    online: p.isBot || !graceOver ? null : p.id === you || game.online.includes(p.id),
    turn: (view.phase === 'serving' || view.phase === 'bidding' || view.phase === 'eating') && view.pendingActors.includes(p.id),
    status: statusFor(p, view),
    cardW,
    stackMax,
    stack: stackClick(p),
    power: powerClick(p),
    cue: cueFor(p, current),
    compact: phone,
  });

  const setupMode = view.phase === 'setup' && !!me && !me.isBot;
  const setupView = live.phase === 'setup' && live.round === view.round ? live : view;
  const placing = !!legal.place && selKind !== null;
  const botSeat = !!me?.isBot && view.phase !== 'gameOver';
  const showHud = view.phase === 'eating' || view.phase === 'roundEnd' || view.phase === 'gameOver';
  const showHand = !!me && !botSeat && (view.phase === 'serving' || (!phone && hand.length > 0 && (view.phase === 'bidding' || view.phase === 'eating')));

  const leave = () =>
    void run('leave', async () => {
      const ok = await game.leave();
      setConfirmLeave(false);
      if (ok) navigate(HOME);
    });

  return (
    <div className={cx('tp-tablescreen', `tp-phase-${view.phase}`, placing && 'is-placing', phone && 'is-phone')}>
      <TableHeader view={view} names={names} code={snap.code} phone={phone} onOpen={setDrawer} onLeave={() => setConfirmLeave(true)} />

      <main className="tp-board" aria-label="The table">
        {game.isHost && offlineWaiting.length > 0 && view.phase !== 'gameOver' ? (
          <div className="tp-notice" role="status">
            <span>
              Waiting on <strong>{names.name(offlineWaiting[0])}</strong>, who seems to be offline.
            </span>
            <Button size="sm" variant="secondary" busy={pending === `bot:${offlineWaiting[0]}`} disabled={busy} onClick={() => setBot(offlineWaiting[0], true)}>
              Replace with a bot
            </Button>
          </div>
        ) : null}
        <div className="tp-seats" style={{ ['--n' as string]: n, ['--md' as string]: Math.min(n, 3), ['--sm' as string]: Math.min(n, 2) }}>
          {ordered.map((p) => (
            <Seat key={p.id} {...seatProps(p)} />
          ))}
        </div>
        {showHud && view.eating ? <EatingHud view={view} names={names} plateW={plateW} reduced={reduced} /> : null}
        <div className={cx('tp-ticker', showHud && 'tp-ticker--hud')}>
          {!showHud ? (
            <p key={current?.seq ?? 'none'} className={cx('tp-ticker__line', line && `tp-ticker__line--${line.tone}`)} aria-hidden="true">
              {line?.text ?? (view.phase === 'setup' ? 'Everyone hides their puri and one power.' : '')}
            </p>
          ) : null}
          {pb.queued > 1 ? (
            <button type="button" className="tp-link tp-ticker__skip" onClick={pb.skip} aria-label={`Skip ahead (${pb.queued} moves to show)`}>
              <Icon name="skip" size={16} /> Skip {pb.queued}
            </button>
          ) : null}
        </div>
      </main>
      {/* The one live region for the table: each move as it plays, then your turn (the header pill stays quiet). */}
      <div className="tp-sr" aria-live="polite">
        <p key={current?.seq ?? 'none'}>{line?.text ?? ''}</p>
        {yourMove && !overlayKey ? <p>{turnText(live, names)}.</p> : null}
      </div>

      <section className={cx('tp-dock', setupMode && 'tp-dock--setup')} aria-label="Your seat">
        <div className="tp-dock__inner">
          {setupMode ? (
            <SetupPanel
              key={view.round}
              view={setupView}
              names={names}
              color={me?.color ?? 'red'}
              busy={busy}
              pending={pending === 'setup'}
              phone={phone}
              botSeat={!!me?.isBot}
              onSubmit={async (stack, power) => {
                let ok = false;
                await run('setup', async () => {
                  ok = await game.act({ type: 'SUBMIT_SETUP', stack, power });
                });
                return ok;
              }}
            />
          ) : (
            <>
              {showHand ? (
                <div className="tp-dock__hand">
                  <span className="tp-dock__label">Your hand · {hand.length}</span>
                  <Hand
                    cards={hand}
                    color={me?.color ?? 'red'}
                    width={handW}
                    selected={legal.place ? sel : null}
                    pickable={legal.place && !busy ? legal.place.kinds : null}
                    onPick={(i) => setSel((s) => (s === i ? null : i))}
                    emptyText="Empty"
                  />
                </div>
              ) : null}
              <div className="tp-dock__prompt">
                <ActionPanel
                  view={actView}
                  names={names}
                  busy={busy}
                  pending={pending}
                  playing={pb.playing}
                  selectedKind={selKind}
                  onClearSelection={() => setSel(null)}
                  act={act}
                  onUnpeek={
                    peekingBite ? () => setBitePeek(null) : peek && (view.phase === 'roundEnd' || view.phase === 'gameOver') ? () => setPeek(false) : undefined
                  }
                  onTakeSeatBack={botSeat && you ? () => setBot(you, false) : undefined}
                  takingBack={pending === `bot:${you}`}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {shownMoment ? (
        <AkabareMoment
          moment={shownMoment}
          view={actView}
          names={names}
          phone={phone}
          busy={busy}
          pending={pending}
          act={act}
          onDismiss={() => setMoment(null)}
          watch={
            watchingBite
              ? {
                  offline: offlineWaiting.includes(shownMoment.eaterId),
                  onReplace: game.isHost ? () => setBot(shownMoment.eaterId, true) : undefined,
                  replacing: pending === `bot:${shownMoment.eaterId}`,
                  onPeek: () => setBitePeek(biteKey),
                }
              : undefined
          }
        />
      ) : null}
      {showResult && result ? (
        <RoundEndPanel
          view={actView}
          names={names}
          result={result}
          isHost={game.isHost}
          busy={busy}
          pending={pending}
          act={act}
          onPeek={() => setPeek(true)}
          onTakeSeatBack={me?.isBot && you ? () => setBot(you, false) : undefined}
        />
      ) : null}
      {showGameOver ? (
        <GameOverPanel
          view={view}
          names={names}
          isHost={game.isHost}
          busy={busy}
          pending={pending}
          onRematch={() => void run('rematch', game.rematch)}
          onPeek={() => setPeek(true)}
        />
      ) : null}

      <Drawer open={drawer === 'rules'} onClose={() => setDrawer(null)} title="Rules" wide>
        <RulesContent compact config={view.config} />
      </Drawer>
      <Drawer open={drawer === 'log'} onClose={() => setDrawer(null)} title="Game log">
        <LogList log={view.log} names={names} trapReward={view.config.trapReward} />
      </Drawer>
      <Drawer open={drawer === 'scores'} onClose={() => setDrawer(null)} title="Scores & seats">
        <ScoresPanel
          view={view}
          names={names}
          hostId={snap.hostId}
          isHost={game.isHost}
          online={game.online}
          graceOver={graceOver}
          busy={busy}
          pending={pending}
          onSetBot={setBot}
          onLeave={() => {
            setDrawer(null);
            setConfirmLeave(true);
          }}
        />
      </Drawer>
      <ConfirmDialog
        open={confirmLeave}
        title="Leave this game?"
        confirmLabel="Leave the game"
        danger
        busy={pending === 'leave'}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leave}
      >
        <p>A bot will take over your seat so the others can finish. You won’t be able to take it back from this browser.</p>
      </ConfirmDialog>
    </div>
  );
}
