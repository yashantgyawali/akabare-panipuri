/**
 * React binding for one game: session → snapshot, live updates, mutations.
 *
 * The logic lives in `GameSync` (framework-free, unit-tested); `useGame` is a
 * thin useSyncExternalStore wrapper around it.
 *
 * - Loads this tab's session for `code` and fetches the snapshot. A session
 *   that only exists browser-wide (another/earlier tab) is offered as
 *   `suggestedSession` with status 'needsJoin' ("Continue as X" / "Join").
 * - Refetches on version pings (coalesced; out-of-order responses dropped by
 *   version), every 20s, and on tab focus / network recovery.
 * - Mutations apply the returned snapshot immediately and resolve to true, or
 *   resolve to false and set `actionError` (they never throw).
 * - 'unauthorized' drops the session (→ needsJoin); a fetch that says
 *   'not_found' (the game is gone) → status 'error'.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import type { ServerErrorCode, Snapshot } from '../server/types.ts';
import { getGameClient } from './index.ts';
import { sessionStore, type SessionStore } from './session.ts';
import { ApiError, type GameClient, type Session } from './types.ts';

export type UseGameStatus = 'idle' | 'loading' | 'needsJoin' | 'ready' | 'error';

export interface LobbyPatchInput {
  name?: string;
  color?: ColorId;
  config?: Partial<GameConfig>;
}

export interface ActionError {
  code: ServerErrorCode;
  message: string;
}

export interface GameSyncState {
  status: UseGameStatus;
  snapshot: Snapshot | null;
  session: Session | null;
  /** Player ids currently connected (includes you once joined and subscribed). */
  online: PlayerId[];
  /** Why status is 'error' (e.g. the game doesn't exist). */
  error: string | null;
  errorCode: ServerErrorCode | null;
  /** The last failed join/mutation (color_taken, illegal_action, …); cleared by the next success. */
  actionError: ActionError | null;
  /** A mutation or join is in flight. */
  busy: boolean;
  /** A session for this game saved by another (or an earlier) tab. */
  suggestedSession: Session | null;
}

export interface GameActions {
  join(name: string, color?: ColorId): Promise<boolean>;
  continueAs(session: Session): void;
  act(action: Action): Promise<boolean>;
  updateLobby(patch: LobbyPatchInput): Promise<boolean>;
  addBot(): Promise<boolean>;
  removePlayer(playerId: PlayerId): Promise<boolean>;
  start(): Promise<boolean>;
  setBot(playerId: PlayerId, isBot: boolean): Promise<boolean>;
  rematch(): Promise<boolean>;
  /** Leaves the game and forgets the session. */
  leave(): Promise<boolean>;
  /** Refetch now (also retries after an error). */
  refresh(): void;
  clearActionError(): void;
}

export interface UseGame extends GameSyncState, GameActions {
  isHost: boolean;
}

export interface GameSyncOptions {
  pollMs?: number;
  sessions?: SessionStore;
  /** Source of 'visibilitychange' (with visibilityState); defaults to `document`. */
  document?: (EventTarget & { visibilityState?: string }) | null;
  /** Source of 'online'; defaults to `window`. */
  window?: EventTarget | null;
}

const REFETCH_MS = 20_000;

/** Snapshots from createGame(), shown instantly when the game route mounts. */
const primed = new Map<string, Snapshot>();

const BLANK: Omit<GameSyncState, 'busy'> = {
  status: 'idle',
  snapshot: null,
  session: null,
  online: [],
  error: null,
  errorCode: null,
  actionError: null,
  suggestedSession: null,
};

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError('internal', message || 'Something went wrong.');
}

const normalizeCode = (code: string | null | undefined): string | null => code?.trim().toUpperCase() || null;

/** Creates a game as host, saves the session for this tab, and primes useGame. */
export async function createGame(
  name: string,
  color?: ColorId,
  client: GameClient = getGameClient(),
  sessions: SessionStore = sessionStore,
): Promise<{ session: Session; snapshot: Snapshot }> {
  const result = await client.createGame(name, color);
  sessions.save(result.session);
  primed.set(result.session.code, result.snapshot);
  return result;
}

/**
 * One game's client-side state machine. `start()` begins fetching and live
 * updates and returns `stop`; it may be started again (React StrictMode).
 * Listeners are notified after every state change; `getState()` returns a
 * new object only when something changed.
 */
