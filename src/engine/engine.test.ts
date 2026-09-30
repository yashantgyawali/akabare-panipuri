import { describe, expect, test } from 'vitest';
import {
  applyAction,
  availablePowers,
  chooseBotAction,
  createGame,
  EngineError,
  legalActions,
  pendingActors,
  POWER_KINDS,
  projectView,
  randStream,
  runBots,
  setBot,
  VIEW_LOG_LIMIT,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameEventBody,
  type GameState,
  type PlayerSeed,
  type PowerKind,
  type PuriKind,
} from './index.ts';

// ---------------------------------------------------------------------------
// Harness: a scripted table of named players. Every action runs against a
// deep-frozen state, so any mutation of the input throws.
// ---------------------------------------------------------------------------

const SEATS = [
  { id: 'sita', name: 'Sita', color: 'red' },
  { id: 'ramesh', name: 'Ramesh', color: 'blue' },
  { id: 'anil', name: 'Anil', color: 'yellow' },
  { id: 'priya', name: 'Priya', color: 'green' },
  { id: 'maya', name: 'Maya', color: 'purple' },
  { id: 'hari', name: 'Hari', color: 'orange' },
] as const;
type Id = (typeof SEATS)[number]['id'];

const P: PuriKind = 'panipuri';
const A: PuriKind = 'akabare';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

type EventOf<T extends GameEventBody['type']> = Extract<GameEvent, { type: T }>;

class Table {
  state: GameState;
  events: GameEvent[];

  constructor(state: GameState) {
    this.state = state;
    this.events = [...state.log];
  }

  act(id: Id, action: Action): GameEvent[] {
    const before = JSON.stringify(this.state);
    const result = applyAction(deepFreeze(this.state), id, action);
    if (!result.ok) throw new Error(`${id} ${JSON.stringify(action)} rejected: ${result.error}`);
    expect(JSON.stringify(this.state)).toBe(before);
    this.state = result.state;
    this.events.push(...result.events);
    return result.events;
  }

  fail(id: Id, action: Action): string {
    const before = JSON.stringify(this.state);
    const result = applyAction(deepFreeze(this.state), id, action);
    if (result.ok) throw new Error(`${id} ${JSON.stringify(action)} unexpectedly accepted`);
    expect(JSON.stringify(this.state)).toBe(before);
    expect(result.error.length).toBeGreaterThan(5);
    return result.error;
  }

  setup = (id: Id, stack: PuriKind[], power: PowerKind) => this.act(id, { type: 'SUBMIT_SETUP', stack, power });
  place = (id: Id, kind: PuriKind, target: Id) => this.act(id, { type: 'PLACE_PURI', kind, targetPlayerId: target });
  startBid = (id: Id, amount: number) => this.act(id, { type: 'START_BID', amount });
  raise = (id: Id, amount: number) => this.act(id, { type: 'RAISE', amount });
  pass = (id: Id) => this.act(id, { type: 'PASS' });
  flip = (id: Id, target: Id) => this.act(id, { type: 'FLIP_PURI', targetPlayerId: target });
  power = (id: Id, target: Id) => this.act(id, { type: 'FLIP_POWER', targetPlayerId: target });
  acceptBust = (id: Id) => this.act(id, { type: 'ACCEPT_BUST' });
  ready = (id: Id) => this.act(id, { type: 'READY' });
  forceContinue = (id: Id) => this.act(id, { type: 'FORCE_CONTINUE' });

  p(id: Id) {
    return this.state.players.find((q) => q.id === id)!;
  }
  get eating() {
    return this.state.eating!;
  }
  score(id: Id) {
    return this.p(id).score;
  }
  view(id: Id | null) {
    return projectView(this.state, id);
  }
  legal(id: Id) {
    return legalActions(this.state, id);
  }
  all<T extends GameEventBody['type']>(type: T): EventOf<T>[] {
    return this.events.filter((e): e is EventOf<T> => e.type === type);
  }
  last<T extends GameEventBody['type']>(type: T): EventOf<T> {
    const found = this.all(type);
    expect(found.length).toBeGreaterThan(0);
    return found[found.length - 1];
  }
}

interface TableOpts {
  players?: number | Id[];
  first?: Id;
  config?: Partial<GameConfig>;
  bots?: Id[];
}

function seeds(opts: TableOpts): PlayerSeed[] {
  const ids = Array.isArray(opts.players) ? opts.players : SEATS.slice(0, opts.players ?? 4).map((s) => s.id);
  return ids.map((id) => ({ ...SEATS.find((s) => s.id === id)!, isBot: opts.bots?.includes(id) ?? false }));
}

/** A new game; searches seeds so the PRNG picks the requested first player. */
function table(opts: TableOpts = {}): Table {
  for (let seed = 0; seed < 1000; seed++) {
    const state = createGame(seeds(opts), opts.config ?? {}, seed);
    if (!opts.first || state.firstPlayerId === opts.first) return new Table(state);
  }
  throw new Error('no seed found');
}

type SetupSpec = Partial<Record<Id, { stack?: PuriKind[]; power?: PowerKind }>>;
const DEFAULT_POWER_ORDER: PowerKind[] = ['khali', 'dahi', 'chaat', 'vinegar'];

/** Everyone submits setup: all-Panipuri stacks and a default available power unless specified. */
function setupAll(t: Table, spec: SetupSpec = {}): void {
  for (const p of t.state.players) {
    const s = spec[p.id as Id] ?? {};
    const stack = s.stack ?? Array.from({ length: t.state.config.startingStack }, () => P);
    const avail = availablePowers(t.state, p.id);
    const power = s.power ?? DEFAULT_POWER_ORDER.find((k) => avail.includes(k))!;
    t.setup(p.id as Id, stack, power);
  }
  expect(t.state.phase).toBe('serving');
}

/** From serving: the current turn player opens, `winner` ends up eating at `amount`, everyone else passes. */
function auction(t: Table, winner: Id, amount: number): void {
  const starter = t.state.serving!.turnId as Id;
  t.startBid(starter, starter === winner ? amount : t.state.config.minBid);
  let raised = starter === winner;
  while (t.state.phase === 'bidding') {
    const turn = t.state.bidding!.turnId as Id;
    if (turn === winner && !raised) {
      t.raise(turn, amount);
      raised = true;
    } else {
      t.pass(turn);
    }
  }
  expect(t.state.phase).toBe('eating');
  expect(t.eating.eaterId).toBe(winner);
  expect(t.eating.bid).toBe(amount);
}

/** One uneventful round: setup with the given powers, first player bids 1 and eats their own top card. */
function quickRound(t: Table, powers: Partial<Record<Id, PowerKind>> = {}): void {
  setupAll(t, Object.fromEntries(Object.entries(powers).map(([id, power]) => [id, { power }])) as SetupSpec);
  const first = t.state.serving!.turnId as Id;
  auction(t, first, 1);
  t.flip(first, first);
  expect(t.state.phase).toBe('roundEnd');
  t.forceContinue(first);
}

