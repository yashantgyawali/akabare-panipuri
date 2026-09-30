/**
 * Property audit. Lens: information security, bot fairness, legal-action
 * consistency, purity/determinism and robustness (complements fuzz.test.ts
 * and audit.rules.test.ts).
 *
 * 1. projectView leaks nothing, for every viewer (and spectators) at every step
 *    of many seeded games, checked two ways: against an oracle written from
 *    decision 13, and by indistinguishability. A secretly different world
 *    (other owners' hidden cards shuffled between their hidden slots, their
 *    face-down powers and power history re-drawn) must give the viewer a
 *    byte-identical view, identical bot decisions and identical answers
 *    (ok / error text) to the viewer's own actions.
 * 2. Bots decide only from their own view (explicit two-world construction).
 * 3. legalActions ⇔ applyAction accepts, over a universe of candidate actions,
 *    plus a named battery of illegal moves.
 * 4. Purity and determinism, including JSON round trips (the server stores the
 *    state as jsonb): no mutation, no aliasing, replayable, runBots stable.
 * 5. Malformed actions and player ids are rejected, never thrown.
 */
import { describe, expect, test } from 'vitest';
import {
  applyAction,
  botStep,
  chooseBotAction,
  COLORS,
  createGame,
  decideFromView,
  DEFAULT_CONFIG,
  legalActions,
  noLegalActions,
  pendingActors,
  POWER_KINDS,
  projectView,
  PURI_KINDS,
  randStream,
  runBots,
  setBot,
  VIEW_LOG_LIMIT,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
  type LegalActions,
  type PlayerId,
  type PlayerSeed,
  type PlayerView,
  type PowerKind,
  type PuriCard,
  type PuriKind,
  type Rand,
} from './index.ts';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const P: PuriKind = 'panipuri';
const A: PuriKind = 'akabare';
const GHOST = 'ghost-not-seated';

const json = (x: unknown): string => JSON.stringify(x);
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rng = (seed: number): Rand => randStream(seed).rand;
const pick = <T>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)];

function shuffle<T>(xs: T[], rand: Rand): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

function must(cond: boolean, msg: string | (() => string)): void {
  if (!cond) throw new Error(typeof msg === 'string' ? msg : msg());
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Calls `visit` on every object/array node of a JSON-like tree. */
function walk(x: unknown, visit: (node: object, path: string) => void, path = '$'): void {
  if (x === null || typeof x !== 'object') return;
  visit(x, path);
  for (const [k, v] of Object.entries(x)) walk(v, visit, `${path}.${k}`);
}

/** What Postgres jsonb does to an object: keys re-ordered (shorter first, then bytewise), arrays kept. */
function jsonbRoundTrip<T>(x: T): T {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v === null || typeof v !== 'object') return v;
    const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, norm((v as Record<string, unknown>)[k])]));
  };
  return norm(roundTrip(x)) as T;
}

/** Key-order-insensitive JSON, for comparing results across a jsonb round trip. */
const canonical = (x: unknown): string => json(jsonbRoundTrip(x));

const revealedOracle = (s: GameState): boolean =>
  s.phase === 'gameOver' || (s.phase === 'roundEnd' && s.config.revealOnRoundEnd);

const NAMES = ['Sita', 'Ramesh', 'Anil', 'Priya', 'Maya', 'Hari'];

/** Distinctive uuid-ish ids so a leaked card id (`${ownerId}:p3`) is easy to spot. */
function seatsFor(n: number, isBot: (i: number) => boolean): PlayerSeed[] {
  return NAMES.slice(0, n).map((name, i) => ({
    id: `9c${i}e-${name.toLowerCase()}-41d7`,
    name,
    color: COLORS[i],
    isBot: isBot(i),
  }));
}

function tagOf(s: GameState): string {
  if (s.phase !== 'eating') return s.phase;
  const e = s.eating!;
  if (e.pendingAkabare) return 'eating:pending';
  if (s.players.every((p) => p.stack.length === 0)) return 'eating:emptyTable';
  return s.players.find((p) => p.id === e.eaterId)!.stack.length > 0 ? 'eating:own' : 'eating:others';
}

// ---------------------------------------------------------------------------
// Action enumeration
// ---------------------------------------------------------------------------

function kindCombos(size: number): PuriKind[][] {
  let out: PuriKind[][] = [[]];
  for (let i = 0; i < size; i++) out = out.flatMap((xs) => PURI_KINDS.map((k) => [...xs, k]));
  return out;
}

/** Every concrete action the legal set advertises (bids at min and min + 3). */
function advertisedActions(s: GameState, id: PlayerId): Action[] {
  const L = legalActions(s, id);
  const out: Action[] = [];
  if (L.setup) {
    for (const stack of kindCombos(L.setup.stackSize)) {
      const ak = stack.filter((k) => k === A).length;
      if (ak > L.setup.hand.akabare || stack.length - ak > L.setup.hand.panipuri) continue;
      for (const power of L.setup.availablePowers) out.push({ type: 'SUBMIT_SETUP', stack, power });
    }
  }
  if (L.place) {
    for (const kind of L.place.kinds) {
      for (const t of L.place.targets) out.push({ type: 'PLACE_PURI', kind, targetPlayerId: t });
    }
  }
  if (L.startBid) {
    out.push({ type: 'START_BID', amount: L.startBid.min }, { type: 'START_BID', amount: L.startBid.min + 3 });
  }
  if (L.raise) out.push({ type: 'RAISE', amount: L.raise.min }, { type: 'RAISE', amount: L.raise.min + 3 });
  if (L.pass) out.push({ type: 'PASS' });
  for (const t of L.flipPuri) out.push({ type: 'FLIP_PURI', targetPlayerId: t });
  for (const t of L.flipPower) out.push({ type: 'FLIP_POWER', targetPlayerId: t });
  if (L.acceptBust) out.push({ type: 'ACCEPT_BUST' });
  if (L.ready) out.push({ type: 'READY' });
  if (L.forceContinue) out.push({ type: 'FORCE_CONTINUE' });
  return out;
}

/** A universe of well-formed candidate actions: legal and illegal, every type, every target. */
function candidateActions(s: GameState): Action[] {
  const c = s.config;
  const ids = [...s.players.map((p) => p.id), GHOST];
  const out: Action[] = [];
  for (const stack of kindCombos(c.startingStack)) {
    for (const power of POWER_KINDS) out.push({ type: 'SUBMIT_SETUP', stack, power });
  }
  for (const size of [c.startingStack - 1, c.startingStack + 1]) {
    out.push({ type: 'SUBMIT_SETUP', stack: Array.from({ length: size }, () => P), power: 'khali' });
  }
  for (const kind of PURI_KINDS) for (const t of ids) out.push({ type: 'PLACE_PURI', kind, targetPlayerId: t });
  const high = s.bidding?.highBid ?? c.minBid;
  const amounts = [...new Set([-1, 0, c.minBid - 1, c.minBid, c.minBid + 3, high - 1, high, high + 1, high + 4])];
  for (const amount of amounts) out.push({ type: 'START_BID', amount }, { type: 'RAISE', amount });
  for (const t of ids) out.push({ type: 'FLIP_PURI', targetPlayerId: t }, { type: 'FLIP_POWER', targetPlayerId: t });
  out.push({ type: 'PASS' }, { type: 'ACCEPT_BUST' }, { type: 'READY' }, { type: 'FORCE_CONTINUE' });
  return out;
}

function isAdvertised(L: LegalActions, a: Action): boolean {
  switch (a.type) {
    case 'SUBMIT_SETUP': {
      if (!L.setup || a.stack.length !== L.setup.stackSize) return false;
      const ak = a.stack.filter((k) => k === A).length;
      return (
        ak <= L.setup.hand.akabare && a.stack.length - ak <= L.setup.hand.panipuri && L.setup.availablePowers.includes(a.power)
      );
    }
    case 'PLACE_PURI':
      return !!L.place && L.place.kinds.includes(a.kind) && L.place.targets.includes(a.targetPlayerId);
    case 'START_BID':
      return !!L.startBid && a.amount >= L.startBid.min;
    case 'RAISE':
      return !!L.raise && a.amount >= L.raise.min;
    case 'PASS':
      return L.pass;
    case 'FLIP_PURI':
      return L.flipPuri.includes(a.targetPlayerId);
    case 'FLIP_POWER':
      return L.flipPower.includes(a.targetPlayerId);
    case 'ACCEPT_BUST':
      return L.acceptBust;
    case 'READY':
      return L.ready;
    case 'FORCE_CONTINUE':
      return L.forceContinue;
  }
}

