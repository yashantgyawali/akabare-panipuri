/**
 * Adversarial rules audit (rules v0.6 PDF + ARCHITECTURE "Rules decisions" 1-15).
 *
 * Part 1: targeted scenarios, each tagged with the rule it checks.
 * Part 2: a differential test against an independent reference model written
 * straight from the rules text (not from engine.ts), driven by random legal
 * and illegal actions from every seat.
 */
import { describe, expect, test } from 'vitest';
import {
  applyAction,
  availablePowers,
  botStep,
  chooseBotAction,
  computeWinners,
  createGame,
  EngineError,
  legalActions,
  mulberry32,
  pendingActors,
  POWER_KINDS,
  projectView,
  runBots,
  setBot,
  type Action,
  type ColorId,
  type GameConfig,
  type GameEvent,
  type GameEventBody,
  type GameState,
  type LegalActions,
  type Phase,
  type PlayerId,
  type PlayerState,
  type PowerKind,
  type PuriKind,
} from './index.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Id = 'sita' | 'ramesh' | 'anil' | 'priya' | 'maya' | 'hari';
const ROSTER: { id: Id; name: string; color: ColorId }[] = [
  { id: 'sita', name: 'Sita', color: 'red' },
  { id: 'ramesh', name: 'Ramesh', color: 'blue' },
  { id: 'anil', name: 'Anil', color: 'yellow' },
  { id: 'priya', name: 'Priya', color: 'green' },
  { id: 'maya', name: 'Maya', color: 'purple' },
  { id: 'hari', name: 'Hari', color: 'orange' },
];
const P: PuriKind = 'panipuri';
const A: PuriKind = 'akabare';
type EventOf<T extends GameEventBody['type']> = Extract<GameEvent, { type: T }>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

class G {
  s: GameState;
  ev: GameEvent[];
  constructor(s: GameState) {
    this.s = s;
    this.ev = [...s.log];
  }
  ok(id: Id, a: Action): GameEvent[] {
    const r = applyAction(deepFreeze(this.s), id, a);
    if (!r.ok) throw new Error(`${id} ${JSON.stringify(a)} rejected in ${this.s.phase}: ${r.error}`);
    this.s = r.state;
    this.ev.push(...r.events);
    return r.events;
  }
  no(id: Id, a: Action): string {
    const r = applyAction(deepFreeze(this.s), id, a);
    if (r.ok) throw new Error(`${id} ${JSON.stringify(a)} was accepted in ${this.s.phase}`);
    expect(typeof r.error).toBe('string');
    return r.error;
  }
  p(id: Id) {
    return this.s.players.find((q) => q.id === id)!;
  }
  get e() {
    return this.s.eating!;
  }
  score(id: Id) {
    return this.p(id).score;
  }
  legal(id: Id) {
    return legalActions(this.s, id);
  }
  turn(): Id {
    return (this.s.phase === 'serving' ? this.s.serving!.turnId : this.s.bidding!.turnId) as Id;
  }
  flip = (id: Id, t: Id) => this.ok(id, { type: 'FLIP_PURI', targetPlayerId: t });
  power = (id: Id, t: Id) => this.ok(id, { type: 'FLIP_POWER', targetPlayerId: t });
  all<T extends GameEventBody['type']>(type: T): EventOf<T>[] {
    return this.ev.filter((e): e is EventOf<T> => e.type === type);
  }
  last<T extends GameEventBody['type']>(type: T): EventOf<T> {
    const found = this.all(type);
    expect(found.length).toBeGreaterThan(0);
    return found[found.length - 1];
  }
  get result() {
    return this.s.results[this.s.results.length - 1];
  }
}

function game(n = 3, opts: { first?: Id; config?: Partial<GameConfig>; bots?: Id[] } = {}): G {
  const seeds = ROSTER.slice(0, n).map((p) => ({ ...p, isBot: opts.bots?.includes(p.id) ?? false }));
  const first = opts.first ?? 'sita';
  for (let seed = 0; seed < 1000; seed++) {
    const s = createGame(seeds, opts.config ?? {}, seed);
    if (s.firstPlayerId === first) return new G(s);
  }
  throw new Error('no seed gives that first player');
}

type Spec = Partial<Record<Id, { stack?: PuriKind[]; power?: PowerKind }>>;

/** Everyone submits: all-Panipuri stacks and the first available power unless specified. */
function setupAll(g: G, spec: Spec = {}): void {
  for (const p of g.s.players) {
    const sp = spec[p.id as Id] ?? {};
    const stack = sp.stack ?? Array.from({ length: g.s.config.startingStack }, () => P);
    const power = sp.power ?? availablePowers(g.s, p.id)[0];
    g.ok(p.id as Id, { type: 'SUBMIT_SETUP', stack, power });
  }
  expect(g.s.phase).toBe('serving');
}

/** Each move is played by whoever's serving turn it is. */
function serve(g: G, moves: [PuriKind, Id][]): void {
  for (const [kind, onto] of moves) g.ok(g.turn(), { type: 'PLACE_PURI', kind, targetPlayerId: onto });
}

/** The current serving player opens; `winner` ends up eating at `amount`; everyone else passes. */
function auction(g: G, winner: Id, amount: number): void {
  const starter = g.turn();
  g.ok(starter, { type: 'START_BID', amount: starter === winner ? amount : g.s.config.minBid });
  let raised = starter === winner;
  while (g.s.phase === 'bidding') {
    const t = g.turn();
    if (t === winner && !raised) {
      g.ok(t, { type: 'RAISE', amount });
      raised = true;
    } else g.ok(t, { type: 'PASS' });
  }
  expect(g.s.phase).toBe('eating');
  expect(g.e.eaterId).toBe(winner);
  expect(g.e.bid).toBe(amount);
}

/** One round: setup with `picks`, the first player bids 1 and eats their own top Panipuri, then continue. */
function quickRound(g: G, picks: Partial<Record<Id, PowerKind>> = {}): void {
  setupAll(g, Object.fromEntries(Object.entries(picks).map(([id, power]) => [id, { power }])) as Spec);
  const first = g.turn();
  auction(g, first, 1);
  g.flip(first, first);
  expect(g.s.phase).toBe('roundEnd');
  g.ok(first, { type: 'FORCE_CONTINUE' });
}

function battery(ids: readonly Id[]): Action[] {
  return [
    { type: 'SUBMIT_SETUP', stack: [P, P], power: 'dahi' },
    ...ids.flatMap((t): Action[] => [
      { type: 'PLACE_PURI', kind: P, targetPlayerId: t },
      { type: 'PLACE_PURI', kind: A, targetPlayerId: t },
      { type: 'FLIP_PURI', targetPlayerId: t },
      { type: 'FLIP_POWER', targetPlayerId: t },
    ]),
    { type: 'START_BID', amount: 1 },
    { type: 'START_BID', amount: 40 },
    { type: 'RAISE', amount: 40 },
    { type: 'PASS' },
    { type: 'ACCEPT_BUST' },
    { type: 'READY' },
    { type: 'FORCE_CONTINUE' },
  ];
}