export class GameSync {
  readonly code: string | null;
  readonly actions: GameActions;
  private readonly client: GameClient;
  private readonly sessions: SessionStore;
  private readonly pollMs: number;
  private readonly doc: GameSyncOptions['document'];
  private readonly win: EventTarget | null;
  private readonly listeners = new Set<() => void>();
  private state: GameSyncState;
  /** Bumped whenever the session changes; async results from an older epoch are dropped. */
  private epoch = 0;
  /** Version of the snapshot shown (-1 = none); older responses are ignored. */
  private version = -1;
  private started = false;
  private detach: (() => void) | null = null;
  private job: { epoch: number; again: boolean } | null = null;
  private busyCount = 0;

  constructor(client: GameClient, code: string | null, opts: GameSyncOptions = {}) {
    this.client = client;
    this.code = normalizeCode(code);
    this.sessions = opts.sessions ?? sessionStore;
    this.pollMs = opts.pollMs ?? REFETCH_MS;
    this.doc = opts.document !== undefined ? opts.document : typeof document !== 'undefined' ? document : null;
    this.win = opts.window !== undefined ? opts.window : typeof window !== 'undefined' ? window : null;
    const init = this.initialState();
    this.version = init.snapshot?.version ?? -1;
    this.state = { ...init, busy: false };
    this.actions = {
      join: this.join,
      continueAs: this.continueAs,
      act: (action) => this.mutate((s) => this.client.act(s, action)),
      updateLobby: (patch) => this.mutate((s) => this.client.updateLobby(s, patch)),
      addBot: () => this.mutate((s) => this.client.addBot(s)),
      removePlayer: (id) => this.mutate((s) => this.client.removePlayer(s, id)),
      start: () => this.mutate((s) => this.client.startGame(s)),
      setBot: (id, isBot) => this.mutate((s) => this.client.setBot(s, id, isBot)),
      rematch: () => this.mutate((s) => this.client.rematch(s)),
      leave: this.leave,
      refresh: this.refresh,
      clearActionError: () => {
        if (this.state.actionError) this.set({ actionError: null });
      },
    };
  }

  getState = (): GameSyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start = (): (() => void) => {
    if (!this.started) {
      this.started = true;
      if (this.state.session) {
        this.attach(this.state.session);
        this.refetch();
      }
    }
    return this.stop;
  };

  stop = (): void => {
    this.started = false;
    this.detach?.();
    this.detach = null;
  };

  // -------------------------------------------------------------------------
  // State plumbing
  // -------------------------------------------------------------------------