// ---------------------------------------------------------------------------
// Driver: seeded games played move by move
// ---------------------------------------------------------------------------

type Move = { kind: 'act'; id: PlayerId; action: Action } | { kind: 'setBot'; id: PlayerId; isBot: boolean };
type Setup = { stack: PuriKind[]; power: PowerKind };

interface Spec {
  seed: number;
  n: number;
  config: Partial<GameConfig>;
  bots: (i: number) => boolean;
  churn: boolean;
}

interface StepInfo {
  prev: GameState;
  move: Move;
  events: GameEvent[];
  /** Oracle for `me.setup`: what each player submitted this round. */
  setups: ReadonlyMap<PlayerId, Setup>;
}

function applyMove(s: GameState, m: Move): { state: GameState; events: GameEvent[] } {
  if (m.kind === 'setBot') {
    const state = setBot(s, m.id, m.isBot);
    return { state, events: state.log.slice(s.log.length) };
  }
  const r = applyAction(s, m.id, deepFreeze(m.action));
  if (!r.ok) throw new Error(`advertised move rejected: ${m.id} ${json(m.action)} in ${tagOf(s)}: ${r.error}`);
  // Nothing from the (untrusted) action object may end up inside the state.
  const actionNodes = new Set<object>();
  walk(m.action, (node) => actionNodes.add(node));
  walk({ ...r.state, log: r.events }, (node, path) => must(!actionNodes.has(node), `the state aliases the action at ${path}`));
  return r;
}

/** Every seat, bot or human, is mostly driven by the bot brain; else a random advertised move. */
function nextMove(s: GameState, rand: Rand, churn: boolean): Move {
  if (churn && rand() < 0.02) {
    const p = pick(s.players, rand);
    return { kind: 'setBot', id: p.id, isBot: !p.isBot };
  }
  let id = pick(pendingActors(s), rand);
  if (s.phase === 'setup' && rand() < 0.1) {
    const done = s.players.filter((p) => p.setupDone);
    if (done.length > 0) id = pick(done, rand).id; // a change of mind before the last submission
  }
  const brain = rand() < 0.75 ? chooseBotAction(s, id, rand) : null;
  const options = advertisedActions(s, id);
  must(brain !== null || options.length > 0, () => `${id} is pending in ${tagOf(s)} with nothing to do`);
  return { kind: 'act', id, action: brain ?? pick(options, rand) };
}

/** Plays a seeded game to the end. Every state handed around is deep-frozen. */
function play(spec: Spec, visit?: (s: GameState, step: StepInfo | null) => void): { final: GameState; moves: Move[] } {
  const rand = rng(spec.seed * 7919 + 17);
  let s = deepFreeze(createGame(seatsFor(spec.n, spec.bots), spec.config, spec.seed));
  const setups = new Map<PlayerId, Setup>();
  visit?.(s, null);
  const moves: Move[] = [];
  for (let i = 0; s.phase !== 'gameOver'; i++) {
    must(i < 6000, `game ${spec.seed} did not terminate`);
    const m = nextMove(s, rand, spec.churn);
    const { state, events } = applyMove(s, m);
    if (events.some((e) => e.type === 'roundStart')) setups.clear();
    if (m.kind === 'act' && m.action.type === 'SUBMIT_SETUP') {
      setups.set(m.id, { stack: [...m.action.stack], power: m.action.power });
    }
    moves.push(m);
    const prev = s;
    s = deepFreeze(state);
    visit?.(s, { prev, move: m, events, setups });
  }
  return { final: s, moves };
}

const CONFIGS: Partial<GameConfig>[] = [
  { maxRounds: 3 },
  { revealOnRoundEnd: true, maxRounds: 3 },
  { targetScore: 6, maxRounds: 6 },
  { startingStack: 1, powerFlipsMax: 1, trapReward: 3, maxRounds: 3 },
  { startingStack: 3, panipuriPerPlayer: 2, powerResetRound: 2, minBid: 2, maxRounds: 3 },
  { powerFlipsMax: 3, powerResetRound: 5, revealOnRoundEnd: true, maxRounds: 3 },
  { targetScore: null, maxRounds: 2, trapReward: 0 },
];

function specs(count: number, salt: number): Spec[] {
  return Array.from({ length: count }, (_, g) => ({
    seed: (g + 1) * 104729 + salt,
    n: 3 + ((g + salt) % 4),
    config: CONFIGS[(g + salt) % CONFIGS.length],
    bots: (i: number) => (g + i + salt) % 3 === 0,
    churn: (g + salt) % 2 === 1,
  }));
}

// ---------------------------------------------------------------------------
// The view oracle (decision 13 / 14) and event whitelist
// ---------------------------------------------------------------------------

function exactKeys(obj: unknown, keys: readonly string[], where: string): void {
  must(obj !== null && typeof obj === 'object' && !Array.isArray(obj), () => `${where} is not an object`);
  const got = Object.keys(obj as object);
  for (const k of got) must(keys.includes(k), () => `${where} has an unexpected field "${k}"`);
  for (const k of keys) must(got.includes(k), () => `${where} lacks "${k}"`);
}

const VIEW_KEYS = [
  'youId', 'round', 'phase', 'config', 'firstPlayerId', 'players', 'me', 'serving', 'bidding', 'eating',
  'results', 'winners', 'log', 'lastSeq', 'legal', 'pendingActors', 'tableMax', 'revealed',
];
const PLAYER_KEYS = [
  'id', 'name', 'color', 'isBot', 'seat', 'score', 'busts', 'handCount', 'setupDone', 'ready', 'stack', 'power',
];
const ME_KEYS = ['hand', 'availablePowers', 'usedPowers', 'powerPicks', 'setup'];
const EATING_KEYS = [
  'eaterId', 'bid', 'target', 'eaten', 'powersFlipped', 'skipNext', 'pendingAkabare', 'plate', 'powers', 'ownStackEmpty',
];
const RESULT_KEYS = [
  'round', 'eaterId', 'bid', 'target', 'eaten', 'outcome', 'bustReason', 'akabareOwnerId', 'trapRewardTo',
  'scoreDeltas', 'scoresAfter',
];
const EVENT_KEYS: Record<GameEvent['type'], string[]> = {
  roundStart: ['firstPlayerId', 'availablePowersReset'],
  setupDone: ['playerId'],
  servingStart: ['turnId'],
  place: ['playerId', 'onStackOf'],
  bidStart: ['playerId', 'amount'],
  raise: ['playerId', 'amount'],
  pass: ['playerId'],
  eater: ['playerId', 'bid'],
  flipPuri: ['eaterId', 'fromStackOf', 'owner', 'kind', 'cancelled', 'eaten', 'target'],
  bite: ['eaterId', 'fromStackOf', 'owner'],
  flipPower: ['eaterId', 'fromStackOf', 'owner', 'kind', 'effect', 'eaten', 'target'],
  success: ['eaterId', 'target', 'eaten'],
  bust: ['eaterId', 'reason', 'target', 'eaten', 'akabareOwnerId', 'trapRewardTo'],
  roundEnd: ['result'],
  ready: ['playerId'],
  gameOver: ['winners', 'scores'],
  botSet: ['playerId', 'isBot'],
};

function noCardIds(text: string, s: GameState, where: string): void {
  for (const p of s.players) must(!text.includes(`${p.id}:`), () => `${where} contains a card id of ${p.id}`);
}

