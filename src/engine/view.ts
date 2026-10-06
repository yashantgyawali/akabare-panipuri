/**
 * Per-player projection of the secret GameState. This is the ONLY shape that
 * leaves the server. Card ids never appear; face-down kinds appear only to
 * their owner (or everyone after a reveal).
 */
import {
  VIEW_LOG_LIMIT,
  type EatingView,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  type PlayerView,
  type PrivateView,
  type PublicPlayerView,
  type PuriCard,
} from './types.ts';
import { legalActions, noLegalActions, pendingActors } from './engine.ts';
import { availablePowers, countKinds, tableMax } from './rules.ts';

/** Leftovers are revealed at gameOver, and at roundEnd when config.revealOnRoundEnd is set (decision 13). */
export function isRevealed(state: GameState): boolean {
  return state.phase === 'gameOver' || (state.phase === 'roundEnd' && state.config.revealOnRoundEnd);
}

export function projectView(state: GameState, viewerId: PlayerId | null): PlayerView {
  const viewer = viewerId === null ? null : (state.players.find((p) => p.id === viewerId) ?? null);
  const youId = viewer ? viewer.id : null;
  const revealed = isRevealed(state);
  return {
    youId,
    round: state.round,
    phase: state.phase,
    config: { ...state.config },
    firstPlayerId: state.firstPlayerId,
    players: state.players.map((p) => publicPlayer(p, youId, revealed)),
    me: viewer ? privateView(state, viewer) : null,
    serving: state.serving ? { ...state.serving } : null,
    bidding: state.bidding ? structuredClone(state.bidding) : null,
    eating: eatingView(state),
    results: structuredClone(state.results),
    winners: state.winners ? [...state.winners] : null,
    log: state.log.slice(-VIEW_LOG_LIMIT).map(copyEvent),
    lastSeq: state.nextSeq - 1,
    legal: youId ? legalActions(state, youId) : noLegalActions(),
    pendingActors: pendingActors(state),
    tableMax: tableMax(state),
    revealed,
  };
}

/** Views never alias the state; events are flat apart from these two (cheaper than structuredClone). */
function copyEvent(e: GameEvent): GameEvent {
  if (e.type === 'roundEnd') {
    const r = e.result;
    return { ...e, result: { ...r, scoreDeltas: { ...r.scoreDeltas }, scoresAfter: { ...r.scoresAfter } } };
  }
  if (e.type === 'gameOver') return { ...e, winners: [...e.winners], scores: { ...e.scores } };
  return { ...e };
}

function publicPlayer(p: PlayerState, youId: PlayerId | null, revealed: boolean): PublicPlayerView {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isBot: p.isBot,
    seat: p.seat,
    score: p.score,
    busts: p.busts,
    handCount: p.hand.length,
    setupDone: p.setupDone,
    ready: p.ready,
    stack: p.stack.map((c) => ({ owner: c.owner, kind: revealed || c.owner === youId ? c.kind : null })),
    power: p.power
      ? {
          owner: p.id,
          revealed: p.power.revealed,
          kind: p.power.revealed || revealed || p.id === youId ? p.power.kind : null,
        }
      : null,
  };
}

function privateView(state: GameState, me: PlayerState): PrivateView {
  return {
    hand: countKinds(me.hand),
    availablePowers: availablePowers(state, me.id),
    usedPowers: [...me.usedPowers],
    powerPicks: [...me.powerPicks],
    setup: submittedSetup(state, me),
  };
}

/**
 * The setup is the bottom `startingStack` cards of the player's stack as it
 * stood before eating. Eating only pops from the top, so that stack is the
 * remaining stack followed by the cards popped from it, in reverse pop order.
 */
function submittedSetup(state: GameState, me: PlayerState): PrivateView['setup'] {
  if (!me.power || !me.setupDone) return null;
  const popped: PuriCard[] = (state.eating?.plate ?? []).filter((x) => x.fromStackOf === me.id).map((x) => x.card);
  const original = [...me.stack, ...popped.reverse()];
  return {
    stack: original.slice(0, state.config.startingStack).map((c) => c.kind),
    power: me.power.kind,
  };
}

function eatingView(state: GameState): EatingView | null {
  const e = state.eating;
  if (!e) return null;
  const eater = state.players.find((p) => p.id === e.eaterId);
  return {
    eaterId: e.eaterId,
    bid: e.bid,
    target: e.target,
    eaten: e.eaten,
    powersFlipped: e.powersFlipped,
    skipNext: e.skipNext,
    freePlate: e.freePlate,
    pendingAkabare: e.pendingAkabare
      ? { owner: e.pendingAkabare.card.owner, fromStackOf: e.pendingAkabare.fromStackOf }
      : null,
    plate: e.plate.map((x) => ({
      owner: x.card.owner,
      kind: x.card.kind,
      fromStackOf: x.fromStackOf,
      cancelled: x.cancelled,
      saved: x.saved,
    })),
    powers: e.powers.map((x) => ({ ...x })),
    ownStackEmpty: !eater || eater.stack.length === 0,
  };
}
