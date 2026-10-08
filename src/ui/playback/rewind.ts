/**
 * Event playback, the pure part: what the table looked like at log position
 * `cursor`, derived from real PlayerViews by UN-applying the events that have
 * not been played yet.
 *
 * - `rewindView(v, c)` walks the unplayed events (c, v.lastSeq] of v's round
 *   newest-first and undoes each one on a copy of v (a flipped card goes back
 *   on top of its stack face down, a placed card leaves its stack, scores lose
 *   the round's deltas, …). It returns null when that's impossible: the
 *   events aren't all in v.log, or they cross into v's round from an earlier
 *   one (the previous round's table is gone from v).
 * - `displayAt(views, c)` picks the closest view at or after c and rewinds it;
 *   failing that (c is in an older round than every later view) it takes the
 *   newest view before c and applies the events up to c forward (forwardView).
 *
 * Rewound views never gain information: kinds only come from the events
 * themselves (public), and un-revealing hides every card that isn't the
 * viewer's own. Their `legal` is empty (nobody acts on a past state).
 */
import { noLegalActions } from '../../engine/index.ts';
import type { BidEntry, BiddingState, GameEvent, PlayerId, PlayerView, PublicPlayerView, RoundResult } from '../../engine/types.ts';

export function nextSeatId(players: readonly PublicPlayerView[], from: PlayerId, skip: readonly PlayerId[] = []): PlayerId {
  const order = [...players].sort((a, b) => a.seat - b.seat);
  const i = order.findIndex((p) => p.id === from);
  if (i < 0) return from;
  for (let k = 1; k <= order.length; k++) {
    const p = order[(i + k) % order.length];
    if (!skip.includes(p.id)) return p.id;
  }
  return from;
}

export function bidEntryOf(e: GameEvent): BidEntry | null {
  if (e.type === 'bidStart') return { playerId: e.playerId, action: 'start', amount: e.amount };
  if (e.type === 'raise') return { playerId: e.playerId, action: 'raise', amount: e.amount };
  if (e.type === 'pass') return { playerId: e.playerId, action: 'pass' };
  return null;
}

/** The bidding state after these history entries (the first must be the 'start'). */
export function biddingFromHistory(history: readonly BidEntry[], players: readonly PublicPlayerView[]): BiddingState | null {
  if (history.length === 0) return null;
  const first = history[0];
  let highBid = first.amount ?? 0;
  let highBidderId = first.playerId;
  const passed: PlayerId[] = [];
  for (const h of history.slice(1)) {
    if (h.action === 'raise' && h.amount !== undefined) {
      highBid = h.amount;
      highBidderId = h.playerId;
    } else if (h.action === 'pass') {
      passed.push(h.playerId);
    }
  }
  const last = history[history.length - 1].playerId;
  return {
    starterId: first.playerId,
    highBid,
    highBidderId,
    passed,
    history: history.map((h) => ({ ...h })),
    turnId: nextSeatId(players, last, passed),
  };
}

/** Who the game waits on in this (possibly rewound) view. Mirrors the engine's pendingActors. */
export function derivePendingActors(v: PlayerView): PlayerId[] {
  switch (v.phase) {
    case 'setup':
      return v.players.filter((p) => !p.setupDone).map((p) => p.id);
    case 'serving':
      return v.serving ? [v.serving.turnId] : [];
    case 'bidding':
      return v.bidding ? [v.bidding.turnId] : [];
    case 'eating':
      return v.eating ? [v.eating.eaterId] : [];
    case 'roundEnd': {
      const waiting = v.players.filter((p) => !p.isBot && !p.ready).map((p) => p.id);
      return waiting.length > 0 ? waiting : v.players.filter((p) => p.isBot).map((p) => p.id);
    }
    case 'gameOver':
      return [];
  }
}

/** Hide everything the viewer doesn't own (leaving a revealed phase). */
function unreveal(v: PlayerView): void {
  if (!v.revealed) return;
  v.revealed = false;
  for (const p of v.players) {
    p.stack = p.stack.map((c) => ({ owner: c.owner, kind: c.owner === v.youId ? c.kind : null }));
    if (p.power && !p.power.revealed && p.power.owner !== v.youId) p.power = { ...p.power, kind: null };
  }
}

