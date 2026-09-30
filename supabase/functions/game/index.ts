/**
 * `game` edge function (Deno): the server-authoritative Akabare Panipuri API.
 *
 *   POST { op, ... } → ServerResponse (see _lib/server/types.ts)
 *
 * Request handling lives in handler.ts; this file wires it to Postgres through
 * the service role. The engine and server core under _lib/ are copies made by
 * `npm run sync:function`; edit src/, not _lib/.
 */
import { createClient, type PostgrestError } from 'npm:@supabase/supabase-js@2';
import { CORS_HEADERS, handleHttp, type GameRow, type GameStore } from './handler.ts';
import { ServerError } from './_lib/server/core.ts';
import type { GameRecord } from './_lib/server/types.ts';

const GAMES = 'akabare_games';
const TOKENS = 'akabare_tokens';
const UNIQUE_VIOLATION = '23505';

function dbError(error: PostgrestError): ServerError {
  // Code + message only: `details` can echo row values.
  console.error(`[game] database error ${error.code}: ${error.message}`);
  return new ServerError('internal', 'The game database is unavailable. Please try again.');
}

function toRow(data: { id: string; record: GameRecord; version: number } | null): GameRow | null {
  return data ? { id: data.id, record: data.record, version: data.version } : null;
}

function postgresStore(url: string, serviceKey: string): GameStore {
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const games = () => db.from(GAMES);
  const tokens = () => db.from(TOKENS);

  return {
    async findByCode(code) {
      const { data, error } = await games().select('id, record, version').eq('code', code).maybeSingle();
      if (error) throw dbError(error);
      return toRow(data);
    },
    async findById(id) {
      const { data, error } = await games().select('id, record, version').eq('id', id).maybeSingle();
      if (error) throw dbError(error);
      return toRow(data);
    },
    async insertGame(rec) {
      const { data, error } = await games()
        .insert({ code: rec.code, status: rec.status, record: rec, version: rec.version })
        .select('id')
        .single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw dbError(error);
      return data.id as string;
    },
    async updateGame(id, expectedVersion, rec) {
      const { data, error } = await games()
        .update({ record: rec, status: rec.status, version: rec.version })
        .eq('id', id)
        .eq('version', expectedVersion)
        .select('id');
      if (error) throw dbError(error);
      return data.length === 1;
    },
    async deleteGame(id, expectedVersion) {
      const { data, error } = await games().delete().eq('id', id).eq('version', expectedVersion).select('id');
      if (error) throw dbError(error);
      return data.length === 1;
    },
    async insertToken(gameId, tokenHash, playerId) {
      const { error } = await tokens().insert({ token_hash: tokenHash, game_id: gameId, player_id: playerId });
      if (error) throw dbError(error);
    },
    async findPlayer(gameId, tokenHash) {
      const { data, error } = await tokens()
        .select('player_id')
        .eq('token_hash', tokenHash)
        .eq('game_id', gameId)
        .maybeSingle();
      if (error) throw dbError(error);
      return data ? (data.player_id as string) : null;
    },
    async deleteTokens(gameId, playerId) {
      const { error } = await tokens().delete().eq('game_id', gameId).eq('player_id', playerId);
      if (error) throw dbError(error);
    },
    async pruneBefore(cutoffIso) {
      const { error } = await games().delete().lt('updated_at', cutoffIso);
      if (error) throw dbError(error);
    },
  };
}

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const store = url && serviceKey ? postgresStore(url, serviceKey) : null;

Deno.serve((req) => {
  if (store) return handleHttp(req, store);
  console.error('[game] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  const body = { ok: false, error: { code: 'internal', message: 'The game server is not configured.' } };
  return new Response(JSON.stringify(body), {
    status: 500,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