/** Which action types `id` can get accepted right now (probing a battery against a frozen state). */
function acceptedTypes(g: G, id: Id): string[] {
  const ids = g.s.players.map((p) => p.id as Id);
  const out = new Set<string>();
  const before = JSON.stringify(g.s);
  for (const a of battery(ids)) if (applyAction(deepFreeze(g.s), id, a).ok) out.add(a.type);
  expect(JSON.stringify(g.s)).toBe(before);
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Setup (PDF p1-2, decision 1)
// ---------------------------------------------------------------------------

describe('audit: setup (PDF "Setup", decision 1)', () => {
  test('the stack is listed bottom → top: the first flip is the card listed last', () => {
    const g = game();
    setupAll(g, { sita: { stack: [A, P], power: 'nayaplate' } });
    expect(g.p('sita').stack.map((c) => c.kind)).toEqual([A, P]);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    expect(g.e.plate[0].card.kind).toBe(P);
    expect(g.result.outcome).toBe('success');
  });

  test('resubmitting replaces stack and power without duplicating cards; only the final pick counts as used', () => {
    const g = game();
    g.ok('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'vinegar' });
    g.ok('sita', { type: 'SUBMIT_SETUP', stack: [A, P], power: 'dahi' });
    expect(g.all('setupDone').filter((e) => e.playerId === 'sita')).toHaveLength(1);
    expect(g.p('sita').hand.map((c) => c.kind).sort()).toEqual([P, P, P, P]);
    expect(g.p('sita').stack.map((c) => c.kind)).toEqual([A, P]);
    expect(g.p('sita').power).toEqual({ kind: 'dahi', revealed: false });
    expect(g.p('sita').usedPowers).toEqual([]); // not locked in until everyone has submitted
    g.ok('ramesh', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'nayaplate' });
    g.ok('anil', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'nayaplate' });
    expect(g.s.phase).toBe('serving');
    expect(g.p('sita').usedPowers).toEqual(['dahi']);
    // Too late to change your mind once the last player has submitted.
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'vinegar' });
  });

  test('rejects wrong sizes, two Akabare, bogus kinds, unavailable powers and unknown players', () => {
    const g = game();
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P], power: 'dahi' });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, P, P], power: 'dahi' });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [A, A], power: 'dahi' });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, 'chili' as PuriKind], power: 'dahi' });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'masala' as PowerKind });
    expect(applyAction(g.s, 'ghost', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'dahi' }).ok).toBe(false);
    quickRound(g, { sita: 'vinegar' });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'vinegar' });
  });

  test('a new round hands back the full set and clears stacks, powers and flags', () => {
    const g = game();
    setupAll(g, { sita: { stack: [A, P] } });
    // Cards end up spread over other stacks and the plate: all of them must come home.
    serve(g, [[P, 'ramesh'], [A, 'sita'], [P, 'anil']]);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita'); // ramesh's Akabare, planted on top of sita's stack
    expect(g.e.pendingAkabare!.card.owner).toBe('ramesh');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.s.phase).toBe('roundEnd');
    g.ok('ramesh', { type: 'FORCE_CONTINUE' });
    expect(g.s.round).toBe(2);
    expect(g.s.phase).toBe('setup');
    expect(g.s.eating).toBeNull();
    for (const p of g.s.players) {
      expect(p.hand.map((c) => c.id).sort()).toEqual([`${p.id}:a`, ...[1, 2, 3, 4, 5].map((i) => `${p.id}:p${i}`)].sort());
      expect(p.stack).toEqual([]);
      expect(p.power).toBeNull();
      expect(p.setupDone).toBe(false);
      expect(p.ready).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Power availability (PDF table, decision 2)
// ---------------------------------------------------------------------------

describe('audit: power availability (PDF p2 table, decision 2)', () => {
  test('PDF example picks over 7 rounds: no off-by-one at the reset rounds (1, 4, 7)', () => {
    const g = game(3, { config: { targetScore: null, maxRounds: 7 } });
    const picks: PowerKind[] = ['vinegar', 'chaat', 'nayaplate', 'vinegar', 'dahi', 'chaat', 'nayaplate'];
    const expected: PowerKind[][] = [
      ['vinegar', 'dahi', 'nayaplate', 'chaat'],
      ['dahi', 'nayaplate', 'chaat'],
      ['dahi', 'nayaplate'],
      ['vinegar', 'dahi', 'nayaplate', 'chaat'],
      ['dahi', 'nayaplate', 'chaat'],
      ['nayaplate', 'chaat'],
      ['vinegar', 'dahi', 'nayaplate', 'chaat'],
    ];
    for (let r = 0; r < 7; r++) {
      expect(g.s.round).toBe(r + 1);
      expect(availablePowers(g.s, 'sita')).toEqual(expected[r]);
      expect(projectView(g.s, 'sita').me!.availablePowers).toEqual(expected[r]);
      expect(g.legal('sita').setup!.availablePowers).toEqual(expected[r]);
      if (r < 6) quickRound(g, { sita: picks[r] });
    }
    expect(g.all('roundStart').map((e) => e.availablePowersReset)).toEqual([true, false, false, true, false, false, true]);
    expect(g.p('sita').powerPicks).toEqual(picks.slice(0, 6));
  });

  test.each([
    [2, [4, 4, 4, 4, 4]],
    [3, [4, 3, 4, 3, 4]],
    [4, [4, 3, 2, 4, 3]],
    [5, [4, 3, 2, 1, 4]],
  ])('powerResetRound %i gives %j choices in rounds 1-5', (reset, sizes) => {
    const g = game(3, { config: { targetScore: null, maxRounds: 6, powerResetRound: reset } });
    const seen: number[] = [];
    for (let r = 0; r < 5; r++) {
      seen.push(availablePowers(g.s, 'ramesh').length);
      quickRound(g);
    }
    expect(seen).toEqual(sizes);
  });

  test('a power that was placed but never flipped is still used', () => {
    const g = game();
    quickRound(g, { anil: 'dahi' });
    expect(g.all('flipPower')).toHaveLength(0);
    expect(availablePowers(g.s, 'anil')).not.toContain('dahi');
    g.no('anil', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'dahi' });
  });
});

// ---------------------------------------------------------------------------
// First player (decision 3)
// ---------------------------------------------------------------------------

describe('audit: first player (decision 3)', () => {
  test('rotates clockwise each round, wrapping; serving starts with the first player', () => {
    const g = game(3, { first: 'ramesh', config: { targetScore: null, maxRounds: 5 } });
    const firsts: string[] = [];
    for (let r = 0; r < 4; r++) {
      firsts.push(g.s.firstPlayerId);
      setupAll(g);
      expect(g.turn()).toBe(g.s.firstPlayerId);
      const f = g.turn();
      auction(g, f, 1);
      g.flip(f, f);
      g.ok('sita', { type: 'FORCE_CONTINUE' });
    }
    expect(firsts).toEqual(['ramesh', 'anil', 'sita', 'ramesh']);
  });
});

// ---------------------------------------------------------------------------
// Serving (PDF "Serving", decision 4)
// ---------------------------------------------------------------------------

describe('audit: serving (decision 4)', () => {
  test('turns go clockwise; nobody acts out of turn; any stack (own included) is a valid target', () => {
    const g = game(4);
    setupAll(g);
    for (const [who, onto] of [['sita', 'sita'], ['ramesh', 'anil'], ['anil', 'anil'], ['priya', 'sita'], ['sita', 'priya']] as [Id, Id][]) {
      for (const other of ['sita', 'ramesh', 'anil', 'priya'] as Id[]) {
        if (other === who) continue;
        g.no(other, { type: 'PLACE_PURI', kind: P, targetPlayerId: onto });
        g.no(other, { type: 'START_BID', amount: 1 });
      }
      expect(g.turn()).toBe(who);
      g.ok(who, { type: 'PLACE_PURI', kind: P, targetPlayerId: onto });
    }
    expect(g.p('sita').stack.map((c) => c.owner)).toEqual(['sita', 'sita', 'sita', 'priya']);
    expect(g.p('anil').stack.map((c) => c.owner)).toEqual(['anil', 'anil', 'ramesh', 'anil']);
    expect(g.all('place').map((e) => [e.playerId, e.onStackOf])).toEqual([
      ['sita', 'sita'],
      ['ramesh', 'anil'],
      ['anil', 'anil'],
      ['priya', 'sita'],
      ['sita', 'priya'],
    ]);
    g.no('ramesh', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'ghost' });
  });

  test('several players with empty hands: whoever is up with an empty hand must start the bid', () => {
    const g = game(3, { config: { startingStack: 5 } });
    setupAll(g); // 5 Panipuri down, the Akabare stays in hand
    serve(g, [[A, 'ramesh'], [A, 'anil'], [A, 'sita']]);
    expect(g.s.players.map((p) => p.hand.length)).toEqual([0, 0, 0]);
    expect(g.turn()).toBe('sita');
    expect(g.legal('sita').place).toBeNull();
    expect(g.legal('sita').startBid).toEqual({ min: 1 });
    g.no('sita', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' });
    g.no('sita', { type: 'PLACE_PURI', kind: A, targetPlayerId: 'ramesh' });
    g.no('ramesh', { type: 'START_BID', amount: 2 });
    g.ok('sita', { type: 'START_BID', amount: 2 });
    expect(g.s.phase).toBe('bidding');
  });

  test('startingStack = whole set: every hand is empty, the first player must open straight away', () => {
    const g = game(3, { config: { startingStack: 6 } });
    setupAll(g, {
      sita: { stack: [P, P, P, A, P, P] },
      ramesh: { stack: [P, P, P, P, P, A] },
      anil: { stack: [A, P, P, P, P, P] },
    });
    expect(g.s.players.every((p) => p.hand.length === 0)).toBe(true);
    expect(g.legal('sita').place).toBeNull();
    g.no('sita', { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' });
    g.no('ramesh', { type: 'START_BID', amount: 1 });
    g.ok('sita', { type: 'START_BID', amount: 3 });
  });

  test('once the bid starts nobody can place, the starter included', () => {
    const g = game();
    setupAll(g);
    serve(g, [[P, 'sita']]);
    g.ok('ramesh', { type: 'START_BID', amount: 1 });
    for (const id of ['sita', 'ramesh', 'anil'] as Id[]) g.no(id, { type: 'PLACE_PURI', kind: P, targetPlayerId: 'sita' });
    g.no('anil', { type: 'START_BID', amount: 2 });
  });

  test('minBid 3: opening below 3 or with a fraction is rejected; no maximum bid', () => {
    const g = game(3, { config: { minBid: 3 } });
    setupAll(g);
    expect(g.legal('sita').startBid).toEqual({ min: 3 });
    g.no('sita', { type: 'START_BID', amount: 2 });
    g.no('sita', { type: 'START_BID', amount: 3.5 });
    g.no('sita', { type: 'START_BID', amount: Number.NaN });
    g.ok('sita', { type: 'START_BID', amount: 3 });
    expect(g.legal('ramesh').raise).toEqual({ min: 4 });
    g.ok('ramesh', { type: 'RAISE', amount: 500 });
    expect(g.s.bidding!.highBid).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Bidding (PDF "Bidding", decision 5)
// ---------------------------------------------------------------------------

describe('audit: bidding (decision 5)', () => {
  test('starter outbid, play comes back around; passed players never get a turn; high bidder never on turn', () => {
    const g = game(4);
    setupAll(g);
    const turns: string[] = [];
    const step = (id: Id, a: Action) => {
      expect(g.turn()).toBe(id);
      // Everyone who is not on turn is refused, passed players included.
      for (const other of ['sita', 'ramesh', 'anil', 'priya'] as Id[]) {
        if (other === id) continue;
        g.no(other, { type: 'PASS' });
        g.no(other, { type: 'RAISE', amount: 99 });
      }
      g.ok(id, a);
      if (g.s.phase === 'bidding') {
        turns.push(g.turn());
        expect(g.s.bidding!.passed).not.toContain(g.turn());
        expect(g.turn()).not.toBe(g.s.bidding!.highBidderId);
      }
    };
    step('sita', { type: 'START_BID', amount: 1 });
    step('ramesh', { type: 'RAISE', amount: 2 });
    step('anil', { type: 'PASS' });
    step('priya', { type: 'RAISE', amount: 3 });
    step('sita', { type: 'RAISE', amount: 4 });
    step('ramesh', { type: 'PASS' });
    step('priya', { type: 'PASS' });
    expect(turns).toEqual(['ramesh', 'anil', 'priya', 'sita', 'ramesh', 'priya']);
    expect(g.s.phase).toBe('eating');
    expect(g.e.eaterId).toBe('sita');
    expect(g.e.bid).toBe(4);
    expect(g.e.target).toBe(4);
    expect(g.last('eater')).toMatchObject({ playerId: 'sita', bid: 4 });
  });

  test('the starter outbid then passing hands the round to the high bidder', () => {
    const g = game();
    setupAll(g);
    g.ok('sita', { type: 'START_BID', amount: 1 });
    g.ok('ramesh', { type: 'RAISE', amount: 2 });
    g.ok('anil', { type: 'PASS' });
    expect(g.turn()).toBe('sita');
    g.ok('sita', { type: 'PASS' });
    expect(g.e.eaterId).toBe('ramesh');
    expect(g.e.bid).toBe(2);
  });

  test('a raise must beat the high bid; the starter eats at the opening bid if everyone passes', () => {
    const g = game();
    setupAll(g);
    g.ok('sita', { type: 'START_BID', amount: 3 });
    g.no('ramesh', { type: 'RAISE', amount: 3 });
    g.no('ramesh', { type: 'RAISE', amount: 2 });
    g.no('ramesh', { type: 'RAISE', amount: 3.5 });
    g.ok('ramesh', { type: 'PASS' });
    g.ok('anil', { type: 'PASS' });
    expect(g.e.eaterId).toBe('sita');
    expect(g.e.bid).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Eating order and power flips (PDF "Eating", decision 6)
// ---------------------------------------------------------------------------

describe('audit: eating order (decision 6)', () => {
  test('own stack first (even after power flips), then any other non-empty stack, switching freely', () => {
    const g = game();
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'dahi' }, anil: { power: 'chaat' } });
    auction(g, 'sita', 7);
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    g.power('sita', 'ramesh'); // Dahi, wasted
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' });
    expect(g.legal('sita').flipPuri).toEqual(['sita']);
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    expect(projectView(g.s, 'anil').eating!.ownStackEmpty).toBe(true);
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'sita' });
    expect(g.legal('sita').flipPuri).toEqual(['ramesh', 'anil']);
    g.flip('sita', 'ramesh');
    g.flip('sita', 'anil');
    g.flip('sita', 'anil');
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' });
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'ghost' });
    expect(g.legal('sita').flipPuri).toEqual(['ramesh']);
    g.flip('sita', 'ramesh');
    expect(g.e.eaten).toBe(6);
    expect(g.s.phase).toBe('eating'); // short of 7, anil's Chaat still face down
    g.power('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'success', target: 7, eaten: 8 });
    expect(g.score('sita')).toBe(7);
  });

  test('own power is flippable; an already revealed power is not; powersFlipped never exceeds the cap', () => {
    const g = game();
    setupAll(g, { sita: { power: 'dahi' }, ramesh: { power: 'dahi' }, anil: { power: 'nayaplate' } });
    auction(g, 'sita', 5);
    g.power('sita', 'sita');
    expect(g.e.powersFlipped).toBe(1);
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: 'sita' });
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: 'ghost' });
    expect(g.e.powersFlipped).toBe(1);
    expect(g.legal('sita').flipPower).toEqual(['ramesh', 'anil']);
    g.power('sita', 'ramesh');
    expect(g.e.powersFlipped).toBe(2);
    expect(g.legal('sita').flipPower).toEqual([]);
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: 'anil' });
    expect(g.e.powersFlipped).toBe(2);
    expect(g.p('anil').power!.revealed).toBe(false);
  });

  test.each([1, 2, 3])('powerFlipsMax %i caps the flips exactly', (max) => {
    const g = game(4, { config: { powerFlipsMax: max } });
    setupAll(g, { sita: { power: 'dahi' }, ramesh: { power: 'dahi' }, anil: { power: 'dahi' }, priya: { power: 'dahi' } });
    auction(g, 'sita', 5);
    const order: Id[] = ['ramesh', 'anil', 'priya', 'sita'];
    for (let i = 0; i < max; i++) g.power('sita', order[i]);
    expect(g.e.powersFlipped).toBe(max);
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: order[max] });
    expect(g.legal('sita').flipPower).toEqual([]);
  });

  test('eating actions from anyone but the eater are refused, in every eating sub-state', () => {
    const g = game();
    setupAll(g, { sita: { power: 'dahi' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[P, 'anil'], [P, 'anil'], [A, 'sita']]);
    auction(g, 'sita', 4);
    const probe = () => {
      for (const id of ['ramesh', 'anil'] as Id[]) expect(acceptedTypes(g, id)).toEqual([]);
    };
    probe();
    expect(acceptedTypes(g, 'sita')).toEqual(['FLIP_POWER', 'FLIP_PURI']);
    g.flip('sita', 'sita'); // anil's Akabare: pending
    expect(g.e.pendingAkabare).not.toBeNull();
    probe();
    expect(acceptedTypes(g, 'sita')).toEqual(['ACCEPT_BUST', 'FLIP_POWER']);
  });
});

