/**
 * SupabaseGameClient: the `game` edge function over HTTP, plus Realtime for
 * version pings (public broadcast from a DB trigger) and presence.
 *
 * - Calls use fetch against /functions/v1/game so error envelopes are always
 *   readable (functions.invoke hides non-2xx bodies). Only the function's own
 *   envelope produces its error codes; gateway or network failures become
 *   'internal', so a proxy 401/404 never looks like a revoked session or a
 *   deleted game.
 * - subscribe() shares one channel per game code between subscribers, tracks
 *   presence as { playerId }, and rebuilds the channel with jittered backoff
 *   after CHANNEL_ERROR / TIMED_OUT / an unexpected CLOSED.
 */
import { createClient } from '@supabase/supabase-js';
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import {
  BROADCAST_EVENT,
  channelName,
  type JoinResult,
  type ServerErrorCode,
  type ServerRequest,
  type Snapshot,
} from '../server/types.ts';
import { ApiError, type GameClient, type Session } from './types.ts';

const ERROR_CODES: readonly ServerErrorCode[] = [
  'bad_request',
  'not_found',
  'unauthorized',
  'forbidden',
  'full',
  'color_taken',
  'wrong_status',
  'illegal_action',
  'conflict',
  'internal',
];

/** The slice of a Realtime channel this client uses (a supabase-js RealtimeChannel fits). */
export interface ChannelLike {
  on(type: 'broadcast', filter: { event: string }, callback: (message: { payload?: unknown }) => void): ChannelLike;
  on(type: 'presence', filter: { event: 'sync' }, callback: () => void): ChannelLike;
  subscribe(callback: (status: string, err?: Error) => void): ChannelLike;
  track(payload: Record<string, unknown>): Promise<unknown>;
  presenceState(): Record<string, unknown[]>;
}

/** The slice of SupabaseClient this client uses. */
export interface RealtimeLike {
  channel(topic: string, options: { config: Record<string, unknown> }): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
}

export interface SupabaseDeps {
  fetch?: typeof fetch;
  /** Created from url + anonKey on first subscribe when omitted. */
  realtime?: RealtimeLike;
  timeoutMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  /** Grace period before an unused channel is removed (absorbs unsubscribe → resubscribe). */
  idleCloseMs?: number;
}

interface Listener {
  playerId: PlayerId;
  onVersion: (version: number) => void;
  onPresence?: (onlineIds: PlayerId[]) => void;
  lastPresence?: string;
}

type Handlers = { onVersion: (version: number) => void; onPresence?: (onlineIds: PlayerId[]) => void };

export class SupabaseGameClient implements GameClient {
  readonly mode = 'supabase' as const;
  readonly url: string;
  readonly anonKey: string;
  private readonly endpoint: string;
  private readonly deps: SupabaseDeps;
  private realtime: RealtimeLike | null;
  private readonly channels = new Map<string, GameChannel>();

  constructor(url: string, anonKey: string, deps: SupabaseDeps = {}) {
    this.url = url.replace(/\/+$/, '');
    this.anonKey = anonKey;
    this.endpoint = `${this.url}/functions/v1/game`;
    this.deps = deps;
    this.realtime = deps.realtime ?? null;
  }

  // -------------------------------------------------------------------------
  // GameClient
  // -------------------------------------------------------------------------

  async createGame(name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return toSession(await this.call<JoinResult>({ op: 'create', name, color }));
  }

  async joinGame(code: string, name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return toSession(await this.call<JoinResult>({ op: 'join', code: code.trim().toUpperCase(), name, color }));
  }

  getSnapshot(session: Session): Promise<Snapshot> {
    return this.call({ op: 'get', ...auth(session) });
  }

  updateLobby(
    session: Session,
    patch: { name?: string; color?: ColorId; config?: Partial<GameConfig> },
  ): Promise<Snapshot> {
    return this.call({ op: 'updateLobby', ...auth(session), patch });
  }

  addBot(session: Session): Promise<Snapshot> {
    return this.call({ op: 'addBot', ...auth(session) });
  }

  removePlayer(session: Session, playerId: PlayerId): Promise<Snapshot> {
    return this.call({ op: 'removePlayer', ...auth(session), playerId });
  }