/** The Akabare pending at the end of these played events (a 'bite' not yet resolved), within `round`. */
export function pendingBite(log: readonly GameEvent[], round: number): { owner: PlayerId; fromStackOf: PlayerId } | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.round !== round) return null;
    if (e.type === 'bite') return { owner: e.owner, fromStackOf: e.fromStackOf };
    if (e.type === 'flipPower' || e.type === 'flipPuri' || e.type === 'success' || e.type === 'bust' || e.type === 'roundEnd') return null;
  }
  return null;
}

export function rewindView(v: PlayerView, cursor: number): PlayerView | null {
  if (cursor >= v.lastSeq) return v;
  const unplayed = v.log.filter((e) => e.seq > cursor);
  if (unplayed.length !== v.lastSeq - cursor) return null; // not all in the log tail
  if (unplayed.some((e) => e.round !== v.round || e.type === 'roundStart')) return null;

  const out: PlayerView = structuredClone(v);
  const me = out.youId;
  const player = (id: PlayerId) => out.players.find((p) => p.id === id);
  const result: RoundResult | undefined =
    v.results.find((r) => r.round === v.round) ??
    (v.log.find((e) => e.type === 'roundEnd' && e.round === v.round) as Extract<GameEvent, { type: 'roundEnd' }> | undefined)?.result;
  const revertScores = () => {
    if (!result) return;
    for (const p of out.players) p.score -= result.scoreDeltas[p.id] ?? 0;
  };
  const setBidding = (history: BidEntry[]) => {
    out.bidding = biddingFromHistory(history, out.players);
  };

  for (const e of [...unplayed].reverse()) {
    switch (e.type) {
      case 'gameOver':
        out.phase = 'roundEnd';
        out.winners = null;
        if (!out.config.revealOnRoundEnd) unreveal(out);
        break;
      case 'roundEnd':
        out.phase = 'eating';
        out.results = out.results.filter((r) => r.round !== e.round);
        for (const p of out.players) p.ready = false;
        unreveal(out);
        break;
      case 'ready': {
        const p = player(e.playerId);
        if (p) p.ready = false;
        break;
      }
      case 'botSet': {
        const p = player(e.playerId);
        if (p) p.isBot = !e.isBot;
        break;
      }
      case 'success':
        revertScores();
        break;
      case 'bust': {
        revertScores();
        const p = player(e.eaterId);
        if (p) p.busts = Math.max(0, p.busts - 1);
        break;
      }
      case 'flipPower': {
        const p = player(e.fromStackOf);
        if (p?.power) p.power = { owner: p.power.owner, revealed: false, kind: p.power.owner === me || out.revealed ? e.kind : null };
        const eat = out.eating;
        if (eat) {
          eat.powersFlipped = Math.max(0, eat.powersFlipped - 1);
          eat.powers = eat.powers.slice(0, -1);
          if (e.effect === 'plusTwo') eat.eaten -= 2;
          if (e.effect === 'freePlate') eat.freePlate = false;
          if (e.effect === 'numb') eat.skipNext = false;
          if (e.effect === 'saved' && eat.plate.length > 0) {
            const last = eat.plate[eat.plate.length - 1];
            eat.plate[eat.plate.length - 1] = { ...last, saved: false };
          }
        }
        break;
      }
      case 'bite':
        break;
      case 'flipPuri': {
        const eat = out.eating;
        if (eat) {
          eat.plate = eat.plate.slice(0, -1);
          if (!e.cancelled && e.kind === 'panipuri') eat.eaten -= 1;
          eat.skipNext = e.cancelled;
        }
        const p = player(e.fromStackOf);
        if (p) p.stack = [...p.stack, { owner: e.owner, kind: e.owner === me || out.revealed ? e.kind : null }];
        break;
      }
      case 'eater': {
        out.phase = 'bidding';
        out.eating = null;
        // The engine keeps `bidding` through eating; rebuild it from the log only if it's missing.
        if (out.bidding) {
          setBidding(out.bidding.history);
        } else {
          const history = v.log
            .filter((x) => x.round === e.round && x.seq < e.seq)
            .map(bidEntryOf)
            .filter((x): x is BidEntry => x !== null);
          const start = history.findIndex((h) => h.action === 'start');
          setBidding(start >= 0 ? history.slice(start) : [{ playerId: e.playerId, action: 'start', amount: e.bid }]);
        }
        break;
      }
      case 'bidStart':
      case 'raise':
      case 'pass': {
        if (e.type === 'bidStart') {
          out.phase = 'serving';
          out.bidding = null;
          out.serving = { turnId: e.playerId };
        } else if (out.bidding) {
          setBidding(out.bidding.history.slice(0, -1));
        }
        break;
      }
      case 'place': {
        const target = player(e.onStackOf);
        const card = target ? target.stack[target.stack.length - 1] : undefined;
        if (target) target.stack = target.stack.slice(0, -1);
        const placer = player(e.playerId);
        if (placer) placer.handCount += 1;
        if (e.playerId === me && out.me && card?.kind) out.me.hand = { ...out.me.hand, [card.kind]: out.me.hand[card.kind] + 1 };
        out.phase = 'serving';
        out.serving = { turnId: e.playerId };
        break;
      }
      case 'servingStart':
        out.phase = 'setup';
        out.serving = null;
        break;
      case 'setupDone': {
        const p = player(e.playerId);
        if (p) {
          p.setupDone = false;
          p.stack = [];
          p.power = null;
          p.handCount = out.config.panipuriPerPlayer + 1;
        }
        if (e.playerId === me && out.me) {
          out.me.setup = null;
          out.me.hand = { panipuri: out.config.panipuriPerPlayer, akabare: 1 };
        }
        break;
      }
      case 'roundStart':
        return null; // unreachable (filtered above)
    }
  }

  out.log = v.log.filter((e) => e.seq <= cursor);
  out.lastSeq = cursor;
  out.legal = noLegalActions();
  if (out.eating) {
    const eater = player(out.eating.eaterId);
    out.eating.ownStackEmpty = !eater || eater.stack.length === 0;
    out.eating.pendingAkabare = out.phase === 'eating' ? pendingBite(out.log, out.round) : null;
  }
  out.pendingActors = derivePendingActors(out);
  return out;
}

