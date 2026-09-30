import { describe, expect, it } from 'vitest';
import type { Action, LegalActions, PlayerView } from '../engine/index.ts';
import {
  act,
  addBot,
  cleanName,
  joinPlayer,
  leave,
  newRecord,
  normalizeCode,
  rematch,
  removePlayer,
  ServerError,
  setBot,
  snapshot,
  startGame,
  updateLobby,
} from './core.ts';
import { generateCode, generateId, generateToken, hashToken, randomSeed, sha256 } from './crypto.ts';
import { CODE_ALPHABET, CODE_LENGTH, type GameRecord, type ServerErrorCode } from './types.ts';

const T0 = '2026-09-30T10:00:00.000Z';
const T1 = '2026-09-30T10:01:00.000Z';

function expectError(fn: () => unknown, code: ServerErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ServerError);
    expect((e as ServerError).code).toBe(code);
    return;
  }
  throw new Error(`expected ServerError(${code})`);
}

function lobby(): GameRecord {
  let rec = newRecord('abcde', { id: 'h', name: 'Host' }, T0);
  rec = joinPlayer(rec, { id: 'p2', name: 'Two' }, T0);
  rec = addBot(rec, 'h', 'b1', T0);
  return rec;
}

/** A deterministic legal action from a view's `legal` block. */
function pickLegal(view: PlayerView, turn: number): Action | null {
  const l: LegalActions = view.legal;
  if (l.setup && !l.setup.submitted) {
    const stack = Array.from({ length: l.setup.stackSize }, () => 'panipuri' as const);
    return { type: 'SUBMIT_SETUP', stack, power: l.setup.availablePowers[turn % l.setup.availablePowers.length] };
  }
  if (l.place && turn % 3 !== 0) {
    return { type: 'PLACE_PURI', kind: l.place.kinds[0], targetPlayerId: l.place.targets[turn % l.place.targets.length] };
  }
  if (l.startBid) return { type: 'START_BID', amount: l.startBid.min + (turn % 3) };
  if (l.raise) return turn % 2 === 0 ? { type: 'PASS' } : { type: 'RAISE', amount: l.raise.min };
  if (l.pass) return { type: 'PASS' };
  if (l.flipPower.length > 0 && turn % 4 === 0) return { type: 'FLIP_POWER', targetPlayerId: l.flipPower[0] };
  if (l.flipPuri.length > 0) return { type: 'FLIP_PURI', targetPlayerId: l.flipPuri[0] };
  if (l.flipPower.length > 0) return { type: 'FLIP_POWER', targetPlayerId: l.flipPower[0] };
  if (l.acceptBust) return { type: 'ACCEPT_BUST' };
  if (l.ready) return { type: 'READY' };
  return null;
}

/** Plays every human with pickLegal until finished; returns the final record. */
function playOut(rec: GameRecord, maxSteps = 5000): GameRecord {
  for (let i = 0; i < maxSteps && rec.status === 'playing'; i++) {
    const humans = rec.players.filter((p) => !p.isBot);
    let moved = false;
    for (const h of humans) {
      const snap = snapshot(rec, h.id);
      const action = pickLegal(snap.view!, i);
      if (!action) continue;
      const before = rec.version;
      rec = act(rec, h.id, action, T1);
      expect(rec.version).toBe(before + 1);
      moved = true;
      break;
    }
    if (!moved) {
      // Only the host can unstick roundEnd (everyone human is ready, bots advance).
      throw new Error(`no human could move in phase ${rec.state!.phase}`);
    }
  }
  return rec;
}

describe('crypto', () => {
  it('generates tokens, codes, seeds and ids', async () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(t);
    const code = generateCode();
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    const seed = randomSeed();
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
    expect(generateId()).toMatch(/^[0-9a-f-]{36}$/);
    const h = await hashToken('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('fallback sha256 matches WebCrypto', async () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'पानीपुरी'.repeat(40)]) {
      const data = new TextEncoder().encode(s);
      const ref = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      expect(Array.from(sha256(data))).toEqual(Array.from(ref));
    }
  });
});