// ---------------------------------------------------------------------------
// FLIP_PURI / FLIP_POWER resolution (PDF power table + pseudocode, decisions 7-8)
// ---------------------------------------------------------------------------

/** sita eats `bid` with [P,P] at home; anil's Akabare sits on top of ramesh's stack. */
function plantedOnRamesh(powers: Record<'sita' | 'ramesh' | 'anil', PowerKind>, bid: number, config: Partial<GameConfig> = {}): G {
  const g = game(3, { config });
  setupAll(g, { sita: { power: powers.sita }, ramesh: { power: powers.ramesh }, anil: { power: powers.anil } });
  serve(g, [[P, 'anil'], [P, 'anil'], [A, 'ramesh']]);
  auction(g, 'sita', bid);
  g.flip('sita', 'sita');
  g.flip('sita', 'sita');
  expect(g.e.eaten).toBe(2);
  return g;
}

describe('audit: resolution (decisions 7-8)', () => {
  test('a bite with flips left becomes pending: FLIP_PURI refused, only FLIP_POWER / ACCEPT_BUST', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'nayaplate', anil: 'vinegar' }, 4);
    const events = g.flip('sita', 'ramesh');
    expect(events.map((e) => e.type)).toEqual(['flipPuri', 'bite']);
    expect(g.e.pendingAkabare).toMatchObject({ fromStackOf: 'ramesh', card: { owner: 'anil', kind: A } });
    expect(g.s.phase).toBe('eating');
    expect(pendingActors(g.s)).toEqual(['sita']);
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' });
    const L = g.legal('sita');
    expect(L.flipPuri).toEqual([]);
    expect(L.flipPower).toEqual(['sita', 'ramesh', 'anil']);
    expect(L.acceptBust).toBe(true);
    expect(projectView(g.s, 'ramesh').eating!.pendingAkabare).toEqual({ owner: 'anil', fromStackOf: 'ramesh' });
  });

  test('failed save with Naya Plate: busts at the bid (Naya Plate does not raise the loss)', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'nayaplate', anil: 'vinegar' }, 4);
    g.flip('sita', 'ramesh');
    g.power('sita', 'ramesh');
    expect(g.last('flipPower')).toMatchObject({ kind: 'nayaplate', effect: 'failedSave', target: 4, eaten: 2 });
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', target: 4, akabareOwnerId: 'anil', trapRewardTo: 'anil' });
    expect(g.result.scoreDeltas).toEqual({ sita: -4, ramesh: 0, anil: 2 });
  });

  test('failed save with Chaat: busts even though +2 would have reached the target', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'nayaplate', anil: 'vinegar' }, 4);
    g.flip('sita', 'ramesh');
    g.power('sita', 'sita');
    expect(g.last('flipPower')).toMatchObject({ kind: 'chaat', effect: 'failedSave', eaten: 2 });
    expect(g.result).toMatchObject({ outcome: 'bust', eaten: 2, target: 4 });
    expect(g.score('sita')).toBe(-4);
    expect(g.score('anil')).toBe(2);
  });

  test('Vinegar after the bite cannot save you (PDF: it only works before)', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'nayaplate', anil: 'vinegar' }, 4);
    g.flip('sita', 'ramesh');
    g.power('sita', 'anil');
    expect(g.last('flipPower')).toMatchObject({ kind: 'vinegar', effect: 'failedSave' });
    expect(g.result.outcome).toBe('bust');
    expect(g.e.skipNext).toBe(false);
  });

  test('Dahi after the bite saves: plate card marked saved, pending cleared, eating continues', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'dahi', anil: 'vinegar' }, 5);
    g.flip('sita', 'ramesh');
    g.power('sita', 'ramesh');
    expect(g.last('flipPower')).toMatchObject({ kind: 'dahi', effect: 'saved' });
    expect(g.e.pendingAkabare).toBeNull();
    expect(g.e.plate[2]).toMatchObject({ saved: true, cancelled: false, card: { owner: 'anil', kind: A } });
    expect(g.e.eaten).toBe(2);
    expect(g.s.phase).toBe('eating');
    expect(g.legal('sita').flipPuri).toEqual(['ramesh', 'anil']);
  });

  test('a bite with flips left but every power already face up is an immediate bust', () => {
    const g = game(3, { config: { powerFlipsMax: 4 } });
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'dahi' }, anil: { power: 'dahi' } });
    serve(g, [[P, 'ramesh'], [P, 'ramesh'], [A, 'sita']]);
    auction(g, 'sita', 5);
    g.power('sita', 'sita');
    g.power('sita', 'ramesh');
    g.power('sita', 'anil');
    expect(g.e.powersFlipped).toBe(3);
    expect(g.e.target).toBe(5);
    g.flip('sita', 'sita');
    expect(g.s.phase).toBe('roundEnd');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', target: 5, trapRewardTo: 'anil' });
  });

  test('Vinegar cancels exactly the next card; a second Vinegar while numb is wasted (no stacking)', () => {
    const g = game();
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'vinegar' }, anil: { power: 'nayaplate' } });
    auction(g, 'sita', 3);
    g.power('sita', 'sita');
    g.power('sita', 'ramesh');
    expect(g.all('flipPower').map((e) => e.effect)).toEqual(['numb', 'wasted']);
    g.flip('sita', 'sita');
    expect(g.e.eaten).toBe(0);
    expect(g.e.skipNext).toBe(false);
    g.flip('sita', 'sita');
    expect(g.e.eaten).toBe(1);
    g.flip('sita', 'ramesh');
    g.flip('sita', 'ramesh');
    expect(g.e.plate.map((x) => x.cancelled)).toEqual([true, false, false, false]);
    expect(g.result).toMatchObject({ outcome: 'success', eaten: 3, target: 3 });
  });

  test('a cancelled Akabare neither bites nor pays; the flip is followed by checkEnd', () => {
    const g = game();
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[P, 'ramesh'], [P, 'ramesh'], [A, 'sita']]);
    auction(g, 'sita', 3);
    g.power('sita', 'sita');
    const events = g.flip('sita', 'sita');
    expect(events.map((e) => e.type)).toEqual(['flipPuri']);
    expect(g.e.pendingAkabare).toBeNull();
    expect(g.e.plate[0]).toMatchObject({ cancelled: true, saved: false, card: { owner: 'anil', kind: A } });
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh');
    expect(g.result).toMatchObject({ outcome: 'success', trapRewardTo: null, akabareOwnerId: null });
    expect(g.score('anil')).toBe(0);
  });

  test('Chaat reaching the target exactly succeeds; overshooting still scores +target', () => {
    const exact = game();
    setupAll(exact, { sita: { power: 'chaat' } });
    auction(exact, 'sita', 3);
    exact.flip('sita', 'sita');
    exact.power('sita', 'sita');
    expect(exact.result).toMatchObject({ outcome: 'success', eaten: 3, target: 3 });
    expect(exact.score('sita')).toBe(3);

    const over = game();
    setupAll(over, { sita: { power: 'chaat' } });
    auction(over, 'sita', 3);
    over.flip('sita', 'sita');
    over.flip('sita', 'sita');
    over.power('sita', 'sita');
    expect(over.result).toMatchObject({ outcome: 'success', eaten: 4, target: 3 });
    expect(over.score('sita')).toBe(3);
  });

  test('Naya Plate leaves the target at the bid and frees the order; success scores the bid', () => {
    const g = game();
    setupAll(g, { sita: { power: 'nayaplate' } });
    auction(g, 'sita', 2);
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'ramesh' });
    g.power('sita', 'sita');
    expect(g.e.target).toBe(2);
    expect(g.e.freePlate).toBe(true);
    g.flip('sita', 'ramesh');
    g.flip('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'success', bid: 2, target: 2 });
    expect(g.score('sita')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkEnd and ACCEPT_BUST (decisions 9-10, PDF "Stop when")
// ---------------------------------------------------------------------------

/** startingStack 1: sita [P], ramesh [P], anil [A]; sita eats 3 and bites anil's Akabare as the last card. */
function lastCardAkabare(powers: Record<'sita' | 'ramesh' | 'anil', PowerKind>): G {
  const g = game(3, { config: { startingStack: 1 } });
  setupAll(g, {
    sita: { stack: [P], power: powers.sita },
    ramesh: { stack: [P], power: powers.ramesh },
    anil: { stack: [A], power: powers.anil },
  });
  auction(g, 'sita', 3);
  g.flip('sita', 'sita');
  g.flip('sita', 'ramesh');
  g.flip('sita', 'anil');
  expect(g.e.pendingAkabare).not.toBeNull();
  expect(g.s.players.every((p) => p.stack.length === 0)).toBe(true);
  return g;
}

describe('audit: checkEnd / ACCEPT_BUST (decisions 9-10)', () => {
  test('pending Akabare → Dahi → table empty: waits (no hang) with FLIP_POWER / ACCEPT_BUST only', () => {
    const g = lastCardAkabare({ sita: 'chaat', ramesh: 'dahi', anil: 'nayaplate' });
    g.power('sita', 'ramesh');
    expect(g.s.phase).toBe('eating');
    expect(pendingActors(g.s)).toEqual(['sita']);
    const L = g.legal('sita');
    expect(L.flipPuri).toEqual([]);
    expect(L.flipPower).toEqual(['sita', 'anil']);
    expect(L.acceptBust).toBe(true);
    // Chaat on an empty table finishes the job.
    g.power('sita', 'sita');
    expect(g.result).toMatchObject({ outcome: 'success', eaten: 4, target: 3 });
  });

  test('...or accepting the bust there is an emptyTable bust with no trap reward (the Akabare was saved)', () => {
    const g = lastCardAkabare({ sita: 'chaat', ramesh: 'dahi', anil: 'nayaplate' });
    g.power('sita', 'ramesh');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'emptyTable', akabareOwnerId: null, trapRewardTo: null });
    expect(g.result.scoreDeltas).toEqual({ sita: -3, ramesh: 0, anil: 0 });
  });

  test('...or a Naya Plate as the last flip busts automatically on the empty table', () => {
    const g = lastCardAkabare({ sita: 'chaat', ramesh: 'dahi', anil: 'nayaplate' });
    g.power('sita', 'ramesh');
    g.power('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'emptyTable', target: 3, trapRewardTo: null });
    expect(g.score('sita')).toBe(-3);
  });

  test('Dahi saving the last card with no flips left busts at once (emptyTable)', () => {
    const g = game(3, { config: { startingStack: 1, powerFlipsMax: 1 } });
    setupAll(g, { sita: { stack: [P], power: 'chaat' }, ramesh: { stack: [P], power: 'dahi' }, anil: { stack: [A], power: 'nayaplate' } });
    auction(g, 'sita', 3);
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh');
    g.flip('sita', 'anil');
    g.power('sita', 'ramesh');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'emptyTable', trapRewardTo: null });
  });

  test('a Vinegar-cancelled last card with no flips left busts at once instead of hanging', () => {
    const g = game(3, { config: { startingStack: 1, powerFlipsMax: 1 } });
    setupAll(g, { sita: { stack: [P], power: 'vinegar' }, ramesh: { stack: [P] }, anil: { stack: [P] } });
    auction(g, 'sita', 3);
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh');
    g.power('sita', 'sita');
    g.flip('sita', 'anil');
    expect(g.s.phase).toBe('roundEnd');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'emptyTable', eaten: 2, target: 3 });
  });

  test('an empty table with flips left but every power face up busts at once', () => {
    const g = game(3, { config: { startingStack: 1, powerFlipsMax: 4 } });
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'dahi' }, anil: { power: 'dahi' } });
    auction(g, 'sita', 5);
    g.power('sita', 'ramesh');
    g.power('sita', 'anil');
    g.power('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh');
    expect(g.s.phase).toBe('eating');
    g.flip('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'emptyTable', target: 5, eaten: 3 });
  });

  test('ACCEPT_BUST is refused while cards remain and nothing is pending, and for non-eaters', () => {
    const g = game();
    setupAll(g);
    auction(g, 'sita', 3);
    g.no('sita', { type: 'ACCEPT_BUST' });
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.no('sita', { type: 'ACCEPT_BUST' }); // own stack empty but others still have cards
    g.no('ramesh', { type: 'ACCEPT_BUST' });
    expect(g.legal('sita').acceptBust).toBe(false);
  });

  test('ACCEPT_BUST on a pending Akabare is a bust on that Akabare (its owner is paid)', () => {
    const g = plantedOnRamesh({ sita: 'chaat', ramesh: 'nayaplate', anil: 'vinegar' }, 5);
    g.flip('sita', 'ramesh');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', akabareOwnerId: 'anil', trapRewardTo: 'anil' });
    expect(g.p('sita').busts).toBe(1);
    expect(g.s.players.map((p) => p.power!.revealed)).toEqual([false, false, false]);
  });
});

