/**
 * LocalGameClient: the real server core running in the browser. Games live in
 * localStorage, mutations are serialized with navigator.locks, and every tab
 * of this origin hears version pings and presence on
 * BroadcastChannel('akabare-local'). Open several tabs to play several seats.
 *
 * Keys:
 *   akabare:local:game:<CODE>    GameRecord JSON (secret state included; it's all local)
 *   akabare:local:tokens:<CODE>  { [sha256(token)]: playerId }
 */
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import * as core from '../server/core.ts';
import { generateCode, generateId, generateToken, hashToken, randomSeed } from '../server/crypto.ts';
import type { GameRecord, Snapshot } from '../server/types.ts';
import { ApiError, type GameClient, type Session } from './types.ts';

export const LOCAL_CHANNEL = 'akabare-local';
const GAME_PREFIX = 'akabare:local:game:';
const TOKENS_PREFIX = 'akabare:local:tokens:';
const gameKey = (code: string) => GAME_PREFIX + code;
const tokensKey = (code: string) => TOKENS_PREFIX + code;
const PRUNE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export type LocalMessage =
  | { type: 'version'; code: string; version: number }
  | { type: 'presence'; code: string; playerId: PlayerId; t: number }
  | { type: 'bye'; code: string; playerId: PlayerId };

type TokenMap = Record<string, PlayerId>;

/** The parts of BroadcastChannel this client uses (injectable for tests). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

export interface LocalDeps {
  storage?: Storage | null;
  channel?: ChannelLike | null;
  locks?: Pick<LockManager, 'request'> | null;
  /** Source of 'storage' and 'pagehide' events (window). */
  events?: EventTarget | null;
  /** Artificial latency range in ms; [0, 0] disables it. */
  latency?: [number, number];
  heartbeatMs?: number;
  onlineMs?: number;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOCAL_CHANNEL);
  } catch {
    return null;
  }
}

const nowIso = () => new Date().toISOString();

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof core.ServerError) return new ApiError(e.code, e.message);
  return new ApiError('internal', e instanceof Error ? e.message : String(e));
}

function requireCode(code: string): string {
  const c = core.normalizeCode(code);
  if (!c) throw new ApiError('not_found', `There's no game with code "${code}".`);
  return c;
}

