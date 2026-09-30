import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action, PlayerView } from '../engine/index.ts';
import { hashToken } from '../server/crypto.ts';
import type { GameRecord, ServerErrorCode } from '../server/types.ts';
import { LOCAL_CHANNEL, LocalGameClient, type ChannelLike, type LocalDeps, type LocalMessage } from './local.ts';
import { ApiError } from './types.ts';

// ---------------------------------------------------------------------------
// Shims: in-memory Storage, a BroadcastChannel hub (one endpoint per "tab"),
// and a lock manager that records names and serializes callbacks.
// ---------------------------------------------------------------------------

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  const s = {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
  return s as unknown as Storage;
}

function channelHub() {
  const endpoints = new Set<Set<(e: MessageEvent) => void>>();
  return (): ChannelLike => {
    const listeners = new Set<(e: MessageEvent) => void>();
    endpoints.add(listeners);
    return {
      // Like BroadcastChannel: async, structured-cloned, never delivered to the sender.
      postMessage(message) {
        const data = structuredClone(message);
        for (const other of endpoints) {
          if (other !== listeners) setTimeout(() => other.forEach((fn) => fn({ data } as MessageEvent)), 0);
        }
      },
      addEventListener: (_t, fn) => void listeners.add(fn),
      removeEventListener: (_t, fn) => void listeners.delete(fn),
    };
  };
}

function recordingLocks() {
  const names: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const locks = {
    request<T>(name: string, cb: () => T): Promise<T> {
      names.push(name);
      const run = chain.then(() => cb());
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return { names, locks: locks as unknown as LockManager };
}

interface World {
  storage: Storage;
  tab(overrides?: LocalDeps): LocalGameClient;
}

function world(base: LocalDeps = {}): World {
  const storage = memoryStorage();
  const hub = channelHub();
  return {
    storage,
    tab: (overrides = {}) =>
      new LocalGameClient({ storage, channel: hub(), locks: null, events: null, latency: [0, 0], ...base, ...overrides }),
  };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

async function expectApiError(p: Promise<unknown>, code: ServerErrorCode): Promise<void> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).code).toBe(code);
}

function pickLegal(view: PlayerView, i: number): Action | null {
  const l = view.legal;
  if (l.setup && !l.setup.submitted) {
    return { type: 'SUBMIT_SETUP', stack: Array(l.setup.stackSize).fill('panipuri'), power: l.setup.availablePowers[0] };
  }
  if (l.place && i % 2 === 0) return { type: 'PLACE_PURI', kind: l.place.kinds[0], targetPlayerId: l.place.targets[0] };
  if (l.startBid) return { type: 'START_BID', amount: l.startBid.min };
  if (l.pass) return { type: 'PASS' };
  if (l.flipPuri.length) return { type: 'FLIP_PURI', targetPlayerId: l.flipPuri[0] };
  if (l.flipPower.length) return { type: 'FLIP_POWER', targetPlayerId: l.flipPower[0] };
  if (l.acceptBust) return { type: 'ACCEPT_BUST' };
  if (l.ready) return { type: 'READY' };
  return null;
}

const readRecord = (storage: Storage, code: string) =>
  JSON.parse(storage.getItem(`akabare:local:game:${code}`) ?? 'null') as GameRecord | null;
const readTokens = (storage: Storage, code: string) =>
  JSON.parse(storage.getItem(`akabare:local:tokens:${code}`) ?? 'null') as Record<string, string> | null;