  private set(patch: Partial<GameSyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  private initialState(): Omit<GameSyncState, 'busy'> {
    if (!this.code) return BLANK;
    const loaded = this.sessions.load(this.code);
    if (!loaded || loaded.fromOtherTab) {
      return { ...BLANK, status: 'needsJoin', suggestedSession: loaded?.session ?? null };
    }
    const snap = primed.get(this.code);
    const snapshot = snap && snap.youId === loaded.session.playerId ? snap : null;
    return { ...BLANK, status: snapshot ? 'ready' : 'loading', session: loaded.session, snapshot };
  }

  /** Switches to a session (or none), invalidating everything in flight. */
  private adopt(next: Omit<GameSyncState, 'busy'>): void {
    this.epoch++;
    this.version = next.snapshot?.version ?? -1;
    this.detach?.();
    this.detach = null;
    this.set({ ...next, busy: this.busyCount > 0 });
    if (this.started && next.session) this.attach(next.session);
  }

  /** Version pings, presence, polling and focus/online refetches for `session`. */
  private attach(session: Session): void {
    const unsubscribe = this.client.subscribe(session.code.toUpperCase(), session.playerId, {
      onVersion: (v) => {
        if (v > this.version) this.refetch();
      },
      onPresence: (ids) => {
        if (this.state.session === session) this.set({ online: ids });
      },
    });
    const timer = setInterval(this.refetch, this.pollMs);
    const onVisible = () => {
      if (!this.doc?.visibilityState || this.doc.visibilityState === 'visible') this.refetch();
    };
    this.doc?.addEventListener('visibilitychange', onVisible);
    this.win?.addEventListener('online', this.refetch);
    this.detach = () => {
      unsubscribe();
      clearInterval(timer);
      this.doc?.removeEventListener('visibilitychange', onVisible);
      this.win?.removeEventListener('online', this.refetch);
    };
  }

  private apply(snap: Snapshot, epoch: number): void {
    if (epoch !== this.epoch || snap.version <= this.version) return;
    this.version = snap.version;
    primed.delete(snap.code);
    this.set({ status: 'ready', snapshot: snap, error: null, errorCode: null });
  }

  private fail(err: ApiError): void {
    this.set({ status: 'error', error: err.message, errorCode: err.code });
  }

  private dropSession(session: Session, err: ApiError): void {
    this.sessions.clear(session.code, session.playerId);
    this.adopt({
      ...BLANK,
      status: 'needsJoin',
      suggestedSession: this.sessions.load(session.code)?.session ?? null,
      actionError: { code: err.code, message: err.message },
    });
  }

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  /** Fetches the snapshot; calls made while one is in flight coalesce into one follow-up fetch. */
  private refetch = (): void => {
    const epoch = this.epoch;
    if (this.job && this.job.epoch === epoch) {
      this.job.again = true;
      return;
    }
    const job = { epoch, again: false };
    this.job = job;
    void this.runFetch(job).finally(() => {
      if (this.job === job) this.job = null;
    });
  };

  private async runFetch(job: { epoch: number; again: boolean }): Promise<void> {
    do {
      job.again = false;
      const session = this.state.session;
      if (!session || job.epoch !== this.epoch) return;
      try {
        this.apply(await this.client.getSnapshot(session), job.epoch);
      } catch (e) {
        if (job.epoch !== this.epoch) return;
        const err = toApiError(e);
        if (err.code === 'unauthorized') this.dropSession(session, err);
        else if (err.code === 'not_found' || this.version < 0) this.fail(err);
        // Anything else is transient while a snapshot is shown; the next ping or poll retries.
        return;
      }
    } while (job.again && job.epoch === this.epoch);
  }

  private refresh = (): void => {
    if (!this.state.session) {
      this.adopt(this.initialState());
      if (this.state.session) this.refetch();
      return;
    }
    if (this.state.status === 'error') {
      // Accept whatever the server has now, even if it's the version already shown.
      this.version = -1;
      this.set({ status: 'loading', error: null, errorCode: null });
    }
    this.refetch();
  };

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  private async track<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busyCount++ === 0) this.set({ busy: true });
    try {
      return await fn();
    } finally {
      if (--this.busyCount === 0) this.set({ busy: false });
    }
  }

  private mutate(fn: (session: Session) => Promise<Snapshot>): Promise<boolean> {
    return this.track(async () => {
      const session = this.state.session;
      if (!session) {
        this.set({ actionError: { code: 'unauthorized', message: 'Join the game first.' } });
        return false;
      }
      const epoch = this.epoch;
      try {
        const snap = await fn(session);
        this.apply(snap, epoch);
        if (epoch === this.epoch && this.state.actionError) this.set({ actionError: null });
        return true;
      } catch (e) {
        if (epoch !== this.epoch) return false;
        const err = toApiError(e);
        if (err.code === 'unauthorized') {
          this.dropSession(session, err);
        } else {
          this.set({ actionError: { code: err.code, message: err.message } });
          // Our view may be behind (someone moved first, a player left, the game is gone): catch up.
          this.refetch();
        }
        return false;
      }
    });
  }

  private join = (name: string, color?: ColorId): Promise<boolean> =>
    this.track(async () => {
      const code = this.code;
      if (!code) return false;
      const epoch = this.epoch;
      try {
        const { session, snapshot } = await this.client.joinGame(code, name, color);
        this.sessions.save(session);
        if (epoch === this.epoch) this.adopt({ ...BLANK, status: 'ready', session, snapshot });
        return true;
      } catch (e) {
        if (epoch !== this.epoch) return false;
        const err = toApiError(e);
        if (err.code === 'not_found') this.fail(err);
        else this.set({ actionError: { code: err.code, message: err.message } });
        return false;
      }
    });

  private continueAs = (session: Session): void => {
    this.sessions.save(session);
    this.adopt({ ...BLANK, status: 'loading', session });
    this.refetch();
  };

  private leave = (): Promise<boolean> =>
    this.track(async () => {
      const session = this.state.session;
      if (!session) return false;
      try {
        await this.client.leave(session);
      } catch (e) {
        const err = toApiError(e);
        // Already gone from the game: forgetting the session is still right.
        if (err.code !== 'unauthorized' && err.code !== 'not_found') {
          this.set({ actionError: { code: err.code, message: err.message } });
          return false;
        }
      }
      this.sessions.clear(session.code, session.playerId);
      if (this.state.session === session) {
        this.adopt({ ...BLANK, status: 'needsJoin', suggestedSession: this.sessions.load(session.code)?.session ?? null });
      }
      return true;
    });
}

export function useGame(rawCode: string | null): UseGame {
  const code = normalizeCode(rawCode);
  const client = useMemo(() => getGameClient(), []);
  const sync = useMemo(() => new GameSync(client, code), [client, code]);
  useEffect(() => sync.start(), [sync]);
  const state = useSyncExternalStore(sync.subscribe, sync.getState, sync.getState);
  return useMemo(
    () => ({
      ...state,
      ...sync.actions,
      isHost: !!state.snapshot && !!state.session && state.snapshot.hostId === state.session.playerId,
    }),
    [state, sync],
  );
}