/** New events carry only public facts; flipPuri kinds match the (face-up) plate, card for card. */
function checkEvents(s: GameState, events: readonly GameEvent[]): void {
  for (const e of events) {
    exactKeys(e, ['type', 'seq', 'round', ...EVENT_KEYS[e.type]], `event ${e.type}`);
    if (e.type === 'roundEnd') exactKeys(e.result, RESULT_KEYS, 'roundEnd result');
    noCardIds(json(e), s, `event ${e.type}`);
  }
  must(json(events) === json(s.log.slice(s.log.length - events.length)), 'returned events are not the log tail');
  if (s.eating && events.some((e) => e.type === 'flipPuri')) {
    const flips = s.log.filter((e) => e.round === s.round && e.type === 'flipPuri');
    must(flips.length === s.eating.plate.length, 'flipPuri events and plate disagree');
    flips.forEach((f, i) => {
      const x = s.eating!.plate[i];
      must(
        f.type === 'flipPuri' && f.kind === x.card.kind && f.owner === x.card.owner && f.fromStackOf === x.fromStackOf,
        'a flipPuri event names a card that is not on the plate',
      );
    });
  }
}

/** Checks one viewer's projection against decision 13/14, written independently of view.ts. */
function checkView(s: GameState, viewerId: PlayerId | null, setups: ReadonlyMap<PlayerId, Setup>): PlayerView {
  const v = projectView(s, viewerId);
  const text = json(v);
  const viewer = s.players.find((p) => p.id === viewerId) ?? null;
  const you = viewer ? viewer.id : null;
  const where = `view of ${String(viewerId)} (round ${s.round}, ${tagOf(s)})`;
  const revealed = revealedOracle(s);

  noCardIds(text, s, where);
  exactKeys(v, VIEW_KEYS, where);
  must(v.youId === you, `${where}: youId`);
  must(v.revealed === revealed, `${where}: revealed flag`);
  exactKeys(v.config, Object.keys(DEFAULT_CONFIG), `${where} config`);
  must(json(v.config) === json(s.config), `${where}: config`);

  must(v.players.length === s.players.length, `${where}: player count`);
  s.players.forEach((q, i) => {
    const vq = v.players[i];
    const at = `${where} player ${q.id}`;
    exactKeys(vq, PLAYER_KEYS, at);
    must(
      vq.id === q.id && vq.seat === i && vq.name === q.name && vq.color === q.color && vq.isBot === q.isBot &&
        vq.score === q.score && vq.busts === q.busts && vq.setupDone === q.setupDone && vq.ready === q.ready,
      `${at}: public fields`,
    );
    must(vq.handCount === q.hand.length, `${at}: handCount`);
    must(vq.stack.length === q.stack.length, `${at}: stack length`);
    q.stack.forEach((c, j) => {
      const vc = vq.stack[j];
      exactKeys(vc, ['owner', 'kind'], `${at} stack[${j}]`);
      const kind = revealed || c.owner === you ? c.kind : null;
      must(vc.owner === c.owner && vc.kind === kind, () => `${at} stack[${j}] shows ${json(vc)}`);
    });
    if (q.power === null) {
      must(vq.power === null, `${at}: phantom power`);
    } else {
      exactKeys(vq.power, ['owner', 'revealed', 'kind'], `${at} power`);
      const kind = q.power.revealed || revealed || q.id === you ? q.power.kind : null;
      must(
        vq.power!.owner === q.id && vq.power!.revealed === q.power.revealed && vq.power!.kind === kind,
        () => `${at} power shows ${json(vq.power)}`,
      );
    }
  });

  // From public info alone: hand counts + backs on the table + plate = one full set per owner.
  const setSize = s.config.panipuriPerPlayer + 1;
  for (const o of v.players) {
    const onTable = v.players.reduce((n, p) => n + p.stack.filter((c) => c.owner === o.id).length, 0);
    const onPlate = v.eating ? v.eating.plate.filter((x) => x.owner === o.id).length : 0;
    must(o.handCount + onTable + onPlate === setSize, `${where}: cards of ${o.id} do not add up`);
  }
  const backs = v.players.reduce((n, p) => n + p.stack.length, 0);
  must(v.tableMax === backs + 2 * s.config.powerFlipsMax, `${where}: tableMax is not public-only`);

  exactKeys(v.legal, Object.keys(noLegalActions()), `${where} legal`);
  if (!viewer) {
    must(v.me === null, `${where}: spectator has a private view`);
    must(json(v.legal) === json(noLegalActions()), `${where}: spectator has legal actions`);
  } else {
    const me = v.me!;
    exactKeys(me, ME_KEYS, `${where} me`);
    exactKeys(me.hand, ['panipuri', 'akabare'], `${where} me.hand`);
    const ak = viewer.hand.filter((c) => c.kind === A).length;
    must(me.hand.akabare === ak && me.hand.panipuri === viewer.hand.length - ak, `${where}: me.hand`);
    must(json(me.availablePowers) === json(POWER_KINDS.filter((k) => !viewer.usedPowers.includes(k))), `${where}: me.availablePowers`);
    must(json(me.usedPowers) === json(viewer.usedPowers), `${where}: me.usedPowers`);
    must(json(me.powerPicks) === json(viewer.powerPicks), `${where}: me.powerPicks`);
    must(json(me.setup) === json(setups.get(viewer.id) ?? null), () => `${where}: me.setup ${json(me.setup)}`);
    must(json(v.legal) === json(legalActions(s, viewer.id)), `${where}: legal`);
  }

  must(json(v.serving) === json(s.serving) && json(v.bidding) === json(s.bidding), `${where}: turn state`);
  must(json(v.pendingActors) === json(pendingActors(s)), `${where}: pendingActors`);
  must(json(v.results) === json(s.results) && json(v.winners) === json(s.winners), `${where}: results`);
  must(json(v.log) === json(s.log.slice(-VIEW_LOG_LIMIT)) && v.lastSeq === s.nextSeq - 1, `${where}: log`);

  if (!s.eating) {
    must(v.eating === null, `${where}: phantom eating`);
  } else {
    const e = s.eating;
    const ve = v.eating!;
    exactKeys(ve, EATING_KEYS, `${where} eating`);
    const plate = e.plate.map((x) => ({
      owner: x.card.owner,
      kind: x.card.kind,
      fromStackOf: x.fromStackOf,
      cancelled: x.cancelled,
      saved: x.saved,
    }));
    must(json(ve.plate) === json(plate), `${where}: plate`);
    must(json(ve.powers) === json(e.powers), `${where}: flipped powers`);
    const pending = e.pendingAkabare && { owner: e.pendingAkabare.card.owner, fromStackOf: e.pendingAkabare.fromStackOf };
    must(json(ve.pendingAkabare) === json(pending), `${where}: pendingAkabare`);
    must(
      ve.eaterId === e.eaterId && ve.bid === e.bid && ve.target === e.target && ve.eaten === e.eaten &&
        ve.powersFlipped === e.powersFlipped && ve.skipNext === e.skipNext,
      `${where}: eating numbers`,
    );
  }
  return v;
}

/**
 * A secretly different world that `viewerId` cannot tell apart from `s`: each
 * other owner's hidden cards are shuffled between that owner's hidden slots
 * (their hand and, unless revealed, every stack slot holding one of their
 * cards), so the Akabare moves around; their face-down powers and power
 * history are re-drawn. The rng is kept: it is the bot's dice, not a card.
 */
function alternateWorld(s: GameState, viewerId: PlayerId | null, rand: Rand): GameState {
  const { log, ...rest } = s;
  const alt: GameState = { ...roundTrip(rest), log };
  const revealed = revealedOracle(s);
  for (const q of alt.players) {
    if (q.id === viewerId) continue;
    const slots: [PuriCard[], number][] = q.hand.map((_, i): [PuriCard[], number] => [q.hand, i]);
    if (!revealed) {
      for (const p of alt.players) p.stack.forEach((c, i) => c.owner === q.id && slots.push([p.stack, i]));
    }
    const cards = shuffle(
      slots.map(([arr, i]) => arr[i]),
      rand,
    );
    slots.forEach(([arr, i], k) => (arr[i] = cards[k]));
    if (q.power && !q.power.revealed && !revealed) q.power.kind = pick(POWER_KINDS, rand);
    q.usedPowers = POWER_KINDS.filter(() => rand() < 0.5);
    q.powerPicks = q.powerPicks.map(() => pick(POWER_KINDS, rand));
  }
  return alt;
}

const outcome = (r: ReturnType<typeof applyAction>): string => (r.ok ? 'ok' : `error: ${r.error}`);
const revealing = (a: Action): boolean => a.type === 'FLIP_PURI' || a.type === 'FLIP_POWER';

// ---------------------------------------------------------------------------
// Scripted tables (explicit constructions)
// ---------------------------------------------------------------------------

