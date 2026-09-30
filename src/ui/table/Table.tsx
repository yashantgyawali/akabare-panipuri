/**
 * The table (playing / finished). Everything renders from `view` = the live
 * PlayerView rewound to the playback cursor (see ../playback), so bots' and
 * other players' moves play one at a time and the table always matches the
 * announcer. Actions come only from view.legal (empty while events play).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { describeEvent, makeNameBook, powerName, type NameBook } from '../text.ts';
import { LogList, ScoresPanel, TableHeader, type DrawerName } from './Chrome.tsx';
import { EatingHud } from './EatingHud.tsx';
import { Hand, handCards } from './Hand.tsx';
import { AkabareMoment, GameOverPanel, RoundEndPanel, type Moment } from './Overlays.tsx';
import { ActionPanel } from './Panels.tsx';
import { Plate } from './Plate.tsx';
import { Seat, stackLabel, type Clickable, type SeatProps, type SeatStatus } from './Seat.tsx';
import { SetupPanel, WaitingList } from './SetupPanel.tsx';

const NO_LEGAL = noLegalActions();

function seatOrder(players: readonly PublicPlayerView[], you: PlayerId | null): PublicPlayerView[] {
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);
  const i = Math.max(0, bySeat.findIndex((p) => p.id === you));
  return [...bySeat.slice(i), ...bySeat.slice(0, i)];
}

function statusFor(p: PublicPlayerView, view: PlayerView): SeatStatus | null {
  switch (view.phase) {
    case 'setup':
      return p.setupDone ? { label: 'Set', tone: 'done' } : { label: 'Setting up…', tone: 'wait' };
    case 'serving':
      if (view.serving?.turnId === p.id) return { label: 'Serving', tone: 'turn' };
      return view.firstPlayerId === p.id ? { label: 'Served first', tone: 'wait' } : null;
    case 'bidding': {
      const b = view.bidding;
      if (!b) return null;
      if (b.turnId === p.id) return { label: 'Raise or pass?', tone: 'turn' };
      if (b.passed.includes(p.id)) return { label: 'Passed', tone: 'passed' };
      if (b.highBidderId === p.id) return { label: `High bid ${b.highBid}`, tone: 'high' };
      return null;
    }
    case 'eating': {
      const e = view.eating;
      if (e?.eaterId === p.id) return { label: `Eating ${e.eaten}/${e.target}`, tone: 'eater' };
      return view.bidding?.passed.includes(p.id) ? { label: 'Watching', tone: 'passed' } : null;
    }
    case 'roundEnd': {
      const r = view.results.find((x) => x.round === view.round);
      if (r?.eaterId === p.id) return r.outcome === 'success' ? { label: `Ate ${r.target}`, tone: 'done' } : { label: 'Bust', tone: 'bust' };
      return p.isBot || p.ready ? { label: 'Ready', tone: 'done' } : { label: 'Reading…', tone: 'wait' };
    }
    case 'gameOver':
      return view.winners?.includes(p.id) ? { label: 'Winner', tone: 'win' } : null;
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

function BidBoard({ view, names }: { view: PlayerView; names: NameBook }) {
  const b = view.bidding;
  if (!b) return null;
  return (
    <div className="ak-bidboard">
      <div className="ak-bidboard__high" style={{ ['--c' as string]: `var(--pc-${names.color(b.highBidderId)})` }}>
        <span className="ak-bidboard__label">{view.phase === 'bidding' ? 'High bid' : 'Winning bid'}</span>
        <span className="ak-bidboard__num" key={b.highBid}>
          {b.highBid}
        </span>
        <span className="ak-bidboard__by">by {names.who(b.highBidderId)}</span>
      </div>
      <ol className="ak-bidchips" aria-label="Bids so far">
        {b.history.map((h, i) => (
          <li key={i} className={cx('ak-bidchip', `ak-bidchip--${h.action}`)} style={{ ['--c' as string]: `var(--pc-${names.color(h.playerId)})` }}>
            <span className="ak-bidchip__who" aria-hidden="true">
              {names.initial(h.playerId)}
            </span>
            <span className="ak-sr">{names.who(h.playerId)} </span>
            {h.action === 'pass' ? 'pass' : h.amount}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CenterStage({ view, names, plateW, reduced, compact }: { view: PlayerView; names: NameBook; plateW: number; reduced: boolean; compact: boolean }) {
  const you = view.youId;
  switch (view.phase) {
    case 'setup':
      return (
        <div className="ak-stage ak-stage--setup">
          <p className="ak-stage__kicker">Round {view.round}</p>
          <h2 className="ak-stage__title">Hide your puri</h2>
          <p className="ak-stage__text">
            Everyone places {view.config.startingStack} puri face down and one power. {view.firstPlayerId === you ? 'You serve' : `${names.name(view.firstPlayerId)} serves`} first.
          </p>
          <WaitingList view={view} names={names} />
        </div>
      );
    case 'serving': {
      const turn = view.serving?.turnId ?? null;
      return (
        <div className="ak-stage">
          <p className="ak-stage__kicker">Round {view.round} · serving</p>
          <h2 className="ak-stage__title">{turn === you ? 'Your turn to serve' : `${names.name(turn)} is serving`}</h2>
          <p className="ak-stage__text">Place a puri on any stack, or start the bid.</p>
          <p className="ak-stage__meta">
            Most anyone could eat right now: <strong>{view.tableMax}</strong>
          </p>
        </div>
      );
    }
    case 'bidding':
      return (
        <div className="ak-stage">
          <p className="ak-stage__kicker">Round {view.round} · bidding</p>
          <BidBoard view={view} names={names} />
          <p className="ak-stage__meta">
            Most anyone could eat: <strong>{view.tableMax}</strong>
          </p>
        </div>
      );
    case 'eating':
    case 'roundEnd':
    case 'gameOver':
      return (
        <div className="ak-stage ak-stage--eat">
          {view.eating ? <EatingHud view={view} names={names} compact={compact} /> : null}
          {view.eating ? <Plate plate={view.eating.plate} names={names} width={plateW} reduced={reduced} empty="The plate is empty" /> : null}
        </div>
      );
  }
}

export function Table({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const live = snap.view!;
  const you = snap.youId;
  const reduced = useReducedMotion();
  const phone = usePhone();
  const big = useMediaQuery('(min-width: 1180px) and (min-height: 760px)');
  const pb = usePlayback(live, you, reduced);
  const view = pb.display ?? live;
  const names = useMemo(() => makeNameBook(view.players, you), [view.players, you]);
  const toast = useToast();
  const { pending, run } = useRunner();
  const busy = game.busy;
  const gameAct = game.act;
  const act = useCallback(
    (key: string, action: Action) => {
      void run(key, () => gameAct(action));
    },
    [run, gameAct],
  );
  const graceOver = useAfter(6000);
  const [drawer, setDrawer] = useState<DrawerName>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const [moment, setMoment] = useState<Moment | null>(null);

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
  const current = pb.current;
  useEffect(() => {
    const e = current;
    if (!e) return;
    if (e.type === 'bite') {
      setMoment({ eaterId: e.eaterId, owner: e.owner, fromStackOf: e.fromStackOf, stage: 'bitten' });
    } else if (e.type === 'flipPower' && (e.effect === 'saved' || e.effect === 'failedSave')) {
      setMoment((m) => ({
        eaterId: e.eaterId,
        owner: m?.owner ?? e.owner,
        fromStackOf: m?.fromStackOf ?? e.fromStackOf,
        stage: e.effect === 'saved' ? 'saved' : 'failed',
        power: { kind: e.kind, owner: e.owner },
      }));
    } else if (e.type === 'bust' && e.reason === 'akabare') {
      setMoment((m) =>
        m
          ? { ...m, stage: 'bust', trapRewardTo: e.trapRewardTo, target: e.target }
          : { eaterId: e.eaterId, owner: e.akabareOwnerId ?? e.eaterId, fromStackOf: e.eaterId, stage: 'bust', trapRewardTo: e.trapRewardTo, target: e.target },
      );
    } else if (e.type === 'roundEnd' || e.type === 'roundStart' || e.type === 'success' || e.type === 'flipPuri') {
      setMoment((m) => (m && (e.type !== 'flipPuri' || m.stage === 'saved') ? null : m));
    }
  }, [current]);
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
  const shownMoment: Moment | null =
    moment && (moment.stage !== 'bitten' || bite)
      ? moment
      : bite && view.eating
        ? { eaterId: view.eating.eaterId, owner: bite.owner, fromStackOf: bite.fromStackOf, stage: 'bitten' }
        : null;

  const result = view.phase === 'roundEnd' || view.phase === 'gameOver' ? (view.results.find((r) => r.round === view.round) ?? null) : null;
  const showResult = view.phase === 'roundEnd' && !!result && !shownMoment && !peek;
  const showGameOver = view.phase === 'gameOver' && !shownMoment && !peek;

  // Browser tab title: nudge when it's your move.
  const yourMove =
    !pb.playing &&
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
  const opponents = ordered.slice(1);
  const m = Math.min(5, Math.max(1, opponents.length));

  const oppW = phone ? 38 : big ? 60 : 52;
  const oppMax = phone ? 90 : big ? 152 : 128;
  const meW = phone ? 42 : big ? 62 : 56;
  const meMax = phone ? 104 : big ? 150 : 132;
  const handW = phone ? 62 : big ? 92 : 80;
  const plateW = phone ? 40 : big ? 54 : 46;

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
  const seatProps = (p: PublicPlayerView, variant: 'opp' | 'me'): SeatProps => ({
    p,
    view,
    names,
    isHost: p.id === snap.hostId,
    online: p.isBot || !graceOver ? null : p.id === you || game.online.includes(p.id),
    turn: (view.phase === 'serving' || view.phase === 'bidding' || view.phase === 'eating') && view.pendingActors.includes(p.id),
    status: statusFor(p, view),
    cardW: variant === 'me' ? meW : oppW,
    stackMax: variant === 'me' ? meMax : oppMax,
    stack: stackClick(p),
    power: powerClick(p),
    cue: cueFor(p, current),
    variant,
    compact: phone,
  });

  const setupMode = view.phase === 'setup';
  const setupView = live.phase === 'setup' && live.round === view.round ? live : view;
  const placing = !!legal.place && selKind !== null;

  const leave = () =>
    void run('leave', async () => {
      const ok = await game.leave();
      setConfirmLeave(false);
      if (ok) navigate(HOME);
    });

  return (
    <div className={cx('ak-tablescreen', `ak-phase-${view.phase}`, placing && 'is-placing', phone && 'is-phone')}>
      <TableHeader view={view} names={names} code={snap.code} phone={phone} onOpen={setDrawer} onLeave={() => setConfirmLeave(true)} />

      {me?.isBot && view.phase !== 'gameOver' ? (
        <div className="ak-banner" role="status">
          <Icon name="bot" size={18} />
          <span>A bot is playing your seat.</span>
          <Button size="sm" variant="primary" busy={pending === `bot:${you}`} disabled={busy} onClick={() => setBot(you, false)}>
            Take my seat back
          </Button>
        </div>
      ) : null}
      {game.isHost && offlineWaiting.length > 0 && view.phase !== 'gameOver' ? (
        <div className="ak-banner ak-banner--warn" role="status">
          <span>
            Waiting on <strong>{names.name(offlineWaiting[0])}</strong>, who seems to be offline.
          </span>
          <Button size="sm" variant="secondary" busy={pending === `bot:${offlineWaiting[0]}`} disabled={busy} onClick={() => setBot(offlineWaiting[0], true)}>
            Replace with a bot
          </Button>
        </div>
      ) : null}

      <main className={cx('ak-arena', `ak-arena--m${m}`)} aria-label="The table">
        <div className="ak-felt" aria-hidden="true" />
        <div className="ak-opps">
          {opponents.map((p, i) => (
            <div
              key={p.id}
              className={cx('ak-oppslot', m >= 3 && (i === 0 || i === m - 1) && 'ak-oppslot--side')}
              style={{ gridArea: `s${i + 1}` }}
            >
              <Seat {...seatProps(p, 'opp')} />
            </div>
          ))}
        </div>
        <div className="ak-center">
          <div className="ak-announce" aria-hidden="true">
            {line ? (
              <p key={current?.seq} className={cx('ak-announce__line', `ak-announce__line--${line.tone}`)} style={line.actor ? { ['--c' as string]: `var(--pc-${names.color(line.actor)})` } : undefined}>
                {line.text}
              </p>
            ) : null}
            {pb.queued > 1 ? (
              <button type="button" className="ak-skip" onClick={pb.skip} aria-label={`Skip ahead (${pb.queued} moves to show)`}>
                <Icon name="skip" size={16} /> Skip {pb.queued}
              </button>
            ) : null}
          </div>
          <CenterStage view={view} names={names} plateW={plateW} reduced={reduced} compact={phone} />
        </div>
      </main>
      <p className="ak-sr" aria-live="polite">
        {line?.text ?? ''}
      </p>

      <section className={cx('ak-dock', setupMode && 'ak-dock--setup')} aria-label="Your seat">
        {me ? (
          <div className="ak-dock__seat">
            <Seat {...seatProps(me, 'me')} />
          </div>
        ) : null}
        {setupMode ? (
          <div className="ak-dock__setup">
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
          </div>
        ) : (
          <>
            <div className="ak-dock__hand">
              <Hand
                cards={hand}
                color={me?.color ?? 'red'}
                width={handW}
                selected={legal.place ? sel : null}
                pickable={legal.place && !busy ? legal.place.kinds : null}
                onPick={(i) => setSel((s) => (s === i ? null : i))}
                emptyText={view.phase === 'serving' || view.phase === 'bidding' ? 'Your hand is empty.' : 'No cards in hand.'}
              />
            </div>
            <div className="ak-dock__panel">
              <ActionPanel
                view={actView}
                names={names}
                busy={busy}
                pending={pending}
                playing={pb.playing}
                selectedKind={selKind}
                onClearSelection={() => setSel(null)}
                act={act}
              />
            </div>
          </>
        )}
      </section>

      {shownMoment ? (
        <AkabareMoment moment={shownMoment} view={actView} names={names} phone={phone} busy={busy} pending={pending} act={act} onDismiss={() => setMoment(null)} />
      ) : null}
      {showResult && result ? (
        <RoundEndPanel view={actView} names={names} result={result} isHost={game.isHost} busy={busy} pending={pending} act={act} onPeek={() => setPeek(true)} />
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
      {peek && (view.phase === 'roundEnd' || view.phase === 'gameOver') ? (
        <button type="button" className="ak-peekback ak-btn ak-btn--primary ak-btn--md" onClick={() => setPeek(false)}>
          <span className="ak-btn__label">{view.phase === 'gameOver' ? 'Back to the results' : 'Back to the round result'}</span>
        </button>
      ) : null}

      <Drawer open={drawer === 'rules'} onClose={() => setDrawer(null)} title="Rules" wide>
        <RulesContent compact />
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