const unsubs: (() => void)[] = [];
afterEach(() => {
  unsubs.splice(0).forEach((u) => u());
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('LocalGameClient', () => {
  it('creates, joins and starts a game; persists only token hashes', async () => {
    const w = world();
    const a = w.tab();
    const b = w.tab();
    expect(a.mode).toBe('local');

    const created = await a.createGame(' Asha ');
    const { session: host, snapshot } = created;
    expect(host.name).toBe('Asha');
    expect(host.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(snapshot).toMatchObject({ code: host.code, status: 'lobby', hostId: host.playerId, youId: host.playerId, view: null });

    const tokens = readTokens(w.storage, host.code)!;
    expect(tokens).toEqual({ [await hashToken(host.token)]: host.playerId });
    for (let i = 0; i < w.storage.length; i++) {
      expect(w.storage.getItem(w.storage.key(i)!)).not.toContain(host.token);
    }

    const joined = await b.joinGame(host.code.toLowerCase(), 'Bina', 'green');
    expect(joined.session.code).toBe(host.code);
    expect(joined.snapshot.players.map((p) => [p.name, p.color])).toEqual([
      ['Asha', 'red'],
      ['Bina', 'green'],
    ]);
    expect((await a.getSnapshot(host)).players).toHaveLength(2);

    const withBot = await a.addBot(host);
    expect(withBot.players[2].isBot).toBe(true);
    expect(withBot.version).toBe(joined.snapshot.version + 1);
    const started = await a.startGame(host);
    expect(started.status).toBe('playing');
    expect(started.view?.phase).toBe('setup');
    expect(started).not.toHaveProperty('state');
    expect(readRecord(w.storage, host.code)!.state).not.toBeNull();
  });

  it('rejects with ApiError codes from the server core', async () => {
    const w = world();
    const a = w.tab();
    const b = w.tab();
    const { session: host } = await a.createGame('Asha');
    const { session: guest } = await b.joinGame(host.code, 'Bina');

    await expectApiError(a.joinGame('ZZZZZ', 'X'), 'not_found');
    await expectApiError(a.joinGame('no!', 'X'), 'not_found');
    await expectApiError(a.joinGame(host.code, '   '), 'bad_request');
    await expectApiError(a.joinGame(host.code, 'X', 'red'), 'color_taken');
    await expectApiError(a.getSnapshot({ ...host, token: 'forged' }), 'unauthorized');
    await expectApiError(a.getSnapshot({ ...guest, token: host.token }), 'unauthorized');
    await expectApiError(b.startGame(guest), 'forbidden');
    await expectApiError(a.startGame(host), 'bad_request'); // only 2 players
    await expectApiError(a.act(host, { type: 'PASS' }), 'wrong_status');
    await expectApiError(a.removePlayer(host, 'nobody'), 'bad_request');

    // A kicked player's token stops working.
    await a.removePlayer(host, guest.playerId);
    await expectApiError(b.getSnapshot(guest), 'unauthorized');
    expect(Object.values(readTokens(w.storage, host.code)!)).toEqual([host.playerId]);
  });

  it('reports corrupted or unavailable storage as internal errors', async () => {
    const w = world();
    const a = w.tab();
    const { session } = await a.createGame('Asha');
    w.storage.setItem(`akabare:local:game:${session.code}`, '{nope');
    await expectApiError(a.getSnapshot(session), 'internal');
    await expectApiError(w.tab({ storage: null }).createGame('X'), 'internal');
  });

  it('plays a whole game with one human and three bots', async () => {
    const a = world().tab();
    const { session } = await a.createGame('Asha');
    for (let i = 0; i < 3; i++) await a.addBot(session);
    let snap = await a.startGame(session);
    for (let i = 0; i < 2000 && snap.status === 'playing'; i++) {
      const action = pickLegal(snap.view!, i);
      expect(action).not.toBeNull();
      const next = await a.act(session, action!);
      expect(next.version).toBeGreaterThan(snap.version);
      snap = next;
    }
    expect(snap.status).toBe('finished');
    expect(snap.view!.phase).toBe('gameOver');
    const again = await a.rematch(session);
    expect(again).toMatchObject({ status: 'lobby', view: null });
  });

  it('leave: host hands over in the lobby; the last human deletes the game', async () => {
    const w = world();
    const a = w.tab();
    const b = w.tab();
    const { session: host } = await a.createGame('Asha');
    const { session: guest } = await b.joinGame(host.code, 'Bina');
    await a.addBot(host);

    await a.leave(host);
    const snap = await b.getSnapshot(guest);
    expect(snap.hostId).toBe(guest.playerId);
    expect(snap.players.map((p) => p.name)).toEqual(['Bina', 'Sita']);
    await expectApiError(a.getSnapshot(host), 'unauthorized');

    await tick(); // let earlier pings pass
    const pings: number[] = [];
    unsubs.push(a.subscribe(host.code, 'watcher', { onVersion: (v) => pings.push(v) }));
    await b.leave(guest);
    expect(readRecord(w.storage, host.code)).toBeNull();
    expect(readTokens(w.storage, host.code)).toBeNull();
    await expectApiError(b.getSnapshot(guest), 'not_found');
    await tick();
    expect(pings).toEqual([snap.version + 1]);
  });

  it('pings every tab (and same-tab subscribers) with the new version', async () => {
    const w = world();
    const a = w.tab();
    const b = w.tab();
    const { session: host } = await a.createGame('Asha');
    await tick(); // let the creation ping pass
    const seenA: number[] = [];
    const seenB: number[] = [];
    unsubs.push(a.subscribe(host.code, host.playerId, { onVersion: (v) => seenA.push(v) }));
    unsubs.push(b.subscribe(host.code.toLowerCase(), 'someone', { onVersion: (v) => seenB.push(v) }));
    const other: number[] = [];
    unsubs.push(b.subscribe('QQQQQ', 'someone', { onVersion: (v) => other.push(v) }));

    const s1 = await a.addBot(host);
    const s2 = await a.addBot(host);
    await tick();
    expect(seenA).toEqual([s1.version, s2.version]);
    expect(seenB).toEqual([s1.version, s2.version]);
    expect(other).toEqual([]);
  });

  it('tracks presence with heartbeats, includes self, and drops on bye or silence', async () => {
    const hub = channelHub();
    const storage = memoryStorage();
    const opts: LocalDeps = { storage, locks: null, events: null, latency: [0, 0], heartbeatMs: 20, onlineMs: 80 };
    const a = new LocalGameClient({ ...opts, channel: hub() });
    const b = new LocalGameClient({ ...opts, channel: hub() });
    const raw = hub();
    const code = 'ABCDE';
    let onlineA: string[] = [];
    let onlineB: string[] = [];
    unsubs.push(a.subscribe(code, 'pa', { onVersion: () => {}, onPresence: (ids) => (onlineA = ids) }));
    const stopB = b.subscribe(code, 'pb', { onVersion: () => {}, onPresence: (ids) => (onlineB = ids) });

    await vi.waitFor(() => {
      expect(onlineA).toEqual(['pa', 'pb']);
      expect(onlineB).toEqual(['pa', 'pb']);
    });

    stopB(); // says bye
    await vi.waitFor(() => expect(onlineA).toEqual(['pa']));

    // A tab that goes silent without a bye (crash, sleep) drops after onlineMs.
    const beat: LocalMessage = { type: 'presence', code, playerId: 'ghost', t: Date.now() };
    raw.postMessage(beat);
    await vi.waitFor(() => expect(onlineA).toEqual(['ghost', 'pa']));
    await vi.waitFor(() => expect(onlineA).toEqual(['pa']), { timeout: 1000 });

    // Other games' presence is ignored.
    raw.postMessage({ ...beat, code: 'OTHER' });
    await tick(30);
    expect(onlineA).toEqual(['pa']);
  });

  it('falls back to storage events when there is no BroadcastChannel', async () => {
    const w = world({ channel: null });
    const events = new EventTarget();
    const b = w.tab({ events });
    const seen: number[] = [];
    unsubs.push(b.subscribe('ABCDE', 'p', { onVersion: (v) => seen.push(v) }));
    const storageEvent = (key: string, newValue: string | null, oldValue: string | null) =>
      Object.assign(new Event('storage'), { key, newValue, oldValue, storageArea: w.storage });
    events.dispatchEvent(storageEvent('akabare:local:game:ABCDE', JSON.stringify({ version: 7 }), null));
    events.dispatchEvent(storageEvent('akabare:local:game:OTHER', JSON.stringify({ version: 9 }), null));
    events.dispatchEvent(storageEvent('akabare:local:game:ABCDE', null, JSON.stringify({ version: 7 }))); // deleted
    expect(seen).toEqual([7, 8]);
  });

  it('serializes mutations per game with navigator.locks when available', async () => {
    const { names, locks } = recordingLocks();
    const w = world({ locks });
    const a = w.tab();
    const b = w.tab();
    const { session: host } = await a.createGame('Asha');
    await b.joinGame(host.code, 'Bina');
    await Promise.all([a.addBot(host), a.addBot(host), a.updateLobby(host, { name: 'Asha D' })]);
    expect(names).toHaveLength(5);
    expect(new Set(names)).toEqual(new Set([`akabare:${host.code}`]));
    const rec = readRecord(w.storage, host.code)!;
    expect(rec.players).toHaveLength(4);
    expect(rec.version).toBe(5);
    // A failing op inside the lock rejects and releases it.
    await expectApiError(a.updateLobby(host, { color: 'blue' }), 'color_taken');
    expect((await a.addBot(host)).version).toBe(6);
  });

  it('queues concurrent mutations within a tab when navigator.locks is missing', async () => {
    const a = world({ latency: [0, 3] }).tab();
    const { session } = await a.createGame('Asha');
    const snaps = await Promise.all([1, 2, 3, 4].map(() => a.addBot(session)));
    expect(snaps.map((s) => s.version).sort()).toEqual([2, 3, 4, 5]);
    expect((await a.getSnapshot(session)).players).toHaveLength(5);
  });

  it('uses the real navigator.locks by default when the runtime has it', async () => {
    const storage = memoryStorage();
    const a = new LocalGameClient({ storage, channel: null, events: null, latency: [0, 0] });
    const { session } = await a.createGame('Asha');
    await Promise.all([a.addBot(session), a.addBot(session)]);
    expect(readRecord(storage, session.code)!.players).toHaveLength(3);
  });

  it('adds artificial latency by default', async () => {
    const a = new LocalGameClient({ storage: memoryStorage(), channel: null, locks: null, events: null });
    const t0 = performance.now();
    await a.createGame('Asha');
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('prunes games untouched for 3 days when creating a game', async () => {
    const w = world();
    const a = w.tab();
    const { session: fresh } = await a.createGame('Fresh');
    const old: GameRecord = { ...readRecord(w.storage, fresh.code)!, code: 'OLDGM', updatedAt: '2000-01-01T00:00:00.000Z' };
    w.storage.setItem('akabare:local:game:OLDGM', JSON.stringify(old));
    w.storage.setItem('akabare:local:tokens:OLDGM', '{}');
    w.storage.setItem('akabare:local:game:JUNKK', 'not json');
    w.storage.setItem('unrelated', 'keep');
    await a.createGame('Newer');
    expect(w.storage.getItem('akabare:local:game:OLDGM')).toBeNull();
    expect(w.storage.getItem('akabare:local:tokens:OLDGM')).toBeNull();
    expect(w.storage.getItem('akabare:local:game:JUNKK')).toBeNull();
    expect(w.storage.getItem('unrelated')).toBe('keep');
    expect(readRecord(w.storage, fresh.code)).not.toBeNull();
  });

  it('uses the akabare-local BroadcastChannel by default', () => {
    expect(LOCAL_CHANNEL).toBe('akabare-local');
    const posted: unknown[] = [];
    const Original = globalThis.BroadcastChannel;
    class FakeChannel {
      constructor(readonly name: string) {
        posted.push(name);
      }
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    try {
      new LocalGameClient({ storage: memoryStorage() });
      expect(posted).toEqual(['akabare-local']);
    } finally {
      vi.stubGlobal('BroadcastChannel', Original);
      vi.unstubAllGlobals();
    }
  });
});