const TRIO = [
  { id: 'sita', name: 'Sita', color: 'red' as const, isBot: true },
  { id: 'ramesh', name: 'Ramesh', color: 'blue' as const, isBot: false },
  { id: 'anil', name: 'Anil', color: 'yellow' as const, isBot: false },
];

function trio(first: string, config: Partial<GameConfig> = {}, bots: string[] = ['sita']): GameState {
  const seeds = TRIO.map((p) => ({ ...p, isBot: bots.includes(p.id) }));
  for (let seed = 0; seed < 500; seed++) {
    const s = createGame(seeds, config, seed);
    if (s.firstPlayerId === first) return deepFreeze(s);
  }
  throw new Error('no seed');
}

function ok(s: GameState, id: PlayerId, a: Action): GameState {
  const r = applyAction(deepFreeze(s), id, a);
  if (!r.ok) throw new Error(`${id} ${json(a)} rejected in ${tagOf(s)}: ${r.error}`);
  return deepFreeze(r.state);
}

function no(s: GameState, id: PlayerId, a: unknown): string {
  const r = applyAction(deepFreeze(s), id, a as Action);
  if (r.ok) throw new Error(`${id} ${json(a)} was accepted in ${tagOf(s)}`);
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
  return r.error;
}

function setupAll(s: GameState, spec: Record<string, Setup>): GameState {
  for (const p of s.players) s = ok(s, p.id, { type: 'SUBMIT_SETUP', ...spec[p.id] });
  return s;
}

const turnOf = (s: GameState): PlayerId => pendingActors(s)[0];

interface Snap {
  s: GameState;
  setups: ReadonlyMap<PlayerId, Setup>;
}

/**
 * Rare states random play seldom reaches: a bite on your own Akabare, a Dahi
 * save, a cancelled plant, the empty-table wait (2 and 1 flips left), both
 * kinds of bust, revealed and secret round ends, the next round, gameOver.
 */
function scriptedRareStates(): Snap[] {
  const out: Snap[] = [];
  for (const reveal of [false, true]) {
    for (const scene of ['bite', 'empty'] as const) {
      const setups = new Map<PlayerId, Setup>([
        ['sita', { stack: scene === 'bite' ? [P, A] : [P, P], power: 'vinegar' }],
        ['ramesh', { stack: [P, P], power: 'khali' }],
        ['anil', { stack: [P, P], power: 'dahi' }],
      ]);
      let s = trio('ramesh', { revealOnRoundEnd: reveal, maxRounds: scene === 'bite' ? 2 : 1 }, []);
      const snap = () => out.push({ s, setups: new Map(setups) });
      const flip = (t: string) => (s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: t }));
      const power = (t: string) => (s = ok(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: t }));
      for (const [id, st] of setups) s = ok(s, id, { type: 'SUBMIT_SETUP', ...st });
      snap();
      s = ok(s, 'ramesh', { type: 'PLACE_PURI', kind: scene === 'bite' ? A : P, targetPlayerId: 'anil' });
      s = ok(s, 'anil', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' });
      s = ok(s, 'sita', { type: 'START_BID', amount: 12 });
      snap();
      s = ok(s, 'ramesh', { type: 'PASS' });
      s = ok(s, 'anil', { type: 'PASS' });
      snap();
      flip('sita');
      if (scene === 'bite') {
        flip('sita'); // her own Akabare
        expect(tagOf(s)).toBe('eating:pending');
        snap();
        power('anil'); // Dahi saves
        flip('sita');
        snap();
        power('sita'); // Vinegar...
        flip('anil'); // ...cancels Ramesh's planted Akabare
        for (const t of ['anil', 'anil', 'ramesh', 'ramesh']) flip(t);
        expect(s.results[0].bustReason).toBe('emptyTable'); // no flips left: busts at once
      } else {
        for (const t of ['sita', 'sita', 'anil', 'anil', 'anil', 'ramesh', 'ramesh']) flip(t);
        expect(tagOf(s)).toBe('eating:emptyTable');
        snap();
        power('ramesh'); // Khali: target 13, one flip left
        expect(tagOf(s)).toBe('eating:emptyTable');
        snap();
        s = ok(s, 'sita', { type: 'ACCEPT_BUST' });
      }
      expect(s.phase).toBe('roundEnd');
      snap();
      s = ok(s, 'anil', { type: 'FORCE_CONTINUE' });
      if (scene === 'bite') setups.clear();
      expect(s.phase).toBe(scene === 'bite' ? 'setup' : 'gameOver');
      snap();
    }
  }
  return out;
}

interface LeakStats {
  views: number;
  altsMovingKinds: number;
  ownActionsCompared: number;
  botDecisionsCompared: number;
}

const kindsOnTable = (s: GameState) => json(s.players.map((p) => p.stack.map((c) => c.kind)));

/**
 * For every viewer (and a spectator): the oracle holds, a secretly different
 * world gives the same view and the same bot decisions, and (with probability
 * `ownProb`) the viewer's own actions get the same answers in both worlds.
 */
function checkAllViewers(s: GameState, setups: ReadonlyMap<PlayerId, Setup>, rand: Rand, stats: LeakStats, ownProb: number): void {
  for (const viewerId of [...s.players.map((p) => p.id), null]) {
    const v = checkView(s, viewerId, setups);
    stats.views++;
    const alt = alternateWorld(s, viewerId, rand);
    if (kindsOnTable(alt) !== kindsOnTable(s)) stats.altsMovingKinds++;
    must(json(projectView(alt, viewerId)) === json(v), () => `hidden info reaches the view of ${viewerId} in ${tagOf(s)}`);
    if (viewerId === null) continue;

    // Bot decisions (for every seat, bot or human) cannot tell the worlds apart either.
    if (v.pendingActors.includes(viewerId)) {
      for (const k of [1, 2]) {
        const a1 = chooseBotAction(s, viewerId, rng(s.rng + k));
        const a2 = chooseBotAction(alt, viewerId, rng(s.rng + k));
        must(json(a1) === json(a2), () => `bot decision of ${viewerId} depends on hidden info in ${tagOf(s)}`);
      }
      must(json(chooseBotAction(s, viewerId)) === json(chooseBotAction(alt, viewerId)), 'default-rand decision differs');
      stats.botDecisionsCompared++;
    }

    // The viewer's own actions get the same answers (ok / error text) in both worlds,
    // and non-revealing ones leave the viewer with identical views.
    if (rand() < ownProb) {
      const own = [...advertisedActions(s, viewerId), ...shuffle(candidateActions(s), rand).slice(0, 4)];
      for (const a of own) {
        const r1 = applyAction(s, viewerId, a);
        const r2 = applyAction(alt, viewerId, a);
        must(outcome(r1) === outcome(r2), () => `${viewerId} ${json(a)}: "${outcome(r1)}" vs "${outcome(r2)}"`);
        stats.ownActionsCompared++;
        if (r1.ok && r2.ok && !revealing(a) && !revealedOracle(r1.state)) {
          must(
            json(projectView(r1.state, viewerId)) === json(projectView(r2.state, viewerId)),
            () => `${viewerId} ${json(a)} reveals hidden info`,
          );
        }
      }
    }
  }
  // An unknown viewer is just a spectator.
  must(json(projectView(s, GHOST)) === json(projectView(s, null)), 'unknown viewer is not a spectator');
}

/** Every advertised action applies; every candidate is accepted iff advertised. Returns the state's tag. */
function checkUniverse(s: GameState): string {
  const tag = tagOf(s);
  const universe = candidateActions(s);
  for (const id of [...s.players.map((p) => p.id), GHOST]) {
    const L = legalActions(s, id);
    for (const a of advertisedActions(s, id)) {
      const r = applyAction(s, id, a);
      must(r.ok, () => `${id} ${json(a)} is advertised in ${tag} but rejected: ${r.ok ? '' : r.error}`);
    }
    for (const a of universe) {
      const r = applyAction(s, id, a);
      must(r.ok === isAdvertised(L, a), () => `${id} ${json(a)} in ${tag}: accepted=${r.ok} but advertised=${isAdvertised(L, a)}`);
      if (!r.ok) must(typeof r.error === 'string' && r.error.length > 0, 'empty error');
    }
  }
  // Whoever the game waits on has something legal to do.
  for (const id of pendingActors(s)) must(advertisedActions(s, id).length > 0, `${id} pending with no move in ${tag}`);
  return tag;
}