/**
 * v with the events after it (up to `cursor`, within v's round) applied
 * FORWARD, as far as public information allows. Used when a newer view can't
 * be rewound to the cursor because it is already in a later round (e.g. the
 * device slept through the end of a round): the rest of the old round still
 * plays on the old table, ending on its result. Events carry everything the
 * table shows (flipped kinds, eaten/target, the round result); cards placed by
 * others stay face down. Only the viewer's own placement (a bot playing their
 * seat) loses its kind, which the viewer then just doesn't see.
 */
export function forwardView(v: PlayerView, events: readonly GameEvent[], cursor: number): PlayerView {
  const todo = events.filter((e) => e.seq > v.lastSeq && e.seq <= cursor && (e.round === v.round || e.type === 'ready' || e.type === 'botSet'));
  if (todo.length === 0) return v;
  const out: PlayerView = structuredClone(v);
  const me = out.youId;
  const player = (id: PlayerId) => out.players.find((p) => p.id === id);
  const roundEnd = events.find((e) => e.type === 'roundEnd' && e.round === v.round) as Extract<GameEvent, { type: 'roundEnd' }> | undefined;
  const applyScores = () => {
    if (!roundEnd) return;
    for (const p of out.players) p.score = roundEnd.result.scoresAfter[p.id] ?? p.score;
  };
  const bid = (entry: BidEntry) => {
    out.bidding = biddingFromHistory([...(entry.action === 'start' ? [] : (out.bidding?.history ?? [])), entry], out.players);
  };

  for (const e of todo) {
    if (e.round !== v.round && e.type !== 'ready' && e.type !== 'botSet') continue;
    switch (e.type) {
      case 'ready': {
        const p = player(e.playerId);
        if (p) p.ready = true;
        break;
      }
      case 'botSet': {
        const p = player(e.playerId);
        if (p) p.isBot = e.isBot;
        break;
      }
      case 'setupDone': {
        const p = player(e.playerId);
        if (!p || p.setupDone) break;
        const own = e.playerId === me ? (out.me?.setup ?? null) : null;
        const n = out.config.startingStack;
        p.setupDone = true;
        p.stack = Array.from({ length: n }, (_, i) => ({ owner: p.id, kind: own ? (own.stack[i] ?? null) : null }));
        p.power = { owner: p.id, revealed: false, kind: own ? own.power : null };
        p.handCount = Math.max(0, p.handCount - n);
        if (own && out.me) {
          const hand = { ...out.me.hand };
          for (const k of own.stack) hand[k] = Math.max(0, hand[k] - 1);
          out.me.hand = hand;
        }
        break;
      }
      case 'servingStart':
        out.phase = 'serving';
        out.serving = { turnId: e.turnId };
        break;
      case 'place': {
        const target = player(e.onStackOf);
        if (target) target.stack = [...target.stack, { owner: e.playerId, kind: null }];
        const placer = player(e.playerId);
        if (placer) placer.handCount = Math.max(0, placer.handCount - 1);
        out.serving = { turnId: nextSeatId(out.players, e.playerId) };
        break;
      }
      case 'bidStart':
      case 'raise':
      case 'pass': {
        const entry = bidEntryOf(e);
        if (!entry) break;
        if (e.type === 'bidStart') {
          out.phase = 'bidding';
          out.serving = null;
        }
        bid(entry);
        break;
      }
      case 'eater': {
        out.phase = 'eating';
        if (out.bidding) out.bidding = { ...out.bidding, turnId: e.playerId };
        out.eating = {
          eaterId: e.playerId,
          bid: e.bid,
          target: e.bid,
          eaten: 0,
          powersFlipped: 0,
          skipNext: false,
          freePlate: false,
          pendingAkabare: null,
          plate: [],
          powers: [],
          ownStackEmpty: false,
        };
        break;
      }
      case 'flipPuri': {
        const p = player(e.fromStackOf);
        if (p) p.stack = p.stack.slice(0, -1);
        const eat = out.eating;
        if (eat) {
          eat.plate = [...eat.plate, { owner: e.owner, kind: e.kind, fromStackOf: e.fromStackOf, cancelled: e.cancelled, saved: false }];
          eat.eaten = e.eaten;
          eat.target = e.target;
          eat.skipNext = false;
        }
        break;
      }
      case 'bite':
        break; // pendingAkabare is derived from the log below
      case 'flipPower': {
        const p = player(e.fromStackOf);
        if (p?.power) p.power = { owner: p.power.owner, revealed: true, kind: e.kind };
        const eat = out.eating;
        if (eat) {
          eat.powersFlipped += 1;
          eat.powers = [...eat.powers, { kind: e.kind, owner: e.owner, fromStackOf: e.fromStackOf, effect: e.effect }];
          eat.eaten = e.eaten;
          eat.target = e.target;
          if (e.effect === 'numb') eat.skipNext = true;
          if (e.effect === 'freePlate') eat.freePlate = true;
          if (e.effect === 'saved' && eat.plate.length > 0) {
            const last = eat.plate[eat.plate.length - 1];
            eat.plate = [...eat.plate.slice(0, -1), { ...last, saved: true }];
          }
        }
        break;
      }
      case 'success':
        applyScores();
        break;
      case 'bust': {
        applyScores();
        const p = player(e.eaterId);
        if (p) p.busts += 1;
        break;
      }
      case 'roundEnd':
        out.phase = 'roundEnd';
        out.results = [...out.results.filter((r) => r.round !== e.round), e.result];
        for (const p of out.players) {
          p.score = e.result.scoresAfter[p.id] ?? p.score;
          p.ready = p.isBot;
        }
        break;
      case 'gameOver':
        out.phase = 'gameOver';
        out.winners = [...e.winners];
        for (const p of out.players) p.score = e.scores[p.id] ?? p.score;
        break;
      case 'roundStart':
        break; // a later round: never applied forward
    }
  }

  const known = new Set(v.log.map((e) => e.seq));
  out.log = [...v.log, ...events.filter((e) => e.seq > v.lastSeq && e.seq <= cursor && !known.has(e.seq))];
  out.lastSeq = cursor;
  out.legal = noLegalActions();
  if (out.eating) {
    const eater = player(out.eating.eaterId);
    out.eating.ownStackEmpty = !eater || eater.stack.length === 0;
    out.eating.pendingAkabare = out.phase === 'eating' ? pendingBite(out.log, out.round) : null;
  }
  out.tableMax = out.players.reduce((n, p) => n + p.stack.length, 0) + 2 * out.config.powerFlipsMax;
  out.pendingActors = derivePendingActors(out);
  return out;
}

