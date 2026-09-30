/**
 * React binding for one game: session → snapshot, live updates, mutations.
 *
 * - Loads this tab's session for `code` and fetches the snapshot. A session
 *   that only exists browser-wide (another/earlier tab) is offered as
 *   `suggestedSession` with status 'needsJoin' ("Continue as X" / "Join").
 * - Refetches on version pings (coalesced; out-of-order responses dropped by
 *   version), every 20s, and on tab focus / network recovery.
 * - Mutations apply the returned snapshot immediately and resolve to true, or
 *   resolve to false and set `actionError` (they never throw).
 * - 'unauthorized' drops the session (→ needsJoin); 'not_found' → status 'error'.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import type { ServerErrorCode, Snapshot } from '../server/types.ts';
import { getGameClient } from './index.ts';
import { clearSession, loadSession, saveSession } from './session.ts';
import { ApiError, type GameClient, type Session } from './types.ts';

export type UseGameStatus = 'idle' | 'loading' | 'needsJoin' | 'ready' | 'error';

export interface LobbyPatchInput {
  name?: string;
  color?: ColorId;
  config?: Partial<GameConfig>;
}

export interface UseGame {
  status: UseGameStatus;
  snapshot: Snapshot | null;
  session: Session | null;
  /** Player ids currently connected (always includes you once joined). */
  online: PlayerId[];
  /** Why status is 'error' (e.g. the game doesn't exist). */
  error: string | null;
  errorCode: ServerErrorCode | null;
  /** The last failed join/mutation (color_taken, illegal_action, …); cleared by the next success. */
  actionError: { code: ServerErrorCode; message: string } | null;
  clearActionError(): void;
  /** A mutation or join is in flight. */
  busy: boolean;
  isHost: boolean;
  /** A session for this game saved by another (or an earlier) tab. */
  suggestedSession: Session | null;
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
}

const REFETCH_MS = 20_000;

/** Snapshots from createGame(), shown instantly when the game route mounts. */
const primed = new Map<string, Snapshot>();

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError('internal', message || 'Something went wrong.');
}

/** Creates a game as host, saves the session for this tab, and primes useGame. */
export async function createGame(name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
  const result = await getGameClient().createGame(name, color);
  saveSession(result.session);
  primed.set(result.session.code, result.snapshot);
  return result;
}

interface State {
  status: UseGameStatus;
  snapshot: Snapshot | null;
  session: Session | null;
  online: PlayerId[];
  error: string | null;
  errorCode: ServerErrorCode | null;
  actionError: { code: ServerErrorCode; message: string } | null;
  suggestedSession: Session | null;
}

const BLANK: State = {
  status: 'idle',
  snapshot: null,
  session: null,
  online: [],
  error: null,
  errorCode: null,
  actionError: null,
  suggestedSession: null,
};

function initialState(code: string | null): State {
  if (!code) return BLANK;
  const loaded = loadSession(code);
  if (!loaded || loaded.fromOtherTab) {
    return { ...BLANK, status: 'needsJoin', suggestedSession: loaded?.session ?? null };
  }
  const snap = primed.get(code);
  const snapshot = snap && snap.youId === loaded.session.playerId ? snap : null;
  return { ...BLANK, status: snapshot ? 'ready' : 'loading', session: loaded.session, snapshot };
}