// ---------------------------------------------------------------------------
// Trap reward (PDF "Scoring", decision 11)
// ---------------------------------------------------------------------------

describe('audit: trap reward (decision 11)', () => {
  test("another player's Akabare on the eater's own stack pays that owner", () => {
    const g = game();
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[P, 'ramesh'], [A, 'sita'], [P, 'anil']]);
    auction(g, 'sita', 3);
    g.flip('sita', 'sita');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.result).toMatchObject({ akabareOwnerId: 'ramesh', trapRewardTo: 'ramesh' });
    expect(g.result.scoreDeltas).toEqual({ sita: -3, ramesh: 2, anil: 0 });
  });

  test("the eater's own Akabare sitting on someone else's stack pays nobody (pending then accepted)", () => {
    const g = game();
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[A, 'ramesh'], [P, 'ramesh'], [P, 'anil']]);
    auction(g, 'sita', 5);
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh'); // ramesh's own Panipuri on top
    g.flip('sita', 'ramesh'); // sita's Akabare
    expect(g.e.pendingAkabare!.card.owner).toBe('sita');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.result).toMatchObject({ outcome: 'bust', akabareOwnerId: 'sita', trapRewardTo: null });
    expect(g.result.scoreDeltas).toEqual({ sita: -5, ramesh: 0, anil: 0 });
    expect(g.last('bust')).toMatchObject({ akabareOwnerId: 'sita', trapRewardTo: null });
  });

  test("the eater's own Akabare on someone else's stack pays nobody (immediate bust, flips used up)", () => {
    const g = game(3, { config: { powerFlipsMax: 1 } });
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[A, 'anil'], [P, 'ramesh'], [P, 'ramesh']]);
    auction(g, 'sita', 3);
    g.power('sita', 'ramesh');
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'bust', target: 3, akabareOwnerId: 'sita', trapRewardTo: null });
    expect(g.result.scoreDeltas).toEqual({ sita: -3, ramesh: 0, anil: 0 });
  });

  test('a saved Akabare pays nothing; a later unsaved one pays only its own owner', () => {
    const g = game();
    setupAll(g, { sita: { power: 'nayaplate' }, ramesh: { power: 'dahi' }, anil: { power: 'vinegar' } });
    serve(g, [[P, 'anil'], [A, 'anil'], [A, 'ramesh']]);
    auction(g, 'sita', 7);
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'ramesh'); // anil's Akabare
    g.power('sita', 'ramesh'); // Dahi: saved
    g.flip('sita', 'ramesh');
    g.flip('sita', 'ramesh');
    expect(g.e.eaten).toBe(4);
    g.flip('sita', 'anil'); // ramesh's Akabare
    expect(g.e.pendingAkabare!.card.owner).toBe('ramesh');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    expect(g.result).toMatchObject({ akabareOwnerId: 'ramesh', trapRewardTo: 'ramesh' });
    expect(g.result.scoreDeltas).toEqual({ sita: -7, ramesh: 2, anil: 0 });
  });

  test('trapReward 3 and 0', () => {
    for (const reward of [3, 0]) {
      const g = game(3, { config: { trapReward: reward } });
      setupAll(g);
      serve(g, [[P, 'ramesh'], [A, 'sita'], [P, 'anil']]);
      auction(g, 'sita', 2);
      g.flip('sita', 'sita');
      g.ok('sita', { type: 'ACCEPT_BUST' });
      expect(g.result.trapRewardTo).toBe(reward > 0 ? 'ramesh' : null);
      expect(g.score('ramesh')).toBe(reward);
      expect(g.score('sita')).toBe(-2);
    }
  });
});

// ---------------------------------------------------------------------------
// Round end, winning, tiebreak (PDF "End of round and winning", decision 12)
// ---------------------------------------------------------------------------