/**
 * The table as of `cursor`, from the views seen so far (ascending lastSeq).
 * Only the newest view may carry live legal actions: anything older is a past
 * state (the player may already have acted on it), so its `legal` is emptied.
 */
export function displayAt(views: readonly PlayerView[], cursor: number): PlayerView | null {
  if (views.length === 0) return null;
  const newest = views[views.length - 1];
  const stale = (v: PlayerView): PlayerView => (v === newest ? v : { ...v, legal: noLegalActions() });
  const later = views.find((v) => v.lastSeq >= cursor);
  if (later) {
    const r = rewindView(later, cursor);
    if (r) return stale(r);
  }
  const earlier = [...views].reverse().find((v) => v.lastSeq <= cursor);
  if (earlier) return stale(forwardView(earlier, later?.log ?? [], cursor));
  return stale(later ?? newest);
}

/** Finds the event with this seq in any of the views' logs. */
export function eventAt(views: readonly PlayerView[], seq: number): GameEvent | null {
  for (let i = views.length - 1; i >= 0; i--) {
    const e = views[i].log.find((x) => x.seq === seq);
    if (e) return e;
  }
  return null;
}

/** The player an event is "by" (its actor), for own-action pacing. */
export function actorOf(e: GameEvent): PlayerId | null {
  switch (e.type) {
    case 'setupDone':
    case 'place':
    case 'bidStart':
    case 'raise':
    case 'pass':
    case 'ready':
    case 'botSet':
      return e.playerId;
    case 'flipPuri':
    case 'bite':
    case 'flipPower':
    case 'success':
    case 'bust':
      return e.eaterId;
    case 'eater':
      return e.playerId;
    default:
      return null;
  }
}

