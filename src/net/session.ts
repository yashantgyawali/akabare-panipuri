/**
 * Client-side sessions (a player's token per game).
 *
 * - localStorage `akabare:sessions`: code → the most recent session in this
 *   browser (survives closing the tab).
 * - sessionStorage `akabare:session:<CODE>`: this tab's session, so several
 *   tabs can be different players in the same game.
 *
 * loadSession prefers the tab's own session; a localStorage-only hit is
 * returned with fromOtherTab = true so the UI can offer "Continue as X" or
 * "Join as someone new". All storage access is guarded (private mode, blocked
 * storage, SSR): sessions are a convenience and never throw.
 */
import type { Session } from './types.ts';

const LOCAL_KEY = 'akabare:sessions';
const tabKey = (code: string) => `akabare:session:${code.toUpperCase()}`;

type Stored = Session & { savedAt: number };

export interface LoadedSession {
  session: Session;
  /** Not this tab's own session: another (or an earlier) tab used it. */
  fromOtherTab: boolean;
}

export interface SessionStore {
  /** Saves for this tab and as the browser-wide default for the game. */
  save(session: Session): void;
  load(code: string): LoadedSession | null;
  /**
   * Forgets this tab's session for the game, and the browser-wide one too when
   * it belongs to the same player (or when no playerId is given).
   */
  clear(code: string, playerId?: string): void;
  /** Every game this browser has a session for, newest first. */
  list(): Session[];
}

type StorageGetter = () => Storage | null;

function isSession(v: unknown): v is Session {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.code === 'string' &&
    typeof s.playerId === 'string' &&
    typeof s.token === 'string' &&
    typeof s.name === 'string' &&
    s.code !== '' &&
    s.playerId !== '' &&
    s.token !== ''
  );
}

const strip = ({ code, playerId, token, name }: Session): Session => ({ code, playerId, token, name });

/** A store over the given storages (getters, so a throwing accessor is caught per call). */
export function createSessionStore(getLocal: StorageGetter, getTab: StorageGetter): SessionStore {
  const read = (get: StorageGetter, key: string): unknown => {
    try {
      const raw = get()?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const write = (get: StorageGetter, key: string, value: unknown): void => {
    try {
      const s = get();
      if (!s) return;
      if (value === null) s.removeItem(key);
      else s.setItem(key, JSON.stringify(value));
    } catch {
      // Quota or blocked storage.
    }
  };
  const readMap = (): Record<string, Stored> => {
    const raw = read(getLocal, LOCAL_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, Stored> = {};
    for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isSession(v)) out[code] = { ...strip(v), savedAt: Number((v as Stored).savedAt) || 0 };
    }
    return out;
  };

  return {
    save(session) {
      const s = { ...strip(session), code: session.code.toUpperCase() };
      write(getTab, tabKey(s.code), s);
      write(getLocal, LOCAL_KEY, { ...readMap(), [s.code]: { ...s, savedAt: Date.now() } });
    },
    load(code) {
      const c = code.toUpperCase();
      const own = read(getTab, tabKey(c));
      if (isSession(own) && own.code.toUpperCase() === c) return { session: strip(own), fromOtherTab: false };
      const shared = readMap()[c];
      return shared ? { session: strip(shared), fromOtherTab: true } : null;
    },
    clear(code, playerId) {
      const c = code.toUpperCase();
      const own = read(getTab, tabKey(c));
      if (!playerId || !isSession(own) || own.playerId === playerId) write(getTab, tabKey(c), null);
      const map = readMap();
      if (map[c] && (!playerId || map[c].playerId === playerId)) {
        delete map[c];
        write(getLocal, LOCAL_KEY, map);
      }
    },
    list() {
      return Object.values(readMap())
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(strip);
    },
  };
}

function globalStorage(kind: 'localStorage' | 'sessionStorage'): StorageGetter {
  return () => (typeof globalThis[kind] === 'undefined' ? null : globalThis[kind]);
}

/** The browser's store: localStorage + this tab's sessionStorage. */
export const sessionStore: SessionStore = createSessionStore(globalStorage('localStorage'), globalStorage('sessionStorage'));

export const saveSession = (session: Session): void => sessionStore.save(session);
export const loadSession = (code: string): LoadedSession | null => sessionStore.load(code);
export const clearSession = (code: string, playerId?: string): void => sessionStore.clear(code, playerId);
export const listSessions = (): Session[] => sessionStore.list();