const noLegal = {
  setup: null,
  place: null,
  startBid: null,
  raise: null,
  pass: false,
  flipPuri: [],
  flipPower: [],
  acceptBust: false,
  ready: false,
  forceContinue: false,
};

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe('createGame', () => {
  test('deals each player 5 Panipuri + 1 Akabare with stable ids and starts round 1 setup', () => {
    const t = table();
    const s = t.state;
    expect(s.round).toBe(1);
    expect(s.phase).toBe('setup');
    expect(s.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    for (const p of s.players) {
      expect(p.hand.map((c) => c.id)).toEqual([1, 2, 3, 4, 5].map((i) => `${p.id}:p${i}`).concat(`${p.id}:a`));
      expect(p.hand.every((c) => c.owner === p.id)).toBe(true);
      expect(p.stack).toEqual([]);
      expect(p.power).toBeNull();
      expect(p.score).toBe(0);
    }
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ type: 'roundStart', seq: 1, round: 1, firstPlayerId: s.firstPlayerId, availablePowersReset: true });
    expect(s.nextSeq).toBe(2);
    expect(Number.isInteger(s.rng) && s.rng >= 0 && s.rng <= 0xffffffff).toBe(true);
    expect(pendingActors(s)).toEqual(['sita', 'ramesh', 'anil', 'priya']);
  });

  test('respects config (panipuriPerPlayer) and applies defaults', () => {
    const s = createGame(seeds({ players: 3 }), { panipuriPerPlayer: 3, startingStack: 4 }, 1);
    expect(s.players[0].hand.map((c) => c.kind)).toEqual([P, P, P, A]);
    expect(s.config.trapReward).toBe(2);
  });

  test.each([2, 7])('rejects %i players', (n) => {
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: 'red' as const, isBot: false }));
    expect(() => createGame(players, {}, 0)).toThrow(EngineError);
  });

  test('rejects duplicate ids, duplicate or unknown colors, empty names, invalid config', () => {
    const base = seeds({ players: 3 });
    expect(() => createGame([base[0], base[1], { ...base[2], id: 'sita' }], {}, 0)).toThrow(/Duplicate player id/);
    expect(() => createGame([base[0], base[1], { ...base[2], color: 'red' }], {}, 0)).toThrow(/red/);
    expect(() => createGame([base[0], base[1], { ...base[2], color: 'pink' as never }], {}, 0)).toThrow(/color/);
    expect(() => createGame([base[0], base[1], { ...base[2], name: '  ' }], {}, 0)).toThrow(/name/);
    expect(() => createGame(base, { targetScore: null, maxRounds: null }, 0)).toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// Decision 1: setup
// ---------------------------------------------------------------------------

describe('decision 1: setup', () => {
  test('stack listed bottom → top, the rest stays in hand, power face down', () => {
    const t = table();
    t.setup('sita', [A, P], 'vinegar');
    const sita = t.p('sita');
    expect(sita.stack.map((c) => c.kind)).toEqual([A, P]);
    expect(sita.hand.map((c) => c.kind)).toEqual([P, P, P, P]);
    expect(sita.power).toEqual({ kind: 'vinegar', revealed: false });
    expect(sita.setupDone).toBe(true);
    expect(t.view('sita').me!.setup).toEqual({ stack: [A, P], power: 'vinegar' });
    expect(t.last('setupDone').playerId).toBe('sita');
  });

  test('rejects a wrong-size stack, two Akabare, unknown kinds and off-phase setup', () => {
    const t = table();
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P], power: 'dahi' })).toMatch(/exactly 2/);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P, P, P], power: 'dahi' })).toMatch(/exactly 2/);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [A, A], power: 'dahi' })).toMatch(/1 Akabare/);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: ['chili' as PuriKind, P], power: 'dahi' })).toMatch(/puri kinds/);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'salt' as PowerKind })).toMatch(/power/);
    setupAll(t);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'dahi' })).toMatch(/Setup is over/);
  });

  test('can resubmit until the last player submits; then serving starts', () => {
    const t = table({ first: 'ramesh' });
    t.setup('sita', [P, A], 'vinegar');
    t.setup('ramesh', [P, P], 'dahi');
    const again = t.setup('sita', [P, P], 'chaat');
    expect(again).toEqual([]); // no duplicate setupDone event
    expect(t.p('sita').stack.map((c) => c.kind)).toEqual([P, P]);
    expect(t.p('sita').hand.map((c) => c.kind)).toEqual([P, P, P, A]);
    expect(t.p('sita').power!.kind).toBe('chaat');
    expect(t.state.phase).toBe('setup');
    expect(pendingActors(t.state)).toEqual(['anil', 'priya']);
    t.setup('anil', [P, P], 'khali');
    const last = t.setup('priya', [P, P], 'khali');
    expect(last.map((e) => e.type)).toEqual(['setupDone', 'servingStart']);
    expect(t.state.phase).toBe('serving');
    expect(t.state.serving).toEqual({ turnId: 'ramesh' });
    expect(t.all('setupDone').map((e) => e.playerId)).toEqual(['sita', 'ramesh', 'anil', 'priya']);
    expect(t.p('sita').usedPowers).toEqual(['chaat']);
    expect(t.p('sita').powerPicks).toEqual(['chaat']);
  });

  test('startingStack config: a 3-card stack from a 2-Panipuri set must include the Akabare', () => {
    const t = table({ players: 3, config: { panipuriPerPlayer: 2, startingStack: 3 } });
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P, P, P], power: 'dahi' })).toMatch(/only have 2 Panipuri/);
    t.setup('sita', [P, A, P], 'dahi');
    expect(t.p('sita').hand).toEqual([]);
    expect(t.legal('ramesh').setup).toEqual({
      hand: { panipuri: 2, akabare: 1 },
      stackSize: 3,
      availablePowers: [...POWER_KINDS],
      submitted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Decision 2: power availability
// ---------------------------------------------------------------------------

describe('decision 2: power availability', () => {
  test('PDF table over rounds 1-5, then the cycle continues in rounds 6-7', () => {
    const t = table({ config: { targetScore: null, maxRounds: 10 } });
    const picks: PowerKind[] = ['vinegar', 'chaat', 'khali', 'vinegar', 'dahi', 'khali'];
    const expected: PowerKind[][] = [
      ['vinegar', 'dahi', 'khali', 'chaat'],
      ['dahi', 'khali', 'chaat'],
      ['dahi', 'khali'],
      ['vinegar', 'dahi', 'khali', 'chaat'],
      ['dahi', 'khali', 'chaat'],
      ['khali', 'chaat'],
      ['vinegar', 'dahi', 'khali', 'chaat'],
    ];
    for (let r = 1; r <= 7; r++) {
      expect(t.state.round).toBe(r);
      expect(availablePowers(t.state, 'sita')).toEqual(expected[r - 1]);
      expect(t.view('sita').me!.availablePowers).toEqual(expected[r - 1]);
      expect(t.legal('sita').setup!.availablePowers).toEqual(expected[r - 1]);
      if (r <= 6) quickRound(t, { sita: picks[r - 1] });
    }
    expect(t.p('sita').powerPicks).toEqual(picks);
    expect(t.all('roundStart').map((e) => e.availablePowersReset)).toEqual([true, false, false, true, false, false, true]);
  });

  test('an unavailable power is rejected; placing counts as used even if never flipped', () => {
    const t = table({ config: { targetScore: null } });
    quickRound(t, { sita: 'chaat' });
    expect(t.state.results[0].eaterId).not.toBe(undefined);
    expect(t.state.log.some((e) => e.type === 'flipPower')).toBe(false);
    expect(t.p('sita').usedPowers).toEqual(['chaat']);
    expect(t.fail('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'chaat' })).toMatch(/Chaat isn't available/);
    t.setup('sita', [P, P], 'dahi');
  });

  test('powerResetRound = 2 makes all powers available every round', () => {
    const t = table({ config: { powerResetRound: 2, targetScore: null } });
    quickRound(t, { sita: 'chaat' });
    expect(availablePowers(t.state, 'sita')).toEqual([...POWER_KINDS]);
    quickRound(t, { sita: 'chaat' });
    expect(t.p('sita').powerPicks).toEqual(['chaat', 'chaat']);
  });
});

// ---------------------------------------------------------------------------
// Decision 3: first player
// ---------------------------------------------------------------------------

describe('decision 3: first player', () => {
  test('round 1 is random via the seeded PRNG (deterministic per seed, covers every seat)', () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const a = createGame(seeds({}), {}, seed);
      const b = createGame(seeds({}), {}, seed);
      expect(a.firstPlayerId).toBe(b.firstPlayerId);
      expect(a.rng).toBe(b.rng);
      firsts.add(a.firstPlayerId);
    }
    expect([...firsts].sort()).toEqual(['anil', 'priya', 'ramesh', 'sita']);
  });

  test('later rounds rotate clockwise from the previous first player, wrapping around', () => {
    const t = table({ first: 'anil', config: { targetScore: null, maxRounds: 10 } });
    const firsts: string[] = [];
    for (let r = 0; r < 5; r++) {
      firsts.push(t.state.firstPlayerId);
      quickRound(t);
    }
    expect(firsts).toEqual(['anil', 'priya', 'sita', 'ramesh', 'anil']);
    expect(t.all('roundStart').map((e) => e.firstPlayerId)).toEqual(['anil', 'priya', 'sita', 'ramesh', 'anil', 'priya']);
  });
});

// ---------------------------------------------------------------------------
// Decision 4: serving
// ---------------------------------------------------------------------------

describe('decision 4: serving', () => {
  test('turns go clockwise from the first player; cards go on top of any stack, own included', () => {
    const t = table({ first: 'anil' });
    setupAll(t);
    expect(t.legal('anil').place).toEqual({ kinds: [P, A], targets: ['sita', 'ramesh', 'anil', 'priya'] });
    expect(t.legal('anil').startBid).toEqual({ min: 1 });
    expect(t.legal('sita')).toEqual(noLegal);
    expect(t.fail('sita', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' })).toMatch(/Anil's turn/);
    t.place('anil', A, 'sita');
    expect(t.state.serving!.turnId).toBe('priya');
    t.place('priya', P, 'priya');
    expect(t.state.serving!.turnId).toBe('sita');
    t.place('sita', P, 'anil');
    expect(t.state.serving!.turnId).toBe('ramesh');
    expect(t.p('sita').stack.map((c) => [c.owner, c.kind])).toEqual([['sita', P], ['sita', P], ['anil', A]]);
    expect(t.p('priya').stack).toHaveLength(3);
    expect(t.p('anil').stack.map((c) => c.owner)).toEqual(['anil', 'anil', 'sita']);
    expect(t.all('place').map((e) => [e.playerId, e.onStackOf])).toEqual([
      ['anil', 'sita'],
      ['priya', 'priya'],
      ['sita', 'anil'],
    ]);
    expect(t.p('anil').hand.map((c) => c.kind)).toEqual([P, P, P]);
    expect(t.legal('ramesh').place!.kinds).toEqual([P, A]);
    t.place('ramesh', A, 'ramesh');
    t.place('anil', P, 'anil');
    expect(t.fail('priya', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'nobody' })).toMatch(/no such stack/);
  });

  test('you cannot place a kind you no longer hold', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { stack: [P, A] } });
    expect(t.legal('sita').place!.kinds).toEqual([P]);
    expect(t.fail('sita', { type: 'PLACE_PURI', kind: A, targetPlayerId: 'ramesh' })).toMatch(/no Akabare in hand/);
  });

  test('with an empty hand you must start the bid; after the bid starts nobody can place', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t);
    for (let lap = 0; lap < 4; lap++) {
      for (const id of ['sita', 'ramesh', 'anil'] as Id[]) t.place(id, lap < 3 ? P : A, id);
    }
    expect(t.p('sita').hand).toEqual([]);
    expect(t.legal('sita').place).toBeNull();
    expect(t.legal('sita').startBid).toEqual({ min: 1 });
    expect(t.fail('sita', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' })).toMatch(/no Panipuri in hand/);
    expect(t.fail('sita', { type: 'START_BID', amount: 0 })).toMatch(/at least 1/);
    expect(t.fail('sita', { type: 'START_BID', amount: 1.5 })).toMatch(/whole number/);
    t.startBid('sita', 2);
    expect(t.state.phase).toBe('bidding');
    expect(t.state.serving).toBeNull();
    expect(t.fail('ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' })).toMatch(/no more placing/);
    expect(t.fail('ramesh', { type: 'START_BID', amount: 3 })).toMatch(/already started/);
  });

  test('minBid config is enforced', () => {
    const t = table({ first: 'sita', config: { minBid: 3 } });
    setupAll(t);
    expect(t.legal('sita').startBid).toEqual({ min: 3 });
    expect(t.fail('sita', { type: 'START_BID', amount: 2 })).toMatch(/at least 3/);
    t.startBid('sita', 3);
  });
});