  startGame(session: Session): Promise<Snapshot> {
    return this.call({ op: 'start', ...auth(session) });
  }

  act(session: Session, action: Action): Promise<Snapshot> {
    return this.call({ op: 'act', ...auth(session), action });
  }

  setBot(session: Session, playerId: PlayerId, isBot: boolean): Promise<Snapshot> {
    return this.call({ op: 'setBot', ...auth(session), playerId, isBot });
  }

  rematch(session: Session): Promise<Snapshot> {
    return this.call({ op: 'rematch', ...auth(session) });
  }

  async leave(session: Session): Promise<void> {
    await this.call<null>({ op: 'leave', ...auth(session) });
  }

  subscribe(code: string, playerId: PlayerId, handlers: Handlers): () => void {
    const topic = channelName(code);
    let channel = this.channels.get(topic);
    if (!channel) {
      channel = new GameChannel(this.getRealtime(), topic, this.deps);
      this.channels.set(topic, channel);
    }
    return channel.add({ playerId, onVersion: handlers.onVersion, onPresence: handlers.onPresence });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private getRealtime(): RealtimeLike {
    if (!this.realtime) {
      const client = createClient(this.url, this.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      this.realtime = client as unknown as RealtimeLike;
    }
    return this.realtime;
  }

  /** POSTs one request; resolves to `data` or throws ApiError. */
  private async call<T>(request: ServerRequest): Promise<T> {
    const doFetch = this.deps.fetch ?? globalThis.fetch.bind(globalThis);
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 15_000) : null;
    let status: number;
    let text: string;
    try {
      const res = await doFetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
        },
        body: JSON.stringify(request),
        signal: controller?.signal,
      });
      status = res.status;
      text = await res.text();
    } catch {
      const timedOut = controller?.signal.aborted;
      throw new ApiError(
        'internal',
        timedOut ? 'The game server took too long to answer.' : "Couldn't reach the game server. Check your connection.",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    return parseEnvelope<T>(status, text);
  }
}

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

export function parseEnvelope<T>(status: number, text: string): T {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError('internal', `The game server answered unexpectedly (HTTP ${status}).`);
  }
  if (body && typeof body === 'object' && 'ok' in body) {
    const env = body as { ok: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
    if (env.ok === true && 'data' in env) return env.data as T;
    if (env.ok === false && env.error && typeof env.error === 'object') {
      const code = ERROR_CODES.includes(env.error.code as ServerErrorCode) ? (env.error.code as ServerErrorCode) : 'internal';
      const message = typeof env.error.message === 'string' ? env.error.message : 'Something went wrong.';
      throw new ApiError(code, message);
    }
  }
  // Not our envelope: the API gateway (bad key, function not deployed) or a proxy.
  const detail = body && typeof body === 'object' ? (body as { message?: unknown; msg?: unknown }) : {};
  const hint = typeof detail.message === 'string' ? detail.message : typeof detail.msg === 'string' ? detail.msg : '';
  throw new ApiError('internal', `The game server is unavailable (HTTP ${status}${hint ? `: ${hint}` : ''}).`);
}

function auth(session: Session): { code: string; token: string } {
  return { code: session.code.toUpperCase(), token: session.token };
}

function toSession(result: JoinResult): { session: Session; snapshot: Snapshot } {
  const { playerId, token, snapshot } = result;
  const me = snapshot.players.find((p) => p.id === playerId);
  return { session: { code: snapshot.code, playerId, token, name: me?.name ?? '' }, snapshot };
}

// ---------------------------------------------------------------------------
// One Realtime channel per game code
// ---------------------------------------------------------------------------

