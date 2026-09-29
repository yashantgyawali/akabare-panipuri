/**
 * Client transport contract. The UI talks ONLY to a GameClient; two
 * implementations exist:
 *   - SupabaseGameClient: edge function `game` + Realtime broadcast/presence
 *   - LocalGameClient: the same server core running in the browser, persisted to
 *     localStorage and synced across tabs with BroadcastChannel (dev / offline /
 *     pass-and-play; open several tabs to simulate several players).
 * `getGameClient()` in src/net/index.ts picks Supabase when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are set and `?local` is not in the URL; otherwise local.
 */
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import type { ServerErrorCode, Snapshot } from '../server/types.ts';

export interface Session {
  code: string;
  playerId: PlayerId;
  token: string;
  name: string;
}

export interface GameClient {
  readonly mode: 'supabase' | 'local';
  createGame(name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }>;
  joinGame(code: string, name: string, color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }>;
  getSnapshot(session: Session): Promise<Snapshot>;
  updateLobby(
    session: Session,
    patch: { name?: string; color?: ColorId; config?: Partial<GameConfig> },
  ): Promise<Snapshot>;
  addBot(session: Session): Promise<Snapshot>;
  removePlayer(session: Session, playerId: PlayerId): Promise<Snapshot>;
  startGame(session: Session): Promise<Snapshot>;
  act(session: Session, action: Action): Promise<Snapshot>;
  setBot(session: Session, playerId: PlayerId, isBot: boolean): Promise<Snapshot>;
  rematch(session: Session): Promise<Snapshot>;
  leave(session: Session): Promise<void>;
  /**
   * Subscribe to version pings for a game (and presence). Returns unsubscribe.
   * onVersion fires whenever the server version changes; the caller refetches.
   */
  subscribe(
    code: string,
    playerId: PlayerId,
    handlers: { onVersion: (version: number) => void; onPresence?: (onlineIds: PlayerId[]) => void },
  ): () => void;
}

export class ApiError extends Error {
  readonly code: ServerErrorCode;
  constructor(code: ServerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}
