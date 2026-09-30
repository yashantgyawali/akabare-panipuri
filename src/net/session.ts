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
 * storage, SSR).
 */
import type { Session } from './types.ts';

const LOCAL_KEY = 'akabare:sessions';
const tabKey = (code: string) => `akabare:session:${code.toUpperCase()}`;

type Stored = Session & { savedAt: number };

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof globalThis[kind] === 'undefined' ? null : globalThis[kind];
  } catch {
    return null;
  }
}

function read(kind: 'localStorage' | 'sessionStorage', key: string): unknown {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(kind: 'localStorage' | 'sessionStorage', key: string, value: unknown): void {
  try {
    const s = storage(kind);
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: sessions are a convenience, never fatal.
  }
}

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

function readMap(): Record<string, Stored> {
  const raw = read('localStorage', LOCAL_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, Stored> = {};
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isSession(v)) out[code] = { ...strip(v), savedAt: Number((v as Stored).savedAt) || 0 };
  }
  return out;
}

/** Saves for this tab and as the browser-wide default for the game. */
export function saveSession(session: Session): void {
  const s = { ...strip(session), code: session.code.toUpperCase() };
  write('sessionStorage', tabKey(s.code), s);
  write('localStorage', LOCAL_KEY, { ...readMap(), [s.code]: { ...s, savedAt: Date.now() } });
}

export interface LoadedSession {
  session: Session;
  /** Not this tab's own session: another (or an earlier) tab used it. */
  fromOtherTab: boolean;
}

export function loadSession(code: string): LoadedSession | null {
  const c = code.toUpperCase();
  const own = read('sessionStorage', tabKey(c));
  if (isSession(own) && own.code.toUpperCase() === c) return { session: strip(own), fromOtherTab: false };
  const shared = readMap()[c];
  return shared ? { session: strip(shared), fromOtherTab: true } : null;
}

/**
 * Forgets this tab's session for the game, and the browser-wide one too when
 * it belongs to the same player (or when no playerId is given).
 */
export function clearSession(code: string, playerId?: string): void {
  const c = code.toUpperCase();
  const own = read('sessionStorage', tabKey(c));
  if (!playerId || !isSession(own) || own.playerId === playerId) write('sessionStorage', tabKey(c), null);
  const map = readMap();
  if (map[c] && (!playerId || map[c].playerId === playerId)) {
    delete map[c];
    write('localStorage', LOCAL_KEY, map);
  }
}

/** Every game this browser has a session for, newest first. */
export function listSessions(): Session[] {
  return Object.values(readMap())
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(strip);
}