/** Version from a broadcast message; tolerates the payload arriving nested one level deeper. */
export function versionOf(message: unknown): number | null {
  const payload = (message as { payload?: unknown } | null)?.payload as
    | { version?: unknown; payload?: { version?: unknown } }
    | undefined;
  const v = payload?.version ?? payload?.payload?.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Unique player ids from a presence state ({ key: [{ playerId, ... }] }). */
export function presenceIds(state: Record<string, unknown[]>): PlayerId[] {
  const ids = new Set<PlayerId>();
  for (const metas of Object.values(state)) {
    for (const meta of metas ?? []) {
      const id = (meta as { playerId?: unknown } | null)?.playerId;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
}

class GameChannel {
  private readonly listeners = new Set<Listener>();
  private channel: ChannelLike | null = null;
  /** Bumped whenever the channel is replaced, so late callbacks from an old channel are ignored. */
  private gen = 0;
  private live = false;
  private subscribed = false;
  private trackedId: PlayerId | null = null;
  /** Removal of previous channels; supabase-js reuses a channel with the same topic until it's gone. */
  private closing: Promise<unknown> = Promise.resolve();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly realtime: RealtimeLike;
  private readonly topic: string;
  private readonly opts: SupabaseDeps;

  constructor(realtime: RealtimeLike, topic: string, opts: SupabaseDeps) {
    this.realtime = realtime;
    this.topic = topic;
    this.opts = opts;
  }

  add(listener: Listener): () => void {
    this.listeners.add(listener);
    this.clearTimer('idle');
    if (!this.live) this.open();
    else if (this.subscribed) {
      this.track();
      this.emitPresence();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.remove(listener);
    };
  }

  private remove(listener: Listener): void {
    this.listeners.delete(listener);
    if (this.listeners.size > 0) {
      this.track();
      return;
    }
    this.clearTimer('idle');
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.listeners.size === 0) {
        this.clearTimer('retry');
        this.close();
      }
    }, this.opts.idleCloseMs ?? 1000);
  }

  /** The newest subscriber decides which player this tab shows as online. */
  private current(): Listener | undefined {
    let last: Listener | undefined;
    for (const l of this.listeners) last = l;
    return last;
  }

  private open(): void {
    const gen = ++this.gen;
    this.live = true;
    this.subscribed = false;
    this.trackedId = null;
    void this.closing.then(() => {
      if (gen !== this.gen) return;
      const channel = this.realtime.channel(this.topic, {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: this.current()?.playerId ?? '' },
          private: false,
        },
      });
      this.channel = channel;
      channel
        .on('broadcast', { event: BROADCAST_EVENT }, (message) => {
          if (gen !== this.gen) return;
          const v = versionOf(message);
          if (v !== null) for (const l of [...this.listeners]) l.onVersion(v);
        })
        .on('presence', { event: 'sync' }, () => {
          if (gen === this.gen) this.emitPresence();
        })
        .subscribe((status) => {
          if (gen === this.gen) this.onStatus(status);
        });
    });
  }

  private onStatus(status: string): void {
    if (status === 'SUBSCRIBED') {
      this.subscribed = true;
      this.attempt = 0;
      this.clearTimer('retry');
      this.track();
      this.emitPresence();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // supabase-js may rejoin by itself; if it reports SUBSCRIBED first, the retry is cancelled.
      this.subscribed = false;
      this.trackedId = null;
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.listeners.size === 0) return;
    const min = this.opts.retryMinMs ?? 1000;
    const max = this.opts.retryMaxMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.attempt++) * (0.5 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size === 0) return;
      this.close();
      this.open();
    }, delay);
  }

  private close(): void {
    this.gen++;
    this.live = false;
    this.subscribed = false;
    this.trackedId = null;
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    const removed = this.realtime.removeChannel(channel).catch(() => undefined);
    this.closing = Promise.all([this.closing, removed]);
  }

  private track(): void {
    const me = this.current();
    if (!me || !this.channel || !this.subscribed || this.trackedId === me.playerId) return;
    this.trackedId = me.playerId;
    this.channel.track({ playerId: me.playerId }).catch(() => {
      if (this.trackedId === me.playerId) this.trackedId = null;
    });
  }

  private emitPresence(): void {
    const others = this.channel ? presenceIds(this.channel.presenceState()) : [];
    for (const l of [...this.listeners]) {
      if (!l.onPresence) continue;
      const ids = [...new Set([l.playerId, ...others])].sort();
      const key = ids.join(',');
      if (key === l.lastPresence) continue;
      l.lastPresence = key;
      l.onPresence(ids);
    }
  }

  private clearTimer(which: 'idle' | 'retry'): void {
    const key = which === 'idle' ? 'idleTimer' : 'retryTimer';
    const t = this[key];
    if (t) clearTimeout(t);
    this[key] = null;
  }
}
