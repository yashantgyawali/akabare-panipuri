import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelName } from '../server/types.ts';
import {
  SupabaseGameClient,
  parseEnvelope,
  presenceIds,
  versionOf,
  type ChannelLike,
  type RealtimeLike,
} from './supabase.ts';
import { ApiError, type Session } from './types.ts';

const URL_ = 'https://example.supabase.co/';
const KEY = 'anon-key';
const session: Session = { code: 'abcde', playerId: 'p1', token: 'tok', name: 'Asha' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function clientWith(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  const client = new SupabaseGameClient(URL_, KEY, { fetch: fetchMock as unknown as typeof fetch });
  return { client, fetchMock };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected a rejection');
}

describe('SupabaseGameClient HTTP', () => {
  it('posts the op with the anon key and returns data', async () => {
    const snap = { code: 'ABCDE', version: 3 };
    const { client, fetchMock } = clientWith(async () => jsonResponse(200, { ok: true, data: snap }));
    await expect(client.act(session, { type: 'PASS' })).resolves.toEqual(snap);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/functions/v1/game');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}` });
    expect(JSON.parse(init.body as string)).toEqual({ op: 'act', code: 'ABCDE', token: 'tok', action: { type: 'PASS' } });
  });

  it('builds a session from create/join results', async () => {
    const snapshot = { code: 'QWERT', players: [{ id: 'me', name: 'Asha' }] };
    const { client, fetchMock } = clientWith(async () =>
      jsonResponse(200, { ok: true, data: { playerId: 'me', token: 'secret', snapshot } }),
    );
    const res = await client.joinGame(' qwert ', 'Asha', 'red');
    expect(res.session).toEqual({ code: 'QWERT', playerId: 'me', token: 'secret', name: 'Asha' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      op: 'join',
      code: 'QWERT',
      name: 'Asha',
      color: 'red',
    });
  });

  it('maps error envelopes (any HTTP status) to ApiError codes', async () => {
    const { client } = clientWith(async () =>
      jsonResponse(401, { ok: false, error: { code: 'unauthorized', message: 'No longer valid.' } }),
    );
    const err = await rejection(client.getSnapshot(session));
    expect(err.code).toBe('unauthorized');
    expect(err.message).toBe('No longer valid.');
  });

  it('never turns gateway errors into session or game errors', async () => {
    for (const [status, body] of [
      [401, { code: 401, message: 'Invalid JWT' }],
      [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }],
      [502, '<html>bad gateway</html>'],
    ] as const) {
      const { client } = clientWith(async () => jsonResponse(status, body));
      const err = await rejection(client.getSnapshot(session));
      expect(err.code).toBe('internal');
      expect(err.message).toContain(`HTTP ${status}`);
    }
  });

  it('reports network failures and timeouts as internal', async () => {
    const { client } = clientWith(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await rejection(client.addBot(session))).code).toBe('internal');

    const slow = new SupabaseGameClient(URL_, KEY, {
      timeoutMs: 5,
      fetch: ((_: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch,
    });
    const err = await rejection(slow.startGame(session));
    expect(err.code).toBe('internal');
    expect(err.message).toMatch(/too long/);
  });

  it('parses envelopes defensively', () => {
    expect(parseEnvelope(200, '{"ok":true,"data":null}')).toBeNull();
    expect(() => parseEnvelope(409, '{"ok":false,"error":{"code":"weird","message":"x"}}')).toThrow(ApiError);
    try {
      parseEnvelope(409, '{"ok":false,"error":{"code":"weird","message":"x"}}');
    } catch (e) {
      expect((e as ApiError).code).toBe('internal');
    }
  });
});

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

class FakeChannel implements ChannelLike {
  broadcast: Array<{ event: string; cb: (m: { payload?: unknown }) => void }> = [];
  sync: Array<() => void> = [];
  status: ((s: string) => void) | null = null;
  tracked: unknown[] = [];
  state: Record<string, unknown[]> = {};
  constructor(
    readonly topic: string,
    readonly options: { config: Record<string, unknown> },
  ) {}
  on(type: string, filter: { event: string }, cb: (...args: never[]) => void): ChannelLike {
    if (type === 'broadcast') this.broadcast.push({ event: filter.event, cb: cb as never });
    else this.sync.push(cb as never);
    return this;
  }
  subscribe(cb: (status: string) => void): ChannelLike {
    this.status = cb;
    return this;
  }
  track(payload: Record<string, unknown>): Promise<unknown> {
    this.tracked.push(payload);
    return Promise.resolve('ok');
  }
  presenceState(): Record<string, unknown[]> {
    return this.state;
  }
  send(event: string, payload: unknown) {
    for (const b of this.broadcast) if (b.event === event) b.cb({ payload });
  }
  setPresence(state: Record<string, unknown[]>) {
    this.state = state;
    for (const s of this.sync) s();
  }
}

class FakeRealtime implements RealtimeLike {
  channels: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  channel(topic: string, options: { config: Record<string, unknown> }): ChannelLike {
    const c = new FakeChannel(topic, options);
    this.channels.push(c);
    return c;
  }
  removeChannel(channel: ChannelLike): Promise<unknown> {
    this.removed.push(channel as FakeChannel);
    return Promise.resolve('ok');
  }
  get last(): FakeChannel {
    return this.channels[this.channels.length - 1];
  }
}

describe('SupabaseGameClient.subscribe', () => {
  let realtime: FakeRealtime;
  let client: SupabaseGameClient;
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    realtime = new FakeRealtime();
    client = new SupabaseGameClient(URL_, KEY, { realtime, retryMinMs: 100, retryMaxMs: 400, idleCloseMs: 50 });
  });
  afterEach(() => vi.useRealTimers());

  it('opens a public channel, tracks presence and forwards version pings', async () => {
    const onVersion = vi.fn();
    const onPresence = vi.fn();
    client.subscribe('abcde', 'p1', { onVersion, onPresence });
    await flush();
    const ch = realtime.last;
    expect(ch.topic).toBe(channelName('ABCDE'));
    expect(ch.options.config).toMatchObject({ private: false, presence: { key: 'p1' } });
    expect(ch.broadcast.map((b) => b.event)).toEqual(['update']);

    ch.status!('SUBSCRIBED');
    expect(ch.tracked).toEqual([{ playerId: 'p1' }]);
    expect(onPresence).toHaveBeenLastCalledWith(['p1']);

    ch.send('update', { version: 7, status: 'playing' });
    ch.send('update', { nope: true });
    expect(onVersion.mock.calls).toEqual([[7]]);

    ch.setPresence({ p2: [{ playerId: 'p2' }, { playerId: 'p2' }], p1: [{ playerId: 'p1' }], x: [{}] });
    expect(onPresence).toHaveBeenLastCalledWith(['p1', 'p2']);
    const calls = onPresence.mock.calls.length;
    ch.setPresence({ p2: [{ playerId: 'p2' }], p1: [{ playerId: 'p1' }] });
    expect(onPresence.mock.calls.length).toBe(calls); // unchanged set → no callback
  });

  it('shares one channel per code and closes it after the last unsubscribe', async () => {
    const a = client.subscribe('ABCDE', 'p1', { onVersion: vi.fn() });
    const onVersionB = vi.fn();
    const b = client.subscribe('ABCDE', 'p1', { onVersion: onVersionB });
    await flush();
    expect(realtime.channels).toHaveLength(1);
    realtime.last.status!('SUBSCRIBED');
    a();
    a(); // idempotent
    realtime.last.send('update', { version: 2 });
    expect(onVersionB).toHaveBeenCalledWith(2);
    b();
    await vi.advanceTimersByTimeAsync(60);
    expect(realtime.removed).toEqual([realtime.channels[0]]);
  });

  it('reuses the channel when resubscribed within the idle grace period', async () => {
    const off = client.subscribe('ABCDE', 'p1', { onVersion: vi.fn() });
    await flush();
    realtime.last.status!('SUBSCRIBED');
    off();
    const onVersion = vi.fn();
    client.subscribe('ABCDE', 'p1', { onVersion });
    await vi.advanceTimersByTimeAsync(100);
    expect(realtime.channels).toHaveLength(1);
    expect(realtime.removed).toHaveLength(0);
    realtime.last.send('update', { version: 5 });
    expect(onVersion).toHaveBeenCalledWith(5);
  });

  it('rebuilds the channel with backoff after errors, ignoring the old channel', async () => {
    const onVersion = vi.fn();
    client.subscribe('ABCDE', 'p1', { onVersion });
    await flush();
    const first = realtime.last;
    first.status!('CHANNEL_ERROR');
    first.status!('TIMED_OUT'); // one retry pending at a time
    await vi.advanceTimersByTimeAsync(110);
    expect(realtime.removed).toEqual([first]);
    expect(realtime.channels).toHaveLength(2);
    first.send('update', { version: 9 }); // stale channel
    expect(onVersion).not.toHaveBeenCalled();

    const second = realtime.last;
    second.status!('SUBSCRIBED');
    expect(second.tracked).toEqual([{ playerId: 'p1' }]);
    second.send('update', { version: 10 });
    expect(onVersion).toHaveBeenCalledWith(10);
  });

  it('cancels the retry when supabase-js rejoins on its own', async () => {
    client.subscribe('ABCDE', 'p1', { onVersion: vi.fn() });
    await flush();
    const ch = realtime.last;
    ch.status!('CHANNEL_ERROR');
    ch.status!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(1000);
    expect(realtime.channels).toHaveLength(1);
    expect(realtime.removed).toHaveLength(0);
  });

  it('stops retrying once unsubscribed', async () => {
    const off = client.subscribe('ABCDE', 'p1', { onVersion: vi.fn() });
    await flush();
    realtime.last.status!('CHANNEL_ERROR');
    off();
    await vi.advanceTimersByTimeAsync(2000);
    expect(realtime.channels).toHaveLength(1);
    expect(realtime.removed).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('reads versions and presence ids defensively', () => {
    expect(versionOf({ payload: { version: 4 } })).toBe(4);
    expect(versionOf({ payload: { payload: { version: 5 } } })).toBe(5);
    expect(versionOf({ payload: { version: '4' } })).toBeNull();
    expect(versionOf(null)).toBeNull();
    expect(presenceIds({ a: [{ playerId: 'x' }, null], b: [{ playerId: 'y' }, { playerId: 'x' }] }).sort()).toEqual([
      'x',
      'y',
    ]);
  });
});