// ---------------------------------------------------------------------------
// Decision 5: bidding
// ---------------------------------------------------------------------------

describe('decision 5: bidding', () => {
  test('clockwise from the seat after the starter, skipping passed players, until one remains', () => {
    const t = table({ first: 'sita' });
    setupAll(t);
    t.startBid('sita', 1);
    expect(t.state.bidding).toMatchObject({ starterId: 'sita', highBid: 1, highBidderId: 'sita', turnId: 'ramesh' });
    expect(t.legal('ramesh')).toMatchObject({ raise: { min: 2 }, pass: true });
    expect(t.legal('sita').raise).toBeNull();
    t.pass('ramesh');
    expect(t.fail('ramesh', { type: 'RAISE', amount: 5 })).toMatch(/Anil's turn/);
    expect(t.fail('anil', { type: 'RAISE', amount: 1 })).toMatch(/above the current bid of 1/);
    t.raise('anil', 2);
    t.pass('priya');
    t.raise('sita', 3);
    expect(t.state.bidding!.turnId).toBe('anil'); // ramesh skipped
    t.raise('anil', 5);
    expect(t.state.bidding!.turnId).toBe('sita'); // priya skipped
    const events = t.pass('sita');
    expect(events.map((e) => e.type)).toEqual(['pass', 'eater']);
    expect(t.state.phase).toBe('eating');
    expect(t.eating).toMatchObject({ eaterId: 'anil', bid: 5, target: 5, eaten: 0, powersFlipped: 0 });
    expect(t.state.bidding!.history).toEqual([
      { playerId: 'sita', action: 'start', amount: 1 },
      { playerId: 'ramesh', action: 'pass' },
      { playerId: 'anil', action: 'raise', amount: 2 },
      { playerId: 'priya', action: 'pass' },
      { playerId: 'sita', action: 'raise', amount: 3 },
      { playerId: 'anil', action: 'raise', amount: 5 },
      { playerId: 'sita', action: 'pass' },
    ]);
    expect(t.last('eater')).toMatchObject({ playerId: 'anil', bid: 5 });
    expect(pendingActors(t.state)).toEqual(['anil']);
  });

  test('if everyone else passes straight away, the starter eats at the opening bid; no max bid', () => {
    const t = table({ first: 'priya' });
    setupAll(t);
    t.startBid('priya', 40);
    t.pass('sita');
    t.pass('ramesh');
    t.pass('anil');
    expect(t.eating).toMatchObject({ eaterId: 'priya', bid: 40, target: 40 });
  });

  test('passing or raising outside bidding is rejected', () => {
    const t = table({ first: 'sita' });
    expect(t.fail('sita', { type: 'PASS' })).toMatch(/no bid/);
    setupAll(t);
    expect(t.fail('sita', { type: 'RAISE', amount: 3 })).toMatch(/no bid/);
  });
});

// ---------------------------------------------------------------------------
// Decision 6: eating order
// ---------------------------------------------------------------------------

describe('decision 6: eating order', () => {
  function eatingTable(bid: number, powers: SetupSpec = {}) {
    const t = table({ first: 'anil' });
    setupAll(t, powers);
    t.place('anil', P, 'anil');
    auction(t, 'sita', bid);
    return t;
  }

  test('own stack first, then any other non-empty stack', () => {
    const t = eatingTable(8);
    expect(t.legal('sita').flipPuri).toEqual(['sita']);
    expect(t.fail('sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' })).toMatch(/own stack first/);
    expect(t.fail('ramesh', { type: 'FLIP_PURI', targetPlayerId: 'sita' })).toMatch(/Only the eater \(Sita\)/);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    expect(t.view('sita').eating!.ownStackEmpty).toBe(true);
    expect(t.legal('sita').flipPuri).toEqual(['ramesh', 'anil', 'priya']);
    expect(t.fail('sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' })).toMatch(/Your stack is empty/);
    t.flip('sita', 'priya');
    t.flip('sita', 'anil'); // switching stacks between flips is fine
    t.flip('sita', 'priya');
    expect(t.legal('sita').flipPuri).toEqual(['ramesh', 'anil']);
    expect(t.fail('sita', { type: 'FLIP_PURI', targetPlayerId: 'priya' })).toMatch(/Priya's stack is empty/);
    expect(t.eating.eaten).toBe(5);
    expect(t.eating.plate.map((x) => x.fromStackOf)).toEqual(['sita', 'sita', 'priya', 'anil', 'priya']);
  });

  test('powers may be flipped at any time, beside any stack including your own', () => {
    const t = eatingTable(3, { sita: { power: 'chaat' } });
    expect(t.legal('sita').flipPower).toEqual(['sita', 'ramesh', 'anil', 'priya']);
    t.power('sita', 'sita');
    expect(t.eating.eaten).toBe(2);
    expect(t.legal('sita').flipPower).toEqual(['ramesh', 'anil', 'priya']);
    expect(t.fail('sita', { type: 'FLIP_POWER', targetPlayerId: 'sita' })).toMatch(/already face up/);
    t.power('sita', 'ramesh'); // khali: target 4
    expect(t.eating.target).toBe(4);
    expect(t.legal('sita').flipPower).toEqual([]);
    expect(t.fail('sita', { type: 'FLIP_POWER', targetPlayerId: 'anil' })).toMatch(/already flipped 2 powers/);
    expect(t.fail('ramesh', { type: 'FLIP_POWER', targetPlayerId: 'anil' })).toMatch(/Only the eater/);
  });

  test('powerFlipsMax config limits the flips', () => {
    const t = table({ first: 'sita', config: { powerFlipsMax: 1 } });
    setupAll(t);
    auction(t, 'sita', 3);
    t.power('sita', 'ramesh');
    expect(t.fail('sita', { type: 'FLIP_POWER', targetPlayerId: 'anil' })).toMatch(/already flipped 1 power this round/);
  });

  test('eating actions outside eating are rejected', () => {
    const t = table({ first: 'sita' });
    expect(t.fail('sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' })).toMatch(/Nobody is eating/);
    expect(t.fail('sita', { type: 'ACCEPT_BUST' })).toMatch(/Nobody is eating/);
  });
});

// ---------------------------------------------------------------------------
// Decisions 7 & 8: FLIP_PURI and FLIP_POWER resolution
// ---------------------------------------------------------------------------

/** Ramesh plants his Akabare on top of Sita's stack; Sita wins at `bid`. */
function plantedOnSita(bid: number, spec: SetupSpec = {}, opts: TableOpts = {}): Table {
  const t = table({ first: 'ramesh', ...opts });
  setupAll(t, spec);
  t.place('ramesh', A, 'sita');
  auction(t, 'sita', bid);
  return t;
}

describe('decision 7: FLIP_PURI', () => {
  test('a Panipuri counts 1 and goes to the plate', () => {
    const u = table({ first: 'sita' });
    setupAll(u);
    auction(u, 'sita', 2);
    const [ev] = u.flip('sita', 'sita');
    expect(ev).toMatchObject({ type: 'flipPuri', owner: 'sita', kind: P, cancelled: false, eaten: 1, target: 2, fromStackOf: 'sita' });
    expect(u.eating.plate).toEqual([{ card: { id: 'sita:p2', owner: 'sita', kind: P }, fromStackOf: 'sita', cancelled: false, saved: false }]);
    expect(u.p('sita').stack).toHaveLength(1);
  });

  test('a biting Akabare with flips left and a face-down power becomes pending: only FLIP_POWER / ACCEPT_BUST', () => {
    const t = plantedOnSita(4);
    const events = t.flip('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'bite']);
    expect(events[1]).toMatchObject({ eaterId: 'sita', fromStackOf: 'sita', owner: 'ramesh' });
    expect(t.eating.pendingAkabare).toEqual({ card: { id: 'ramesh:a', owner: 'ramesh', kind: A }, fromStackOf: 'sita' });
    expect(t.eating.eaten).toBe(0);
    expect(t.state.phase).toBe('eating');
    const legal = t.legal('sita');
    expect(legal.flipPuri).toEqual([]);
    expect(legal.flipPower).toEqual(['sita', 'ramesh', 'anil', 'priya']);
    expect(legal.acceptBust).toBe(true);
    expect(t.fail('sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' })).toMatch(/bit an Akabare/);
    expect(t.fail('sita', { type: 'READY' })).toMatch(/Nothing to be ready/);
    expect(t.view('ramesh').eating!.pendingAkabare).toEqual({ owner: 'ramesh', fromStackOf: 'sita' });
  });

  test('a bite with no power flips left is an immediate bust', () => {
    const t = plantedOnSita(4, { anil: { power: 'dahi' }, priya: { power: 'dahi' } });
    t.power('sita', 'anil'); // dahi, wasted
    t.power('sita', 'priya'); // dahi, wasted
    const events = t.flip('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'bite', 'bust', 'roundEnd']);
    expect(t.last('bust')).toMatchObject({ reason: 'akabare', akabareOwnerId: 'ramesh', trapRewardTo: 'ramesh', target: 4 });
    expect(t.state.phase).toBe('roundEnd');
    expect(t.score('sita')).toBe(-4);
    expect(t.score('ramesh')).toBe(2);
  });

  test('a bite with flips left but no face-down power anywhere is an immediate bust', () => {
    const t = plantedOnSita(3, { sita: { power: 'dahi' }, ramesh: { power: 'khali' }, anil: { power: 'dahi' } }, {
      players: 3,
      config: { powerFlipsMax: 4 },
    });
    t.power('sita', 'sita');
    t.power('sita', 'ramesh');
    t.power('sita', 'anil');
    expect(t.eating).toMatchObject({ powersFlipped: 3, target: 4 });
    t.flip('sita', 'sita');
    expect(t.state.phase).toBe('roundEnd');
    expect(t.state.results[0]).toMatchObject({ outcome: 'bust', bustReason: 'akabare', target: 4, trapRewardTo: 'ramesh' });
  });

  test('a cancelled Akabare does not bite (and Vinegar is used up)', () => {
    const t = plantedOnSita(4, { sita: { power: 'vinegar' } });
    t.power('sita', 'sita');
    const events = t.flip('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPuri']);
    expect(events[0]).toMatchObject({ kind: A, owner: 'ramesh', cancelled: true, eaten: 0 });
    expect(t.eating).toMatchObject({ skipNext: false, pendingAkabare: null, eaten: 0 });
    t.flip('sita', 'sita');
    expect(t.eating.eaten).toBe(1);
  });
});

