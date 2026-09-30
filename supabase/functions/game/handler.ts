/**
 * HTTP + op dispatch for the `game` edge function, over an abstract GameStore
 * (index.ts backs it with Postgres). No Deno or npm imports, so the same code
 * can be exercised locally against an in-memory store.
 *
 * Every response is a JSON ServerResponse envelope with CORS headers; the HTTP
 * status mirrors the error code. Tokens and game state are never logged.
 */
import * as core from './_lib/server/core.ts';
import { ServerError } from './_lib/server/core.ts';
import { generateCode, generateId, generateToken, hashToken, randomSeed } from './_lib/server/crypto.ts';
import type { Action, ColorId, PlayerId } from './_lib/engine/types.ts';
import type {
  GameRecord,
  JoinResult,
  LobbyPatch,
  ServerErrorCode,
  ServerResponse,
  Snapshot,
} from './_lib/server/types.ts';

/** One persisted game. `version` is the compare-and-set key (mirrors record.version). */
export interface GameRow {
  id: string;
  record: GameRecord;
  version: number;
}

export interface GameStore {
  findByCode(code: string): Promise<GameRow | null>;
  findById(id: string): Promise<GameRow | null>;
  /** Inserts a new game; resolves to its id, or null when the code is already taken. */
  insertGame(rec: GameRecord): Promise<string | null>;
  /** Writes `rec` only if the stored version is still `expectedVersion`; false = lost the race. */
  updateGame(id: string, expectedVersion: number, rec: GameRecord): Promise<boolean>;
  /** Deletes the game (tokens cascade) only if the stored version is still `expectedVersion`. */
  deleteGame(id: string, expectedVersion: number): Promise<boolean>;
  insertToken(gameId: string, tokenHash: string, playerId: PlayerId): Promise<void>;
  /** The player a token hash belongs to, scoped to one game. */
  findPlayer(gameId: string, tokenHash: string): Promise<PlayerId | null>;
  deleteTokens(gameId: string, playerId: PlayerId): Promise<void>;
  /** Deletes games not updated since `cutoffIso`. */
  pruneBefore(cutoffIso: string): Promise<void>;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export const HTTP_STATUS: Record<ServerErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  full: 409,
  color_taken: 409,
  wrong_status: 409,
  illegal_action: 409,
  conflict: 409,
  internal: 500,
};

const MAX_BODY_CHARS = 16_384;
const MAX_TOKEN_CHARS = 256;
const MAX_RETRIES = 5;
const CODE_ATTEMPTS = 8;
const PRUNE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export async function handleHttp(req: Request, store: GameStore): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return reply(400, fail('bad_request', 'Use POST.'));
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return reply(400, fail('bad_request', 'Request too large.'));
    body = JSON.parse(text);
  } catch {
    return reply(400, fail('bad_request', 'The request body must be JSON.'));
  }
  const op = isObject(body) && typeof body.op === 'string' ? body.op : '?';
  try {
    const data = await dispatch(body, store);
    return reply(200, { ok: true, data } satisfies ServerResponse<unknown>);
  } catch (e) {
    const err = toServerError(e);
    if (err.code === 'internal') console.error(`[game] ${op.slice(0, 20)} failed: ${e instanceof Error ? e.message : String(e)}`);
    return reply(HTTP_STATUS[err.code], fail(err.code, err.message));
  }
}

