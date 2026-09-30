/**
 * Bots. They decide ONLY from projectView(state, botId): `decideFromView`
 * never sees the GameState, so it cannot read anyone's secret cards.
 * Play is meant to be plausible and fun, not optimal (decision 15).
 */
import type {
  Action,
  GameEvent,
  GameState,
  PlayerId,
  PlayerView,
  PowerKind,
  PowerView,
  PublicPlayerView,
  PuriKind,
  StackCardView,
} from './types.ts';
import { applyAction, EngineError, pendingActors } from './engine.ts';
import { projectView } from './view.ts';
import { randStream, type Rand } from './rules.ts';

export function chooseBotAction(state: GameState, botId: PlayerId, rand?: Rand): Action | null {
  return decideFromView(projectView(state, botId), rand ?? randStream(state.rng).rand);
}

/** The bot's brain: a function of the bot's own view and a random source only. */
export function decideFromView(view: PlayerView, rand: Rand): Action | null {
  const me = view.youId;
  if (me === null || !view.pendingActors.includes(me)) return null;
  switch (view.phase) {
    case 'setup':
      return view.legal.setup && !view.legal.setup.submitted ? chooseSetup(view, rand) : null;
    case 'serving':
      return view.legal.startBid ? chooseServe(view, rand) : null;
    case 'bidding':
      return view.legal.raise ? chooseBid(view, rand) : null;
    case 'eating':
      return view.eating?.eaterId === me ? chooseEat(view, rand) : null;
    case 'roundEnd':
      if (view.legal.ready) return { type: 'READY' };
      return everyHumanReady(view) ? { type: 'FORCE_CONTINUE' } : null;
    case 'gameOver':
      return null;
  }
}

/** A guaranteed-legal move derived from `view.legal` alone (used if a heuristic ever misfires). */
export function fallbackAction(view: PlayerView): Action | null {
  const legal = view.legal;
  if (legal.setup && !legal.setup.submitted && legal.setup.availablePowers.length > 0) {
    const { hand, stackSize } = legal.setup;
    const stack = Array.from({ length: stackSize }, (_, i) => (i < hand.panipuri ? 'panipuri' : 'akabare') as PuriKind);
    return { type: 'SUBMIT_SETUP', stack, power: legal.setup.availablePowers[0] };
  }
  if (legal.startBid) return { type: 'START_BID', amount: legal.startBid.min };
  if (legal.pass) return { type: 'PASS' };
  if (legal.acceptBust) return { type: 'ACCEPT_BUST' };
  if (legal.flipPuri.length > 0) return { type: 'FLIP_PURI', targetPlayerId: legal.flipPuri[0] };
  if (legal.flipPower.length > 0) return { type: 'FLIP_POWER', targetPlayerId: legal.flipPower[0] };
  if (legal.ready) return { type: 'READY' };
  if (legal.forceContinue && everyHumanReady(view)) return { type: 'FORCE_CONTINUE' };
  return null;
}

export interface BotStep {
  state: GameState;
  events: GameEvent[];
  botId: PlayerId;
  action: Action;
  /** True if the heuristic's choice was rejected and the fallback was applied (should never happen). */
  usedFallback: boolean;
}

/** Applies one move by the first pending bot, advancing state.rng. null = no bot to move. */
export function botStep(state: GameState): BotStep | null {
  if (state.phase === 'gameOver') return null;
  const bots = new Set(state.players.filter((p) => p.isBot).map((p) => p.id));
  const botId = pendingActors(state).find((id) => bots.has(id));
  if (!botId) return null;
  const stream = randStream(state.rng);
  const chosen = chooseBotAction(state, botId, stream.rand);
  let action = chosen;
  let result = chosen ? applyAction(state, botId, chosen) : null;
  if (!result || !result.ok) {
    action = fallbackAction(projectView(state, botId));
    if (!action) return null;
    result = applyAction(state, botId, action);
    if (!result.ok) throw new EngineError(`Bot ${botId} has no legal move: ${result.error}`);
  }
  result.state.rng = stream.state();
  return { state: result.state, events: result.events, botId, action: action!, usedFallback: action !== chosen };
}