describe('decision 8: FLIP_POWER', () => {
  test('Dahi after a bite saves you: plate card marked saved, eating continues', () => {
    const t = plantedOnSita(4, { sita: { power: 'dahi' } });
    t.flip('sita', 'sita');
    const [ev] = t.power('sita', 'sita');
    expect(ev).toMatchObject({ type: 'flipPower', kind: 'dahi', effect: 'saved', owner: 'sita', fromStackOf: 'sita' });
    expect(t.eating.pendingAkabare).toBeNull();
    expect(t.eating.plate[0]).toMatchObject({ saved: true, cancelled: false });
    expect(t.eating.powers).toEqual([{ kind: 'dahi', owner: 'sita', fromStackOf: 'sita', effect: 'saved' }]);
    expect(t.view('priya').eating!.plate[0]).toEqual({ owner: 'ramesh', kind: A, fromStackOf: 'sita', cancelled: false, saved: true });
    expect(t.legal('sita').flipPuri).toEqual(['sita']);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    t.flip('sita', 'anil');
    t.flip('sita', 'anil');
    expect(t.state.results[0]).toMatchObject({ outcome: 'success', target: 4, trapRewardTo: null });
    expect(t.score('ramesh')).toBe(0);
  });

  test.each(['vinegar', 'khali', 'chaat'] as PowerKind[])(
    'any other power (%s) after a bite fails the save; its own effect does not apply',
    (kind) => {
      const t = plantedOnSita(3, { anil: { power: kind } });
      t.flip('sita', 'sita');
      const events = t.power('sita', 'anil');
      expect(events.map((e) => e.type)).toEqual(['flipPower', 'bust', 'roundEnd']);
      expect(events[0]).toMatchObject({ kind, effect: 'failedSave', eaten: 0, target: 3 });
      expect(t.eating).toMatchObject({ eaten: 0, target: 3, skipNext: false });
      expect(t.state.results[0]).toMatchObject({ outcome: 'bust', target: 3, eaten: 0, trapRewardTo: 'ramesh' });
      expect(t.score('sita')).toBe(-3);
    },
  );

  test('Vinegar numbs; a second Vinegar while numb is wasted (they do not stack)', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { power: 'vinegar' }, ramesh: { power: 'vinegar' } });
    auction(t, 'sita', 3);
    expect(t.power('sita', 'sita')[0]).toMatchObject({ effect: 'numb' });
    expect(t.eating.skipNext).toBe(true);
    expect(t.view('anil').eating!.skipNext).toBe(true);
    expect(t.power('sita', 'ramesh')[0]).toMatchObject({ effect: 'wasted' });
    t.flip('sita', 'sita');
    expect(t.eating.plate[0].cancelled).toBe(true);
    t.flip('sita', 'sita');
    expect(t.eating.plate[1].cancelled).toBe(false);
    expect(t.eating.eaten).toBe(1);
  });

  test('Dahi without a pending Akabare does nothing; Khali raises the target; Chaat adds 2', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { ramesh: { power: 'dahi' }, anil: { power: 'khali' }, priya: { power: 'chaat' } });
    auction(t, 'sita', 5);
    expect(t.power('sita', 'ramesh')[0]).toMatchObject({ effect: 'wasted', eaten: 0, target: 5 });
    expect(t.power('sita', 'anil')[0]).toMatchObject({ effect: 'targetUp', eaten: 0, target: 6 });
    const u = table({ first: 'sita' });
    setupAll(u, { priya: { power: 'chaat' } });
    auction(u, 'sita', 5);
    expect(u.power('sita', 'priya')[0]).toMatchObject({ effect: 'plusTwo', eaten: 2, target: 5 });
  });

  test('power flips are public: kind, owner and effect are in the log and every view', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { anil: { power: 'khali' } });
    auction(t, 'sita', 3);
    t.power('sita', 'anil');
    for (const viewer of ['sita', 'ramesh', 'anil', null] as (Id | null)[]) {
      const v = t.view(viewer);
      expect(v.players[2].power).toEqual({ owner: 'anil', revealed: true, kind: 'khali' });
      expect(v.eating!.powers).toEqual([{ kind: 'khali', owner: 'anil', fromStackOf: 'anil', effect: 'targetUp' }]);
    }
  });
});

// ---------------------------------------------------------------------------
// Decisions 9 & 10: checkEnd and ACCEPT_BUST
// ---------------------------------------------------------------------------

describe('decision 9: checkEnd', () => {
  test('success as soon as eaten ≥ target; overshooting still scores +target', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { power: 'chaat' } });
    auction(t, 'sita', 2);
    t.flip('sita', 'sita');
    const events = t.power('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPower', 'success', 'roundEnd']);
    expect(t.state.results[0]).toMatchObject({ outcome: 'success', target: 2, eaten: 3, bustReason: null });
    expect(t.state.results[0].scoreDeltas).toEqual({ sita: 2, ramesh: 0, anil: 0, priya: 0 });
    expect(t.score('sita')).toBe(2);
    expect(t.p('sita').stack).toHaveLength(1); // leftovers stay on the table
  });

  test('empty table, short, flips left: waits for FLIP_POWER or ACCEPT_BUST', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t, { ramesh: { power: 'khali' }, anil: { power: 'dahi' } });
    auction(t, 'sita', 7);
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil', 'anil'] as Id[]) t.flip('sita', id);
    expect(t.state.phase).toBe('eating');
    expect(t.eating.eaten).toBe(6);
    expect(t.legal('sita')).toMatchObject({ flipPuri: [], flipPower: ['sita', 'ramesh', 'anil'], acceptBust: true });
    t.power('sita', 'ramesh'); // khali: needs 8 now
    expect(t.state.phase).toBe('eating');
    const events = t.power('sita', 'anil'); // dahi wasted, flips exhausted
    expect(events.map((e) => e.type)).toEqual(['flipPower', 'bust', 'roundEnd']);
    expect(t.state.results[0]).toMatchObject({ bustReason: 'emptyTable', target: 8, akabareOwnerId: null, trapRewardTo: null });
    expect(t.score('sita')).toBe(-8);
  });

  test('empty table, short, no flips left: immediate emptyTable bust', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t, { ramesh: { power: 'dahi' }, anil: { power: 'dahi' } });
    auction(t, 'sita', 7);
    t.power('sita', 'ramesh');
    t.power('sita', 'anil');
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil'] as Id[]) t.flip('sita', id);
    const events = t.flip('sita', 'anil');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'bust', 'roundEnd']);
    expect(t.last('bust')).toMatchObject({ reason: 'emptyTable', eaten: 6, target: 7 });
  });

  test('Vinegar-then-empty-table does not hang: the cancelled last card busts at once', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t, { sita: { power: 'vinegar' }, ramesh: { power: 'dahi' } });
    auction(t, 'sita', 7);
    t.power('sita', 'ramesh'); // wasted
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil'] as Id[]) t.flip('sita', id);
    t.power('sita', 'sita'); // numb, last flip
    const events = t.flip('sita', 'anil');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'bust', 'roundEnd']);
    expect(events[0]).toMatchObject({ cancelled: true, eaten: 5 });
    expect(t.state.phase).toBe('roundEnd');
    expect(t.state.results[0].bustReason).toBe('emptyTable');
  });

  test('Vinegar flipped on an empty table (then a wasted Vinegar) busts once flips run out', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t, { sita: { power: 'vinegar' }, anil: { power: 'vinegar' } });
    auction(t, 'sita', 7);
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil', 'anil'] as Id[]) t.flip('sita', id);
    expect(t.power('sita', 'sita')[0]).toMatchObject({ effect: 'numb' });
    expect(t.state.phase).toBe('eating');
    const events = t.power('sita', 'anil');
    expect(events.map((e) => e.type)).toEqual(['flipPower', 'bust', 'roundEnd']);
    expect(events[0]).toMatchObject({ effect: 'wasted' });
    expect(t.state.results[0].bustReason).toBe('emptyTable');
  });

  test('Dahi saving the very last card with no flips left ends in an emptyTable bust (no trap reward)', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t, { sita: { power: 'dahi' }, ramesh: { stack: [A, P], power: 'dahi' } });
    auction(t, 'sita', 9);
    t.power('sita', 'ramesh'); // wasted
    for (const id of ['sita', 'sita', 'anil', 'anil', 'ramesh'] as Id[]) t.flip('sita', id);
    t.flip('sita', 'ramesh'); // ramesh's own Akabare, last card on the table
    expect(t.eating.pendingAkabare).not.toBeNull();
    const events = t.power('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPower', 'bust', 'roundEnd']);
    expect(t.state.results[0]).toMatchObject({ bustReason: 'emptyTable', akabareOwnerId: null, trapRewardTo: null, eaten: 5 });
    expect(t.score('ramesh')).toBe(0);
  });
});

