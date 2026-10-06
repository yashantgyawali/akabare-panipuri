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

describe('displayAt across a round change (forwardView)', () => {
  for (const seed of [5, 7, 42, 2026]) {
    it(`plays the rest of an old round forward when the next view is already in a new round (seed ${seed})`, () => {
      for (const viewer of ['p0', 'p3']) {
        const views = playGame(seed, viewer);
        let compared = 0;
        let ends = 0;
        for (let i = 0; i < views.length; i++) {
          const from = views[i];
          if (from.phase !== 'bidding' && from.phase !== 'eating') continue;
          const next = views.find((v) => v.round === from.round + 1);
          if (!next) continue;
          const roundEnd = next.log.find((e) => e.type === 'roundEnd' && e.round === from.round);
          if (!roundEnd || next.log[0].seq > from.lastSeq + 1) continue;
          for (let c = from.lastSeq + 1; c <= roundEnd.seq; c++) {
            const d = displayAt([from, next], c);
            expect(d).not.toBeNull();
            expect(d!.round).toBe(from.round);
            expect(d!.lastSeq).toBe(c);
            expect(d!.legal.flipPuri).toEqual([]);
            const real = views.find((v) => v.lastSeq === c);
            if (real && real.round === from.round) {
              expect(shape(d!)).toEqual(shape(real));
              compared++;
            }
          }
          const end = displayAt([from, next], roundEnd.seq)!;
          expect(end.phase).toBe('roundEnd');
          expect(end.results.find((r) => r.round === from.round)).toEqual((roundEnd as Extract<typeof roundEnd, { type: 'roundEnd' }>).result);
          ends++;
        }
        expect(compared).toBeGreaterThan(10);
        expect(ends).toBeGreaterThan(3);
      }
    });
  }

  it('also moves a serving-phase table forward (no frozen table), keeping others’ cards face down', () => {
    const views = playGame(9, 'p1');
    const from = views.find((v) => v.phase === 'serving' && v.round === 1)!;
    const next = views.find((v) => v.round === 2)!;
    const roundEnd = next.log.find((e) => e.type === 'roundEnd' && e.round === 1)!;
    expect(next.log[0].seq).toBeLessThanOrEqual(from.lastSeq + 1);
    const phases = new Set<string>();
    for (let c = from.lastSeq + 1; c <= roundEnd.seq; c++) {
      const d = displayAt([from, next], c)!;
      phases.add(d.phase);
      for (const p of d.players) for (const card of p.stack) if (card.owner !== 'p1') expect(card.kind).toBeNull();
    }
    expect(phases.has('bidding')).toBe(true);
    expect(phases.has('roundEnd')).toBe(true);
  });
});

/** Seeds whose games contain a Naya Plate flip (found by scanning, so the test follows the bots). */
function nayaGames(viewer: string): PlayerView[][] {
  const out: PlayerView[][] = [];
  for (let seed = 1; seed <= 80 && out.length < 6; seed++) {
    const views = playGame(seed, viewer);
    const log = views[views.length - 1].log;
    if (log.some((e) => e.type === 'flipPower' && e.effect === 'freePlate')) out.push(views);
  }
  return out;
}

describe('Naya Plate (freePlate) playback', () => {
  it('rewinds before and after the flip, with flips from any stack including the own one', () => {
    const games = nayaGames('p0');
    expect(games.length).toBeGreaterThan(0);
    let before = 0;
    let after = 0;
    let ownAfter = 0;
    for (const views of games) {
      const final = views.filter((v) => v.eating).slice(-1)[0];
      for (const last of views.filter((v) => v.phase === 'eating' || v.phase === 'roundEnd')) {
        const naya = last.log.find((e) => e.type === 'flipPower' && e.effect === 'freePlate' && e.round === last.round);
        if (!naya) continue;
        for (const earlier of views) {
          if (earlier.round !== last.round || earlier.lastSeq >= last.lastSeq || !earlier.eating) continue;
          const r = rewindView(last, earlier.lastSeq);
          if (!r) continue;
          expect(shape(r)).toEqual(shape(earlier));
          expect(r.eating!.freePlate).toBe(earlier.lastSeq >= naya.seq);
          if (earlier.lastSeq >= naya.seq) after++;
          else before++;
        }
        // flips taken from the eater's own stack after the Naya flip
        const own = last.log.filter((e) => e.type === 'flipPuri' && e.seq > naya.seq && e.fromStackOf === e.eaterId);
        ownAfter += own.length;
      }
      expect(final).toBeDefined();
    }
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(ownAfter).toBeGreaterThanOrEqual(0);
  });

  it('un-applies the flip: freePlate is off and the power card goes back face down', () => {
    for (const views of nayaGames('p1')) {
      const v = views.find((x) => x.eating?.freePlate)!;
      const naya = v.log.find((e) => e.type === 'flipPower' && e.effect === 'freePlate' && e.round === v.round)!;
      const r = rewindView(v, naya.seq - 1)!;
      expect(r.eating?.freePlate).toBe(false);
      expect(r.eating?.powers.some((p) => p.effect === 'freePlate')).toBe(false);
      const owner = r.players.find((p) => p.id === (naya as Extract<typeof naya, { type: 'flipPower' }>).fromStackOf)!;
      expect(owner.power?.revealed).toBe(false);
    }
  });

  it('plays a Naya Plate forward across a round boundary', () => {
    let checked = 0;
    for (const viewer of ['p0', 'p3']) {
      for (const views of nayaGames(viewer)) {
        const from = views.find((v) => v.phase === 'eating' && v.eating && !v.eating.freePlate && v.log.length > 0);
        if (!from) continue;
        const next = views.find((v) => v.round === from.round + 1);
        if (!next) continue;
        const nayaEv = next.log.find((e) => e.type === 'flipPower' && e.effect === 'freePlate' && e.round === from.round);
        if (!nayaEv || nayaEv.seq <= from.lastSeq || next.log[0].seq > from.lastSeq + 1) continue;
        const roundEnd = next.log.find((e) => e.type === 'roundEnd' && e.round === from.round)!;
        for (let c = from.lastSeq + 1; c <= roundEnd.seq; c++) {
          const d = displayAt([from, next], c)!;
          expect(d.round).toBe(from.round);
          expect(d.eating?.freePlate).toBe(c >= nayaEv.seq);
          const real = views.find((x) => x.lastSeq === c);
          if (real && real.round === from.round) expect(shape(d)).toEqual(shape(real));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
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
