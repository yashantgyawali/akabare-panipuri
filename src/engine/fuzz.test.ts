import { describe, expect, test } from 'vitest';
import {
  applyAction,
  botStep,
  chooseBotAction,
  COLORS,
  createGame,
  fullSet,
  legalActions,
  mulberry32,
  noLegalActions,
  pendingActors,
  POWER_KINDS,
  projectView,
  randStream,
  runBots,
  setBot,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerSeed,
  type PuriKind,
  type Rand,
} from './index.ts';

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function checkCards(s: GameState): void {
  for (const owner of s.players) {
    const seen: string[] = [];
    for (const p of s.players) {
      for (const c of p.hand) {
        if (c.owner !== p.id) fail(`${c.id} is in ${p.id}'s hand`);
        if (c.owner === owner.id) seen.push(c.id);
      }
      for (const c of p.stack) if (c.owner === owner.id) seen.push(c.id);
    }
    for (const x of s.eating?.plate ?? []) if (x.card.owner === owner.id) seen.push(x.card.id);
    const expected = fullSet(owner.id, s.config).map((c) => c.id);
    if (JSON.stringify(seen.sort()) !== JSON.stringify(expected.sort())) {
      fail(`cards of ${owner.id}: ${seen.join(',')}`);
    }
  }
}

function checkScores(s: GameState): void {
  for (const p of s.players) {
    const sum = s.results.reduce((n, r) => n + (r.scoreDeltas[p.id] ?? 0), 0);
    if (sum !== p.score) fail(`${p.id} score ${p.score} != sum of deltas ${sum}`);
    const busts = s.results.filter((r) => r.outcome === 'bust' && r.eaterId === p.id).length;
    if (busts !== p.busts) fail(`${p.id} busts ${p.busts} != ${busts}`);
  }
  s.log.forEach((e, i) => e.seq !== i + 1 && fail(`log seq gap at ${i}`));
  if (s.nextSeq !== s.log.length + 1) fail('nextSeq out of sync');
  if (s.phase !== 'gameOver' && pendingActors(s).length === 0) fail(`nobody pending in ${s.phase}`);
}

const ALL_EMPTY = JSON.stringify(noLegalActions());

/** No card ids anywhere; no kinds for other owners' face-down cards or others' unrevealed powers. */
function checkView(s: GameState, viewerId: PlayerId | null): void {
  const v = projectView(s, viewerId);
  const json = JSON.stringify(v);
  for (const p of s.players) if (json.includes(`"${p.id}:`)) fail(`view of ${viewerId} leaks a card id of ${p.id}`);
  const revealed = s.phase === 'gameOver' || (s.phase === 'roundEnd' && s.config.revealOnRoundEnd);
  if (v.revealed !== revealed) fail('revealed flag');
  s.players.forEach((q, i) => {
    const vq = v.players[i];
    if (vq.id !== q.id || vq.handCount !== q.hand.length) fail('public player');
    if (vq.stack.length !== q.stack.length) fail('stack length');
    q.stack.forEach((c, j) => {
      const vc = vq.stack[j];
      const expected = revealed || c.owner === viewerId ? c.kind : null;
      if (vc.owner !== c.owner || vc.kind !== expected || Object.keys(vc).length !== 2) {
        fail(`view of ${viewerId}: stack card ${j} of ${q.id} shows ${JSON.stringify(vc)}`);
      }
    });
    if (!q.power) {
      if (vq.power !== null) fail('phantom power');
    } else {
      const expected = q.power.revealed || revealed || q.id === viewerId ? q.power.kind : null;
      if (vq.power?.kind !== expected || vq.power.revealed !== q.power.revealed) {
        fail(`view of ${viewerId}: power of ${q.id} shows ${JSON.stringify(vq.power)}`);
      }
    }
  });
  if (viewerId === null) {
    if (v.me !== null || JSON.stringify(v.legal) !== ALL_EMPTY) fail('spectator sees private data');
  } else {
    const me = s.players.find((p) => p.id === viewerId)!;
    const akabare = me.hand.filter((c) => c.kind === 'akabare').length;
    if (v.me?.hand.akabare !== akabare || v.me.hand.panipuri !== me.hand.length - akabare) fail('private hand');
  }
}

function checkAll(s: GameState): void {
  checkCards(s);
  checkScores(s);
  checkView(s, null);
  for (const p of s.players) checkView(s, p.id);
}

