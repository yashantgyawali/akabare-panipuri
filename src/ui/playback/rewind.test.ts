import { describe, expect, it } from 'vitest';
import { applyAction, chooseBotAction, createGame, pendingActors, projectView, resolveConfig } from '../../engine/index.ts';
import type { GameState, PlayerSeed, PlayerView } from '../../engine/types.ts';
import { biddingFromHistory, displayAt, eventDuration, nextSeatId, rewindView } from './rewind.ts';

const SEEDS: PlayerSeed[] = [
  { id: 'p0', name: 'Asha', color: 'red', isBot: false },
  { id: 'p1', name: 'Bikash', color: 'blue', isBot: false },
  { id: 'p2', name: 'Chandra', color: 'yellow', isBot: false },
  { id: 'p3', name: 'Dipa', color: 'green', isBot: false },
];

/** Plays a whole game one action at a time; returns the viewer's view after every action. */
function playGame(seed: number, viewer: string, players = SEEDS, reveal = false): PlayerView[] {
  let s: GameState = createGame(players, resolveConfig({ targetScore: 12, maxRounds: 4, revealOnRoundEnd: reveal }), seed);
  const views: PlayerView[] = [projectView(s, viewer)];
  for (let i = 0; i < 2000 && s.phase !== 'gameOver'; i++) {
    const actor = pendingActors(s)[0];
    const action = chooseBotAction(s, actor);
    if (!action) throw new Error(`no action for ${actor} in ${s.phase}`);
    const r = applyAction(s, actor, action);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    views.push(projectView(s, viewer));
  }
  expect(s.phase).toBe('gameOver');
  return views;
}

/** The parts of a view the table renders. */
function shape(v: PlayerView) {
  return {
    round: v.round,
    phase: v.phase,
    revealed: v.revealed,
    winners: v.winners,
    results: v.results.length,
    players: v.players.map((p) => ({
      id: p.id,
      isBot: p.isBot,
      score: p.score,
      busts: p.busts,
      handCount: p.handCount,
      setupDone: p.setupDone,
      ready: p.ready,
      stack: p.stack,
      power: p.power,
    })),
    serving: v.phase === 'serving' ? v.serving : null,
    bidding: v.phase === 'bidding' || v.phase === 'eating' ? v.bidding : null,
    eating: v.phase === 'eating' ? v.eating : null,
    hand: v.me?.hand,
    setup: v.me?.setup,
    pendingActors: v.pendingActors,
  };
}

describe('rewindView', () => {
  for (const seed of [1, 7, 42, 2026, 99]) {
    it(`reproduces every earlier state of the same round (seed ${seed})`, () => {
      for (const viewer of ['p0', 'p2']) {
        const views = playGame(seed, viewer, SEEDS, seed % 2 === 0);
        let compared = 0;
        for (let j = 1; j < views.length; j++) {
          for (let i = Math.max(0, j - 30); i < j; i++) {
            const later = views[j];
            const earlier = views[i];
            if (earlier.round !== later.round) continue;
            const r = rewindView(later, earlier.lastSeq);
            if (!r) continue;
            compared++;
            expect(shape(r)).toEqual(shape(earlier));
            // never more than the earlier view knew
            for (let k = 0; k < r.players.length; k++) {
              r.players[k].stack.forEach((c, n) => {
                if (c.kind !== null) expect(earlier.players[k].stack[n].kind).toBe(c.kind);
              });
            }
          }
        }
        expect(compared).toBeGreaterThan(200);
      }
    });
  }

  it('refuses to cross into a new round and falls back to the earlier view', () => {
    const views = playGame(5, 'p1');
    const j = views.findIndex((v, idx) => idx > 0 && v.round === 2);
    const before = views[j - 1];
    const after = views[j];
    expect(before.phase).toBe('roundEnd');
    expect(rewindView(after, before.lastSeq)).toBeNull();
    const d = displayAt([before, after], before.lastSeq);
    expect(d?.phase).toBe('roundEnd');
    expect(d?.round).toBe(1);
  });

  it('returns the same view at its own lastSeq, with live legal actions', () => {
    const views = playGame(3, 'p0');
    const v = views[10];
    expect(rewindView(v, v.lastSeq)).toBe(v);
    const past = rewindView(views[12], v.lastSeq);
    if (past) expect(past.legal.flipPuri).toEqual([]);
  });
});

describe('displayAt', () => {
  it('never offers the legal actions of a superseded view', () => {
    const views = playGame(11, 'p0');
    // find a view where p0 can act, followed by a later one
    const i = views.findIndex((v, k) => k < views.length - 1 && (v.legal.startBid || v.legal.raise || v.legal.flipPuri.length > 0));
    expect(i).toBeGreaterThanOrEqual(0);
    const d = displayAt([views[i], views[i + 1]], views[i].lastSeq);
    expect(d?.legal.startBid).toBeNull();
    expect(d?.legal.raise).toBeNull();
    expect(d?.legal.flipPuri).toEqual([]);
    // but the newest view at its own position keeps them
    expect(displayAt([views[i]], views[i].lastSeq)).toBe(views[i]);
  });
});

describe('helpers', () => {
  const players = SEEDS.map((p, seat) => ({ ...p, seat, score: 0, busts: 0, handCount: 4, setupDone: true, ready: false, stack: [], power: null }));
  it('nextSeatId skips passed players', () => {
    expect(nextSeatId(players, 'p1')).toBe('p2');
    expect(nextSeatId(players, 'p3')).toBe('p0');
    expect(nextSeatId(players, 'p1', ['p2', 'p3'])).toBe('p0');
  });
  it('biddingFromHistory tracks the high bid, passes and the turn', () => {
    const b = biddingFromHistory(
      [
        { playerId: 'p1', action: 'start', amount: 3 },
        { playerId: 'p2', action: 'pass' },
        { playerId: 'p3', action: 'raise', amount: 5 },
      ],
      players,
    );
    expect(b).toMatchObject({ starterId: 'p1', highBid: 5, highBidderId: 'p3', passed: ['p2'], turnId: 'p0' });
  });
  it('own actions play instantly and long queues speed up', () => {
    const place = { type: 'place', playerId: 'p0', onStackOf: 'p1', seq: 5, round: 1 } as const;
    expect(eventDuration(place, true, 1, false)).toBe(0);
    expect(eventDuration(place, false, 1, false)).toBeGreaterThan(eventDuration(place, false, 20, false));
  });
});
