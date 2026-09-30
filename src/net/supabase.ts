/**
 * PLACEHOLDER so imports resolve; the Supabase agent replaces this file.
 * Keep the constructor signature `(url, anonKey)`: src/net/index.ts builds the
 * client that way.
 */
import type { Action, ColorId, GameConfig, PlayerId } from '../engine/types.ts';
import type { Snapshot } from '../server/types.ts';
import { ApiError, type GameClient, type Session } from './types.ts';

const notConfigured = (): Promise<never> =>
  Promise.reject(new ApiError('internal', 'The online server is not configured yet. Add ?local to play locally.'));

export class SupabaseGameClient implements GameClient {
  readonly mode = 'supabase' as const;
  constructor(
    readonly url: string,
    readonly anonKey: string,
  ) {}
  createGame(_name: string, _color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return notConfigured();
  }
  joinGame(_code: string, _name: string, _color?: ColorId): Promise<{ session: Session; snapshot: Snapshot }> {
    return notConfigured();
  }
  getSnapshot(_session: Session): Promise<Snapshot> {
    return notConfigured();
  }
  updateLobby(_session: Session, _patch: { name?: string; color?: ColorId; config?: Partial<GameConfig> }): Promise<Snapshot> {
    return notConfigured();
  }
  addBot(_session: Session): Promise<Snapshot> {
    return notConfigured();
  }
  removePlayer(_session: Session, _playerId: PlayerId): Promise<Snapshot> {
    return notConfigured();
  }
  startGame(_session: Session): Promise<Snapshot> {
    return notConfigured();
  }
  act(_session: Session, _action: Action): Promise<Snapshot> {
    return notConfigured();
  }
  setBot(_session: Session, _playerId: PlayerId, _isBot: boolean): Promise<Snapshot> {
    return notConfigured();
  }
  rematch(_session: Session): Promise<Snapshot> {
    return notConfigured();
  }
  leave(_session: Session): Promise<void> {
    return notConfigured();
  }
  subscribe(
    _code: string,
    _playerId: PlayerId,
    _handlers: { onVersion: (version: number) => void; onPresence?: (onlineIds: PlayerId[]) => void },
  ): () => void {
    return () => {};
  }
}