export function useGame(rawCode: string | null): UseGame {
  const code = rawCode ? rawCode.trim().toUpperCase() : null;
  const client: GameClient = useMemo(() => getGameClient(), []);
  const [st, setSt] = useState<State>(() => initialState(code));
  const [busyCount, setBusyCount] = useState(0);

  // Mutable mirrors so async callbacks see the latest values without re-subscribing.
  const gen = useRef(0); // bumped whenever the code or session changes; stale responses are dropped
  const version = useRef(-1);
  const sessionRef = useRef<Session | null>(null);
  const codeRef = useRef<string | null>(code);
  const fetchJob = useRef<{ gen: number; running: boolean; again: boolean } | null>(null);

  /** Switches to a session (or none), invalidating everything in flight. */
  const adopt = useCallback((next: State) => {
    gen.current++;
    sessionRef.current = next.session;
    version.current = next.snapshot ? next.snapshot.version : -1;
    setSt(next);
  }, []);

  const applySnapshot = useCallback((snap: Snapshot, g: number) => {
    if (g !== gen.current || snap.version <= version.current) return;
    version.current = snap.version;
    primed.delete(snap.code);
    setSt((s) => ({ ...s, status: 'ready', snapshot: snap, error: null, errorCode: null }));
  }, []);

  const dropSession = useCallback(
    (session: Session, err: ApiError) => {
      clearSession(session.code, session.playerId);
      const other = loadSession(session.code);
      adopt({
        ...BLANK,
        status: 'needsJoin',
        suggestedSession: other?.session ?? null,
        actionError: { code: err.code, message: err.message },
      });
    },
    [adopt],
  );

  const fail = useCallback((code: ServerErrorCode, message: string) => {
    setSt((s) => ({ ...s, status: 'error', error: message, errorCode: code }));
  }, []);

  const refetch = useCallback(() => {
    const g = gen.current;
    const current = fetchJob.current;
    if (current && current.running && current.gen === g) {
      current.again = true;
      return;
    }
    const job = { gen: g, running: true, again: false };
    fetchJob.current = job;
    void (async () => {
      try {
        do {
          job.again = false;
          const session = sessionRef.current;
          if (!session || gen.current !== g) break;
          try {
            applySnapshot(await client.getSnapshot(session), g);
          } catch (e) {
            if (gen.current !== g) break;
            const err = toApiError(e);
            if (err.code === 'unauthorized') dropSession(session, err);
            else if (err.code === 'not_found') fail(err.code, err.message);
            // Anything else is transient while we have a snapshot; the next ping or poll retries.
            else if (version.current < 0) fail(err.code, err.message);
            break;
          }
        } while (job.again && gen.current === g);
      } finally {
        job.running = false;
      }
    })();
  }, [client, applySnapshot, dropSession, fail]);

  // (Re)initialize when the game code changes.
  useEffect(() => {
    codeRef.current = code;
    const next = initialState(code);
    adopt(next);
    if (next.session) refetch();
  }, [code, adopt, refetch]);

  // Live updates while we hold a session.
  const playerId = st.session?.playerId ?? null;
  useEffect(() => {
    if (!code || !playerId) return;
    const unsubscribe = client.subscribe(code, playerId, {
      onVersion: (v) => {
        if (v > version.current) refetch();
      },
      onPresence: (ids) => setSt((s) => (s.session?.playerId === playerId ? { ...s, online: ids } : s)),
    });
    const timer = setInterval(refetch, REFETCH_MS);
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refetch();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('online', refetch);
    return () => {
      unsubscribe();
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('online', refetch);
    };
  }, [client, code, playerId, refetch]);

  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusyCount((n) => n + 1);
    try {
      return await fn();
    } finally {
      setBusyCount((n) => n - 1);
    }
  }, []);

  const mutate = useCallback(
    (fn: (session: Session) => Promise<Snapshot>): Promise<boolean> =>
      track(async () => {
        const session = sessionRef.current;
        if (!session) {
          setSt((s) => ({ ...s, actionError: { code: 'unauthorized', message: 'Join the game first.' } }));
          return false;
        }
        const g = gen.current;
        try {
          const snap = await fn(session);
          applySnapshot(snap, g);
          if (g === gen.current) setSt((s) => (s.actionError ? { ...s, actionError: null } : s));
          return true;
        } catch (e) {
          if (g !== gen.current) return false;
          const err = toApiError(e);
          if (err.code === 'unauthorized') dropSession(session, err);
          else if (err.code === 'not_found') fail(err.code, err.message);
          else {
            setSt((s) => ({ ...s, actionError: { code: err.code, message: err.message } }));
            // Our view may be behind (someone else moved first): catch up.
            if (err.code === 'illegal_action' || err.code === 'wrong_status' || err.code === 'conflict') refetch();
          }
          return false;
        }
      }),
    [track, applySnapshot, dropSession, fail, refetch],
  );

  const join = useCallback(
    (name: string, color?: ColorId): Promise<boolean> =>
      track(async () => {
        const c = codeRef.current;
        if (!c) return false;
        const g = gen.current;
        try {
          const { session, snapshot } = await client.joinGame(c, name, color);
          saveSession(session);
          if (g !== gen.current || codeRef.current !== c) return true;
          adopt({ ...BLANK, status: 'ready', session, snapshot });
          return true;
        } catch (e) {
          if (g !== gen.current) return false;
          const err = toApiError(e);
          if (err.code === 'not_found') fail(err.code, err.message);
          else setSt((s) => ({ ...s, actionError: { code: err.code, message: err.message } }));
          return false;
        }
      }),
    [client, track, adopt, fail],
  );

  const continueAs = useCallback(
    (session: Session) => {
      saveSession(session);
      adopt({ ...BLANK, status: 'loading', session });
      refetch();
    },
    [adopt, refetch],
  );

  const leave = useCallback(
    (): Promise<boolean> =>
      track(async () => {
        const session = sessionRef.current;
        if (!session) return false;
        try {
          await client.leave(session);
        } catch (e) {
          const err = toApiError(e);
          // Already gone from the game: forgetting the session is still right.
          if (err.code !== 'unauthorized' && err.code !== 'not_found') {
            setSt((s) => ({ ...s, actionError: { code: err.code, message: err.message } }));
            return false;
          }
        }
        clearSession(session.code, session.playerId);
        const other = loadSession(session.code);
        adopt({ ...BLANK, status: 'needsJoin', suggestedSession: other?.session ?? null });
        return true;
      }),
    [client, track, adopt],
  );

  const refresh = useCallback(() => {
    if (sessionRef.current) {
      setSt((s) => (s.status === 'error' ? { ...s, status: 'loading', error: null, errorCode: null } : s));
      version.current = Math.min(version.current, st.snapshot ? st.snapshot.version - 1 : -1);
      refetch();
    } else {
      adopt(initialState(codeRef.current));
    }
  }, [adopt, refetch, st.snapshot]);

  const clearActionError = useCallback(() => setSt((s) => (s.actionError ? { ...s, actionError: null } : s)), []);

  return {
    ...st,
    busy: busyCount > 0,
    isHost: !!st.snapshot && !!st.session && st.snapshot.hostId === st.session.playerId,
    clearActionError,
    join,
    continueAs,
    act: useCallback((action: Action) => mutate((s) => client.act(s, action)), [mutate, client]),
    updateLobby: useCallback((patch: LobbyPatchInput) => mutate((s) => client.updateLobby(s, patch)), [mutate, client]),
    addBot: useCallback(() => mutate((s) => client.addBot(s)), [mutate, client]),
    removePlayer: useCallback((id: PlayerId) => mutate((s) => client.removePlayer(s, id)), [mutate, client]),
    start: useCallback(() => mutate((s) => client.startGame(s)), [mutate, client]),
    setBot: useCallback((id: PlayerId, isBot: boolean) => mutate((s) => client.setBot(s, id, isBot)), [mutate, client]),
    rematch: useCallback(() => mutate((s) => client.rematch(s)), [mutate, client]),
    leave,
    refresh,
  };
}