/** Applies bot moves (setup, turns, roundEnd continue) until a human must act or the game is over. */
export function runBots(state: GameState, maxSteps = 1000): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const step = botStep(s);
    if (!step) break;
    s = step.state;
    events.push(...step.events);
  }
  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Heuristics (view-only)
// ---------------------------------------------------------------------------

const pick = <T>(items: readonly T[], rand: Rand): T => items[Math.floor(rand() * items.length) % items.length];
const top = (stack: readonly StackCardView[]): StackCardView | undefined => stack[stack.length - 1];
const self = (view: PlayerView): PublicPlayerView => view.players.find((p) => p.id === view.youId)!;
const others = (view: PlayerView): PublicPlayerView[] => view.players.filter((p) => p.id !== view.youId);
const faceDown = (power: PowerView | null) => power !== null && !power.revealed;

function everyHumanReady(view: PlayerView): boolean {
  return view.players.every((p) => p.isBot || p.ready);
}

function weighted<T>(options: readonly [T, number][], rand: Rand): T {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r < 0) return value;
  }
  return options[options.length - 1][0];
}

function chooseSetup(view: PlayerView, rand: Rand): Action {
  const setup = view.legal.setup!;
  const size = setup.stackSize;
  // Keep the Akabare in hand to plant on someone else's stack; occasionally bluff with it at home.
  const withAkabare = setup.hand.akabare > 0 && (size > setup.hand.panipuri || rand() < 0.15);
  const stack = Array.from({ length: size }, (): PuriKind => 'panipuri');
  if (withAkabare) stack[Math.floor(rand() * size) % size] = 'akabare';
  // An Akabare at home wants protection; otherwise Chaat helps us eat and Khali traps others.
  const weights: Record<PowerKind, number> = withAkabare
    ? { vinegar: 4, dahi: 3, chaat: 2, khali: 1 }
    : { chaat: 3, khali: 2, vinegar: 2, dahi: 1.5 };
  const power = weighted(setup.availablePowers.map((k): [PowerKind, number] => [k, weights[k]]), rand);
  return { type: 'SUBMIT_SETUP', stack, power };
}

/**
 * Chance that a face-down card is an Akabare, from public info only: its
 * owner (back color), where it sits, and which Akabare are already on the
 * plate. Everyone has exactly one Akabare, and a rival's lone card on
 * someone else's stack is the classic plant.
 */
export function akabareOdds(view: PlayerView, card: StackCardView, stackOf: PlayerId): number {
  if (card.kind !== null) return card.kind === 'akabare' ? 1 : 0;
  const plate = view.eating?.plate ?? [];
  if (plate.some((x) => x.owner === card.owner && x.kind === 'akabare')) return 0;
  if (card.owner === stackOf) return 0.15;
  let away = 0;
  for (const p of view.players) {
    if (p.id !== card.owner) away += p.stack.filter((c) => c.owner === card.owner).length;
  }
  return Math.min(0.7, Math.max(0.1, 0.7 / Math.max(1, away)));
}

/**
 * Rough expected number of Panipuri this bot could eat if it won the bid:
 * its own stack card by card (a Vinegar/Dahi shield absorbs the worst card),
 * a discounted share of the other stacks, and +2 for an own face-down Chaat.
 */
export function estimateEatable(view: PlayerView): number {
  const me = self(view);
  const power = faceDown(me.power) ? me.power!.kind : null;
  let shield = power === 'vinegar' || power === 'dahi';
  let expected = 0;
  let survive = 1;
  for (let i = me.stack.length - 1; i >= 0; i--) {
    const risk = akabareOdds(view, me.stack[i], me.id);
    if (shield && risk >= 0.4) {
      shield = false;
      expected += survive * (1 - risk) * (power === 'dahi' ? 1 : 0);
      continue;
    }
    survive *= 1 - risk * 0.9; // a blind Dahi occasionally saves a bite
    expected += survive * (1 - risk);
  }
  let othersSafe = 0;
  for (const p of others(view)) for (const c of p.stack) othersSafe += 1 - akabareOdds(view, c, p.id);
  expected += survive * Math.min(othersSafe, 4) * 0.5;
  if (power === 'chaat') expected += 2 * survive;
  return expected;
}

