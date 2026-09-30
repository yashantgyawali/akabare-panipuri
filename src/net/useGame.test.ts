import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerId } from '../engine/types.ts';
import { DEFAULT_CONFIG } from '../engine/types.ts';
import type { Snapshot } from '../server/types.ts';
import { LocalGameClient, type ChannelLike } from './local.ts';
import { createSessionStore, type SessionStore } from './session.ts';
import { ApiError, type GameClient, type Session } from './types.ts';
import { createGame, GameSync, type GameSyncOptions } from './useGame.ts';

// ---------------------------------------------------------------------------
// Shims
// ---------------------------------------------------------------------------

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as unknown as Storage;
}

function channelHub() {
  const endpoints = new Set<Set<(e: MessageEvent) => void>>();
  return (): ChannelLike => {
    const listeners = new Set<(e: MessageEvent) => void>();
    endpoints.add(listeners);
    return {
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

interface Tab {
  client: LocalGameClient;
  sessions: SessionStore;
  sync(code: string | null, opts?: GameSyncOptions): GameSync;
}

/** One browser: shared localStorage + channel; each tab has its own sessionStorage. */
function browser() {
  const local = memoryStorage();
  const hub = channelHub();
  const syncs: GameSync[] = [];
  const tab = (): Tab => {
    const tabStorage = memoryStorage();
    const client = new LocalGameClient({ storage: local, channel: hub(), locks: null, events: null, latency: [0, 2] });
    const sessions = createSessionStore(() => local, () => tabStorage);
    return {
      client,
      sessions,
      sync(code, opts = {}) {
        const s = new GameSync(client, code, { sessions, document: null, window: null, ...opts });
        syncs.push(s);
        return s;
      },
    };
  };
  return { local, tab, stopAll: () => syncs.forEach((s) => s.stop()) };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
});

function started(s: GameSync): GameSync {
  cleanup.push(s.start());
  return s;
}

/** A GameClient whose getSnapshot calls are resolved by hand. */
function fakeClient() {
  const calls: { resolve: (s: Snapshot) => void; reject: (e: unknown) => void }[] = [];
  let handlers: { onVersion: (v: number) => void; onPresence?: (ids: PlayerId[]) => void } | null = null;
  let subscribes = 0;
  let unsubscribes = 0;
  const mutation = { next: null as Snapshot | null, error: null as ApiError | null };
  const mutate = () =>
    mutation.error ? Promise.reject(mutation.error) : Promise.resolve(mutation.next as Snapshot);
  const client: GameClient = {
    mode: 'local',
    createGame: () => Promise.reject(new Error('unused')),
    joinGame: () => Promise.reject(new Error('unused')),
    getSnapshot: () => new Promise<Snapshot>((resolve, reject) => calls.push({ resolve, reject })),
    updateLobby: mutate,
    addBot: mutate,
    removePlayer: mutate,
    startGame: mutate,
    act: mutate,
    setBot: mutate,
    rematch: mutate,
    leave: () => Promise.resolve(),
    subscribe: (_code, _id, h) => {
      subscribes++;
      handlers = h;
      return () => {
        unsubscribes++;
        handlers = null;
      };
    },
  };
  return {
    client,
    calls,
    mutation,
    ping: (v: number) => handlers!.onVersion(v),
    presence: (ids: PlayerId[]) => handlers!.onPresence?.(ids),
    counts: () => ({ subscribes, unsubscribes }),
  };
}

const session: Session = { code: 'ABCDE', playerId: 'me', token: 't', name: 'Me' };
const snap = (version: number): Snapshot => ({
  code: 'ABCDE',
  status: 'lobby',
  hostId: 'me',
  version,
  config: DEFAULT_CONFIG,
  players: [{ id: 'me', name: 'Me', color: 'red', seat: 0, isBot: false }],
  youId: 'me',
  view: null,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSync(f: ReturnType<typeof fakeClient>, opts: GameSyncOptions = {}) {
  const sessions = createSessionStore(memoryStorage, (() => {
    const s = memoryStorage();
    return () => s;
  })());
  sessions.save(session);
  return { sessions, sync: new GameSync(f.client, 'abcde', { sessions, document: null, window: null, ...opts }) };
}

// ---------------------------------------------------------------------------

describe('GameSync with the local client (several tabs)', () => {
  it('host tab is ready instantly; a second tab is offered the session, then joins as someone new', async () => {
    const b = browser();
    const t1 = b.tab();
    const t2 = b.tab();
    const { session: host } = await createGame('Asha', undefined, t1.client, t1.sessions);
    expect(t1.sessions.load(host.code)?.fromOtherTab).toBe(false);

    const s1 = t1.sync(host.code.toLowerCase());
    expect(s1.getState()).toMatchObject({ status: 'ready', session: host, busy: false });
    expect(s1.getState().snapshot?.players).toHaveLength(1);
    started(s1);

    const s2 = started(t2.sync(host.code));
    expect(s2.getState()).toMatchObject({ status: 'needsJoin', session: null, suggestedSession: host });

    const joining = s2.actions.join('Bina');
    expect(s2.getState().busy).toBe(true);
    expect(await joining).toBe(true);
    const st2 = s2.getState();
    expect(st2).toMatchObject({ status: 'ready', busy: false, suggestedSession: null });
    expect(st2.session?.name).toBe('Bina');
    expect(t2.sessions.load(host.code)).toMatchObject({ fromOtherTab: false, session: st2.session });

    // Tab 1 hears the version ping and refetches; presence shows both.
    await vi.waitFor(() => expect(s1.getState().snapshot?.players).toHaveLength(2));
    await vi.waitFor(() => expect(s1.getState().online.sort()).toEqual([host.playerId, st2.session!.playerId].sort()));
    expect(s1.getState().online).toContain(host.playerId);

    // A third tab continues as the suggested (latest) session.
    const t3 = b.tab();
    const s3 = started(t3.sync(host.code));
    expect(s3.getState().suggestedSession).toEqual(st2.session);
    s3.actions.continueAs(s3.getState().suggestedSession!);
    expect(s3.getState().status).toBe('loading');
    await vi.waitFor(() => expect(s3.getState().status).toBe('ready'));
    expect(s3.getState().snapshot?.youId).toBe(st2.session!.playerId);
    expect(t3.sessions.load(host.code)?.fromOtherTab).toBe(false);
  });

  it('mutations apply their snapshot; failures set actionError, never throw, and keep the game', async () => {
    const b = browser();
    const t1 = b.tab();
    const t2 = b.tab();
    const { session: host } = await createGame('Asha', undefined, t1.client, t1.sessions);
    const s1 = started(t1.sync(host.code));
    const s2 = started(t2.sync(host.code));
    await s2.actions.join('Bina');

    const v = s1.getState().snapshot!.version;
    expect(await s1.actions.addBot()).toBe(true);
    expect(s1.getState().snapshot!.version).toBeGreaterThan(v);
    expect(s1.getState().snapshot!.players).toHaveLength(3);

    expect(await s2.actions.start()).toBe(false);
    expect(s2.getState()).toMatchObject({ status: 'ready', actionError: { code: 'forbidden' } });
    s2.actions.clearActionError();
    expect(s2.getState().actionError).toBeNull();

    // A target that is gone is not "game not found".
    expect(await s1.actions.removePlayer('nobody')).toBe(false);
    expect(s1.getState()).toMatchObject({ status: 'ready', actionError: { code: 'bad_request' } });
    expect(await s1.actions.updateLobby({ config: { maxRounds: 3 } })).toBe(true);
    expect(s1.getState().actionError).toBeNull();
    expect(s1.getState().snapshot!.config.maxRounds).toBe(3);

    expect(await s1.actions.start()).toBe(true);
    expect(s1.getState().snapshot!.status).toBe('playing');
    expect(await s1.actions.act({ type: 'PASS' })).toBe(false);
    expect(s1.getState().actionError?.code).toBe('illegal_action');
    await vi.waitFor(() => expect(s2.getState().snapshot?.status).toBe('playing'));
  });

  it('a kicked player drops to needsJoin and forgets the session', async () => {
    const b = browser();
    const t1 = b.tab();
    const t2 = b.tab();
    const { session: host } = await createGame('Asha', undefined, t1.client, t1.sessions);
    const s1 = started(t1.sync(host.code));
    const s2 = started(t2.sync(host.code));
    await s2.actions.join('Bina');
    const guest = s2.getState().session!;

    await s1.actions.removePlayer(guest.playerId);
    await vi.waitFor(() => expect(s2.getState().status).toBe('needsJoin'));
    expect(s2.getState()).toMatchObject({ session: null, snapshot: null, actionError: { code: 'unauthorized' } });
    // Bina saved last, so both her tab session and the browser-wide default are gone.
    expect(t2.sessions.load(host.code)).toBeNull();
    expect(s2.getState().suggestedSession).toBeNull();
  });

  it('leave forgets the session; a deleted game becomes an error for anyone still holding it', async () => {
    const b = browser();
    const t1 = b.tab();
    const t2 = b.tab();
    const { session: host } = await createGame('Asha', undefined, t1.client, t1.sessions);
    const s1 = started(t1.sync(host.code));
    const s2 = started(t2.sync(host.code));
    await s2.actions.join('Bina');
    const guest = s2.getState().session!;

    expect(await s2.actions.leave()).toBe(true);
    expect(s2.getState()).toMatchObject({ status: 'needsJoin', session: null, suggestedSession: null });
    expect(t2.sessions.load(host.code)).toBeNull();
    await expect(t2.client.getSnapshot(guest)).rejects.toMatchObject({ code: 'unauthorized' });
    await vi.waitFor(() => expect(s1.getState().snapshot?.players).toHaveLength(1));

    // The game disappears underneath tab 1 (e.g. pruned): the next ping/fetch says not_found.
    b.local.removeItem(`akabare:local:game:${host.code}`);
    s1.actions.refresh();
    await vi.waitFor(() => expect(s1.getState()).toMatchObject({ status: 'error', errorCode: 'not_found' }));
    s1.actions.refresh();
    expect(s1.getState().status).toBe('loading');
    await vi.waitFor(() => expect(s1.getState().status).toBe('error'));
  });

  it('a session for a game that does not exist is an error; no code is idle', async () => {
    const b = browser();
    const t = b.tab();
    t.sessions.save({ code: 'ZZZZZ', playerId: 'x', token: 'y', name: 'X' });
    const s = started(t.sync('ZZZZZ'));
    expect(s.getState().status).toBe('loading');
    await vi.waitFor(() => expect(s.getState()).toMatchObject({ status: 'error', errorCode: 'not_found' }));
    const join = started(t.sync('QQQQQ'));
    expect(await join.actions.join('X')).toBe(false);
    expect(join.getState()).toMatchObject({ status: 'error', errorCode: 'not_found' });
    expect(t.sync(null).getState().status).toBe('idle');
    expect(t.sync('  ').getState().status).toBe('idle');
  });

  it('join errors (color taken, bad name) stay on the join screen', async () => {
    const b = browser();
    const t1 = b.tab();
    const { session: host } = await createGame('Asha', 'red', t1.client, t1.sessions);
    const s = started(b.tab().sync(host.code));
    expect(await s.actions.join('Bina', 'red')).toBe(false);
    expect(s.getState()).toMatchObject({ status: 'needsJoin', actionError: { code: 'color_taken' } });
    expect(await s.actions.join('  ')).toBe(false);
    expect(s.getState().actionError?.code).toBe('bad_request');
  });
});

describe('GameSync fetching', () => {
  it('coalesces refetches and ignores out-of-order responses', async () => {
    const f = fakeClient();
    const { sync } = fakeSync(f);
    expect(sync.getState().status).toBe('loading');
    started(sync);
    expect(f.calls).toHaveLength(1);

    f.ping(5);
    f.ping(6);
    f.ping(7);
    expect(f.calls).toHaveLength(1); // coalesced while in flight

    f.calls[0].resolve(snap(3));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'ready', snapshot: { version: 3 } });
    expect(f.calls).toHaveLength(2); // exactly one follow-up
    f.calls[1].resolve(snap(7));
    await flush();
    expect(sync.getState().snapshot?.version).toBe(7);
    expect(f.calls).toHaveLength(2);

    // A mutation that returns an older snapshot does not roll the view back.
    f.mutation.next = snap(6);
    expect(await sync.actions.addBot()).toBe(true);
    expect(sync.getState().snapshot?.version).toBe(7);
    f.mutation.next = snap(9);
    await sync.actions.addBot();
    expect(sync.getState().snapshot?.version).toBe(9);

    f.ping(8); // older than what we show: no fetch
    f.ping(9);
    expect(f.calls).toHaveLength(2);
    f.ping(10);
    expect(f.calls).toHaveLength(3);
    f.calls[2].resolve(snap(8)); // stale response
    await flush();
    expect(sync.getState().snapshot?.version).toBe(9);
  });

  it('transient errors keep the snapshot; an initial failure shows and refresh recovers', async () => {
    const f = fakeClient();
    const { sync } = fakeSync(f);
    started(sync);
    f.calls[0].reject(new ApiError('internal', 'offline'));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'error', error: 'offline', errorCode: 'internal' });

    sync.actions.refresh();
    expect(sync.getState()).toMatchObject({ status: 'loading', error: null });
    f.calls[1].resolve(snap(4));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'ready', snapshot: { version: 4 } });

    f.ping(5);
    f.calls[2].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'ready', snapshot: { version: 4 }, error: null });
  });

  it('unauthorized on fetch clears the session', async () => {
    const f = fakeClient();
    const { sync, sessions } = fakeSync(f);
    started(sync);
    f.calls[0].reject(new ApiError('unauthorized', 'gone'));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'needsJoin', session: null, actionError: { code: 'unauthorized' } });
    expect(sessions.load('ABCDE')).toBeNull();
    expect(f.counts()).toEqual({ subscribes: 1, unsubscribes: 1 });
  });

  it('a failed mutation refetches so a stale view catches up', async () => {
    const f = fakeClient();
    const { sync } = fakeSync(f);
    started(sync);
    f.calls[0].resolve(snap(2));
    await flush();
    f.mutation.error = new ApiError('illegal_action', 'Not your turn.');
    expect(await sync.actions.act({ type: 'PASS' })).toBe(false);
    expect(sync.getState().actionError).toEqual({ code: 'illegal_action', message: 'Not your turn.' });
    expect(f.calls).toHaveLength(2);
    f.mutation.error = new ApiError('not_found', 'The game is gone.');
    await sync.actions.act({ type: 'PASS' });
    f.calls[1].reject(new ApiError('not_found', 'The game is gone.'));
    await flush();
    expect(sync.getState()).toMatchObject({ status: 'error', errorCode: 'not_found' });
  });

  it('forwards presence, polls, and restarts cleanly (StrictMode)', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeClient();
      const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
      const win = new EventTarget();
      const { sync } = fakeSync(f, { pollMs: 1000, document: doc, window: win });
      let settled = 0;
      /** Resolves every outstanding fetch (including coalesced follow-ups); returns how many ran. */
      const drain = async () => {
        const start = settled;
        while (settled < f.calls.length) {
          f.calls[settled++].resolve(snap(1));
          await vi.advanceTimersByTimeAsync(0);
        }
        return settled - start;
      };

      const stop = sync.start();
      stop();
      sync.start();
      expect(f.counts()).toEqual({ subscribes: 2, unsubscribes: 1 });
      expect(await drain()).toBe(2); // the restart's fetch coalesced into one follow-up
      expect(sync.getState().status).toBe('ready');

      f.presence(['me', 'you']);
      expect(sync.getState().online).toEqual(['me', 'you']);

      await vi.advanceTimersByTimeAsync(1000);
      expect(await drain()).toBe(1); // poll

      doc.dispatchEvent(new Event('visibilitychange'));
      expect(await drain()).toBe(1);
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(await drain()).toBe(0);
      win.dispatchEvent(new Event('online'));
      expect(await drain()).toBe(1);

      sync.stop();
      expect(f.counts()).toEqual({ subscribes: 2, unsubscribes: 2 });
      await vi.advanceTimersByTimeAsync(5000);
      win.dispatchEvent(new Event('online'));
      expect(await drain()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies listeners and keeps getState() stable between changes', async () => {
    const f = fakeClient();
    const { sync } = fakeSync(f);
    const seen: string[] = [];
    const off = sync.subscribe(() => seen.push(sync.getState().status));
    const before = sync.getState();
    expect(sync.getState()).toBe(before);
    started(sync);
    f.calls[0].resolve(snap(1));
    await flush();
    expect(seen).toContain('ready');
    off();
    const count = seen.length;
    f.ping(2);
    f.calls[1].resolve(snap(2));
    await flush();
    expect(seen).toHaveLength(count);
  });
});