describe('validation helpers', () => {
  it('normalizes codes', () => {
    expect(normalizeCode(' abcde ')).toBe('ABCDE');
    expect(normalizeCode('ABCD')).toBeNull();
    expect(normalizeCode('ABCD0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode(42)).toBeNull();
  });

  it('cleans names', () => {
    expect(cleanName('  Sita   Devi ')).toBe('Sita Devi');
    expect(cleanName('a\u0000b')).toBe('ab');
    expect(cleanName('x'.repeat(20))).toHaveLength(20);
    expectError(() => cleanName('   '), 'bad_request');
    expectError(() => cleanName('x'.repeat(21)), 'bad_request');
    expectError(() => cleanName(7), 'bad_request');
  });
});

describe('lobby lifecycle', () => {
  it('creates a record with the host in seat 0', () => {
    const rec = newRecord('abcde', { id: 'h', name: ' Host ' }, T0);
    expect(rec).toMatchObject({ code: 'ABCDE', hostId: 'h', status: 'lobby', state: null, version: 1 });
    expect(rec.players).toEqual([{ id: 'h', name: 'Host', color: 'red', seat: 0, isBot: false }]);
    expect(rec.createdAt).toBe(T0);
    expect(newRecord('ABCDE', { id: 'h', name: 'H', color: 'green' }, T0).players[0].color).toBe('green');
    expectError(() => newRecord('nope', { id: 'h', name: 'H' }, T0), 'bad_request');
    expectError(() => newRecord('ABCDE', { id: 'h', name: '' }, T0), 'bad_request');
    expectError(() => newRecord('ABCDE', { id: 'h', name: 'H', color: 'pink' as never }, T0), 'bad_request');
  });

  it('joins with free or requested colors and bumps the version', () => {
    let rec = newRecord('ABCDE', { id: 'h', name: 'Host' }, T0);
    const r2 = joinPlayer(rec, { id: 'p2', name: 'Two' }, T1);
    expect(r2.version).toBe(2);
    expect(r2.updatedAt).toBe(T1);
    expect(r2.players[1]).toEqual({ id: 'p2', name: 'Two', color: 'blue', seat: 1, isBot: false });
    expect(rec.players).toHaveLength(1); // input untouched
    rec = joinPlayer(r2, { id: 'p3', name: 'Three', color: 'purple' }, T1);
    expect(rec.players[2].color).toBe('purple');
    expectError(() => joinPlayer(rec, { id: 'p4', name: 'Four', color: 'purple' }, T1), 'color_taken');
    expectError(() => joinPlayer(rec, { id: 'p4', name: '  ' }, T1), 'bad_request');
    expectError(() => joinPlayer(rec, { id: 'p2', name: 'Dup' }, T1), 'conflict');
  });

  it('rejects a seventh player', () => {
    let rec = newRecord('ABCDE', { id: 'h', name: 'Host' }, T0);
    for (let i = 2; i <= 6; i++) rec = joinPlayer(rec, { id: `p${i}`, name: `P${i}` }, T0);
    expect(rec.players.map((p) => p.color)).toEqual(['red', 'blue', 'yellow', 'green', 'purple', 'orange']);
    expectError(() => joinPlayer(rec, { id: 'p7', name: 'P7' }, T0), 'full');
    expectError(() => addBot(rec, 'h', 'b', T0), 'full');
  });

  it('updates own name/color; config is host only and validated', () => {
    let rec = lobby();
    rec = updateLobby(rec, 'p2', { name: 'Deux', color: 'green' }, T1);
    expect(rec.players[1]).toMatchObject({ name: 'Deux', color: 'green' });
    rec = updateLobby(rec, 'p2', { color: 'green' }, T1); // own color is fine
    expectError(() => updateLobby(rec, 'p2', { color: 'red' }, T1), 'color_taken');
    expectError(() => updateLobby(rec, 'p2', { name: '' }, T1), 'bad_request');
    expectError(() => updateLobby(rec, 'p2', { config: { maxRounds: 3 } }, T1), 'forbidden');
    rec = updateLobby(rec, 'h', { config: { maxRounds: 3, targetScore: null } }, T1);
    expect(rec.config.maxRounds).toBe(3);
    expect(rec.config.targetScore).toBeNull();
    expect(rec.config.trapReward).toBe(2);
    expectError(() => updateLobby(rec, 'h', { config: { maxRounds: null } }, T1), 'bad_request');
    expectError(() => updateLobby(rec, 'h', { config: { minBid: 0 } }, T1), 'bad_request');
    expectError(() => updateLobby(rec, 'ghost', { name: 'X' }, T1), 'unauthorized');
  });

  it('adds bots with unused names and free colors (host only)', () => {
    let rec = newRecord('ABCDE', { id: 'h', name: 'sita' }, T0);
    rec = addBot(rec, 'h', 'b1', T0);
    rec = addBot(rec, 'h', 'b2', T0);
    expect(rec.players.slice(1)).toEqual([
      { id: 'b1', name: 'Ramesh', color: 'blue', seat: 1, isBot: true },
      { id: 'b2', name: 'Anil', color: 'yellow', seat: 2, isBot: true },
    ]);
    rec = joinPlayer(rec, { id: 'p', name: 'P' }, T0);
    expectError(() => addBot(rec, 'p', 'b3', T0), 'forbidden');
  });

  it('removes players (host only, not self) and reseats', () => {
    let rec = lobby();
    expectError(() => removePlayer(rec, 'p2', 'b1', T1), 'forbidden');
    expectError(() => removePlayer(rec, 'h', 'h', T1), 'bad_request');
    expectError(() => removePlayer(rec, 'h', 'nobody', T1), 'not_found');
    rec = removePlayer(rec, 'h', 'p2', T1);
    expect(rec.players.map((p) => [p.id, p.seat])).toEqual([
      ['h', 0],
      ['b1', 1],
    ]);
    expectError(() => snapshot(rec, 'p2'), 'unauthorized');
  });

  it('starts only as host, in the lobby, with 3-6 players', () => {
    let rec = newRecord('ABCDE', { id: 'h', name: 'Host' }, T0);
    rec = joinPlayer(rec, { id: 'p2', name: 'Two' }, T0);
    expectError(() => startGame(rec, 'h', 1, T1), 'bad_request');
    rec = addBot(rec, 'h', 'b1', T0);
    expectError(() => startGame(rec, 'p2', 1, T1), 'forbidden');
    const started = startGame(rec, 'h', 1, T1);
    expect(started.status).toBe('playing');
    expect(started.version).toBe(rec.version + 1);
    expect(started.state!.players.map((p) => p.id)).toEqual(['h', 'p2', 'b1']);
    // The bot has already submitted its setup.
    expect(started.state!.players.find((p) => p.id === 'b1')!.setupDone).toBe(true);
    expectError(() => startGame(started, 'h', 1, T1), 'wrong_status');
    expectError(() => joinPlayer(started, { id: 'late', name: 'Late' }, T1), 'wrong_status');
    expectError(() => addBot(started, 'h', 'b9', T1), 'wrong_status');
    expectError(() => updateLobby(started, 'h', { name: 'X' }, T1), 'wrong_status');
    expectError(() => rematch(started, 'h', T1), 'wrong_status');
    expectError(() => act(rec, 'h', { type: 'PASS' }, T1), 'wrong_status');
  });
});

describe('playing', () => {
  it('maps engine errors and restricts FORCE_CONTINUE to the host', () => {
    const rec = startGame(lobby(), 'h', 7, T1);
    expectError(() => act(rec, 'h', { type: 'PASS' }, T1), 'illegal_action');
    expectError(() => act(rec, 'h', { type: 'NOPE' } as never, T1), 'illegal_action');
    expectError(() => act(rec, 'p2', { type: 'FORCE_CONTINUE' }, T1), 'forbidden');
    expectError(() => act(rec, 'ghost', { type: 'PASS' }, T1), 'unauthorized');
  });

  it('plays a whole game (1 human + bots) to finished, then rematches', () => {
    let rec = newRecord('ABCDE', { id: 'h', name: 'Host' }, T0);
    rec = addBot(rec, 'h', 'b1', T0);
    rec = addBot(rec, 'h', 'b2', T0);
    rec = addBot(rec, 'h', 'b3', T0);
    rec = startGame(rec, 'h', 12345, T1);
    rec = playOut(rec);
    expect(rec.status).toBe('finished');
    expect(rec.state!.phase).toBe('gameOver');
    const snap = snapshot(rec, 'h');
    expect(snap.view!.winners!.length).toBeGreaterThan(0);

    expectError(() => act(rec, 'h', { type: 'READY' }, T1), 'wrong_status');
    expectError(() => rematch(rec, 'b1', T1), 'forbidden');
    const again = rematch(rec, 'h', T1);
    expect(again).toMatchObject({ status: 'lobby', state: null, version: rec.version + 1 });
    expect(again.players.map((p) => p.id)).toEqual(['h', 'b1', 'b2', 'b3']);
    expect(snapshot(again, 'h').view).toBeNull();
    expect(startGame(again, 'h', 99, T1).status).toBe('playing');
  });

  it('plays a whole game with 2 humans across many seeds', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let rec = lobby();
      rec = updateLobby(rec, 'h', { config: { maxRounds: 3 } }, T0);
      rec = startGame(rec, 'h', seed, T1);
      rec = playOut(rec);
      expect(rec.status).toBe('finished');
    }
  });

  it('only shows forceContinue to the host', () => {
    let rec = startGame(lobby(), 'h', 3, T1);
    for (let i = 0; i < 500 && rec.state!.phase !== 'roundEnd'; i++) {
      const mover = rec.players.find((p) => !p.isBot && pickLegal(snapshot(rec, p.id).view!, i))!;
      rec = act(rec, mover.id, pickLegal(snapshot(rec, mover.id).view!, i)!, T1);
    }
    expect(rec.state!.phase).toBe('roundEnd');
    expect(snapshot(rec, 'h').view!.legal.forceContinue).toBe(true);
    expect(snapshot(rec, 'p2').view!.legal.forceContinue).toBe(false);
    const round = rec.state!.round;
    rec = act(rec, 'h', { type: 'FORCE_CONTINUE' }, T1);
    expect(rec.state!.round === round + 1 || rec.status === 'finished').toBe(true);
  });

  it('snapshots never contain the raw state or other owners’ hidden cards', () => {
    let rec = startGame(lobby(), 'h', 5, T1);
    // Get into serving with face-down cards on every stack.
    for (let i = 0; i < 50 && rec.state!.phase === 'setup'; i++) {
      const mover = rec.players.find((p) => !p.isBot && snapshot(rec, p.id).view!.legal.setup?.submitted === false)!;
      rec = act(rec, mover.id, pickLegal(snapshot(rec, mover.id).view!, 1)!, T1);
    }
    expect(rec.state!.phase).not.toBe('setup');
    const snap = snapshot(rec, 'h');
    const json = JSON.stringify(snap);
    expect(snap).not.toHaveProperty('state');
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"hand":[');
    for (const p of rec.state!.players) {
      for (const card of [...p.hand, ...p.stack]) {
        expect(json).not.toContain(`"${card.id}"`);
      }
    }
    // Other owners' face-down stack cards have no kind; own cards do.
    for (const pv of snap.view!.players) {
      for (const c of pv.stack) {
        if (c.owner === 'h') expect(c.kind).not.toBeNull();
        else expect(c.kind).toBeNull();
      }
      if (pv.power && pv.id !== 'h' && !pv.power.revealed) expect(pv.power.kind).toBeNull();
    }
    // Snapshots don't alias the record.
    snap.players[0].name = 'mutated';
    expect(rec.players[0].name).toBe('Host');
  });
});

describe('setBot', () => {
  it('lets the host bot anyone and a player bot/unbot themselves', () => {
    let rec = startGame(lobby(), 'h', 9, T1);
    expectError(() => setBot(rec, 'p2', 'h', true, T1), 'forbidden');
    expectError(() => setBot(rec, 'h', 'b1', false, T1), 'forbidden');
    expectError(() => setBot(rec, 'h', 'nobody', true, T1), 'not_found');
    rec = setBot(rec, 'h', 'p2', true, T1);
    expect(rec.players.find((p) => p.id === 'p2')!.isBot).toBe(true);
    expect(rec.state!.players.find((p) => p.id === 'p2')!.isBot).toBe(true);
    // p2's setup was played by the bot straight away.
    expect(rec.state!.players.find((p) => p.id === 'p2')!.setupDone).toBe(true);
    rec = setBot(rec, 'p2', 'p2', false, T1);
    expect(rec.players.find((p) => p.id === 'p2')!.isBot).toBe(false);
    expect(rec.state!.players.find((p) => p.id === 'p2')!.isBot).toBe(false);
  });

  it('all humans away lets the bots finish the game', () => {
    let rec = startGame(lobby(), 'h', 11, T1);
    rec = setBot(rec, 'h', 'p2', true, T1);
    rec = setBot(rec, 'h', 'h', true, T1);
    expect(rec.status).toBe('finished');
  });

  it('works in the lobby', () => {
    const rec = setBot(lobby(), 'h', 'p2', true, T1);
    expect(rec.players[1].isBot).toBe(true);
    expect(rec.state).toBeNull();
  });
});

describe('leave', () => {
  it('in the lobby removes the player and hands host to the next human', () => {
    let rec = lobby();
    rec = joinPlayer(rec, { id: 'p4', name: 'Four' }, T0);
    const r1 = leave(rec, 'p2', T1)!;
    expect(r1.players.map((p) => p.id)).toEqual(['h', 'b1', 'p4']);
    expect(r1.players.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(r1.hostId).toBe('h');
    const r2 = leave(rec, 'h', T1)!;
    expect(r2.hostId).toBe('p2'); // next human clockwise, skipping bots
    expect(r2.players.map((p) => p.id)).toEqual(['p2', 'b1', 'p4']);
    expect(leave(leave(r2, 'p2', T1)!, 'p4', T1)).toBeNull();
    expectError(() => leave(r1, 'p2', T1), 'unauthorized');
  });

  it('during play turns the leaver into a bot and transfers host', () => {
    let rec = startGame(lobby(), 'h', 21, T1);
    rec = leave(rec, 'h', T1)!;
    expect(rec.hostId).toBe('p2');
    expect(rec.players.find((p) => p.id === 'h')!.isBot).toBe(true);
    expect(rec.state!.players.find((p) => p.id === 'h')!.isBot).toBe(true);
    expect(rec.status).toBe('playing');
    // The last human leaving deletes the game.
    expect(leave(rec, 'p2', T1)).toBeNull();
  });

  it('after the game marks the leaver as a bot', () => {
    let rec = startGame(lobby(), 'h', 4, T1);
    rec = setBot(rec, 'h', 'p2', true, T1);
    rec = setBot(rec, 'p2', 'p2', false, T1);
    rec = playOut(rec);
    expect(rec.status).toBe('finished');
    const left = leave(rec, 'h', T1)!;
    expect(left.status).toBe('finished');
    expect(left.hostId).toBe('p2');
    expect(rematch(left, 'p2', T1).players.find((p) => p.id === 'h')!.isBot).toBe(true);
  });
});