// ---------------------------------------------------------------------------
// 1. Leakage
// ---------------------------------------------------------------------------

describe('props 1: projectView leaks nothing (every viewer, every step)', () => {
  const stats: LeakStats = { views: 0, altsMovingKinds: 0, ownActionsCompared: 0, botDecisionsCompared: 0 };
  const tags = new Set<string>();

  test.each(specs(28, 3))('seeded game %#', (spec) => {
    const rand = rng(spec.seed ^ 0x2545f491);
    play(spec, (s, step) => {
      tags.add(tagOf(s));
      if (step) checkEvents(s, step.events);
      checkAllViewers(s, step?.setups ?? new Map<PlayerId, Setup>(), rand, stats, 0.35);
    });
  });

  test('scripted rare states: own bite, Dahi save, cancelled plant, empty-table wait, reveals', () => {
    const rand = rng(99);
    for (const { s, setups } of scriptedRareStates()) {
      tags.add(tagOf(s));
      checkAllViewers(s, setups, rand, stats, 1);
    }
  });

  test('the sweep covered every phase and really moved hidden Akabare around', () => {
    const all = ['setup', 'serving', 'bidding', 'eating:own', 'eating:others', 'eating:pending', 'eating:emptyTable'];
    for (const t of [...all, 'roundEnd', 'gameOver']) expect(tags.has(t), t).toBe(true);
    expect(stats.views).toBeGreaterThan(5000);
    expect(stats.altsMovingKinds).toBeGreaterThan(stats.views / 10);
    expect(stats.botDecisionsCompared).toBeGreaterThan(1000);
    expect(stats.ownActionsCompared).toBeGreaterThan(2000);
  });
});