/**
 * How long an event holds the stage before the next one plays (ms).
 * `own`: the viewer's own action (plays instantly; flips get just enough time to be seen).
 * `queued`: events still waiting after this one (long queues speed up).
 */
export function eventDuration(e: GameEvent, own: boolean, queued: number, reducedMotion: boolean): number {
  let ms: number;
  if (own && (e.type === 'place' || e.type === 'bidStart' || e.type === 'raise' || e.type === 'pass' || e.type === 'setupDone' || e.type === 'ready' || e.type === 'botSet')) {
    ms = 0;
  } else if (own && (e.type === 'flipPuri' || e.type === 'flipPower')) {
    ms = e.type === 'flipPower' && (e.effect === 'saved' || e.effect === 'failedSave') ? 1300 : e.type === 'flipPuri' && e.kind === 'akabare' && !e.cancelled ? 500 : 520;
  } else {
    // Other players' moves (bots especially) are paced slowly enough to read what they play.
    switch (e.type) {
      case 'setupDone':
      case 'ready':
        ms = 320;
        break;
      case 'servingStart':
        ms = 650;
        break;
      case 'roundStart':
        ms = 1100;
        break;
      case 'place':
        ms = 1500;
        break;
      case 'bidStart':
        ms = 1700;
        break;
      case 'raise':
        ms = 1600;
        break;
      case 'pass':
        ms = 1200;
        break;
      case 'eater':
        ms = 1600;
        break;
      case 'flipPuri':
        ms = e.cancelled ? 1800 : e.kind === 'akabare' ? 1100 : 1600;
        break;
      case 'bite':
        ms = 1800;
        break;
      case 'flipPower':
        ms = e.effect === 'saved' || e.effect === 'failedSave' ? 2300 : 1900;
        break;
      case 'success':
        ms = 1800;
        break;
      case 'bust':
        ms = 2200;
        break;
      case 'roundEnd':
      case 'gameOver':
        ms = 400;
        break;
      case 'botSet':
        ms = 600;
        break;
    }
  }
  // Only a long backlog (a reconnect, a missed stretch) speeds up; a bot's normal turn plays at full pace.
  if (queued > 18) ms *= 0.3;
  else if (queued > 12) ms *= 0.6;
  if (reducedMotion) ms *= 0.8;
  return Math.round(ms);
}