describe('audit: round end and game over (decision 12)', () => {
  test('scores and busts accumulate across rounds; results carry scoresAfter', () => {
    const g = game(3, { config: { targetScore: null, maxRounds: 5 } });
    // R1 (sita first): sita +1.
    quickRound(g);
    // R2 (ramesh first): ramesh +2.
    setupAll(g);
    auction(g, 'ramesh', 2);
    g.flip('ramesh', 'ramesh');
    g.flip('ramesh', 'ramesh');
    g.ok('anil', { type: 'FORCE_CONTINUE' });
    // R3 (anil first): anil bites his own Akabare and accepts: -3, no reward.
    expect(g.s.firstPlayerId).toBe('anil');
    setupAll(g, { anil: { stack: [A, P] } });
    auction(g, 'anil', 3);
    g.flip('anil', 'anil');
    g.flip('anil', 'anil');
    g.ok('anil', { type: 'ACCEPT_BUST' });
    expect(g.result.trapRewardTo).toBeNull();
    expect(g.s.results.map((r) => r.scoresAfter)).toEqual([
      { sita: 1, ramesh: 0, anil: 0 },
      { sita: 1, ramesh: 2, anil: 0 },
      { sita: 1, ramesh: 2, anil: -3 },
    ]);
    expect(g.s.players.map((p) => [p.score, p.busts])).toEqual([[1, 0], [2, 0], [-3, 1]]);
  });

  test('reaching targetScore (exactly) mid-game ends it at the continue, before maxRounds', () => {
    const g = game(3, { config: { targetScore: 3, maxRounds: 5 } });
    setupAll(g);
    auction(g, 'sita', 3);
    for (let i = 0; i < 2; i++) g.flip('sita', 'sita');
    g.flip('sita', 'ramesh');
    expect(g.s.phase).toBe('roundEnd');
    expect(g.s.winners).toBeNull();
    g.ok('ramesh', { type: 'FORCE_CONTINUE' });
    expect(g.s.phase).toBe('gameOver');
    expect(g.s.round).toBe(1);
    expect(g.s.winners).toEqual(['sita']);
    expect(g.all('roundStart')).toHaveLength(1);
    expect(g.s.log[g.s.log.length - 1].type).toBe('gameOver');
  });

  test('just short of targetScore the game goes on', () => {
    const g = game(3, { config: { targetScore: 3, maxRounds: 5 } });
    setupAll(g);
    auction(g, 'sita', 2);
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.ok('sita', { type: 'FORCE_CONTINUE' });
    expect(g.s.phase).toBe('setup');
    expect(g.s.round).toBe(2);
  });

  test('a trap reward can be what reaches targetScore; the highest score wins even if not the eater', () => {
    const g = game(3, { config: { targetScore: 2, maxRounds: 5 } });
    setupAll(g);
    serve(g, [[P, 'ramesh'], [A, 'sita'], [P, 'anil']]);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    g.ok('sita', { type: 'ACCEPT_BUST' });
    g.ok('sita', { type: 'FORCE_CONTINUE' });
    expect(g.s.phase).toBe('gameOver');
    expect(g.s.winners).toEqual(['ramesh']);
  });

  test('maxRounds ends the game after the last round even below targetScore', () => {
    const g = game(3, { config: { targetScore: 30, maxRounds: 2 } });
    quickRound(g);
    quickRound(g);
    expect(g.s.phase).toBe('gameOver');
    expect(g.s.round).toBe(2);
    expect(g.all('roundStart')).toHaveLength(2);
    expect(g.s.winners).toEqual(['sita', 'ramesh']); // 1 each, 0 busts: shared
  });

  test('tiebreak: fewer busts wins', () => {
    const g = game(3, { config: { targetScore: null, maxRounds: 2 } });
    // R1: ramesh wins the bid at 2 and busts on anil's Akabare: ramesh -2 (1 bust), anil +2.
    setupAll(g);
    serve(g, [[P, 'sita'], [P, 'sita'], [A, 'ramesh']]);
    g.ok('sita', { type: 'START_BID', amount: 1 });
    g.ok('ramesh', { type: 'RAISE', amount: 2 });
    g.ok('anil', { type: 'PASS' });
    g.ok('sita', { type: 'PASS' });
    g.flip('ramesh', 'ramesh');
    g.ok('ramesh', { type: 'ACCEPT_BUST' });
    g.ok('anil', { type: 'FORCE_CONTINUE' });
    // R2 (ramesh first): ramesh +4 → 2 with 1 bust; anil 2 with 0 busts.
    setupAll(g);
    serve(g, [[P, 'ramesh'], [P, 'ramesh'], [P, 'ramesh']]);
    auction(g, 'ramesh', 4);
    for (let i = 0; i < 4; i++) g.flip('ramesh', 'ramesh');
    g.ok('ramesh', { type: 'FORCE_CONTINUE' });
    expect(g.s.players.map((p) => [p.score, p.busts])).toEqual([[0, 0], [2, 1], [2, 0]]);
    expect(g.s.winners).toEqual(['anil']);
    expect(g.last('gameOver').winners).toEqual(['anil']);
  });

  test('READY: bots are ready at once, READY twice is refused, the last human READY starts the next round', () => {
    const g = game(3, { bots: ['anil'] });
    g.no('sita', { type: 'READY' });
    g.no('sita', { type: 'FORCE_CONTINUE' });
    setupAll(g);
    auction(g, 'sita', 1);
    g.no('sita', { type: 'READY' });
    g.no('sita', { type: 'FORCE_CONTINUE' });
    g.flip('sita', 'sita');
    expect(g.s.players.map((p) => p.ready)).toEqual([false, false, true]);
    expect(pendingActors(g.s)).toEqual(['sita', 'ramesh']);
    g.no('anil', { type: 'READY' });
    g.ok('sita', { type: 'READY' });
    g.no('sita', { type: 'READY' });
    expect(g.s.phase).toBe('roundEnd');
    expect(pendingActors(g.s)).toEqual(['ramesh']);
    expect(g.legal('sita')).toMatchObject({ ready: false, forceContinue: true });
    g.ok('ramesh', { type: 'READY' });
    expect(g.s.phase).toBe('setup');
    expect(g.s.round).toBe(2);
  });

  test('FORCE_CONTINUE advances from anyone (the server, not the engine, restricts it to the host)', () => {
    const g = game();
    setupAll(g);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    g.ok('anil', { type: 'FORCE_CONTINUE' });
    expect(g.s.round).toBe(2);
    g.no('anil', { type: 'FORCE_CONTINUE' });
  });

  test('gameOver refuses every action from every player', () => {
    const g = game(3, { config: { maxRounds: 1 } });
    quickRound(g);
    expect(g.s.phase).toBe('gameOver');
    for (const id of ['sita', 'ramesh', 'anil'] as Id[]) expect(acceptedTypes(g, id)).toEqual([]);
    expect(pendingActors(g.s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Illegal actions from non-active players, phase by phase
// ---------------------------------------------------------------------------

describe('audit: only the active player can act, in every phase', () => {
  test('setup → serving → bidding → eating → roundEnd', () => {
    const g = game();
    const ids: Id[] = ['sita', 'ramesh', 'anil'];
    for (const id of ids) expect(acceptedTypes(g, id)).toEqual(['SUBMIT_SETUP']);
    setupAll(g, { sita: { power: 'dahi' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    expect(acceptedTypes(g, 'sita')).toEqual(['PLACE_PURI', 'START_BID']);
    expect(acceptedTypes(g, 'ramesh')).toEqual([]);
    expect(acceptedTypes(g, 'anil')).toEqual([]);
    serve(g, [[P, 'sita'], [A, 'sita']]);
    g.ok('anil', { type: 'START_BID', amount: 1 });
    // Bidding: sita is up; anil (starter, high bidder) and ramesh wait.
    expect(acceptedTypes(g, 'sita')).toEqual(['PASS', 'RAISE']);
    expect(acceptedTypes(g, 'ramesh')).toEqual([]);
    expect(acceptedTypes(g, 'anil')).toEqual([]);
    g.ok('sita', { type: 'RAISE', amount: 3 });
    g.ok('ramesh', { type: 'PASS' });
    expect(acceptedTypes(g, 'ramesh')).toEqual([]); // passed: out for the round
    expect(acceptedTypes(g, 'anil')).toEqual(['PASS', 'RAISE']);
    g.ok('anil', { type: 'PASS' });
    expect(g.e.eaterId).toBe('sita');
    expect(acceptedTypes(g, 'sita')).toEqual(['FLIP_POWER', 'FLIP_PURI']);
    expect(acceptedTypes(g, 'ramesh')).toEqual([]);
    expect(acceptedTypes(g, 'anil')).toEqual([]);
    g.flip('sita', 'sita'); // ramesh's Akabare
    expect(acceptedTypes(g, 'sita')).toEqual(['ACCEPT_BUST', 'FLIP_POWER']);
    g.power('sita', 'sita'); // own Dahi: saved
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    expect(g.s.phase).toBe('roundEnd');
    for (const id of ids) expect(acceptedTypes(g, id)).toEqual(['FORCE_CONTINUE', 'READY']);
    g.ok('sita', { type: 'READY' });
    expect(acceptedTypes(g, 'sita')).toEqual(['FORCE_CONTINUE']);
  });
});

// ---------------------------------------------------------------------------
// Config edges (PDF config table)
// ---------------------------------------------------------------------------

describe('audit: config edge values', () => {
  const seeds = ROSTER.slice(0, 3).map((p) => ({ ...p, isBot: false }));

  test.each([
    { startingStack: 0 },
    { startingStack: 7 },
    { powerFlipsMax: 0 },
    { powerFlipsMax: 7 },
    { minBid: 0 },
    { powerResetRound: 1 },
    { powerResetRound: 6 },
    { targetScore: null, maxRounds: null },
  ] as Partial<GameConfig>[])('createGame rejects %j', (config) => {
    expect(() => createGame(seeds, config, 1)).toThrow(EngineError);
  });

  test('startingStack 1: a lone Akabare stack is legal and bites on the very first flip', () => {
    const g = game(3, { config: { startingStack: 1 } });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [P, P], power: 'dahi' });
    setupAll(g, { sita: { stack: [A], power: 'nayaplate' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    expect(g.p('sita').hand).toHaveLength(5);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    expect(g.e.pendingAkabare!.card.owner).toBe('sita');
  });

  test('startingStack 3 with the default set', () => {
    const g = game(3, { config: { startingStack: 3 } });
    g.no('sita', { type: 'SUBMIT_SETUP', stack: [A, A, P], power: 'dahi' });
    setupAll(g, { sita: { stack: [P, A, P] } });
    expect(g.p('sita').hand.map((c) => c.kind)).toEqual([P, P, P]);
    auction(g, 'sita', 2);
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    expect(g.e.pendingAkabare).not.toBeNull();
  });

  test('powerFlipsMax 1: after one flip every bite is an immediate bust', () => {
    const g = game(3, { config: { powerFlipsMax: 1 } });
    setupAll(g, { sita: { power: 'dahi' }, ramesh: { power: 'dahi' }, anil: { power: 'dahi' } });
    serve(g, [[P, 'ramesh'], [P, 'ramesh'], [A, 'sita']]);
    auction(g, 'sita', 3);
    g.power('sita', 'ramesh'); // Dahi wasted before the bite
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: 'sita' });
    g.flip('sita', 'sita');
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', trapRewardTo: 'anil' });
  });

  test('minBid 3 carries through: the eater still needs only the high bid', () => {
    const g = game(3, { config: { minBid: 3 } });
    setupAll(g);
    auction(g, 'sita', 3);
    for (let i = 0; i < 2; i++) g.flip('sita', 'sita');
    g.flip('sita', 'anil');
    expect(g.result).toMatchObject({ outcome: 'success', target: 3 });
  });
});

// ---------------------------------------------------------------------------
// Part 2: differential test against an independent reference model
// ---------------------------------------------------------------------------

interface RCard {
  owner: PlayerId;
  kind: PuriKind;
}
interface RPlayer {
  id: PlayerId;
  isBot: boolean;
  score: number;
  busts: number;
  hand: Record<PuriKind, number>;
  stack: RCard[];
  power: { kind: PowerKind; revealed: boolean } | null;
  used: PowerKind[];
  picks: PowerKind[];
  setupDone: boolean;
  ready: boolean;
}
interface RResult {
  eaterId: PlayerId;
  outcome: 'success' | 'bust';
  bustReason: 'akabare' | 'emptyTable' | null;
  bid: number;
  target: number;
  akabareOwnerId: PlayerId | null;
  trapRewardTo: PlayerId | null;
  scoreDeltas: Record<PlayerId, number>;
}
interface Ref {
  cfg: GameConfig;
  ps: RPlayer[];
  round: number;
  phase: Phase;
  first: PlayerId;
  turn: PlayerId | null;
  high: number;
  highBidder: PlayerId | null;
  passed: PlayerId[];
  eater: PlayerId | null;
  bid: number;
  target: number;
  eaten: number;
  flips: number;
  skip: boolean;
  free: boolean;
  pending: RCard | null;
  results: RResult[];
  winners: PlayerId[] | null;
}

const rp = (r: Ref, id: PlayerId) => r.ps.find((p) => p.id === id);
const tableEmpty = (r: Ref) => r.ps.every((p) => p.stack.length === 0);
const canFlip = (r: Ref) => r.flips < r.cfg.powerFlipsMax && r.ps.some((p) => p.power !== null && !p.power.revealed);

function nextOf(r: Ref, id: PlayerId, skip: PlayerId[] = []): PlayerId {
  const i = r.ps.findIndex((p) => p.id === id);
  for (let k = 1; k <= r.ps.length; k++) {
    const c = r.ps[(i + k) % r.ps.length].id;
    if (!skip.includes(c)) return c;
  }
  return id;
}

function refNewRound(r: Ref): void {
  // PDF: rounds 1-3 unused only, round 4 all back, round 5 the 3 not picked in round 4.
  const reset = (r.round - 1) % (r.cfg.powerResetRound - 1) === 0;
  for (const p of r.ps) {
    p.hand = { panipuri: r.cfg.panipuriPerPlayer, akabare: 1 };
    p.stack = [];
    p.power = null;
    p.setupDone = false;
    p.ready = false;
    if (reset) p.used = [];
  }
  Object.assign(r, { phase: 'setup', turn: null, high: 0, highBidder: null, passed: [], eater: null });
  Object.assign(r, { bid: 0, target: 0, eaten: 0, flips: 0, skip: false, free: false, pending: null });
}

function refInit(s: GameState): Ref {
  const r: Ref = {
    cfg: { ...s.config },
    ps: s.players.map((p) => ({
      id: p.id,
      isBot: p.isBot,
      score: 0,
      busts: 0,
      hand: { panipuri: 0, akabare: 0 },
      stack: [],
      power: null,
      used: [],
      picks: [],
      setupDone: false,
      ready: false,
    })),
    round: 1,
    phase: 'setup',
    first: s.firstPlayerId,
    turn: null,
    high: 0,
    highBidder: null,
    passed: [],
    eater: null,
    bid: 0,
    target: 0,
    eaten: 0,
    flips: 0,
    skip: false,
    free: false,
    pending: null,
    results: [],
    winners: null,
  };
  refNewRound(r);
  return r;
}

function refFinish(r: Ref, outcome: 'success' | 'bust', card: RCard | null): void {
  const eater = rp(r, r.eater!)!;
  const deltas: Record<PlayerId, number> = Object.fromEntries(r.ps.map((p) => [p.id, 0]));
  let trapRewardTo: PlayerId | null = null;
  if (outcome === 'success') deltas[eater.id] += r.target;
  else {
    deltas[eater.id] -= r.target;
    eater.busts += 1;
    // PDF: no reward for your own Akabare, a cancelled/saved one (never passed here), or an empty table (card null).
    if (card && card.owner !== eater.id && r.cfg.trapReward > 0) {
      trapRewardTo = card.owner;
      deltas[card.owner] += r.cfg.trapReward;
    }
  }
  for (const p of r.ps) p.score += deltas[p.id];
  r.results.push({
    eaterId: eater.id,
    outcome,
    bustReason: outcome === 'success' ? null : card ? 'akabare' : 'emptyTable',
    bid: r.bid,
    target: r.target,
    akabareOwnerId: card ? card.owner : null,
    trapRewardTo,
    scoreDeltas: deltas,
  });
  r.pending = null;
  r.phase = 'roundEnd';
  for (const p of r.ps) p.ready = p.isBot;
}

function refCheckEnd(r: Ref): void {
  if (r.eaten >= r.target) refFinish(r, 'success', null);
  else if (tableEmpty(r) && !canFlip(r)) refFinish(r, 'bust', null);
}

function refContinue(r: Ref): void {
  const { targetScore, maxRounds } = r.cfg;
  if ((targetScore !== null && r.ps.some((p) => p.score >= targetScore)) || (maxRounds !== null && r.round >= maxRounds)) {
    r.phase = 'gameOver';
    const top = Math.max(...r.ps.map((p) => p.score));
    const leaders = r.ps.filter((p) => p.score === top);
    const fewest = Math.min(...leaders.map((p) => p.busts));
    r.winners = leaders.filter((p) => p.busts === fewest).map((p) => p.id);
    return;
  }
  r.round += 1;
  r.first = nextOf(r, r.first);
  refNewRound(r);
}

/** Validates `a` from the rules alone; when legal and not `dry`, applies it. Never mutates when illegal. */
function refApply(r: Ref, id: PlayerId, a: Action, dry: boolean): boolean {
  const me = rp(r, id);
  const c = r.cfg;
  if (!me || r.phase === 'gameOver') return false;
  switch (a.type) {
    case 'SUBMIT_SETUP': {
      if (r.phase !== 'setup' || a.stack.length !== c.startingStack) return false;
      const ak = a.stack.filter((k) => k === 'akabare').length;
      const pp = a.stack.filter((k) => k === 'panipuri').length;
      if (ak + pp !== a.stack.length || ak > 1 || pp > c.panipuriPerPlayer) return false;
      if (!POWER_KINDS.includes(a.power) || me.used.includes(a.power)) return false;
      if (dry) return true;
      me.stack = a.stack.map((kind) => ({ owner: id, kind }));
      me.hand = { panipuri: c.panipuriPerPlayer - pp, akabare: 1 - ak };
      me.power = { kind: a.power, revealed: false };
      me.setupDone = true;
      if (r.ps.every((p) => p.setupDone)) {
        for (const p of r.ps) {
          if (!p.used.includes(p.power!.kind)) p.used.push(p.power!.kind);
          p.picks.push(p.power!.kind);
        }
        r.phase = 'serving';
        r.turn = r.first;
      }
      return true;
    }
    case 'PLACE_PURI': {
      const t = rp(r, a.targetPlayerId);
      if (r.phase !== 'serving' || r.turn !== id || !t || !(me.hand[a.kind] > 0)) return false;
      if (dry) return true;
      me.hand[a.kind] -= 1;
      t.stack.push({ owner: id, kind: a.kind });
      r.turn = nextOf(r, id);
      return true;
    }
    case 'START_BID':
      if (r.phase !== 'serving' || r.turn !== id || !Number.isInteger(a.amount) || a.amount < c.minBid) return false;
      if (dry) return true;
      Object.assign(r, { phase: 'bidding', high: a.amount, highBidder: id, passed: [], turn: nextOf(r, id) });
      return true;
    case 'RAISE':
      if (r.phase !== 'bidding' || r.turn !== id || !Number.isInteger(a.amount) || a.amount <= r.high) return false;
      if (dry) return true;
      Object.assign(r, { high: a.amount, highBidder: id, turn: nextOf(r, id, r.passed) });
      return true;
    case 'PASS': {
      if (r.phase !== 'bidding' || r.turn !== id) return false;
      if (dry) return true;
      r.passed.push(id);
      const left = r.ps.filter((p) => !r.passed.includes(p.id));
      if (left.length === 1) {
        if (left[0].id !== r.highBidder) throw new Error('reference model: last bidder is not the high bidder');
        Object.assign(r, { phase: 'eating', eater: left[0].id, bid: r.high, target: r.high, turn: null });
        Object.assign(r, { eaten: 0, flips: 0, skip: false, free: false, pending: null });
      } else r.turn = nextOf(r, id, r.passed);
      return true;
    }
    case 'FLIP_PURI': {
      const t = rp(r, a.targetPlayerId);
      if (r.phase !== 'eating' || r.eater !== id || r.pending || !t) return false;
      if (r.free) {
        if (t.stack.length === 0) return false;
      } else if (me.stack.length > 0 ? t.id !== id : t.id === id || t.stack.length === 0) return false;
      if (dry) return true;
      const card = t.stack.pop()!;
      if (r.skip) {
        r.skip = false;
        refCheckEnd(r);
      } else if (card.kind === 'panipuri') {
        r.eaten += 1;
        refCheckEnd(r);
      } else if (canFlip(r)) r.pending = card;
      else refFinish(r, 'bust', card);
      return true;
    }
    case 'FLIP_POWER': {
      const t = rp(r, a.targetPlayerId);
      if (r.phase !== 'eating' || r.eater !== id || r.flips >= c.powerFlipsMax || !t?.power || t.power.revealed) return false;
      if (dry) return true;
      r.flips += 1;
      t.power.revealed = true;
      const k = t.power.kind;
      if (r.pending) {
        if (k === 'dahi') {
          r.pending = null;
          refCheckEnd(r);
        } else refFinish(r, 'bust', r.pending);
        return true;
      }
      if (k === 'vinegar') r.skip = true;
      if (k === 'nayaplate') r.free = true;
      if (k === 'chaat') r.eaten += 2;
      refCheckEnd(r);
      return true;
    }
    case 'ACCEPT_BUST': {
      if (r.phase !== 'eating' || r.eater !== id) return false;
      const card = r.pending;
      if (!card && !(tableEmpty(r) && r.eaten < r.target)) return false;
      if (dry) return true;
      refFinish(r, 'bust', card);
      return true;
    }
    case 'READY':
      if (r.phase !== 'roundEnd' || me.ready) return false;
      if (dry) return true;
      me.ready = true;
      if (r.ps.every((p) => p.isBot || p.ready)) refContinue(r);
      return true;
    case 'FORCE_CONTINUE':
      if (r.phase !== 'roundEnd') return false;
      if (dry) return true;
      refContinue(r);
      return true;
  }
}

function refPending(r: Ref): PlayerId[] {
  switch (r.phase) {
    case 'setup':
      return r.ps.filter((p) => !p.setupDone).map((p) => p.id);
    case 'serving':
    case 'bidding':
      return [r.turn!];
    case 'eating':
      return [r.eater!];
    case 'roundEnd': {
      const humans = r.ps.filter((p) => !p.isBot && !p.ready).map((p) => p.id);
      return humans.length > 0 ? humans : r.ps.filter((p) => p.isBot).map((p) => p.id);
    }
    case 'gameOver':
      return [];
  }
}

function refLegal(r: Ref, id: PlayerId): LegalActions {
  const me = rp(r, id)!;
  const ids = r.ps.map((p) => p.id);
  const can = (a: Action) => refApply(r, id, a, true);
  const onTurn = r.turn === id;
  return {
    setup:
      r.phase === 'setup'
        ? {
            hand: { panipuri: r.cfg.panipuriPerPlayer, akabare: 1 },
            stackSize: r.cfg.startingStack,
            availablePowers: POWER_KINDS.filter((k) => !me.used.includes(k)),
            submitted: me.setupDone,
          }
        : null,
    place:
      r.phase === 'serving' && onTurn && me.hand.panipuri + me.hand.akabare > 0
        ? { kinds: (['panipuri', 'akabare'] as const).filter((k) => me.hand[k] > 0), targets: ids }
        : null,
    startBid: r.phase === 'serving' && onTurn ? { min: r.cfg.minBid } : null,
    raise: r.phase === 'bidding' && onTurn ? { min: r.high + 1 } : null,
    pass: can({ type: 'PASS' }),
    flipPuri: ids.filter((t) => can({ type: 'FLIP_PURI', targetPlayerId: t })),
    flipPower: ids.filter((t) => can({ type: 'FLIP_POWER', targetPlayerId: t })),
    acceptBust: can({ type: 'ACCEPT_BUST' }),
    ready: can({ type: 'READY' }),
    forceContinue: can({ type: 'FORCE_CONTINUE' }),
  };
}

function normEngine(s: GameState) {
  const e = s.eating;
  return {
    phase: s.phase,
    round: s.round,
    first: s.firstPlayerId,
    players: s.players.map((p) => ({
      id: p.id,
      score: p.score,
      busts: p.busts,
      hand: {
        panipuri: p.hand.filter((c) => c.kind === 'panipuri').length,
        akabare: p.hand.filter((c) => c.kind === 'akabare').length,
      },
      stack: p.stack.map((c) => `${c.owner}/${c.kind}`),
      stackIds: p.stack.every((c) => c.id.startsWith(`${c.owner}:`)),
      power: p.power ? `${p.power.kind}/${p.power.revealed}` : null,
      used: [...p.usedPowers].sort(),
      picks: p.powerPicks,
      setupDone: p.setupDone,
      ready: p.ready,
    })),
    turn: s.phase === 'serving' ? s.serving!.turnId : s.phase === 'bidding' ? s.bidding!.turnId : null,
    bidding: s.phase === 'bidding' ? { high: s.bidding!.highBid, by: s.bidding!.highBidderId, passed: [...s.bidding!.passed].sort() } : null,
    eating: e
      ? {
          eater: e.eaterId,
          bid: e.bid,
          target: e.target,
          eaten: e.eaten,
          flips: e.powersFlipped,
          skip: e.skipNext,
          free: e.freePlate,
          pending: e.pendingAkabare ? `${e.pendingAkabare.card.owner}/${e.pendingAkabare.card.kind}` : null,
        }
      : null,
    results: s.results.map((x) => ({
      eaterId: x.eaterId,
      outcome: x.outcome,
      bustReason: x.bustReason,
      bid: x.bid,
      target: x.target,
      akabareOwnerId: x.akabareOwnerId,
      trapRewardTo: x.trapRewardTo,
      scoreDeltas: x.scoreDeltas,
    })),
    winners: s.winners,
    pending: pendingActors(s),
  };
}

function normRef(r: Ref) {
  return {
    phase: r.phase,
    round: r.round,
    first: r.first,
    players: r.ps.map((p) => ({
      id: p.id,
      score: p.score,
      busts: p.busts,
      hand: { ...p.hand },
      stack: p.stack.map((c) => `${c.owner}/${c.kind}`),
      stackIds: true,
      power: p.power ? `${p.power.kind}/${p.power.revealed}` : null,
      used: [...p.used].sort(),
      picks: p.picks,
      setupDone: p.setupDone,
      ready: p.ready,
    })),
    turn: r.phase === 'serving' || r.phase === 'bidding' ? r.turn : null,
    bidding: r.phase === 'bidding' ? { high: r.high, by: r.highBidder, passed: [...r.passed].sort() } : null,
    eating: r.eater
      ? {
          eater: r.eater,
          bid: r.bid,
          target: r.target,
          eaten: r.eaten,
          flips: r.flips,
          skip: r.skip,
          free: r.free,
          pending: r.pending ? `${r.pending.owner}/${r.pending.kind}` : null,
        }
      : null,
    results: r.results,
    winners: r.winners,
    pending: refPending(r),
  };
}

type Rand = () => number;
const pickOf = <T>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length) % xs.length];

/** A random probe: mostly from someone the rules say is up, in the current phase; sometimes nonsense. */
function randomProbe(r: Ref, rand: Rand): [PlayerId, Action] {
  const ids = r.ps.map((p) => p.id);
  const pend = refPending(r);
  const actor = pend.length > 0 && rand() < 0.85 ? pickOf(pend, rand) : pickOf(ids, rand);
  const target = () => (rand() < 0.03 ? 'ghost' : pickOf(ids, rand));
  const phase: Phase = rand() < 0.08 ? pickOf(['setup', 'serving', 'bidding', 'eating', 'roundEnd'] as const, rand) : r.phase;
  switch (phase) {
    case 'setup': {
      const len = Math.max(0, r.cfg.startingStack + (rand() < 0.05 ? pickOf([-1, 1], rand) : 0));
      const stack = Array.from({ length: len }, (): PuriKind => (rand() < 0.22 ? 'akabare' : 'panipuri'));
      return [actor, { type: 'SUBMIT_SETUP', stack, power: pickOf(POWER_KINDS, rand) }];
    }
    case 'serving':
      if (rand() < 0.22) {
        const amount = rand() < 0.03 ? 1.5 : r.cfg.minBid - 1 + Math.floor(rand() * 7);
        return [actor, { type: 'START_BID', amount }];
      }
      return [actor, { type: 'PLACE_PURI', kind: rand() < 0.25 ? 'akabare' : 'panipuri', targetPlayerId: target() }];
    case 'bidding':
      if (rand() < 0.55) return [actor, { type: 'PASS' }];
      return [actor, { type: 'RAISE', amount: r.high + Math.floor(rand() * 3) }];
    case 'eating': {
      const x = rand();
      if (x < (r.pending ? 0.15 : 0.7)) return [actor, { type: 'FLIP_PURI', targetPlayerId: target() }];
      if (x < 0.9) return [actor, { type: 'FLIP_POWER', targetPlayerId: target() }];
      return [actor, { type: 'ACCEPT_BUST' }];
    }
    default:
      return [actor, rand() < 0.75 ? { type: 'READY' } : { type: 'FORCE_CONTINUE' }];
  }
}

const DIFF_CONFIGS: Partial<GameConfig>[] = [
  {},
  { startingStack: 1 },
  { startingStack: 3 },
  { startingStack: 6 },
  { powerFlipsMax: 1 },
  { powerFlipsMax: 3 },
  { minBid: 3 },
  { powerResetRound: 2, trapReward: 0 },
  { powerResetRound: 3, maxRounds: 7, targetScore: null },
  { powerResetRound: 5, maxRounds: 6 },
  { targetScore: 6, maxRounds: null },
  { targetScore: 4, maxRounds: 5, trapReward: 3 },
  { panipuriPerPlayer: 2, startingStack: 3 },
  { revealOnRoundEnd: true, powerFlipsMax: 6 },
];

describe('audit: differential test against an independent reference model', () => {
  const coverage: Record<string, number> = {};
  const hit = (k: string) => (coverage[k] = (coverage[k] ?? 0) + 1);

  test.each(Array.from({ length: 140 }, (_, i) => i))('game %i', (g) => {
    let seed = (g * 2654435761 + 7) >>> 0;
    const rand: Rand = () => {
      const [v, next] = mulberry32(seed);
      seed = next;
      return v;
    };
    const n = 3 + (g % 4);
    const config = DIFF_CONFIGS[g % DIFF_CONFIGS.length];
    const seeds = ROSTER.slice(0, n).map((p, i) => ({ ...p, isBot: g % 5 === 0 ? i !== 0 : g % 3 === 0 && i === n - 1 }));
    let s = createGame(seeds, config, g);
    const r = refInit(s);

    const check = (where: string) => {
      const a = JSON.stringify(normEngine(s));
      const b = JSON.stringify(normRef(r));
      if (a !== b) expect({ where, ...normEngine(s) }).toEqual({ where, ...normRef(r) });
      for (const p of r.ps) {
        const el = JSON.stringify(legalActions(s, p.id));
        const rl = JSON.stringify(refLegal(r, p.id));
        if (el !== rl) expect({ where, id: p.id, legal: legalActions(s, p.id) }).toEqual({ where, id: p.id, legal: refLegal(r, p.id) });
      }
    };
    check('start');
    for (let step = 0; step < 6000 && r.phase !== 'gameOver'; step++) {
      const [id, action] = randomProbe(r, rand);
      const legal = refApply(r, id, action, true);
      const res = applyAction(s, id, action);
      const where = `step ${step}: ${id} ${JSON.stringify(action)} in ${r.phase} (round ${r.round})`;
      if (res.ok !== legal) {
        throw new Error(`${where}: engine ${res.ok ? 'accepted' : `rejected (${res.ok ? '' : res.error})`}, rules say ${legal ? 'legal' : 'illegal'}`);
      }
      if (!res.ok) continue;
      const before = { pending: r.pending, eater: r.eater, results: r.results.length, skip: r.skip };
      refApply(r, id, action, false);
      s = res.state;
      check(where);
      if (action.type === 'FLIP_PURI' && !before.pending && r.pending) hit('bite pending');
      if (action.type === 'FLIP_PURI' && before.skip) hit('cancelled flip');
      if (action.type === 'FLIP_POWER' && before.pending) hit(r.results.length > before.results ? 'failed save' : 'saved');
      if (r.results.length > before.results) {
        const last = r.results[r.results.length - 1];
        hit(`${last.outcome}${last.bustReason ? `:${last.bustReason}` : ''}`);
        if (last.trapRewardTo) hit('trap reward');
        if (last.akabareOwnerId === last.eaterId) hit('own akabare bust');
      }
      if ((r.phase as Phase) === 'gameOver') hit('game over');
    }
  });

  test('the random games reached every rules corner', () => {
    for (const k of [
      'bite pending',
      'cancelled flip',
      'failed save',
      'saved',
      'success',
      'bust:akabare',
      'bust:emptyTable',
      'trap reward',
      'own akabare bust',
      'game over',
    ]) {
      expect(coverage[k] ?? 0, k).toBeGreaterThan(0);
    }
    expect(coverage['game over']).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Part 3: the PDF's worked examples (p4-5), played literally
// ---------------------------------------------------------------------------

describe('audit: PDF examples (p4-5)', () => {
  test('"Vinegar saves you": numb first, then the Akabare Ramesh planted on his own stack is cancelled', () => {
    const g = game(3);
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    serve(g, [[P, 'sita'], [A, 'ramesh']]);
    auction(g, 'sita', 4); // anil opens, sita raises to 4, the others pass
    for (let i = 0; i < 3; i++) g.flip('sita', 'sita');
    expect(g.e.eaten).toBe(3);
    g.power('sita', 'sita');
    expect(g.last('flipPower')).toMatchObject({ kind: 'vinegar', effect: 'numb' });
    const events = g.flip('sita', 'ramesh');
    expect(events.map((e) => e.type)).toEqual(['flipPuri']);
    expect(g.last('flipPuri')).toMatchObject({ owner: 'ramesh', kind: A, cancelled: true, eaten: 3 });
    expect(g.e.pendingAkabare).toBeNull();
    g.flip('sita', 'ramesh');
    expect(g.result).toMatchObject({ outcome: 'success', target: 4, akabareOwnerId: null, trapRewardTo: null });
    expect(g.result.scoreDeltas).toEqual({ sita: 4, ramesh: 0, anil: 0 });
  });

  test('"Vinegar wastes a puri": the Panipuri after Vinegar does not count', () => {
    const g = game(3, { first: 'anil' });
    setupAll(g, { anil: { power: 'vinegar' } });
    auction(g, 'anil', 2);
    g.power('anil', 'anil');
    g.flip('anil', 'anil');
    expect(g.last('flipPuri')).toMatchObject({ kind: P, cancelled: true, eaten: 0 });
    expect(g.e).toMatchObject({ eaten: 0, skipNext: false });
    g.flip('anil', 'anil');
    expect(g.e.eaten).toBe(1);
    g.flip('anil', 'sita');
    expect(g.result).toMatchObject({ outcome: 'success', eaten: 2, target: 2 });
  });

  test('"The blind Dahi": Priya bites, gambles on Anil\'s power, it is Chaat, she is out (no +2)', () => {
    const g = game(4);
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'dahi' }, anil: { power: 'chaat' }, priya: { power: 'nayaplate' } });
    serve(g, [[A, 'priya']]);
    auction(g, 'priya', 3); // ramesh opens, anil passes, priya raises, sita and ramesh pass
    g.flip('priya', 'priya');
    expect(g.e.pendingAkabare!.card.owner).toBe('sita');
    g.power('priya', 'anil');
    expect(g.last('flipPower')).toMatchObject({ owner: 'anil', kind: 'chaat', effect: 'failedSave', eaten: 0 });
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', eaten: 0, target: 3, trapRewardTo: 'sita' });
    expect(g.result.scoreDeltas).toEqual({ sita: 2, ramesh: 0, anil: 0, priya: -3 });
  });

  test('"Chaat speeds you up": bid 4, eat 1, Sita\'s Chaat makes 3, one more to go', () => {
    const g = game(3);
    setupAll(g, { sita: { power: 'chaat' }, ramesh: { power: 'nayaplate' }, anil: { power: 'nayaplate' } });
    auction(g, 'ramesh', 4);
    g.flip('ramesh', 'ramesh');
    g.power('ramesh', 'sita');
    expect(g.last('flipPower')).toMatchObject({ owner: 'sita', kind: 'chaat', effect: 'plusTwo', eaten: 3, target: 4 });
    expect(g.s.phase).toBe('eating');
    g.flip('ramesh', 'ramesh');
    expect(g.result).toMatchObject({ outcome: 'success', eaten: 4, target: 4 });
    expect(g.score('ramesh')).toBe(4);
  });

  test('"Naya Plate dodges the planted chili": Sita plants on Ramesh, Ramesh flips Naya Plate and eats from Anil instead', () => {
    const g = game(3);
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'nayaplate' }, anil: { power: 'dahi' } });
    serve(g, [[A, 'ramesh']]);
    auction(g, 'ramesh', 3);
    expect(g.s.players[1].stack.at(-1)).toMatchObject({ kind: 'akabare', owner: 'sita' });
    expect(g.legal('ramesh').flipPuri).toEqual(['ramesh']);
    g.power('ramesh', 'ramesh');
    expect(g.last('flipPower')).toMatchObject({ kind: 'nayaplate', effect: 'freePlate', target: 3 });
    expect(g.e).toMatchObject({ bid: 3, target: 3, freePlate: true });
    expect(g.legal('ramesh').flipPuri).toEqual(['sita', 'ramesh', 'anil']);
    g.flip('ramesh', 'anil');
    g.flip('ramesh', 'anil');
    g.flip('ramesh', 'sita');
    expect(g.result).toMatchObject({ outcome: 'success', bid: 3, target: 3, eaten: 3 });
    expect(g.result.scoreDeltas).toEqual({ sita: 0, ramesh: 3, anil: 0 });
  });

  test('"Chaat on an empty table": 5 eaten of 7, table empty, the last flip is Chaat: success', () => {
    const g = game(5, { first: 'anil', config: { startingStack: 1 } });
    setupAll(g, { sita: { power: 'chaat' }, ramesh: { power: 'dahi' } });
    auction(g, 'anil', 7);
    g.flip('anil', 'anil');
    g.power('anil', 'ramesh'); // Dahi with nothing to save
    expect(g.last('flipPower').effect).toBe('wasted');
    for (const t of ['sita', 'ramesh', 'priya', 'maya'] as Id[]) g.flip('anil', t);
    expect(g.e.eaten).toBe(5);
    expect(g.s.players.every((p) => p.stack.length === 0)).toBe(true);
    expect(g.s.phase).toBe('eating');
    expect(g.legal('anil')).toMatchObject({ flipPuri: [], acceptBust: true });
    g.power('anil', 'sita');
    expect(g.result).toMatchObject({ outcome: 'success', eaten: 7, target: 7 });
    expect(g.score('anil')).toBe(7);
  });

  test('"The planted chili": Sita\'s Akabare on Anil\'s stack busts Ramesh through a Naya Plate, Sita +2', () => {
    const g = game(3);
    setupAll(g, { sita: { power: 'vinegar' }, ramesh: { power: 'vinegar' }, anil: { power: 'nayaplate' } });
    serve(g, [[A, 'anil']]);
    auction(g, 'ramesh', 3);
    g.flip('ramesh', 'ramesh');
    g.flip('ramesh', 'ramesh');
    g.flip('ramesh', 'anil');
    expect(g.last('bite')).toMatchObject({ eaterId: 'ramesh', fromStackOf: 'anil', owner: 'sita' });
    g.power('ramesh', 'anil');
    expect(g.last('flipPower')).toMatchObject({ kind: 'nayaplate', effect: 'failedSave', target: 3 });
    expect(g.result).toMatchObject({ outcome: 'bust', bustReason: 'akabare', target: 3, akabareOwnerId: 'sita', trapRewardTo: 'sita' });
    expect(g.result.scoreDeltas).toEqual({ sita: 2, ramesh: -3, anil: 0 });
    expect(g.p('ramesh').busts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part 4: remaining corners
// ---------------------------------------------------------------------------

describe('audit: more bidding and pending-bite corners', () => {
  test('6 players: raises and passes interleave; passed seats are skipped every time around', () => {
    const g = game(6);
    setupAll(g);
    const script: [Id, Action, Id | null][] = [
      ['sita', { type: 'START_BID', amount: 1 }, 'ramesh'],
      ['ramesh', { type: 'PASS' }, 'anil'],
      ['anil', { type: 'RAISE', amount: 2 }, 'priya'],
      ['priya', { type: 'PASS' }, 'maya'],
      ['maya', { type: 'PASS' }, 'hari'],
      ['hari', { type: 'RAISE', amount: 3 }, 'sita'],
      ['sita', { type: 'RAISE', amount: 4 }, 'anil'],
      ['anil', { type: 'PASS' }, 'hari'],
      ['hari', { type: 'RAISE', amount: 5 }, 'sita'],
      ['sita', { type: 'PASS' }, null],
    ];
    for (const [who, a, next] of script) {
      g.ok(who, a);
      if (next) {
        expect(g.turn()).toBe(next);
        expect(pendingActors(g.s)).toEqual([next]);
        for (const out of g.s.bidding!.passed) expect(acceptedTypes(g, out as Id)).toEqual([]);
      }
    }
    expect(g.e).toMatchObject({ eaterId: 'hari', bid: 5, target: 5 });
    expect(g.s.bidding!.passed).toEqual(['ramesh', 'priya', 'maya', 'anil', 'sita']);
    expect(g.all('eater')).toHaveLength(1);
  });

  test('pending: a revealed power is refused and changes nothing; a Naya Plate from before the bite stays; own Dahi saves', () => {
    const g = plantedOnRamesh({ sita: 'dahi', ramesh: 'nayaplate', anil: 'vinegar' }, 5);
    g.power('sita', 'ramesh'); // Naya Plate before the bite: free plate, target unchanged
    g.flip('sita', 'ramesh'); // anil's Akabare: pending
    const before = JSON.stringify(g.s);
    g.no('sita', { type: 'FLIP_POWER', targetPlayerId: 'ramesh' });
    g.no('sita', { type: 'FLIP_PURI', targetPlayerId: 'anil' });
    g.no('anil', { type: 'FLIP_POWER', targetPlayerId: 'sita' });
    g.no('anil', { type: 'ACCEPT_BUST' });
    expect(JSON.stringify(g.s)).toBe(before);
    expect(g.legal('sita').flipPower).toEqual(['sita', 'anil']);
    g.power('sita', 'sita');
    expect(g.e).toMatchObject({ pendingAkabare: null, powersFlipped: 2, target: 5, eaten: 2, freePlate: true });
    expect(g.legal('sita').flipPower).toEqual([]);
    for (const t of ['ramesh', 'anil', 'anil'] as Id[]) g.flip('sita', t);
    expect(g.result).toMatchObject({ outcome: 'success', target: 5, eaten: 5 });
  });

  test("pending with only the eater's own power left: it is still a choice, and own non-Dahi fails the save", () => {
    const g = game(3, { config: { powerFlipsMax: 3 } });
    setupAll(g, { sita: { power: 'chaat' }, ramesh: { power: 'nayaplate' }, anil: { power: 'dahi' } });
    serve(g, [[P, 'ramesh'], [A, 'sita']]);
    auction(g, 'sita', 6);
    g.power('sita', 'ramesh'); // Naya Plate: free plate
    g.power('sita', 'anil'); // Dahi, nothing to save
    g.flip('sita', 'sita'); // ramesh's Akabare
    expect(g.e.pendingAkabare!.card.owner).toBe('ramesh');
    expect(g.legal('sita')).toMatchObject({ flipPuri: [], flipPower: ['sita'], acceptBust: true });
    g.power('sita', 'sita');
    expect(g.last('flipPower')).toMatchObject({ kind: 'chaat', effect: 'failedSave', eaten: 0, target: 6 });
    expect(g.result.scoreDeltas).toEqual({ sita: -6, ramesh: 2, anil: 0 });
  });

  test('nobody outside the game gets any action accepted, in any phase', () => {
    const g = game();
    const probe = () => {
      for (const a of battery(['sita', 'ramesh', 'anil'])) expect(applyAction(g.s, 'ghost', a).ok).toBe(false);
      expect(legalActions(g.s, 'ghost')).toEqual(legalActions(g.s, 'nobody'));
      expect(projectView(g.s, 'ghost').legal.startBid).toBeNull();
    };
    probe();
    setupAll(g);
    probe();
    auction(g, 'sita', 2);
    probe();
    g.flip('sita', 'sita');
    g.flip('sita', 'sita');
    expect(g.s.phase).toBe('roundEnd');
    probe();
  });
});

describe('audit: winners and game length (decision 12)', () => {
  const W = (rows: [string, number, number][]) =>
    computeWinners(rows.map(([id, score, busts]) => ({ id, score, busts }) as PlayerState));

  test('highest score, then fewer busts among the leaders only, then a shared win', () => {
    expect(W([['a', 5, 2], ['b', 5, 1], ['c', 4, 0]])).toEqual(['b']);
    expect(W([['a', 5, 1], ['b', 5, 1], ['c', 5, 2]])).toEqual(['a', 'b']);
    expect(W([['a', -3, 1], ['b', -1, 2], ['c', -2, 0]])).toEqual(['b']);
    expect(W([['a', 0, 0], ['b', 0, 0], ['c', 0, 0]])).toEqual(['a', 'b', 'c']);
    expect(W([['a', 31, 3], ['b', 30, 0], ['c', 2, 0]])).toEqual(['a']);
  });

  test('maxRounds null: play goes past round 5 until someone reaches targetScore', () => {
    const g = game(3, { config: { targetScore: 3, maxRounds: null } });
    for (let r = 1; r <= 6; r++) quickRound(g);
    expect(g.s).toMatchObject({ phase: 'setup', round: 7 });
    expect(g.s.players.map((p) => p.score)).toEqual([2, 2, 2]);
    quickRound(g);
    expect(g.s).toMatchObject({ phase: 'gameOver', round: 7, winners: ['sita'] });
  });

  test('the last human READY also runs the game-over check', () => {
    const g = game(3, { config: { targetScore: 1 } });
    setupAll(g);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    g.ok('ramesh', { type: 'READY' });
    g.ok('anil', { type: 'READY' });
    expect(g.s.phase).toBe('roundEnd');
    g.ok('sita', { type: 'READY' });
    expect(g.s).toMatchObject({ phase: 'gameOver', winners: ['sita'] });
    expect(g.last('gameOver')).toMatchObject({ winners: ['sita'], scores: { sita: 1, ramesh: 0, anil: 0 } });
  });

  test('setBot at roundEnd: a new bot is ready at once, a returning human must READY again', () => {
    const g = game();
    setupAll(g);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    expect(pendingActors(g.s)).toEqual(['sita', 'ramesh', 'anil']);
    g.s = setBot(g.s, 'anil', true);
    expect(g.p('anil').ready).toBe(true);
    expect(pendingActors(g.s)).toEqual(['sita', 'ramesh']);
    g.ok('sita', { type: 'READY' });
    g.s = setBot(g.s, 'anil', false);
    expect(g.p('anil').ready).toBe(false);
    expect(pendingActors(g.s)).toEqual(['ramesh', 'anil']);
    g.ok('ramesh', { type: 'READY' });
    expect(g.s.phase).toBe('roundEnd');
    g.ok('anil', { type: 'READY' });
    expect(g.s).toMatchObject({ phase: 'setup', round: 2 });
  });

  test('when the last unready human becomes a bot, the bots move the round on and set up', () => {
    const g = game();
    setupAll(g);
    auction(g, 'sita', 1);
    g.flip('sita', 'sita');
    g.ok('sita', { type: 'READY' });
    g.ok('ramesh', { type: 'READY' });
    g.s = setBot(g.s, 'anil', true);
    expect(g.s.phase).toBe('roundEnd');
    expect(pendingActors(g.s)).toEqual(['anil']);
    const out = runBots(g.s).state;
    expect(out).toMatchObject({ phase: 'setup', round: 2 });
    expect(out.players.find((p) => p.id === 'anil')!.setupDone).toBe(true);
    expect(pendingActors(out)).toEqual(['sita', 'ramesh']);
  });
});

describe('audit: round-1 first player and the private reminder (decisions 3, 13)', () => {
  test('round 1 first player comes from the seed: deterministic per seed, every seat reachable', () => {
    const seeds = ROSTER.slice(0, 4).map((p) => ({ ...p, isBot: false }));
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const a = createGame(seeds, {}, seed);
      expect(createGame(seeds, {}, seed)).toEqual(a);
      seen.add(a.firstPlayerId);
      expect(a.log[0]).toMatchObject({ type: 'roundStart', firstPlayerId: a.firstPlayerId, round: 1, seq: 1 });
    }
    expect([...seen].sort()).toEqual(['anil', 'priya', 'ramesh', 'sita']);
  });

  test('owners keep seeing what they placed and where; everyone else sees only the back color', () => {
    const g = game();
    setupAll(g, { sita: { stack: [A, P] } });
    serve(g, [[P, 'ramesh'], [P, 'sita'], [P, 'sita']]);
    const cards = (viewer: Id | null, of: Id) =>
      projectView(g.s, viewer).players.find((p) => p.id === of)!.stack.map((c) => `${c.owner}:${c.kind}`);
    expect(cards('sita', 'sita')).toEqual(['sita:akabare', 'sita:panipuri', 'ramesh:null', 'anil:null']);
    expect(cards('ramesh', 'sita')).toEqual(['sita:null', 'sita:null', 'ramesh:panipuri', 'anil:null']);
    expect(cards(null, 'sita')).toEqual(['sita:null', 'sita:null', 'ramesh:null', 'anil:null']);
    expect(cards('sita', 'ramesh')).toEqual(['ramesh:null', 'ramesh:null', 'sita:panipuri']);
    expect(projectView(g.s, 'sita').me!.setup).toEqual({ stack: [A, P], power: 'vinegar' });
    auction(g, 'ramesh', 6);
    for (const t of ['ramesh', 'ramesh', 'ramesh', 'sita', 'sita', 'sita'] as Id[]) g.flip('ramesh', t);
    expect(g.result.outcome).toBe('success');
    expect(cards('sita', 'sita')).toEqual(['sita:akabare']);
    expect(cards('ramesh', 'sita')).toEqual(['sita:null']);
    expect(projectView(g.s, 'sita').me!.setup).toEqual({ stack: [A, P], power: 'vinegar' });
  });

  test('the reminder keeps bottom → top order after someone else eats the whole setup', () => {
    const g = game();
    setupAll(g, { sita: { stack: [A, P] } });
    auction(g, 'ramesh', 4);
    g.flip('ramesh', 'ramesh');
    g.flip('ramesh', 'ramesh');
    g.flip('ramesh', 'sita'); // sita's top: Panipuri
    g.flip('ramesh', 'sita'); // sita's bottom: her Akabare
    expect(g.e.pendingAkabare!.card.owner).toBe('sita');
    expect(g.p('sita').stack).toEqual([]);
    expect(projectView(g.s, 'sita').me!.setup).toEqual({ stack: [A, P], power: 'vinegar' });
    g.ok('ramesh', { type: 'ACCEPT_BUST' });
    expect(projectView(g.s, 'sita').me!.setup).toEqual({ stack: [A, P], power: 'vinegar' });
  });
});

// ---------------------------------------------------------------------------
// Part 5: hidden information never reaches a view or a bot (decisions 13-15)
// ---------------------------------------------------------------------------

function shuffled<T>(xs: readonly T[], rand: Rand): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A copy of `s` differing only in what `viewer` can't know: others' face-down/hand kinds, hidden powers, power history. */
function hiddenTwin(s: GameState, viewer: PlayerId | null, rand: Rand): GameState {
  const t = structuredClone(s);
  for (const q of t.players) {
    if (q.id === viewer) continue;
    const cards = [...t.players.flatMap((x) => x.stack.filter((c) => c.owner === q.id)), ...q.hand];
    const kinds = shuffled(cards.map((c) => c.kind), rand);
    cards.forEach((c, i) => (c.kind = kinds[i]));
    if (q.power && !q.power.revealed) q.power.kind = pickOf(POWER_KINDS, rand);
    q.usedPowers = shuffled(POWER_KINDS, rand).slice(0, Math.floor(rand() * 4));
    q.powerPicks = q.powerPicks.map(() => pickOf(POWER_KINDS, rand));
  }
  return t;
}

describe('audit: views and bots see only public info (decisions 13-15)', () => {
  const CONFIGS: Partial<GameConfig>[] = [{}, { revealOnRoundEnd: true }, { startingStack: 1, powerFlipsMax: 1 }, { startingStack: 3, powerFlipsMax: 3 }];

  test.each(Array.from({ length: 12 }, (_, i) => i))('all-bot game %i', (i) => {
    const n = 3 + (i % 4);
    const seeds = ROSTER.slice(0, n).map((p) => ({ ...p, isBot: true }));
    let s = createGame(seeds, { ...CONFIGS[i % CONFIGS.length], maxRounds: 3, targetScore: null }, 1000 + i);
    let seed = i + 1;
    const rand: Rand = () => {
      const [v, next] = mulberry32(seed);
      seed = next;
      return v;
    };
    let compared = 0;
    for (let step = 0; step < 800 && s.phase !== 'gameOver'; step++) {
      const revealed = s.phase === 'roundEnd' && s.config.revealOnRoundEnd;
      const viewers: (PlayerId | null)[] = [null, pickOf(s.players, rand).id, ...pendingActors(s)];
      for (const viewer of revealed ? [] : viewers) {
        const twin = hiddenTwin(s, viewer, rand);
        const a = JSON.stringify(projectView(s, viewer));
        const b = JSON.stringify(projectView(twin, viewer));
        if (a !== b) expect({ step, viewer, view: projectView(twin, viewer) }).toEqual({ step, viewer, view: projectView(s, viewer) });
        if (viewer) expect(chooseBotAction(twin, viewer)).toEqual(chooseBotAction(s, viewer));
        compared++;
      }
      const view = projectView(s, null);
      expect(view.tableMax).toBe(s.players.reduce((k, p) => k + p.stack.length, 0) + 2 * s.config.powerFlipsMax);
      expect(view.lastSeq).toBe(s.log[s.log.length - 1].seq);
      const next = botStep(s);
      expect(next, `bots stuck in ${s.phase}`).not.toBeNull();
      expect(next!.usedFallback).toBe(false);
      s = next!.state;
    }
    expect(s.phase).toBe('gameOver');
    expect(compared).toBeGreaterThan(50);
    // The log is gap-free and tagged with non-decreasing rounds.
    expect(s.log.map((e) => e.seq)).toEqual(s.log.map((_, k) => k + 1));
    expect(s.log.every((e, k) => k === 0 || e.round >= s.log[k - 1].round)).toBe(true);
  });
});