export class LocalGameClient implements GameClient {
  readonly mode = 'local' as const;
  private readonly storage: Storage | null;
  private readonly channel: ChannelLike | null;
  private readonly locks: Pick<LockManager, 'request'> | null;
  private readonly events: EventTarget | null;
  private readonly latencyMs: [number, number];
  private readonly heartbeatMs: number;
  private readonly onlineMs: number;
  private readonly local = new Set<(msg: LocalMessage) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: LocalDeps = {}) {
    this.storage = deps.storage !== undefined ? deps.storage : defaultStorage();
    this.channel = deps.channel !== undefined ? deps.channel : defaultChannel();
    this.locks =
      deps.locks !== undefined ? deps.locks : typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null;
    this.events = deps.events !== undefined ? deps.events : typeof window !== 'undefined' ? window : null;
    this.latencyMs = deps.latency ?? [30, 80];
    this.heartbeatMs = deps.heartbeatMs ?? 2000;
    this.onlineMs = deps.onlineMs ?? 6000;
  }

  // -------------------------------------------------------------------------
  // GameClient
  // -------------------------------------------------------------------------

  async createGame(name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return this.call(async () => {
      const playerId = generateId();
      const token = generateToken();
      const hash = await hashToken(token);
      this.prune();
      let code = generateCode();
      for (let i = 0; i < 20 && this.readRecord(code); i++) code = generateCode();
      return this.lock(code, () => {
        if (this.readRecord(code)) throw new ApiError('conflict', 'Please try again.');
        const rec = core.newRecord(code, { id: playerId, name, color }, nowIso());
        this.commit(rec, { [hash]: playerId });
        return { session: { code, playerId, token, name: rec.players[0].name }, snapshot: core.snapshot(rec, playerId) };
      });
    });
  }

  async joinGame(code: string, name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return this.call(async () => {
      const c = requireCode(code);
      const playerId = generateId();
      const token = generateToken();
      const hash = await hashToken(token);
      return this.lock(c, () => {
        const rec = core.joinPlayer(this.requireRecord(c), { id: playerId, name, color }, nowIso());
        const me = rec.players.find((p) => p.id === playerId)!;
        this.commit(rec, { ...this.readTokens(c), [hash]: playerId });
        return { session: { code: c, playerId, token, name: me.name }, snapshot: core.snapshot(rec, playerId) };
      });
    });
  }

  async getSnapshot(session: Session): Promise<Snapshot> {
    return this.call(async () => {
      const c = requireCode(session.code);
      const hash = await hashToken(session.token);
      const rec = this.requireRecord(c);
      return core.snapshot(rec, this.authenticate(c, hash, session));
    });
  }

  updateLobby(
    session: Session,
    patch: { name?: string; color?: ColorId; config?: Partial<GameConfig> },
  ): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.updateLobby(rec, me, patch, now));
  }

  addBot(session: Session): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.addBot(rec, me, generateId(), now));
  }

  removePlayer(session: Session, playerId: PlayerId): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.removePlayer(rec, me, playerId, now), [playerId]);
  }

  startGame(session: Session): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.startGame(rec, me, randomSeed(), now));
  }

  act(session: Session, action: Action): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.act(rec, me, action, now, randomSeed()));
  }

  setBot(session: Session, playerId: PlayerId, isBot: boolean): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.setBot(rec, me, playerId, isBot, now, randomSeed()));
  }

  rematch(session: Session): Promise<Snapshot> {
    return this.mutate(session, (rec, me, now) => core.rematch(rec, me, now));
  }

  async leave(session: Session): Promise<void> {
    return this.call(async () => {
      const c = requireCode(session.code);
      const hash = await hashToken(session.token);
      await this.lock(c, () => {
        const rec = this.requireRecord(c);
        const me = this.authenticate(c, hash, session);
        const next = core.leave(rec, me, nowIso());
        if (next) {
          this.commit(next, this.withoutPlayers(this.readTokens(c), [me]));
        } else {
          this.remove(c);
          this.post({ type: 'version', code: c, version: rec.version + 1 });
        }
      });
    });
  }

  subscribe(
    code: string,
    playerId: PlayerId,
    handlers: { onVersion: (version: number) => void; onPresence?: (onlineIds: PlayerId[]) => void },
  ): () => void {
    const c = code.toUpperCase();
    const heard = new Map<PlayerId, number>();
    let lastOnline = '';
    let closed = false;

    const emitPresence = () => {
      if (closed || !handlers.onPresence) return;
      const t = Date.now();
      const others = [...heard].filter(([id, at]) => id !== playerId && t - at <= this.onlineMs).map(([id]) => id);
      const ids = [playerId, ...others].sort();
      const key = ids.join(',');
      if (key === lastOnline) return;
      lastOnline = key;
      handlers.onPresence(ids);
    };
    const beat = () => this.post({ type: 'presence', code: c, playerId, t: Date.now() });

    const onMessage = (msg: LocalMessage) => {
      if (closed || !msg || typeof msg !== 'object' || msg.code !== c) return;
      if (msg.type === 'version') {
        if (typeof msg.version === 'number') handlers.onVersion(msg.version);
      } else if (msg.type === 'presence' && msg.playerId !== playerId) {
        const at = heard.get(msg.playerId);
        heard.set(msg.playerId, Date.now());
        // Answer newcomers straight away so both sides see each other within one message.
        if (at === undefined || Date.now() - at > this.onlineMs) beat();
        emitPresence();
      } else if (msg.type === 'bye' && msg.playerId !== playerId) {
        heard.delete(msg.playerId);
        emitPresence();
      }
    };
    const onChannel = (e: MessageEvent) => onMessage(e.data as LocalMessage);
    // Fallback for browsers without BroadcastChannel: other tabs' localStorage writes.
    const onStorage = (e: Event) => {
      const se = e as StorageEvent;
      if (se.key !== gameKey(c) || (this.storage && se.storageArea && se.storageArea !== this.storage)) return;
      const version = versionOf(se.newValue) ?? (versionOf(se.oldValue) ?? 0) + 1;
      onMessage({ type: 'version', code: c, version });
    };
    const bye = () => this.post({ type: 'bye', code: c, playerId });

    this.channel?.addEventListener('message', onChannel);
    this.local.add(onMessage);
    this.events?.addEventListener('storage', onStorage);
    this.events?.addEventListener('pagehide', bye);
    const timer = setInterval(() => {
      beat();
      emitPresence();
    }, this.heartbeatMs);
    setTimeout(() => {
      if (closed) return;
      beat();
      emitPresence();
    }, 0);

    return () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      this.channel?.removeEventListener('message', onChannel);
      this.local.delete(onMessage);
      this.events?.removeEventListener('storage', onStorage);
      this.events?.removeEventListener('pagehide', bye);
      bye();
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Simulated network: latency, then the op, with every failure as ApiError. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    const [min, max] = this.latencyMs;
    if (max > 0) await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    try {
      return await fn();
    } catch (e) {
      throw toApiError(e);
    }
  }

  /** Authenticated read-modify-write under the game's lock. `dropTokensOf` loses access (kicked players). */
  private mutate(
    session: Session,
    op: (rec: GameRecord, me: PlayerId, now: string) => GameRecord,
    dropTokensOf: PlayerId[] = [],
  ): Promise<Snapshot> {
    return this.call(async () => {
      const c = requireCode(session.code);
      const hash = await hashToken(session.token);
      return this.lock(c, () => {
        const rec = this.requireRecord(c);
        const me = this.authenticate(c, hash, session);
        const next = op(rec, me, nowIso());
        this.commit(next, dropTokensOf.length ? this.withoutPlayers(this.readTokens(c), dropTokensOf) : undefined);
        return core.snapshot(next, me);
      });
    });
  }

  /** Runs `fn` exclusively for this game across tabs (navigator.locks), or at least within this tab. */
  private lock<T>(code: string, fn: () => T): Promise<T> {
    // A synchronous throw inside the callback rejects the request (and releases the lock).
    if (this.locks) return this.locks.request(`akabare:${code}`, () => fn());
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private authenticate(code: string, hash: string, session: Session): PlayerId {
    const id = this.readTokens(code)[hash];
    if (!id || id !== session.playerId) throw new ApiError('unauthorized', 'This session is no longer valid for this game.');
    return id;
  }

  private requireStorage(): Storage {
    if (!this.storage) throw new ApiError('internal', 'Local play needs browser storage, which is unavailable.');
    return this.storage;
  }

  private readJson(key: string): unknown {
    const raw = this.requireStorage().getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApiError('internal', 'The saved game is corrupted.');
    }
  }

  private readRecord(code: string): GameRecord | null {
    return (this.readJson(gameKey(code)) as GameRecord | null) ?? null;
  }

  private requireRecord(code: string): GameRecord {
    const rec = this.readRecord(code);
    if (!rec) throw new ApiError('not_found', `There's no game with code "${code}".`);
    return rec;
  }

  private readTokens(code: string): TokenMap {
    const t = this.readJson(tokensKey(code));
    return t && typeof t === 'object' ? (t as TokenMap) : {};
  }

  private withoutPlayers(tokens: TokenMap, ids: PlayerId[]): TokenMap {
    return Object.fromEntries(Object.entries(tokens).filter(([, id]) => !ids.includes(id)));
  }

  /** Persists the record (and tokens if given), then pings every tab. */
  private commit(rec: GameRecord, tokens?: TokenMap): void {
    const s = this.requireStorage();
    try {
      if (tokens) s.setItem(tokensKey(rec.code), JSON.stringify(tokens));
      s.setItem(gameKey(rec.code), JSON.stringify(rec));
    } catch {
      throw new ApiError('internal', "Couldn't save the game: browser storage is full or blocked.");
    }
    this.post({ type: 'version', code: rec.code, version: rec.version });
  }

  private remove(code: string): void {
    const s = this.requireStorage();
    s.removeItem(gameKey(code));
    s.removeItem(tokensKey(code));
  }

  /** Other tabs via the channel; this tab's subscribers directly (a channel never hears itself). */
  private post(msg: LocalMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel closed: other tabs fall back to storage events and polling.
    }
    setTimeout(() => {
      for (const fn of [...this.local]) fn(msg);
    }, 0);
  }

  /** Drops local games untouched for 3 days (mirrors the edge function's pruning). */
  private prune(): void {
    const s = this.storage;
    if (!s) return;
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(GAME_PREFIX)) continue;
      try {
        const updated = Date.parse((JSON.parse(s.getItem(key) ?? 'null') as GameRecord | null)?.updatedAt ?? '');
        if (!(updated > cutoff)) stale.push(key.slice(GAME_PREFIX.length));
      } catch {
        stale.push(key.slice(GAME_PREFIX.length));
      }
    }
    for (const code of stale) this.remove(code);
  }
}

function versionOf(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}