describe('decision 10: ACCEPT_BUST legality', () => {
  test('illegal while the table has cards and nothing is pending, and for non-eaters', () => {
    const t = plantedOnSita(3);
    expect(t.legal('sita').acceptBust).toBe(false);
    expect(t.fail('sita', { type: 'ACCEPT_BUST' })).toMatch(/only give up/);
    t.flip('sita', 'sita');
    expect(t.fail('anil', { type: 'ACCEPT_BUST' })).toMatch(/Only the eater/);
    t.acceptBust('sita');
    expect(t.state.results[0]).toMatchObject({ bustReason: 'akabare', trapRewardTo: 'ramesh' });
  });

  test('legal on an empty table with flips left: emptyTable bust, no trap reward', () => {
    const t = table({ players: 3, first: 'sita' });
    setupAll(t);
    auction(t, 'sita', 7);
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil', 'anil'] as Id[]) t.flip('sita', id);
    const events = t.acceptBust('sita');
    expect(events.map((e) => e.type)).toEqual(['bust', 'roundEnd']);
    expect(t.state.results[0]).toMatchObject({ bustReason: 'emptyTable', target: 7, trapRewardTo: null });
  });
});

// ---------------------------------------------------------------------------
// Decision 11: bust & trap reward
// ---------------------------------------------------------------------------