function openingBid(view: PlayerView, rand: Rand): Action {
  const min = view.legal.startBid!.min;
  const amount = Math.round(estimateEatable(view) + rand() * 1.4 - 0.4);
  return { type: 'START_BID', amount: Math.max(min, amount) };
}

function chooseServe(view: PlayerView, rand: Rand): Action {
  const place = view.legal.place;
  if (!place) return openingBid(view, rand);
  const me = self(view);
  const hand = view.me!.hand;
  const rivals = others(view);
  if (hand.akabare > 0 && rand() < 0.8) {
    return { type: 'PLACE_PURI', kind: 'akabare', targetPlayerId: pick(rivals, rand).id };
  }
  if (hand.panipuri > 0) {
    if (estimateEatable(view) >= 3 && rand() < 0.3) return openingBid(view, rand);
    // Own Panipuri on your own stack is known-safe food if you end up eating.
    const target = rand() < 0.75 ? me.id : pick(rivals, rand).id;
    return { type: 'PLACE_PURI', kind: 'panipuri', targetPlayerId: target };
  }
  if (rand() < 0.5) return openingBid(view, rand);
  return { type: 'PLACE_PURI', kind: 'akabare', targetPlayerId: pick(rivals, rand).id };
}

function chooseBid(view: PlayerView, rand: Rand): Action {
  const min = view.legal.raise!.min;
  const estimate = estimateEatable(view) + rand() * 1.2 - 0.2;
  if (min > estimate) return { type: 'PASS' };
  const amount = estimate >= min + 1.5 && rand() < 0.25 ? min + 1 : min;
  return { type: 'RAISE', amount };
}

function chooseEat(view: PlayerView, rand: Rand): Action {
  const legal = view.legal;
  const e = view.eating!;
  const me = self(view);
  const ownPower = faceDown(me.power) && legal.flipPower.includes(me.id) ? me.power!.kind : null;
  const blind = legal.flipPower.filter((id) => id !== me.id);

  if (e.pendingAkabare) {
    // Bitten: pray for Dahi. Own Dahi is a sure thing; own anything-else is a sure bust.
    if (ownPower === 'dahi') return { type: 'FLIP_POWER', targetPlayerId: me.id };
    if (blind.length > 0) return { type: 'FLIP_POWER', targetPlayerId: pick(blind, rand) };
    return { type: 'ACCEPT_BUST' };
  }

  const need = e.target - e.eaten;
  if (legal.flipPuri.length === 0) {
    // Empty table and short: only Chaat can help. Gamble only if Chaat(s) could still get there.
    if (ownPower === 'chaat') return { type: 'FLIP_POWER', targetPlayerId: me.id };
    const flipsLeft = view.config.powerFlipsMax - e.powersFlipped;
    if (blind.length > 0 && need <= 2 * flipsLeft) return { type: 'FLIP_POWER', targetPlayerId: pick(blind, rand) };
    return legal.acceptBust ? { type: 'ACCEPT_BUST' } : fallbackAction(view)!;
  }

  if (ownPower === 'chaat' && (need <= 2 || rand() < 0.15)) return { type: 'FLIP_POWER', targetPlayerId: me.id };

  // Prefer the safest-looking top card; own known Panipuri is best, own Akabare worst.
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const ranked = legal.flipPuri
    .map((id) => {
      const card = top(byId.get(id)!.stack)!;
      const risk = e.skipNext ? 0 : akabareOdds(view, card, id);
      const mine = card.owner === me.id && card.kind === 'panipuri';
      return { id, risk, score: (mine ? 1 : 0) - risk * 2 + rand() * 0.3 };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  // Numb the tongue first when the next bite looks like (or is known to be) an Akabare.
  if (ownPower === 'vinegar' && !e.skipNext && best.risk >= 0.5) {
    return { type: 'FLIP_POWER', targetPlayerId: me.id };
  }
  return { type: 'FLIP_PURI', targetPlayerId: best.id };
}