function reply(status: number, body: ServerResponse<unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const fail = (code: ServerErrorCode, message: string): ServerResponse<never> => ({ ok: false, error: { code, message } });

function toServerError(e: unknown): ServerError {
  if (e instanceof ServerError) return e;
  // Unexpected throws (bugs, network): the detail goes to the log, not the response.
  return new ServerError('internal', 'Something went wrong on the server. Please try again.');
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;
type Op = (b: Body, store: GameStore) => Promise<unknown>;

const OPS: Record<string, Op> = {
  create,
  join,
  get: async (b, store) => {
    const { row, me } = await authenticate(b, store);
    return core.snapshot(row.record, me);
  },
  updateLobby: (b, store) => {
    const patch = b.patch;
    if (!isObject(patch)) throw new ServerError('bad_request', 'Nothing to change.');
    return mutate(b, store, (rec, me, now) => core.updateLobby(rec, me, patch as LobbyPatch, now));
  },
  addBot: (b, store) => mutate(b, store, (rec, me, now) => core.addBot(rec, me, generateId(), now)),
  removePlayer: (b, store) => {
    const target = requireString(b.playerId, 'player');
    return mutate(b, store, (rec, me, now) => core.removePlayer(rec, me, target, now), (gameId) =>
      store.deleteTokens(gameId, target),
    );
  },
  start: (b, store) => mutate(b, store, (rec, me, now) => core.startGame(rec, me, randomSeed(), now)),
  act: (b, store) => {
    const action = b.action;
    if (!isObject(action)) throw new ServerError('bad_request', 'Missing action.');
    return mutate(b, store, (rec, me, now) => core.act(rec, me, action as unknown as Action, now, randomSeed()));
  },
  setBot: (b, store) => {
    const target = requireString(b.playerId, 'player');
    if (typeof b.isBot !== 'boolean') throw new ServerError('bad_request', 'isBot must be true or false.');
    const isBot = b.isBot;
    return mutate(b, store, (rec, me, now) => core.setBot(rec, me, target, isBot, now, randomSeed()));
  },
  rematch: (b, store) => mutate(b, store, (rec, me, now) => core.rematch(rec, me, now)),
  leave,
};

export function dispatch(body: unknown, store: GameStore): Promise<unknown> {
  if (!isObject(body)) throw new ServerError('bad_request', 'The request body must be a JSON object.');
  const op = typeof body.op === 'string' && Object.hasOwn(OPS, body.op) ? OPS[body.op] : null;
  if (!op) throw new ServerError('bad_request', 'Unknown op.');
  return op(body, store);
}

async function create(b: Body, store: GameStore): Promise<JoinResult> {
  const playerId = generateId();
  const token = generateToken();
  const color = optionalColor(b.color);
  // Validates name and color before touching the database.
  let rec = core.newRecord(generateCode(), { id: playerId, name: b.name as string, color }, nowIso());
  // Best-effort housekeeping, overlapped with the insert; awaited so the runtime doesn't cut it off.
  const pruning = store.pruneBefore(new Date(Date.now() - PRUNE_AFTER_MS).toISOString()).catch((e) => {
    console.error(`[game] prune failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  try {
    const hash = await hashToken(token);
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const gameId = await store.insertGame(rec);
      if (gameId) {
        try {
          await store.insertToken(gameId, hash, playerId);
        } catch (e) {
          await store.deleteGame(gameId, rec.version).catch(() => undefined);
          throw e;
        }
        return { playerId, token, snapshot: core.snapshot(rec, playerId) };
      }
      rec = { ...rec, code: generateCode() };
    }
    throw new ServerError('conflict', "Couldn't find a free game code. Please try again.");
  } finally {
    await pruning;
  }
}

async function join(b: Body, store: GameStore): Promise<JoinResult> {
  const row = await requireGame(store, requireCode(b.code));
  const player = { id: generateId(), name: b.name as string, color: optionalColor(b.color) };
  // Fail fast (bad name, full, taken color, already started) before creating a token.
  core.joinPlayer(row.record, player, nowIso());
  const token = generateToken();
  const hash = await hashToken(token);
  // Token first: if the join then fails, the token is removed; the reverse order could leave a seat nobody can use.
  await store.insertToken(row.id, hash, player.id);
  let rec: GameRecord;
  try {
    rec = (await commit(store, row, (r, now) => core.joinPlayer(r, player, now)))!;
  } catch (e) {
    await store.deleteTokens(row.id, player.id).catch(() => undefined);
    throw e;
  }
  return { playerId: player.id, token, snapshot: core.snapshot(rec, player.id) };
}

async function leave(b: Body, store: GameStore): Promise<null> {
  const { row, me } = await authenticate(b, store);
  const next = await commit(store, row, (rec, now) => core.leave(rec, me, now));
  // A null record means the game was deleted (tokens cascade); otherwise the seat is a bot or gone.
  if (next) await cleanupTokens(store, row.id, me);
  return null;
}

// ---------------------------------------------------------------------------
// Auth + optimistic concurrency
// ---------------------------------------------------------------------------

async function authenticate(b: Body, store: GameStore): Promise<{ row: GameRow; me: PlayerId }> {
  const code = requireCode(b.code);
  if (typeof b.token !== 'string') throw new ServerError('bad_request', 'Missing session token.');
  const token = b.token;
  const row = await requireGame(store, code);
  const me =
    token.length > 0 && token.length <= MAX_TOKEN_CHARS ? await store.findPlayer(row.id, await hashToken(token)) : null;
  if (!me) throw new ServerError('unauthorized', 'This session is no longer valid for this game.');
  return { row, me };
}

/** Authenticated read-modify-write returning the caller's snapshot. */
async function mutate(
  b: Body,
  store: GameStore,
  op: (rec: GameRecord, me: PlayerId, now: string) => GameRecord,
  after?: (gameId: string) => Promise<void>,
): Promise<Snapshot> {
  const { row, me } = await authenticate(b, store);
  const next = (await commit(store, row, (rec, now) => op(rec, me, now)))!;
  if (after) await after(row.id).catch(logCleanupError);
  return core.snapshot(next, me);
}

/**
 * Applies `op` to the freshest record and writes it only if nobody else wrote
 * in between (version compare-and-set), re-running `op` on lost races. A null
 * result deletes the game. Errors thrown by `op` (illegal moves etc.) pass through.
 */
async function commit(
  store: GameStore,
  first: GameRow,
  op: (rec: GameRecord, now: string) => GameRecord | null,
): Promise<GameRecord | null> {
  let row = first;
  for (let attempt = 0; ; attempt++) {
    const next = op(row.record, nowIso());
    const won = next
      ? await store.updateGame(row.id, row.version, next)
      : await store.deleteGame(row.id, row.version);
    if (won) return next;
    if (attempt >= MAX_RETRIES) throw new ServerError('conflict', 'The table is busy. Please try again.');
    await sleep(15 * 2 ** attempt + Math.random() * 40);
    const fresh = await store.findById(row.id);
    if (!fresh) throw new ServerError('not_found', 'This game no longer exists.');
    row = fresh;
  }
}

async function cleanupTokens(store: GameStore, gameId: string, playerId: PlayerId): Promise<void> {
  await store.deleteTokens(gameId, playerId).catch(logCleanupError);
}

function logCleanupError(e: unknown): void {
  console.error(`[game] token cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
    throw new ServerError('bad_request', `Missing or invalid ${what}.`);
  }
  return v;
}

/** A malformed code can't name a game, so it is 'not_found' (like local mode); a missing one is 'bad_request'. */
function requireCode(v: unknown): string {
  if (typeof v !== 'string') throw new ServerError('bad_request', 'Missing game code.');
  const code = core.normalizeCode(v);
  if (!code) throw new ServerError('not_found', `There's no game with code "${v.trim().slice(0, 12)}".`);
  return code;
}

/** Type check only; the core rejects unknown colors. */
function optionalColor(v: unknown): ColorId | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ServerError('bad_request', 'Invalid color.');
  return v as ColorId;
}

async function requireGame(store: GameStore, code: string): Promise<GameRow> {
  const row = await store.findByCode(code);
  if (!row) throw new ServerError('not_found', `There's no game with code "${code}".`);
  return row;
}

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