describe('decision 11: trap reward', () => {
  test('an Akabare planted on the eater\'s own stack pays its owner', () => {
    const t = plantedOnSita(3);
    t.flip('sita', 'sita');
    t.acceptBust('sita');
    const r = t.state.results[0];
    expect(r).toMatchObject({ outcome: 'bust', akabareOwnerId: 'ramesh', trapRewardTo: 'ramesh' });
    expect(r.scoreDeltas).toEqual({ sita: -3, ramesh: 2, anil: 0, priya: 0 });
    expect(t.p('sita').busts).toBe(1);
    expect(t.p('ramesh').busts).toBe(0);
  });

  test('busting on your own Akabare (in your own stack) pays nobody', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { stack: [P, A] } });
    auction(t, 'sita', 2);
    t.flip('sita', 'sita');
    t.acceptBust('sita');
    expect(t.state.results[0]).toMatchObject({ akabareOwnerId: 'sita', trapRewardTo: null });
    expect(t.state.results[0].scoreDeltas).toEqual({ sita: -2, ramesh: 0, anil: 0, priya: 0 });
  });

  test('busting on your own Akabare planted on someone else\'s stack pays nobody', () => {
    const t = table({ first: 'sita' });
    setupAll(t);
    t.place('sita', A, 'ramesh');
    auction(t, 'sita', 5);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    expect(t.view('sita').players[1].stack.at(-1)).toEqual({ owner: 'sita', kind: A });
    t.flip('sita', 'ramesh');
    t.acceptBust('sita');
    expect(t.state.results[0]).toMatchObject({ akabareOwnerId: 'sita', trapRewardTo: null });
  });

  test('a cancelled Akabare pays nothing, even if the eater later busts on an empty table', () => {
    const t = plantedOnSita(9, { sita: { power: 'vinegar' } }, { players: 3 });
    t.power('sita', 'sita');
    t.flip('sita', 'sita'); // ramesh's akabare, cancelled
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil', 'anil'] as Id[]) t.flip('sita', id);
    t.acceptBust('sita');
    expect(t.state.results[0]).toMatchObject({ bustReason: 'emptyTable', trapRewardTo: null });
    expect(t.score('ramesh')).toBe(0);
  });

  test('a saved Akabare pays nothing; a later unsaved one pays only its own owner', () => {
    const t = table({ first: 'ramesh' });
    setupAll(t, { sita: { power: 'dahi' }, priya: { power: 'khali' } });
    t.place('ramesh', A, 'sita');
    t.place('anil', A, 'sita');
    auction(t, 'sita', 4);
    t.flip('sita', 'sita'); // anil's akabare
    t.power('sita', 'sita'); // dahi saves
    t.flip('sita', 'sita'); // ramesh's akabare
    t.power('sita', 'priya'); // khali: failed save
    expect(t.state.results[0]).toMatchObject({ akabareOwnerId: 'ramesh', trapRewardTo: 'ramesh', target: 4 });
    expect(t.state.results[0].scoreDeltas).toEqual({ sita: -4, ramesh: 2, anil: 0, priya: 0 });
  });

  test('trapReward is configurable, and 0 means no reward recipient', () => {
    const t = plantedOnSita(3, {}, { config: { trapReward: 3 } });
    t.flip('sita', 'sita');
    t.acceptBust('sita');
    expect(t.score('ramesh')).toBe(3);
    const u = plantedOnSita(3, {}, { config: { trapReward: 0 } });
    u.flip('sita', 'sita');
    u.acceptBust('sita');
    expect(u.state.results[0]).toMatchObject({ akabareOwnerId: 'ramesh', trapRewardTo: null });
    expect(u.score('ramesh')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decision 12: round end, scoring, game over
// ---------------------------------------------------------------------------

describe('decision 12: round end and game over', () => {
  test('success scores +target including Khali; roundEnd carries the result', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { ramesh: { power: 'khali' } });
    auction(t, 'sita', 2);
    t.power('sita', 'ramesh');
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    expect(t.state.phase).toBe('eating'); // 2 eaten, but Khali raised the target to 3
    const events = t.flip('sita', 'anil');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'success', 'roundEnd']);
    const ev = t.last('roundEnd');
    expect(ev.result).toEqual({
      round: 1,
      eaterId: 'sita',
      bid: 2,
      target: 3,
      eaten: 3,
      outcome: 'success',
      bustReason: null,
      akabareOwnerId: null,
      trapRewardTo: null,
      scoreDeltas: { sita: 3, ramesh: 0, anil: 0, priya: 0 },
      scoresAfter: { sita: 3, ramesh: 0, anil: 0, priya: 0 },
    });
  });

  test('bots are ready at once; the round advances when every human is READY', () => {
    const t = table({ first: 'sita', bots: ['anil', 'priya'] });
    setupAll(t);
    auction(t, 'sita', 1);
    t.flip('sita', 'sita');
    expect(t.state.players.map((p) => p.ready)).toEqual([false, false, true, true]);
    expect(pendingActors(t.state)).toEqual(['sita', 'ramesh']);
    expect(t.legal('sita')).toMatchObject({ ready: true, forceContinue: true });
    t.ready('sita');
    expect(t.fail('sita', { type: 'READY' })).toMatch(/already ready/);
    expect(t.state.phase).toBe('roundEnd');
    expect(pendingActors(t.state)).toEqual(['ramesh']);
    const events = t.ready('ramesh');
    expect(events.map((e) => e.type)).toEqual(['ready', 'roundStart']);
    expect(t.state).toMatchObject({ round: 2, phase: 'setup', firstPlayerId: 'ramesh', serving: null, bidding: null, eating: null });
    for (const p of t.state.players) {
      expect(p.hand.map((c) => c.id)).toEqual([1, 2, 3, 4, 5].map((i) => `${p.id}:p${i}`).concat(`${p.id}:a`));
      expect(p).toMatchObject({ stack: [], power: null, setupDone: false, ready: false });
    }
    expect(t.score('sita')).toBe(1);
  });

  test('FORCE_CONTINUE advances regardless of readiness; only valid at roundEnd', () => {
    const t = table({ first: 'sita' });
    expect(t.fail('anil', { type: 'FORCE_CONTINUE' })).toMatch(/end of a round/);
    setupAll(t);
    auction(t, 'sita', 1);
    t.flip('sita', 'sita');
    t.forceContinue('anil');
    expect(t.state.round).toBe(2);
  });

  test('reaching targetScore ends the game at the end of that round', () => {
    const t = table({ first: 'sita', config: { targetScore: 3 } });
    setupAll(t, { sita: { power: 'chaat' } });
    auction(t, 'sita', 4);
    t.power('sita', 'sita');
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    expect(t.state.phase).toBe('roundEnd'); // result shown first
    t.ready('sita');
    t.ready('ramesh');
    t.ready('anil');
    const events = t.ready('priya');
    expect(events.map((e) => e.type)).toEqual(['ready', 'gameOver']);
    expect(t.state.phase).toBe('gameOver');
    expect(t.state.winners).toEqual(['sita']);
    expect(t.last('gameOver')).toMatchObject({ winners: ['sita'], scores: { sita: 4, ramesh: 0, anil: 0, priya: 0 } });
    expect(pendingActors(t.state)).toEqual([]);
    expect(t.legal('sita')).toEqual(noLegal);
    expect(t.fail('sita', { type: 'READY' })).toMatch(/game is over/);
  });

  test('maxRounds ends the game after that round even if nobody reached targetScore', () => {
    const t = table({ config: { maxRounds: 2 } });
    quickRound(t);
    expect(t.state.round).toBe(2);
    quickRound(t);
    expect(t.state.phase).toBe('gameOver');
    expect(t.state.round).toBe(2);
    expect(t.state.results).toHaveLength(2);
  });

  test('targetScore null: plays every round up to maxRounds whatever the scores', () => {
    const t = table({ first: 'sita', config: { targetScore: null, maxRounds: 2 } });
    setupAll(t, { sita: { power: 'chaat' } });
    auction(t, 'sita', 6);
    t.power('sita', 'sita');
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh'] as Id[]) t.flip('sita', id);
    expect(t.score('sita')).toBe(6);
    t.forceContinue('sita');
    expect(t.state.phase).toBe('setup');
    quickRound(t);
    expect(t.state.phase).toBe('gameOver');
    expect(t.state.round).toBe(2);
  });

  test('maxRounds null: keeps going past round 5 until someone reaches targetScore', () => {
    const t = table({ first: 'sita', config: { targetScore: 3, maxRounds: null } });
    while (t.state.phase !== 'gameOver') quickRound(t);
    // Each round the rotating first player scores +1: sita reaches 3 in round 9.
    expect(t.state.round).toBe(9);
    expect(t.state.winners).toEqual(['sita']);
    expect(t.state.players.map((p) => p.score)).toEqual([3, 2, 2, 2]);
  });

  test('ties break on fewer busts', () => {
    const t = table({ players: 3, first: 'sita', config: { maxRounds: 3 } });
    // Round 1: sita busts on her own Akabare (-1).
    setupAll(t, { sita: { stack: [P, A] } });
    auction(t, 'sita', 1);
    t.flip('sita', 'sita');
    t.acceptBust('sita');
    t.forceContinue('sita');
    // Round 2: sita scores +3 (total 2, 1 bust).
    setupAll(t);
    auction(t, 'sita', 3);
    for (const id of ['sita', 'sita', 'anil'] as Id[]) t.flip('sita', id);
    t.forceContinue('sita');
    // Round 3: ramesh scores +2 (total 2, 0 busts).
    setupAll(t);
    auction(t, 'ramesh', 2);
    t.flip('ramesh', 'ramesh');
    t.flip('ramesh', 'ramesh');
    t.forceContinue('sita');
    expect(t.state.players.map((p) => [p.score, p.busts])).toEqual([[2, 1], [2, 0], [0, 0]]);
    expect(t.state.winners).toEqual(['ramesh']);
  });

  test('still tied: the win is shared', () => {
    const t = table({ players: 3, first: 'sita', config: { maxRounds: 2 } });
    setupAll(t);
    auction(t, 'sita', 2);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    t.forceContinue('sita');
    setupAll(t);
    auction(t, 'anil', 2);
    t.flip('anil', 'anil');
    t.flip('anil', 'anil');
    t.forceContinue('sita');
    expect(t.state.winners).toEqual(['sita', 'anil']);
    expect(t.last('gameOver').winners).toEqual(['sita', 'anil']);
  });

  test('scores always equal the sum of result deltas; busts are counted', () => {
    const t = plantedOnSita(3);
    t.flip('sita', 'sita');
    t.acceptBust('sita');
    t.forceContinue('sita');
    quickRound(t);
    for (const p of t.state.players) {
      expect(p.score).toBe(t.state.results.reduce((n, r) => n + r.scoreDeltas[p.id], 0));
    }
    expect(t.p('sita').busts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Decision 13: secrecy (views)
// ---------------------------------------------------------------------------

describe('decision 13: secrecy', () => {
  function secretsTable(ramesh: { stack: PuriKind[]; power: PowerKind }) {
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { power: 'vinegar' }, ramesh });
    t.place('sita', A, 'ramesh');
    t.place('ramesh', P, 'sita');
    return t;
  }

  test('face-down puri show only their owner; the owner also sees the kind (anywhere on the table)', () => {
    const t = secretsTable({ stack: [A, P], power: 'khali' });
    const v = t.view('sita');
    expect(v.youId).toBe('sita');
    expect(v.players[0].stack).toEqual([
      { owner: 'sita', kind: P },
      { owner: 'sita', kind: P },
      { owner: 'ramesh', kind: null },
    ]);
    expect(v.players[1].stack).toEqual([
      { owner: 'ramesh', kind: null },
      { owner: 'ramesh', kind: null },
      { owner: 'sita', kind: A },
    ]);
    const r = t.view('ramesh');
    expect(r.players[1].stack).toEqual([
      { owner: 'ramesh', kind: A },
      { owner: 'ramesh', kind: P },
      { owner: 'sita', kind: null },
    ]);
    expect(r.players[0].stack[2]).toEqual({ owner: 'ramesh', kind: P });
  });

  test('powers show their kind only to their owner until flipped', () => {
    const t = secretsTable({ stack: [P, P], power: 'khali' });
    expect(t.view('sita').players[0].power).toEqual({ owner: 'sita', revealed: false, kind: 'vinegar' });
    expect(t.view('sita').players[1].power).toEqual({ owner: 'ramesh', revealed: false, kind: null });
    expect(t.view(null).players[0].power!.kind).toBeNull();
  });

  test('hand contents and used-power history are private; hand counts are public', () => {
    const t = secretsTable({ stack: [P, P], power: 'khali' });
    const v = t.view('anil');
    expect(v.players.map((p) => p.handCount)).toEqual([3, 3, 4, 4]);
    expect(v.me).toEqual({
      hand: { panipuri: 3, akabare: 1 },
      availablePowers: ['vinegar', 'dahi', 'chaat'],
      usedPowers: ['khali'],
      powerPicks: ['khali'],
      setup: { stack: [P, P], power: 'khali' },
    });
    expect(t.view('sita').me!.hand).toEqual({ panipuri: 3, akabare: 0 });
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/usedPowers":\["vinegar/);
  });

  test('spectators get no private view and no legal actions', () => {
    const t = secretsTable({ stack: [P, P], power: 'khali' });
    for (const v of [t.view(null), projectView(t.state, 'stranger')]) {
      expect(v.youId).toBeNull();
      expect(v.me).toBeNull();
      expect(v.legal).toEqual(noLegal);
      expect(v.players.every((p) => p.stack.every((c) => c.kind === null))).toBe(true);
      expect(v.players.every((p) => p.power!.kind === null)).toBe(true);
    }
  });

  test('views never contain card ids, and do not depend on hidden information', () => {
    const a = secretsTable({ stack: [A, P], power: 'khali' });
    const b = secretsTable({ stack: [P, P], power: 'chaat' });
    for (const viewer of ['sita', 'anil', 'priya', null] as (Id | null)[]) {
      const va = a.view(viewer);
      expect(va).toEqual(b.view(viewer));
      expect(JSON.stringify(va)).not.toMatch(/:(p\d+|a)"/);
    }
    expect(a.view('ramesh')).not.toEqual(b.view('ramesh'));
    // The public log never says what kind was placed.
    for (const e of a.state.log) expect(JSON.stringify(e)).not.toMatch(/panipuri|akabare/);
  });

  test('the private setup reminder survives placements and eating', () => {
    const t = table({ first: 'ramesh' });
    setupAll(t, { sita: { stack: [A, P], power: 'dahi' } });
    t.place('ramesh', P, 'sita');
    expect(t.view('sita').me!.setup).toEqual({ stack: [A, P], power: 'dahi' });
    auction(t, 'sita', 5);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    expect(t.view('sita').me!.setup).toEqual({ stack: [A, P], power: 'dahi' });
    t.flip('sita', 'sita'); // own Akabare
    t.acceptBust('sita');
    expect(t.view('sita').me!.setup).toEqual({ stack: [A, P], power: 'dahi' });
    expect(t.view('ramesh').me!.setup).toEqual({ stack: [P, P], power: 'khali' });
    t.forceContinue('sita');
    expect(t.view('sita').me!.setup).toBeNull();
  });

  test('leftovers stay secret at roundEnd by default, and are revealed at gameOver', () => {
    const t = table({ first: 'sita', config: { maxRounds: 1 } });
    setupAll(t, { ramesh: { stack: [A, P], power: 'chaat' } });
    auction(t, 'sita', 1);
    t.flip('sita', 'sita');
    const atEnd = t.view('anil');
    expect(atEnd.revealed).toBe(false);
    expect(atEnd.players[1].stack.map((c) => c.kind)).toEqual([null, null]);
    expect(atEnd.players[1].power!.kind).toBeNull();
    t.forceContinue('sita');
    const over = t.view('anil');
    expect(over.revealed).toBe(true);
    expect(over.players[1].stack.map((c) => c.kind)).toEqual([A, P]);
    expect(over.players[1].power).toEqual({ owner: 'ramesh', revealed: false, kind: 'chaat' });
    expect(t.view(null).players[1].stack.map((c) => c.kind)).toEqual([A, P]);
    expect(over.me!.hand).toEqual({ panipuri: 3, akabare: 1 }); // hands are not "on the table"
  });

  test('revealOnRoundEnd reveals leftovers during roundEnd only', () => {
    const t = table({ first: 'sita', config: { revealOnRoundEnd: true } });
    setupAll(t, { ramesh: { stack: [A, P], power: 'chaat' } });
    expect(t.view('anil').revealed).toBe(false);
    auction(t, 'sita', 1);
    expect(t.view('anil').players[1].stack[0].kind).toBeNull();
    t.flip('sita', 'sita');
    const v = t.view('anil');
    expect(v.revealed).toBe(true);
    expect(v.players[1].stack.map((c) => c.kind)).toEqual([A, P]);
    expect(v.players[1].power!.kind).toBe('chaat');
    expect(JSON.stringify(v)).not.toMatch(/:(p\d+|a)"/);
  });

  test('log is the last VIEW_LOG_LIMIT events; lastSeq is the newest seq; legal/pending mirror the engine', () => {
    const t = table({ first: 'sita', config: { targetScore: null, maxRounds: 20 } });
    for (let i = 0; i < 8; i++) quickRound(t);
    expect(t.state.log.length).toBeGreaterThan(VIEW_LOG_LIMIT);
    const v = t.view('ramesh');
    expect(v.log).toHaveLength(VIEW_LOG_LIMIT);
    expect(v.log).toEqual(t.state.log.slice(-VIEW_LOG_LIMIT));
    expect(v.lastSeq).toBe(t.state.log.at(-1)!.seq);
    expect(t.state.log.map((e) => e.seq)).toEqual(t.state.log.map((_, i) => i + 1));
    expect(v.legal).toEqual(legalActions(t.state, 'ramesh'));
    expect(v.pendingActors).toEqual(pendingActors(t.state));
  });
});

// ---------------------------------------------------------------------------
// Decision 14: soft bid warning
// ---------------------------------------------------------------------------

describe('decision 14: tableMax', () => {
  test('face-down puri on the table + 2 × powerFlipsMax (public info only)', () => {
    const t = table({ first: 'sita' });
    setupAll(t);
    expect(t.view('sita').tableMax).toBe(8 + 4);
    t.place('sita', A, 'ramesh');
    expect(t.view('anil').tableMax).toBe(9 + 4);
    const u = table({ first: 'sita', players: 3, config: { powerFlipsMax: 3 } });
    setupAll(u);
    expect(u.view(null).tableMax).toBe(6 + 6);
    auction(u, 'sita', 2);
    u.flip('sita', 'sita');
    expect(u.view(null).tableMax).toBe(5 + 6);
  });
});

// ---------------------------------------------------------------------------
// The 7 worked examples from the PDF
// ---------------------------------------------------------------------------

describe('PDF examples', () => {
  test('Vinegar saves you', () => {
    // Sita suspects Ramesh planted his Akabare on top of his own stack.
    const t = table({ first: 'sita' });
    setupAll(t, { sita: { power: 'vinegar' }, ramesh: { stack: [P, A], power: 'khali' } });
    auction(t, 'sita', 3);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    // She flips her Vinegar first, then Ramesh's top card. It's the Akabare. Cancelled. She's safe.
    t.power('sita', 'sita');
    const events = t.flip('sita', 'ramesh');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'flipPuri', owner: 'ramesh', kind: A, cancelled: true, eaten: 2 });
    expect(t.state.phase).toBe('eating');
    expect(t.eating.pendingAkabare).toBeNull();
    t.flip('sita', 'ramesh');
    expect(t.state.results[0]).toMatchObject({ outcome: 'success', target: 3, trapRewardTo: null });
    expect(t.score('sita')).toBe(3);
    expect(t.score('ramesh')).toBe(0);
  });

  test('Vinegar wastes a puri', () => {
    const t = table({ first: 'anil' });
    setupAll(t, { anil: { power: 'vinegar' } });
    auction(t, 'anil', 2);
    t.power('anil', 'anil');
    const [ev] = t.flip('anil', 'anil');
    // His next card is a Panipuri. It doesn't count.
    expect(ev).toMatchObject({ kind: P, cancelled: true, eaten: 0 });
    expect(t.eating).toMatchObject({ eaten: 0, skipNext: false });
    expect(t.eating.plate[0]).toMatchObject({ cancelled: true });
    t.flip('anil', 'anil');
    expect(t.eating.eaten).toBe(1);
  });

  test('The blind Dahi', () => {
    // Priya bites an Akabare (Sita's, planted on Priya's stack).
    const t = table({ first: 'sita' });
    setupAll(t, { anil: { power: 'chaat' } });
    t.place('sita', A, 'priya');
    auction(t, 'priya', 3);
    t.flip('priya', 'priya');
    expect(t.last('bite')).toMatchObject({ eaterId: 'priya', owner: 'sita' });
    // She flips the power beside Anil's stack, hoping for Dahi. It's Chaat. She's out.
    const [ev] = t.power('priya', 'anil');
    expect(ev).toMatchObject({ kind: 'chaat', effect: 'failedSave', eaten: 0 });
    expect(t.state.results[0]).toMatchObject({ eaterId: 'priya', outcome: 'bust', bustReason: 'akabare', eaten: 0, target: 3 });
    expect(t.score('priya')).toBe(-3);
    expect(t.score('sita')).toBe(2);
  });

  test('Chaat speeds you up', () => {
    // Ramesh bids 4. He eats 1 Panipuri, then flips the power beside Sita's stack. It's Chaat.
    const t = table({ first: 'ramesh' });
    setupAll(t, { sita: { power: 'chaat' } });
    auction(t, 'ramesh', 4);
    t.flip('ramesh', 'ramesh');
    const [ev] = t.power('ramesh', 'sita');
    // He's at 3 and needs 1 more.
    expect(ev).toMatchObject({ kind: 'chaat', effect: 'plusTwo', eaten: 3, target: 4 });
    expect(t.state.phase).toBe('eating');
    t.flip('ramesh', 'ramesh');
    expect(t.state.results[0]).toMatchObject({ outcome: 'success', target: 4 });
    expect(t.score('ramesh')).toBe(4);
  });

  test('Khali Puri backfires', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { ramesh: { power: 'khali' }, anil: { power: 'dahi' } });
    t.place('sita', A, 'priya');
    t.place('ramesh', P, 'ramesh');
    t.place('anil', P, 'anil');
    // Priya bids 5 and gambles on the power beside Ramesh's stack. It's Khali Puri. Now she needs 6.
    auction(t, 'priya', 5);
    const [ev] = t.power('priya', 'ramesh');
    expect(ev).toMatchObject({ kind: 'khali', effect: 'targetUp', target: 6 });
    // ...and if she busts, she loses 6.
    t.flip('priya', 'priya');
    t.acceptBust('priya');
    expect(t.state.results[0]).toMatchObject({ bid: 5, target: 6, outcome: 'bust' });
    expect(t.score('priya')).toBe(-6);
  });

  test('Chaat on an empty table', () => {
    const t = table({ players: ['sita', 'ramesh', 'anil'], first: 'anil' });
    setupAll(t, { anil: { power: 'vinegar' }, sita: { power: 'chaat' }, ramesh: { power: 'dahi' } });
    auction(t, 'anil', 7);
    t.power('anil', 'anil'); // his first power flip cancels one card
    for (const id of ['anil', 'anil', 'sita', 'sita', 'ramesh', 'ramesh'] as Id[]) t.flip('anil', id);
    // Every stack is empty and he's eaten 5.
    expect(t.state.phase).toBe('eating');
    expect(t.eating.eaten).toBe(5);
    expect(t.legal('anil')).toMatchObject({ flipPuri: [], flipPower: ['sita', 'ramesh'], acceptBust: true });
    // He gambles his last power flip on Sita's power. It's Chaat. He's at 7. Success.
    t.power('anil', 'sita');
    expect(t.state.results[0]).toMatchObject({ eaterId: 'anil', outcome: 'success', eaten: 7, target: 7 });
    expect(t.score('anil')).toBe(7);
  });

  test('The planted chili', () => {
    const t = table({ first: 'sita' });
    setupAll(t, { priya: { power: 'khali' } });
    // Sita slips her Akabare onto Anil's stack.
    t.place('sita', A, 'anil');
    // Ramesh wins the bid, clears his own stack, then flips Anil's top card. Akabare.
    auction(t, 'ramesh', 3);
    t.flip('ramesh', 'ramesh');
    t.flip('ramesh', 'ramesh');
    t.flip('ramesh', 'anil');
    expect(t.last('bite')).toMatchObject({ eaterId: 'ramesh', fromStackOf: 'anil', owner: 'sita' });
    // He flips a power hoping for Dahi. It's Khali Puri. Ramesh busts, and Sita gets +2.
    const [ev] = t.power('ramesh', 'priya');
    expect(ev).toMatchObject({ kind: 'khali', effect: 'failedSave', target: 3 });
    expect(t.state.results[0]).toMatchObject({ outcome: 'bust', akabareOwnerId: 'sita', trapRewardTo: 'sita', target: 3 });
    expect(t.score('ramesh')).toBe(-3);
    expect(t.score('sita')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('purity', () => {
  test('applyAction never mutates a deep-frozen input, on success or on error', () => {
    const t = table({ first: 'sita' });
    const frozen = deepFreeze(t.state);
    const snapshot = JSON.stringify(frozen);
    const ok = applyAction(frozen, 'sita', { type: 'SUBMIT_SETUP', stack: [P, A], power: 'dahi' });
    expect(ok.ok).toBe(true);
    const bad = applyAction(frozen, 'sita', { type: 'SUBMIT_SETUP', stack: [A, A], power: 'dahi' });
    expect(bad).toEqual({ ok: false, error: 'You only have 1 Akabare.' });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    if (ok.ok) {
      ok.state.players[0].stack.pop(); // the new state is independent of the input
      expect(JSON.stringify(frozen)).toBe(snapshot);
    }
  });

  test('malformed actions and unknown players are rejected, not thrown', () => {
    const t = table();
    const s = deepFreeze(t.state);
    expect(applyAction(s, 'sita', null as unknown as Action)).toEqual({ ok: false, error: 'Missing action.' });
    expect(applyAction(s, 'sita', { type: 'EAT_ALL' } as unknown as Action).ok).toBe(false);
    expect(applyAction(s, 'ghost', { type: 'PASS' })).toEqual({ ok: false, error: "You're not a player in this game." });
    expect(applyAction(s, 'sita', { type: 'PLACE_PURI', kind: P } as unknown as Action).ok).toBe(false);
    expect(applyAction(s, 'sita', { type: 'RAISE', amount: '3' } as unknown as Action).ok).toBe(false);
  });

  test('setBot and runBots are pure too', () => {
    const t = table({ bots: ['anil'] });
    const frozen = deepFreeze(t.state);
    const snapshot = JSON.stringify(frozen);
    const withBot = setBot(frozen, 'priya', true);
    const ran = runBots(deepFreeze(withBot));
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(ran.state.players[2].setupDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setBot / runBots / Decision 15: bots
// ---------------------------------------------------------------------------

describe('setBot', () => {
  test('flips the flag, logs botSet, and throws on unknown players', () => {
    const t = table();
    const s = setBot(t.state, 'anil', true);
    expect(s.players[2].isBot).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ type: 'botSet', playerId: 'anil', isBot: true });
    expect(setBot(s, 'anil', true).log).toHaveLength(s.log.length); // unchanged: no event
    expect(() => setBot(s, 'ghost', true)).toThrow(EngineError);
  });

  test('at roundEnd a new bot is ready at once (runBots then advances); a returning human is not', () => {
    const t = table({ first: 'sita', bots: ['anil', 'priya'] });
    setupAll(t);
    auction(t, 'sita', 1);
    t.flip('sita', 'sita');
    t.ready('sita');
    t.state = setBot(t.state, 'ramesh', true);
    expect(t.p('ramesh').ready).toBe(true);
    expect(t.state.phase).toBe('roundEnd');
    expect(pendingActors(t.state)).toEqual(['ramesh', 'anil', 'priya']);
    const ran = runBots(t.state, 1);
    expect(ran.state.round).toBe(2);
    expect(ran.events.map((e) => e.type)).toEqual(['roundStart']);

    const u = table({ first: 'sita', bots: ['anil'] });
    setupAll(u);
    auction(u, 'sita', 1);
    u.flip('sita', 'sita');
    u.state = setBot(u.state, 'anil', false);
    expect(u.p('anil').ready).toBe(false);
    expect(pendingActors(u.state)).toEqual(['sita', 'ramesh', 'anil', 'priya']);
  });
});

describe('runBots', () => {
  test('an all-bot game runs to gameOver deterministically, advancing state.rng', () => {
    const start = createGame(seeds({ players: 5 }).map((p) => ({ ...p, isBot: true })), {}, 1234);
    let a = start;
    let steps = 0;
    while (a.phase !== 'gameOver' && steps++ < 100) a = runBots(a).state;
    expect(a.phase).toBe('gameOver');
    expect(a.winners!.length).toBeGreaterThan(0);
    expect(a.rng).not.toBe(start.rng);
    let b = start;
    while (b.phase !== 'gameOver') b = runBots(b).state;
    expect(b).toEqual(a);
  });

  test('stops when a human must act, and returns every event it produced', () => {
    const t = table({ first: 'sita', bots: ['ramesh', 'anil', 'priya'] });
    const ran = runBots(t.state);
    expect(ran.events.map((e) => e.type)).toEqual(['setupDone', 'setupDone', 'setupDone']);
    expect(pendingActors(ran.state)).toEqual(['sita']);
    t.state = ran.state;
    t.setup('sita', [P, P], 'chaat');
    expect(t.state.serving!.turnId).toBe('sita');
    expect(runBots(t.state).state).toBe(t.state); // nothing for bots to do
  });

  test('respects maxSteps', () => {
    const start = createGame(seeds({}).map((p) => ({ ...p, isBot: true })), {}, 5);
    const ran = runBots(start, 2);
    expect(ran.state.players.filter((p) => p.setupDone)).toHaveLength(2);
  });

  test('a player replaced by a bot mid-turn gets moved for', () => {
    const t = table({ first: 'sita' });
    setupAll(t);
    const ran = runBots(setBot(t.state, 'sita', true));
    expect(ran.state.serving?.turnId ?? ran.state.bidding?.turnId).toBe('ramesh');
    expect(ran.events.some((e) => e.type === 'place' || e.type === 'bidStart')).toBe(true);
  });
});

describe('decision 15: bots decide from their own view only', () => {
  const rand = (seed: number) => randStream(seed).rand;

  test('identical views give identical decisions, whatever the hidden cards are', () => {
    for (let seed = 0; seed < 30; seed++) {
      const a = table({ first: 'ramesh', bots: ['sita'] });
      const b = table({ first: 'ramesh', bots: ['sita'] });
      setupAll(a, { ramesh: { stack: [A, P], power: 'dahi' }, anil: { power: 'vinegar' } });
      setupAll(b, { ramesh: { stack: [P, P], power: 'chaat' }, anil: { power: 'khali' } });
      for (const t of [a, b]) {
        t.place('ramesh', P, 'sita');
        t.place('anil', t === a && seed % 2 ? A : P, 'sita');
        t.place('priya', P, 'anil');
      }
      // Hidden differences: ramesh's setup/power, anil's power, and the kind anil placed.
      expect(pendingActors(a.state)).toEqual(['sita']);
      expect(projectView(a.state, 'sita')).toEqual(projectView(b.state, 'sita'));
      const choice = chooseBotAction(a.state, 'sita', rand(seed));
      expect(choice).not.toBeNull();
      expect(choice).toEqual(chooseBotAction(b.state, 'sita', rand(seed)));
      // Same again once the bot is the eater (before any card is turned face up).
      for (const t of [a, b]) {
        if (t.state.phase === 'serving' && t.state.serving!.turnId === 'sita') t.act('sita', choice!);
        if (t.state.phase === 'serving') auction(t, 'sita', 3);
      }
      if (a.state.phase === 'eating' && b.state.phase === 'eating') {
        expect(projectView(a.state, 'sita')).toEqual(projectView(b.state, 'sita'));
        expect(chooseBotAction(a.state, 'sita', rand(seed))).toEqual(chooseBotAction(b.state, 'sita', rand(seed)));
      }
    }
  });

  test('a non-pending bot has nothing to do', () => {
    const t = table({ first: 'sita', bots: ['anil'] });
    setupAll(t);
    expect(chooseBotAction(t.state, 'anil')).toBeNull();
  });

  test('bots keep their Akabare to plant on other stacks', () => {
    let planted = 0;
    let own = 0;
    for (let seed = 0; seed < 60; seed++) {
      let s = createGame(seeds({}).map((p) => ({ ...p, isBot: true })), {}, seed);
      s = runBots(s, 4).state; // setups
      const botId = s.serving!.turnId;
      const me = s.players.find((p) => p.id === botId)!;
      const action = chooseBotAction(s, botId, rand(seed))!;
      if (action.type === 'PLACE_PURI' && action.kind === 'akabare') {
        if (action.targetPlayerId === botId) own++;
        else planted++;
      }
      expect(me.hand.length + me.stack.length).toBe(6);
    }
    expect(own).toBe(0);
    expect(planted).toBeGreaterThan(30);
  });

  test('uses its own Vinegar before its own known Akabare', () => {
    const t = table({ first: 'sita', bots: ['sita'] });
    setupAll(t, { sita: { stack: [P, A], power: 'vinegar' } });
    auction(t, 'sita', 2);
    for (let seed = 0; seed < 10; seed++) {
      expect(chooseBotAction(t.state, 'sita', rand(seed))).toEqual({ type: 'FLIP_POWER', targetPlayerId: 'sita' });
    }
  });

  test('when bitten: flips its own Dahi, otherwise gambles on someone else\'s power', () => {
    const t = plantedOnSita(3, { sita: { power: 'dahi' } }, { bots: ['sita'] });
    t.flip('sita', 'sita');
    expect(chooseBotAction(t.state, 'sita', rand(1))).toEqual({ type: 'FLIP_POWER', targetPlayerId: 'sita' });
    const u = plantedOnSita(3, { sita: { power: 'khali' } }, { bots: ['sita'] });
    u.flip('sita', 'sita');
    for (let seed = 0; seed < 10; seed++) {
      const action = chooseBotAction(u.state, 'sita', rand(seed))!;
      expect(action.type).toBe('FLIP_POWER');
      expect((action as { targetPlayerId: string }).targetPlayerId).not.toBe('sita');
    }
  });

  test('flips its own Chaat when it finishes the job', () => {
    const t = table({ first: 'sita', bots: ['sita'] });
    setupAll(t, { sita: { power: 'chaat' } });
    auction(t, 'sita', 3);
    t.flip('sita', 'sita');
    expect(chooseBotAction(t.state, 'sita', rand(3))).toEqual({ type: 'FLIP_POWER', targetPlayerId: 'sita' });
  });

  test('prefers a stack whose top card it knows is its own Panipuri', () => {
    const t = table({ first: 'sita', bots: ['sita'] });
    setupAll(t, { sita: { power: 'khali' } });
    t.place('sita', P, 'anil');
    auction(t, 'sita', 6);
    t.flip('sita', 'sita');
    t.flip('sita', 'sita');
    for (let seed = 0; seed < 10; seed++) {
      expect(chooseBotAction(t.state, 'sita', rand(seed))).toEqual({ type: 'FLIP_PURI', targetPlayerId: 'anil' });
    }
  });

  test('never flips its own known Khali on an empty table; accepts the bust when no Chaat can save it', () => {
    const t = table({ players: 3, first: 'sita', bots: ['sita'] });
    setupAll(t, { sita: { power: 'khali' } });
    auction(t, 'sita', 12);
    for (const id of ['sita', 'sita', 'ramesh', 'ramesh', 'anil', 'anil'] as Id[]) t.flip('sita', id);
    expect(chooseBotAction(t.state, 'sita', rand(0))).toEqual({ type: 'ACCEPT_BUST' });
  });

  test('bots bid near a sensible estimate (not wildly above the table)', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = createGame(seeds({}).map((p) => ({ ...p, isBot: true })), {}, seed);
      while (s.phase === 'setup' || s.phase === 'serving' || s.phase === 'bidding') s = runBots(s, 1).state;
      expect(s.eating!.bid).toBeLessThanOrEqual(projectView(s, null).tableMax);
    }
  });
});