/** Randomizes everything `viewerId` cannot see. Used only for projection/decisions, never applied. */
function scrambleHidden(s: GameState, viewerId: PlayerId, rand: Rand): GameState {
  const { log, ...rest } = s;
  const c: GameState = { ...structuredClone(rest), log };
  const kind = (): PuriKind => (rand() < 0.5 ? 'panipuri' : 'akabare');
  for (const p of c.players) {
    for (const card of p.stack) if (card.owner !== viewerId) card.kind = kind();
    if (p.id === viewerId) continue;
    for (const card of p.hand) card.kind = kind();
    if (p.power && !p.power.revealed) p.power.kind = POWER_KINDS[Math.floor(rand() * 4)];
    p.usedPowers = POWER_KINDS.filter(() => rand() < 0.5);
    p.powerPicks = p.powerPicks.map(() => POWER_KINDS[Math.floor(rand() * 4)]);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

const NAMES = ['Sita', 'Ramesh', 'Anil', 'Priya', 'Maya', 'Hari'];

function seedsFor(n: number, isBot: (i: number) => boolean = () => false): PlayerSeed[] {
  return NAMES.slice(0, n).map((name, i) => ({ id: `u${i}-${name.toLowerCase()}`, name, color: COLORS[i], isBot: isBot(i) }));
}

const CONFIGS: Partial<GameConfig>[] = [
  {},
  { targetScore: 12, maxRounds: null },
  { targetScore: null, maxRounds: 7 },
  { startingStack: 1, powerFlipsMax: 1, trapReward: 3 },
  { startingStack: 3, panipuriPerPlayer: 3, powerResetRound: 2, minBid: 2 },
  { powerResetRound: 5, powerFlipsMax: 3, revealOnRoundEnd: true, targetScore: 15 },
  { panipuriPerPlayer: 2, startingStack: 3, trapReward: 0, maxRounds: 4 },
];

const MAX_STEPS = 20000;

// ---------------------------------------------------------------------------
// 300 all-bot games
// ---------------------------------------------------------------------------

describe('fuzz: all-bot games', () => {
  const games = Array.from({ length: 300 }, (_, g) => g);
  test.each(games)('game %i', (g) => {
    const n = 3 + (g % 4);
    const config = CONFIGS[g % CONFIGS.length];
    let s = createGame(seedsFor(n, () => true), config, g * 7919 + 13);
    checkAll(s);
    let steps = 0;
    while (s.phase !== 'gameOver') {
      if (++steps > MAX_STEPS) fail(`game ${g} did not terminate (round ${s.round})`);
      const botId = pendingActors(s).find((id) => s.players.some((p) => p.id === id && p.isBot))!;
      // The bot's choice must not depend on anything outside its own view.
      const hidden = scrambleHidden(s, botId, randStream(s.rng ^ 0x5bd1e995).rand);
      const sameView = JSON.stringify(projectView(hidden, botId)) === JSON.stringify(projectView(s, botId));
      if (!sameView && (!s.config.revealOnRoundEnd || s.phase !== 'roundEnd')) fail(`hidden info reached ${botId}'s view`);
      const choice = JSON.stringify(chooseBotAction(s, botId, randStream(s.rng).rand));
      if (sameView && JSON.stringify(chooseBotAction(hidden, botId, randStream(s.rng).rand)) !== choice) {
        fail(`${botId}'s decision depends on hidden info`);
      }

      const step = botStep(s)!;
      if (step.botId !== botId) fail('botStep moved the wrong bot');
      if (step.usedFallback) fail(`bot ${botId} chose an illegal action ${choice}`);
      if (JSON.stringify(step.action) !== choice) fail('botStep applied a different action');
      s = step.state;
      checkAll(s);
    }
    expect(s.winners!.length).toBeGreaterThan(0);
    const top = Math.max(...s.players.map((p) => p.score));
    expect(s.winners!.every((id) => s.players.find((p) => p.id === id)!.score === top)).toBe(true);
    const { targetScore, maxRounds } = s.config;
    expect((targetScore !== null && top >= targetScore) || s.round === maxRounds).toBe(true);
    expect(s.results).toHaveLength(s.round);
    if (g % 3 === 0) {
      // runBots from the start reaches the very same end state.
      let r = createGame(seedsFor(n, () => true), config, g * 7919 + 13);
      while (r.phase !== 'gameOver') r = runBots(r).state;
      expect(JSON.stringify(r)).toBe(JSON.stringify(s));
    }
  });
});

// ---------------------------------------------------------------------------
// Mixed humans (random legal moves) and bots, with setBot churn
// ---------------------------------------------------------------------------

function randomSetup(legal: NonNullable<ReturnType<typeof legalActions>['setup']>, rand: Rand): Action {
  const pool: PuriKind[] = [
    ...Array.from({ length: legal.hand.panipuri }, (): PuriKind => 'panipuri'),
    ...Array.from({ length: legal.hand.akabare }, (): PuriKind => 'akabare'),
  ];
  const stack: PuriKind[] = [];
  for (let i = 0; i < legal.stackSize; i++) stack.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const power = legal.availablePowers[Math.floor(rand() * legal.availablePowers.length)];
  return { type: 'SUBMIT_SETUP', stack, power };
}

/** Every concrete action the legal set advertises (sampled for setup/amounts). */
function legalMoves(s: GameState, id: PlayerId, rand: Rand): Action[] {
  const L = legalActions(s, id);
  const moves: Action[] = [];
  if (L.setup) moves.push(randomSetup(L.setup, rand));
  if (L.place) {
    for (const kind of L.place.kinds) for (const t of L.place.targets) moves.push({ type: 'PLACE_PURI', kind, targetPlayerId: t });
  }
  if (L.startBid) moves.push({ type: 'START_BID', amount: L.startBid.min + Math.floor(rand() * 5) });
  if (L.raise) moves.push({ type: 'RAISE', amount: L.raise.min + Math.floor(rand() * 3) });
  if (L.pass) moves.push({ type: 'PASS' }, { type: 'PASS' });
  for (const t of L.flipPuri) moves.push({ type: 'FLIP_PURI', targetPlayerId: t });
  for (const t of L.flipPower) moves.push({ type: 'FLIP_POWER', targetPlayerId: t });
  if (L.acceptBust) moves.push({ type: 'ACCEPT_BUST' });
  if (L.ready) moves.push({ type: 'READY' });
  if (L.forceContinue && rand() < 0.2) moves.push({ type: 'FORCE_CONTINUE' });
  return moves;
}

const TURN_PROBES: Action[] = [
  { type: 'PASS' },
  { type: 'START_BID', amount: 3 },
  { type: 'RAISE', amount: 99 },
  { type: 'ACCEPT_BUST' },
  { type: 'READY' },
];

describe('fuzz: mixed human/bot games with random legal moves', () => {
  const games = Array.from({ length: 150 }, (_, g) => g);
  test.each(games)('game %i', (g) => {
    let rng = (g * 2654435761) >>> 0;
    const rand: Rand = () => {
      const [v, next] = mulberry32(rng);
      rng = next;
      return v;
    };
    const n = 3 + (g % 4);
    const base = CONFIGS[g % CONFIGS.length];
    const config = { ...base, maxRounds: base.maxRounds === null ? 8 : base.maxRounds };
    let s = createGame(seedsFor(n, () => rand() < 0.4), config, g + 1);
    checkAll(s);
    let steps = 0;
    while (s.phase !== 'gameOver') {
      if (++steps > MAX_STEPS) fail(`game ${g} did not terminate`);
      if (rand() < 0.03) {
        const p = s.players[Math.floor(rand() * n)];
        s = setBot(s, p.id, !p.isBot);
        checkAll(s);
        continue;
      }
      const step = botStep(s);
      if (step) {
        if (step.usedFallback) fail(`bot ${step.botId} chose an illegal action`);
        s = step.state;
        checkAll(s);
        continue;
      }
      const pending = pendingActors(s);
      // Probe: turn actions from someone who isn't pending must be rejected.
      if (s.phase === 'serving' || s.phase === 'bidding' || s.phase === 'eating') {
        const idle = s.players.find((p) => !pending.includes(p.id))!;
        const probe = TURN_PROBES[Math.floor(rand() * TURN_PROBES.length)];
        if (applyAction(s, idle.id, probe).ok) fail(`${idle.id} acted out of turn: ${JSON.stringify(probe)}`);
      }
      // Sometimes someone who already submitted changes their mind (allowed until the last submission).
      const resubmitters = s.phase === 'setup' ? s.players.filter((p) => p.setupDone) : [];
      const actor =
        resubmitters.length > 0 && rand() < 0.15
          ? resubmitters[Math.floor(rand() * resubmitters.length)].id
          : pending[Math.floor(rand() * pending.length)];
      const moves = legalMoves(s, actor, rand);
      if (moves.length === 0) fail(`${actor} is pending in ${s.phase} with no legal moves`);
      const move = moves[Math.floor(rand() * moves.length)];
      const result = applyAction(s, actor, move);
      if (!result.ok) fail(`legal move rejected: ${actor} ${JSON.stringify(move)} in ${s.phase}: ${result.error}`);
      s = result.state;
      checkAll(s);
    }
    expect(s.results).toHaveLength(s.round);
  });
});