describe('props 1b: targeted secrecy scenarios', () => {
  /** Sita (bot) and two humans; Anil plants his Akabare on Ramesh's stack, or doesn't. */
  function plantedWorlds(): [GameState, GameState] {
    const base = trio('ramesh');
    const a = setupAll(base, {
      sita: { stack: [P, P], power: 'vinegar' },
      ramesh: { stack: [P, P], power: 'dahi' },
      anil: { stack: [P, P], power: 'khali' },
    });
    const b = setupAll(base, {
      sita: { stack: [P, P], power: 'vinegar' },
      ramesh: { stack: [P, A], power: 'chaat' }, // Ramesh's own Akabare on top of his own stack
      anil: { stack: [A, P], power: 'dahi' },
    });
    const serve = (s: GameState, anilKind: PuriKind, rameshKind: PuriKind) => {
      s = ok(s, 'ramesh', { type: 'PLACE_PURI', kind: rameshKind, targetPlayerId: 'sita' });
      return ok(s, 'anil', { type: 'PLACE_PURI', kind: anilKind, targetPlayerId: 'ramesh' });
    };
    return [serve(a, A, P), serve(b, P, P)];
  }

  test('a planted Akabare is indistinguishable from a Panipuri for everyone but its owner', () => {
    const [a, b] = plantedWorlds();
    // Sita can't tell the worlds apart (in b both Akabare sit at home, under their owners' Panipuri)...
    expect(json(projectView(a, 'sita'))).toBe(json(projectView(b, 'sita')));
    expect(json(projectView(a, null))).toBe(json(projectView(b, null)));
    // ...and Ramesh's view differs only by his own cards (his setup and the card he placed).
    const vr = projectView(a, 'ramesh');
    expect(vr.players[1].stack).toEqual([
      { owner: 'ramesh', kind: P },
      { owner: 'ramesh', kind: P },
      { owner: 'anil', kind: null },
    ]);
    expect(projectView(a, 'anil').players[1].stack[2]).toEqual({ owner: 'anil', kind: A });
    // The hand counts are public and identical whatever was placed.
    expect(projectView(a, 'sita').players.map((p) => p.handCount)).toEqual([4, 3, 3]);
  });

  test('tableMax counts backs, not Panipuri, so it does not move with the Akabare', () => {
    const [a, b] = plantedWorlds();
    // World a: 1 Akabare on the table; world b: 2. Same backs, same tableMax.
    const onTable = (s: GameState) => s.players.flatMap((p) => p.stack).filter((c) => c.kind === A).length;
    expect([onTable(a), onTable(b)]).toEqual([1, 2]);
    for (const id of ['sita', 'ramesh', 'anil', null]) {
      expect(projectView(a, id).tableMax).toBe(8 + 2 * 2);
      expect(projectView(b, id).tableMax).toBe(8 + 2 * 2);
    }
  });

  test('leftovers: hidden at roundEnd by default, revealed with revealOnRoundEnd, always at gameOver', () => {
    for (const reveal of [false, true]) {
      let s = trio('sita', { revealOnRoundEnd: reveal, maxRounds: 2 }, []);
      s = setupAll(s, {
        sita: { stack: [P, P], power: 'chaat' },
        ramesh: { stack: [A, P], power: 'dahi' },
        anil: { stack: [P, P], power: 'khali' },
      });
      s = ok(s, 'sita', { type: 'START_BID', amount: 2 });
      s = ok(s, 'ramesh', { type: 'PASS' });
      s = ok(s, 'anil', { type: 'PASS' });
      s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
      s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
      expect(s.phase).toBe('roundEnd');
      const v = projectView(s, 'sita');
      expect(v.revealed).toBe(reveal);
      expect(v.players[1].stack.map((c) => c.kind)).toEqual(reveal ? [A, P] : [null, null]);
      expect(v.players[1].power!.kind).toBe(reveal ? 'dahi' : null);
      expect(projectView(s, null).players[2].power!.kind).toBe(reveal ? 'khali' : null);
      // Hands and power history are never revealed.
      expect(json(v)).not.toContain('"usedPowers":["dahi"]');
      // The next round starts secret again.
      s = ok(s, 'ramesh', { type: 'FORCE_CONTINUE' });
      s = setupAll(s, {
        sita: { stack: [P, P], power: 'dahi' },
        ramesh: { stack: [P, A], power: 'chaat' },
        anil: { stack: [P, P], power: 'dahi' },
      });
      const v2 = projectView(s, 'sita');
      expect(v2.revealed).toBe(false);
      expect(v2.players[1].stack.map((c) => c.kind)).toEqual([null, null]);
      expect(v2.players[1].power!.kind).toBeNull();
      // Round 2 is the last: at gameOver every leftover is revealed to everyone.
      s = ok(s, turnOf(s), { type: 'START_BID', amount: 1 });
      while (s.phase === 'bidding') s = ok(s, turnOf(s), { type: 'PASS' });
      while (s.phase === 'eating') {
        const L = legalActions(s, s.eating!.eaterId);
        const a: Action = L.acceptBust
          ? { type: 'ACCEPT_BUST' }
          : { type: 'FLIP_PURI', targetPlayerId: L.flipPuri[0] };
        s = ok(s, s.eating!.eaterId, a);
      }
      s = ok(s, 'sita', { type: 'FORCE_CONTINUE' });
      expect(s.phase).toBe('gameOver');
      for (const id of ['sita', 'ramesh', 'anil', null]) {
        const g = projectView(s, id);
        expect(g.revealed).toBe(true);
        for (const p of g.players) {
          for (const c of p.stack) expect(c.kind).not.toBeNull();
          expect(p.power!.kind).not.toBeNull();
        }
        if (id === null) expect(g.me).toBeNull();
        else expect(g.me!.hand.panipuri + g.me!.hand.akabare).toBe(g.players.find((p) => p.id === id)!.handCount);
      }
    }
  });

  test('a spectator sees backs and flipped cards only; no private view, no legal actions', () => {
    const [a] = plantedWorlds();
    const v = projectView(a, null);
    expect(v.youId).toBeNull();
    expect(v.me).toBeNull();
    expect(v.legal).toEqual(noLegalActions());
    for (const p of v.players) {
      for (const c of p.stack) expect(c.kind).toBeNull();
      expect(p.power).toEqual({ owner: p.id, revealed: false, kind: null });
    }
    expect(json(v)).not.toMatch(/"(hand|usedPowers|powerPicks|rng|nextSeq|card)":/);
  });

  test('views never alias the (frozen) state: the UI may mutate what it receives', () => {
    let aliased = 0;
    play(specs(1, 11)[0], (s) => {
      for (const id of [...s.players.map((p) => p.id), null]) {
        walk(projectView(s, id), (node, path) => {
          if (Object.isFrozen(node)) {
            aliased++;
            throw new Error(`view of ${id} shares ${path} with the state`);
          }
        });
      }
    });
    expect(aliased).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Bot fairness
// ---------------------------------------------------------------------------

describe('props 2: bots decide only from their own view', () => {
  const RANDS = Array.from({ length: 40 }, (_, k) => k * 2654435761);

  /** Asserts identical decisions for many dice, returns the decision for the first die. */
  function sameDecision(a: GameState, b: GameState, bot: PlayerId): Action | null {
    expect(json(projectView(a, bot))).toBe(json(projectView(b, bot)));
    for (const seed of RANDS) {
      expect(json(chooseBotAction(b, bot, rng(seed)))).toBe(json(chooseBotAction(a, bot, rng(seed))));
    }
    expect(json(chooseBotAction(b, bot))).toBe(json(chooseBotAction(a, bot)));
    return chooseBotAction(a, bot, rng(RANDS[0]));
  }

  test('setup: other players\' secret setups do not change the bot\'s pick', () => {
    const base = trio('ramesh');
    const a = ok(ok(base, 'ramesh', { type: 'SUBMIT_SETUP', stack: [A, P], power: 'dahi' }), 'anil', {
      type: 'SUBMIT_SETUP',
      stack: [P, P],
      power: 'chaat',
    });
    const b = ok(ok(base, 'ramesh', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'vinegar' }), 'anil', {
      type: 'SUBMIT_SETUP',
      stack: [P, A],
      power: 'khali',
    });
    expect(sameDecision(a, b, 'sita')!.type).toBe('SUBMIT_SETUP');
  });

  test('serving, bidding and every eating step: an Akabare on top of a rival stack vs. in a hand', () => {
    const base = trio('ramesh');
    const setup = (s: GameState, ramesh: Setup, anil: Setup) =>
      setupAll(s, { sita: { stack: [P, P], power: 'khali' }, ramesh, anil });
    // World a: Anil's Akabare on top of Ramesh's stack, a Dahi beside Anil.
    // World b: Anil's Akabare still in his hand, Ramesh's own Akabare at the bottom of his stack, a Khali beside Anil.
    let a = setup(base, { stack: [P, P], power: 'vinegar' }, { stack: [P, P], power: 'dahi' });
    let b = setup(base, { stack: [A, P], power: 'chaat' }, { stack: [P, P], power: 'khali' });
    a = ok(ok(a, 'ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'anil' }), 'anil', {
      type: 'PLACE_PURI',
      kind: A,
      targetPlayerId: 'ramesh',
    });
    b = ok(ok(b, 'ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'anil' }), 'anil', {
      type: 'PLACE_PURI',
      kind: P,
      targetPlayerId: 'ramesh',
    });
    expect(turnOf(a)).toBe('sita');
    sameDecision(a, b, 'sita'); // serving

    // Sita opens; Ramesh raises; the bot's bidding decision must match too.
    const bid = (s: GameState) => ok(ok(s, 'sita', { type: 'START_BID', amount: 1 }), 'ramesh', { type: 'RAISE', amount: 2 });
    a = bid(a);
    b = bid(b);
    a = ok(a, 'anil', { type: 'PASS' });
    b = ok(b, 'anil', { type: 'PASS' });
    expect(turnOf(a)).toBe('sita');
    sameDecision(a, b, 'sita'); // bidding

    // Sita wins at 5 and eats: compare at every step until a flip shows the worlds differ.
    a = ok(a, 'sita', { type: 'RAISE', amount: 5 });
    b = ok(b, 'sita', { type: 'RAISE', amount: 5 });
    a = ok(a, 'ramesh', { type: 'PASS' });
    b = ok(b, 'ramesh', { type: 'PASS' });
    expect(a.phase).toBe('eating');
    let compared = 0;
    while (a.phase === 'eating' && json(projectView(a, 'sita')) === json(projectView(b, 'sita'))) {
      const choice = sameDecision(a, b, 'sita')!;
      compared++;
      a = ok(a, 'sita', choice);
      b = ok(b, 'sita', choice);
    }
    expect(compared).toBeGreaterThanOrEqual(3); // her own two cards, then a blind choice between rival stacks
  });

  test('chooseBotAction is decideFromView over projectView, and a non-seated or idle bot does nothing', () => {
    play(specs(1, 5)[0], (s) => {
      for (const p of s.players) {
        const rolls = [0.13, 0.71, 0.42, 0.99, 0.05];
        const dice = () => {
          let i = 0;
          return () => rolls[i++ % rolls.length];
        };
        expect(json(chooseBotAction(s, p.id, dice()))).toBe(json(decideFromView(projectView(s, p.id), dice())));
        if (!pendingActors(s).includes(p.id)) expect(chooseBotAction(s, p.id)).toBeNull();
      }
      expect(chooseBotAction(s, GHOST)).toBeNull();
    });
  });

  test('botStep and runBots never need the fallback when the bot brain drives human seats too', () => {
    for (const spec of specs(6, 21)) {
      play(spec, (s) => {
        const bot = s.players.find((p) => p.isBot && pendingActors(s).includes(p.id));
        if (!bot) return;
        const step = botStep(s)!;
        expect(step.usedFallback).toBe(false);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Legal-action consistency
// ---------------------------------------------------------------------------

describe('props 3: legalActions ⇔ applyAction accepts', () => {
  const tags = new Map<string, number>();
  const RARE = new Set(['eating:pending', 'eating:emptyTable', 'gameOver', 'roundEnd']);

  test.each(specs(22, 7))('universe of candidate actions, seeded game %#', (spec) => {
    const rand = rng(spec.seed ^ 0x6c8e9cf5);
    const note = (tag: string) => tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const { final } = play(spec, (s) => {
      if (RARE.has(tagOf(s)) || rand() < 0.12) note(checkUniverse(s));
    });
    note(checkUniverse(final));
  });

  test('universe of candidate actions, scripted rare states', () => {
    for (const { s } of scriptedRareStates()) {
      const tag = checkUniverse(s);
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  });

  test('the sweep reached every kind of state', () => {
    for (const t of [
      'setup',
      'serving',
      'bidding',
      'eating:own',
      'eating:others',
      'eating:pending',
      'eating:emptyTable',
      'roundEnd',
      'gameOver',
    ]) {
      expect(tags.get(t) ?? 0, t).toBeGreaterThan(0);
    }
  });
});

describe('props 3b: a battery of illegal actions', () => {
  function toEating(): GameState {
    let s = trio('sita', {}, []);
    s = setupAll(s, {
      sita: { stack: [P, P], power: 'khali' },
      ramesh: { stack: [P, P], power: 'dahi' },
      anil: { stack: [P, P], power: 'vinegar' },
    });
    // Illegal in serving.
    no(s, 'ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' }); // not your turn
    no(s, 'ramesh', { type: 'START_BID', amount: 3 });
    no(s, 'sita', { type: 'PLACE_PURI', kind: P, targetPlayerId: GHOST }); // unknown stack
    no(s, 'sita', { type: 'START_BID', amount: 0 });
    no(s, 'sita', { type: 'START_BID', amount: -5 });
    no(s, 'sita', { type: 'START_BID', amount: 1.5 });
    no(s, 'sita', { type: 'RAISE', amount: 3 }); // wrong phase
    no(s, 'sita', { type: 'PASS' });
    no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
    no(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: 'sita' });
    no(s, 'sita', { type: 'ACCEPT_BUST' });
    no(s, 'sita', { type: 'READY' });
    no(s, 'sita', { type: 'FORCE_CONTINUE' });
    no(s, 'sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'chaat' }); // setup is over
    no(s, GHOST, { type: 'START_BID', amount: 3 });
    // Placing the Akabare twice.
    s = ok(s, 'sita', { type: 'PLACE_PURI', kind: A, targetPlayerId: 'ramesh' });
    s = ok(s, 'ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'anil' });
    s = ok(s, 'anil', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'anil' });
    expect(no(s, 'sita', { type: 'PLACE_PURI', kind: A, targetPlayerId: 'anil' })).toMatch(/Akabare/);
    // Illegal in bidding.
    s = ok(s, 'sita', { type: 'START_BID', amount: 4 });
    no(s, 'sita', { type: 'RAISE', amount: 5 }); // turn passed to Ramesh
    no(s, 'anil', { type: 'PASS' });
    no(s, 'ramesh', { type: 'RAISE', amount: 4 }); // must beat the high bid
    no(s, 'ramesh', { type: 'RAISE', amount: 2 });
    no(s, 'ramesh', { type: 'START_BID', amount: 9 });
    no(s, 'ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'ramesh' });
    s = ok(s, 'ramesh', { type: 'PASS' });
    no(s, 'ramesh', { type: 'RAISE', amount: 9 }); // passed (and not his turn)
    s = ok(s, 'anil', { type: 'PASS' });
    expect(s.phase).toBe('eating');
    return s;
  }

  test('wrong player, wrong phase, bad amounts, unknown ids, placing the Akabare twice', () => {
    toEating();
  });

  test('own stack first, empty stacks, a flip too many, pending bites, non-eaters', () => {
    let s = toEating();
    no(s, 'ramesh', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' }); // not the eater
    no(s, 'anil', { type: 'FLIP_POWER', targetPlayerId: 'anil' });
    no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' }); // own stack first
    no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: GHOST });
    no(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: GHOST });
    no(s, 'sita', { type: 'ACCEPT_BUST' }); // nothing pending, table not empty
    no(s, 'sita', { type: 'READY' });
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
    no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' }); // own stack is empty now
    // Ramesh's stack: his P, P, then Sita's Akabare on top. Bitten, pending.
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    expect(s.eating!.pendingAkabare).not.toBeNull();
    no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' }); // only a power or giving up
    s = ok(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: 'ramesh' }); // Dahi: saved
    expect(s.eating!.pendingAkabare).toBeNull();
    no(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: 'ramesh' }); // already face up
    s = ok(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: 'sita' }); // Khali: target 5
    expect(s.eating!.powersFlipped).toBe(2);
    expect(no(s, 'sita', { type: 'FLIP_POWER', targetPlayerId: 'anil' })).toMatch(/2 powers/); // a 3rd flip
    expect(legalActions(s, 'sita').flipPower).toEqual([]);
    // Empty Ramesh's stack (eaten 4 of 5); then it can't be flipped.
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    expect([s.eating!.eaten, s.eating!.target]).toEqual([4, 5]);
    expect(no(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' })).toMatch(/empty/);
    expect(legalActions(s, 'sita').flipPuri).toEqual(['anil']);
    s = ok(s, 'sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' });
    // Round end: READY twice is rejected, so is play.
    expect(s.phase).toBe('roundEnd');
    s = ok(s, 'anil', { type: 'READY' });
    no(s, 'anil', { type: 'READY' });
    no(s, 'anil', { type: 'START_BID', amount: 2 });
    no(s, GHOST, { type: 'FORCE_CONTINUE' });
  });

  test('at gameOver every action is rejected and nothing is advertised', () => {
    const { final } = play(specs(1, 9)[0]);
    for (const id of [...final.players.map((p) => p.id), GHOST]) {
      expect(legalActions(final, id)).toEqual(noLegalActions());
      for (const a of candidateActions(final)) no(final, id, a);
    }
  });

  test('bids have a technical ceiling; at the ceiling nobody can raise, and bots pass', () => {
    let s = trio('sita', {}, ['ramesh', 'anil']);
    s = setupAll(s, {
      sita: { stack: [P, P], power: 'khali' },
      ramesh: { stack: [P, P], power: 'dahi' },
      anil: { stack: [P, P], power: 'vinegar' },
    });
    for (const amount of [1e308, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, 2 ** 60, 1_000_001]) {
      no(s, 'sita', { type: 'START_BID', amount });
    }
    const opened = ok(s, 'sita', { type: 'START_BID', amount: 999_999 });
    expect(legalActions(opened, 'ramesh').raise).toEqual({ min: 1_000_000 });
    const top = ok(opened, 'ramesh', { type: 'RAISE', amount: 1_000_000 });
    expect(legalActions(top, 'anil').raise).toBeNull();
    expect(legalActions(top, 'anil').pass).toBe(true);
    no(top, 'anil', { type: 'RAISE', amount: 1_000_001 });
    expect(chooseBotAction(top, 'anil', rng(1))).toEqual({ type: 'PASS' });
    const step = botStep(top)!;
    expect(step.usedFallback).toBe(false);
    // The state stays exact through JSON: a huge bust is a finite score, not -Infinity → null.
    let end = ok(runBots(top).state, 'sita', { type: 'PASS' });
    expect(end.eating!.eaterId).toBe('ramesh');
    end = runBots(end).state;
    expect(end.phase).toBe('roundEnd');
    expect(end.players[1].score).toBe(-1_000_000);
    expect(roundTrip(end)).toStrictEqual(end);
  });
});

// ---------------------------------------------------------------------------
// 4. Purity and determinism (the server stores the state as jsonb)
// ---------------------------------------------------------------------------

describe('props 4: purity, determinism and JSON round trips', () => {
  test.each(specs(10, 13))('replay and JSON round trip, seeded game %#', (spec) => {
    const trace: string[] = [];
    const { final, moves } = play(spec, (s, step) => {
      trace.push(json(s));
      // Plain data only: no undefined, no class instances, Sets or Maps; JSON keeps it exactly.
      walk(s, (node, path) => {
        const proto = Object.getPrototypeOf(node);
        must(proto === Object.prototype || proto === Array.prototype, `${path} is not plain data`);
      });
      if (!step) return;
      const back = roundTrip(step.prev);
      expect(back).toStrictEqual(step.prev);
      // The engine behaves identically on the round-tripped state.
      const again = applyMove(back, step.move);
      must(json(again.state) === json(s), () => `JSON round trip changed the result of ${json(step.move)}`);
      must(json(again.events) === json(step.events), 'JSON round trip changed the events');
      for (const id of [...back.players.map((p) => p.id), null]) {
        must(json(projectView(back, id)) === json(projectView(step.prev, id)), 'round trip changed a view');
      }
      for (const p of back.players) {
        must(json(legalActions(back, p.id)) === json(legalActions(step.prev, p.id)), 'round trip changed legal');
        must(json(chooseBotAction(back, p.id)) === json(chooseBotAction(step.prev, p.id)), 'round trip changed a bot');
      }
    });
    // Same seed + same moves ⇒ the very same states, step by step.
    let s = createGame(seatsFor(spec.n, spec.bots), spec.config, spec.seed);
    expect(json(s)).toBe(trace[0]);
    moves.forEach((m, i) => {
      s = applyMove(s, m).state;
      must(json(s) === trace[i + 1], `replay diverged at move ${i}`);
    });
    expect(json(s)).toBe(json(final));
  });

  test.each(specs(4, 31))('jsonb re-orders object keys: the engine does not care (game %#)', (spec) => {
    let checked = 0;
    play(spec, (s, step) => {
      if (!step) return;
      const back = jsonbRoundTrip(step.prev);
      expect(Object.keys(back)[0]).toBe('log'); // really re-ordered
      const again = applyMove(back, step.move);
      must(canonical(again.state) === canonical(s), () => `jsonb key order changed the result of ${json(step.move)}`);
      must(canonical(again.events) === canonical(step.events), 'jsonb key order changed the events');
      for (const p of back.players) {
        must(canonical(projectView(back, p.id)) === canonical(projectView(step.prev, p.id)), 'jsonb changed a view');
        must(canonical(chooseBotAction(back, p.id)) === canonical(chooseBotAction(step.prev, p.id)), 'jsonb changed a bot');
      }
      checked++;
    });
    expect(checked).toBeGreaterThan(20);
  });

  test('runBots is deterministic, pure, and stable across JSON round trips', () => {
    let differentDice = 0;
    const all8 = specs(8, 17);
    for (const spec of all8) {
      const all = { ...spec, bots: () => true };
      const start = deepFreeze(createGame(seatsFor(all.n, all.bots), all.config, all.seed));
      const r1 = runBots(start, 40);
      const r2 = runBots(start, 40);
      expect(json(r1)).toBe(json(r2));
      const r3 = runBots(roundTrip(start), 40);
      expect(json(r3)).toBe(json(r1));
      // Resuming from a round-tripped midpoint lands on the same final state.
      let direct = r1.state;
      let viaJson = roundTrip(r1.state);
      while (direct.phase !== 'gameOver') direct = runBots(deepFreeze(direct)).state;
      while (viaJson.phase !== 'gameOver') viaJson = roundTrip(runBots(viaJson).state);
      expect(json(viaJson)).toBe(json(direct));
      // Different dice (rng) give a different game; the seed is what makes it repeatable.
      const other = runBots({ ...start, rng: (start.rng + 1) >>> 0 }, 40);
      if (json(other.state.players) !== json(r1.state.players)) differentDice++;
    }
    expect(differentDice).toBeGreaterThan(all8.length / 2);
  });

  test('nothing mutates its (deep-frozen) input: views, legal, pending, bots, setBot, botStep', () => {
    play(specs(1, 19)[0], (s) => {
      const before = json(s);
      for (const p of s.players) {
        projectView(s, p.id);
        legalActions(s, p.id);
        chooseBotAction(s, p.id);
        setBot(s, p.id, !p.isBot);
      }
      projectView(s, null);
      pendingActors(s);
      botStep(s);
      runBots(s, 3);
      for (const a of candidateActions(s)) applyAction(s, s.players[0].id, a);
      must(json(s) === before, 'an input changed');
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Robustness: malformed input is rejected, never thrown
// ---------------------------------------------------------------------------

describe('props 5: malformed actions and ids', () => {
  const sparseHuge = new Array(10_000_000);
  const bad = (amount: unknown) => [{ type: 'START_BID', amount }, { type: 'RAISE', amount }];
  const MALFORMED: unknown[] = [
    undefined, null, 0, 42, NaN, '', 'PASS', true, [], [{ type: 'PASS' }], {}, { type: undefined }, { type: null },
    { type: 42 }, { type: 'pass' }, { type: 'Pass' }, { type: ' PASS' }, { type: 'PASS ' }, { type: '__proto__' },
    { type: 'constructor' }, { type: 'toString' }, { type: 'hasOwnProperty' }, { type: 'valueOf' }, { type: ['PASS'] },
    { type: { toString: () => 'PASS' } }, { type: Object.create(null) }, { type: Symbol('PASS') },
    JSON.parse('{"__proto__": {"type": "PASS"}}'), JSON.parse('{"constructor": {"type": "PASS"}}'),
    // SUBMIT_SETUP
    { type: 'SUBMIT_SETUP' },
    { type: 'SUBMIT_SETUP', power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: 'panipuri,panipuri', power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: [null, null], power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: [{}, {}], power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: ['Panipuri', 'panipuri'], power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: new Array(2), power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: [, 'panipuri'], power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: sparseHuge, power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: { length: 2, 0: 'panipuri', 1: 'panipuri' }, power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: [P, P] },
    { type: 'SUBMIT_SETUP', stack: [P, P], power: 'Dahi' },
    { type: 'SUBMIT_SETUP', stack: [P, P], power: null },
    { type: 'SUBMIT_SETUP', stack: [P, P], power: 3 },
    { type: 'SUBMIT_SETUP', stack: [P, P], power: ['dahi'] },
    { type: 'SUBMIT_SETUP', stack: [A, A], power: 'dahi' },
    { type: 'SUBMIT_SETUP', stack: Array.from({ length: 5000 }, () => P), power: 'dahi' },
    // PLACE_PURI
    { type: 'PLACE_PURI' },
    { type: 'PLACE_PURI', targetPlayerId: '9c0e-sita-41d7' },
    { type: 'PLACE_PURI', kind: 'Akabare', targetPlayerId: '9c0e-sita-41d7' },
    { type: 'PLACE_PURI', kind: null, targetPlayerId: '9c0e-sita-41d7' },
    { type: 'PLACE_PURI', kind: 0, targetPlayerId: '9c0e-sita-41d7' },
    { type: 'PLACE_PURI', kind: P },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: '' },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: 42 },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: null },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: {} },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: ['9c0e-sita-41d7'] },
    { type: 'PLACE_PURI', kind: P, targetPlayerId: '__proto__' },
    // Bids
    { type: 'START_BID' },
    { type: 'RAISE' },
    ...[
      '3', '1', null, true, [3], {}, NaN, Infinity, -Infinity, 1.5, -1, -0, 0, 1e308, Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 2, 2 ** 60, 1_000_001, -1e308, Number.MIN_VALUE,
    ].flatMap(bad),
    // Flips
    ...['FLIP_PURI', 'FLIP_POWER'].flatMap((type) =>
      [undefined, '', 42, null, {}, true, ['x'], GHOST, 'constructor'].map((targetPlayerId) => ({ type, targetPlayerId })),
    ),
    { type: 'FLIP_PURI' },
  ];

  const WEIRD_IDS: unknown[] = [undefined, null, 42, {}, [], '', GHOST, '__proto__', 'constructor', 'toString', NaN];

  test.each(specs(6, 23))('never throws, always ok:false, never touches the input (game %#)', (spec) => {
    const rand = rng(spec.seed);
    const seen = new Set<string>();
    const { final } = play(spec, (s) => {
      const tag = tagOf(s);
      if (seen.has(tag) && rand() > 0.05) return;
      seen.add(tag);
      const before = json(s);
      for (const id of [...s.players.map((p) => p.id), ...WEIRD_IDS]) {
        for (const a of MALFORMED) {
          let r: ReturnType<typeof applyAction>;
          try {
            r = applyAction(s, id as PlayerId, a as Action);
          } catch (err) {
            throw new Error(`applyAction threw for ${String(id)} ${String(json(a)).slice(0, 80)} in ${tag}: ${err}`);
          }
          if (r.ok) throw new Error(`${String(id)} ${String(json(a)).slice(0, 80)} was accepted in ${tag}`);
          must(typeof r.error === 'string' && r.error.length > 0, 'no error text');
        }
      }
      // Weird ids with an otherwise legal action are rejected too.
      for (const actor of pendingActors(s)) {
        for (const a of advertisedActions(s, actor)) {
          for (const id of WEIRD_IDS) must(!applyAction(s, id as PlayerId, a).ok, `${String(id)} acted as a player`);
          for (const id of [actor.toUpperCase(), ` ${actor}`, `${actor} `]) must(!applyAction(s, id, a).ok, 'near-miss id');
        }
      }
      must(json(s) === before, 'input changed');
    });
    expect(final.phase).toBe('gameOver');
    expect(seen.has('gameOver')).toBe(true);
  });

  test('extra fields on a well-formed action are ignored and never reach the state', () => {
    let s = trio('sita', {}, []);
    const marker = 'x-injected-7731';
    const loose = (a: object) => a as unknown as Action;
    const sneaky = { stack: [P, P], power: 'dahi', [marker]: { nested: marker }, amount: 5 };
    for (const p of s.players) s = ok(s, p.id, loose({ type: 'SUBMIT_SETUP', ...sneaky }));
    s = ok(s, 'sita', loose({ type: 'PLACE_PURI', kind: P, targetPlayerId: 'anil', owner: 'ramesh', id: 'anil:a' }));
    s = ok(s, 'ramesh', loose({ type: 'START_BID', amount: 2, playerId: 'anil', highBidderId: 'anil' }));
    expect(json(s)).not.toContain(marker);
    expect(s.players[2].stack[2]).toEqual({ id: 'sita:p3', owner: 'sita', kind: P });
    expect(s.bidding!.highBidderId).toBe('ramesh');
  });

  test('queries are total too: unknown or odd viewers are spectators, odd ids have no legal actions', () => {
    const { final } = play(specs(1, 29)[0]);
    const s = createGame(seatsFor(4, () => false), {}, 5);
    for (const state of [s, final]) {
      const spectator = json(projectView(state, null));
      for (const id of WEIRD_IDS) {
        expect(json(projectView(state, id as PlayerId))).toBe(spectator);
        expect(legalActions(state, id as PlayerId)).toEqual(noLegalActions());
        expect(chooseBotAction(state, id as PlayerId)).toBeNull();
      }
    }
  });
});
