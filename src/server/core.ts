/**
 * Server core: pure lobby + game logic over a GameRecord, shared by the
 * Supabase edge function and the in-browser LocalGameClient. Storage, tokens,
 * clocks and randomness live in the wrappers; everything here takes ids,
 * `now` (ISO string) and seeds as parameters.
 *
 * Every mutation returns a NEW record with version + 1 and updatedAt = now, or
 * throws ServerError. Inputs are never mutated.
 *
 *   newRecord(code, host, now)                         host = { id, name, color? }
 *   joinPlayer(rec, player, now)                       player = { id, name, color? }
 *   updateLobby(rec, actorId, patch, now)
 *   addBot(rec, actorId, botId, now)
 *   removePlayer(rec, actorId, targetId, now)
 *   startGame(rec, actorId, seed, now)
 *   act(rec, actorId, action, now)
 *   setBot(rec, actorId, targetId, isBot, now)
 *   rematch(rec, actorId, now)
 *   leave(rec, actorId, now)                           → GameRecord | null (null = delete the game)
 *   snapshot(rec, playerId)                            → Snapshot (never the raw state)
 *
 * The wrapper resolves token → playerId; an actor who is not in the record is
 * 'unauthorized' (e.g. removed by the host).
 */
import {
  COLORS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  createGame,
  projectView,
  resolveConfig,
  runBots,
  setBot as engineSetBot,
  validateConfig,
  type Action,
  type ColorId,
  type GameState,
  type PlayerId,
} from '../engine/index.ts';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_NAME_LENGTH,
  type GameRecord,
  type LobbyPatch,
  type LobbyPlayer,
  type ServerErrorCode,
  type Snapshot,
} from './types.ts';

export class ServerError extends Error {
  readonly code: ServerErrorCode;
  constructor(code: ServerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ServerError';
  }
}

export const BOT_NAMES = ['Sita', 'Ramesh', 'Anil', 'Priya', 'Maya', 'Hari', 'Gita', 'Bikash'] as const;

export interface NewPlayer {
  id: PlayerId;
  name: string;
  color?: ColorId;
}

// ---------------------------------------------------------------------------
// Validation helpers (exported for wrappers)
// ---------------------------------------------------------------------------

/** Upper-cased, trimmed join code, or null if it can't be one. */
export function normalizeCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  if (c.length !== CODE_LENGTH) return null;
  return [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

/** Trimmed display name with control characters removed and whitespace collapsed; throws bad_request. */
export function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new ServerError('bad_request', 'Enter a name.');
  // deno-lint-ignore no-control-regex
  const n = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length === 0) throw new ServerError('bad_request', 'Enter a name.');
  if ([...n].length > MAX_NAME_LENGTH) {
    throw new ServerError('bad_request', `Names can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return n;
}

const isColor = (c: unknown): c is ColorId => (COLORS as readonly unknown[]).includes(c);

function freeColor(players: readonly LobbyPlayer[]): ColorId {
  const c = COLORS.find((col) => !players.some((p) => p.color === col));
  if (!c) throw new ServerError('full', 'The table is full.');
  return c;
}

function pickColor(players: readonly LobbyPlayer[], color: ColorId | undefined, selfId?: PlayerId): ColorId {
  if (color === undefined || color === null) return freeColor(players);
  if (!isColor(color)) throw new ServerError('bad_request', `Unknown color "${String(color)}".`);
  const holder = players.find((p) => p.color === color && p.id !== selfId);
  if (holder) throw new ServerError('color_taken', `${holder.name} already has ${color}.`);
  return color;
}

function findLobbyPlayer(rec: GameRecord, id: PlayerId): LobbyPlayer | undefined {
  return rec.players.find((p) => p.id === id);
}

function requireMember(rec: GameRecord, id: PlayerId): LobbyPlayer {
  const p = findLobbyPlayer(rec, id);
  if (!p) throw new ServerError('unauthorized', "You're not in this game any more.");
  return p;
}

function requireHost(rec: GameRecord, actorId: PlayerId, what: string): void {
  requireMember(rec, actorId);
  if (rec.hostId !== actorId) throw new ServerError('forbidden', `Only the host can ${what}.`);
}

function requireStatus(rec: GameRecord, status: GameRecord['status'], what: string): void {
  if (rec.status === status) return;
  const now = { lobby: 'in the lobby', playing: 'in progress', finished: 'over' }[rec.status];
  throw new ServerError('wrong_status', `Can't ${what}: the game is ${now}.`);
}

function requireRoom(rec: GameRecord): void {
  if (rec.players.length >= MAX_PLAYERS) {
    throw new ServerError('full', `The table is full (${MAX_PLAYERS} players).`);
  }
}

// ---------------------------------------------------------------------------
// Record plumbing
// ---------------------------------------------------------------------------

function bump(rec: GameRecord, now: string, changes: Partial<GameRecord>): GameRecord {
  return { ...rec, ...changes, version: rec.version + 1, updatedAt: now };
}

/** Seats are contiguous and follow array order. */
function reseat(players: readonly LobbyPlayer[]): LobbyPlayer[] {
  return players.map((p, seat) => ({ ...p, seat }));
}

/** First human after `fromId` in seat order (wrapping), excluding `fromId` itself. */
function nextHuman(players: readonly LobbyPlayer[], fromId: PlayerId): LobbyPlayer | undefined {
  const i = players.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= players.length; k++) {
    const p = players[(i + k) % players.length];
    if (p.id !== fromId && !p.isBot) return p;
  }
  return undefined;
}

/** Runs bots, then derives status and mirrors isBot flags from the state. */
function withState(rec: GameRecord, state: GameState, now: string, players = rec.players): GameRecord {
  const settled = runBots(state).state;
  const bots = new Map(settled.players.map((p) => [p.id, p.isBot]));
  return bump(rec, now, {
    state: settled,
    status: settled.phase === 'gameOver' ? 'finished' : 'playing',
    players: players.map((p) => ({ ...p, isBot: bots.get(p.id) ?? p.isBot })),
  });
}

function engineCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ServerError) throw e;
    throw new ServerError('bad_request', e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export function newRecord(code: string, host: NewPlayer, now: string): GameRecord {
  const c = normalizeCode(code);
  if (!c) throw new ServerError('bad_request', 'Invalid game code.');
  const name = cleanName(host.name);
  const color = pickColor([], host.color);
  return {
    code: c,
    hostId: host.id,
    status: 'lobby',
    config: resolveConfig(null),
    players: [{ id: host.id, name, color, seat: 0, isBot: false }],
    state: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function joinPlayer(rec: GameRecord, player: NewPlayer, now: string): GameRecord {
  requireStatus(rec, 'lobby', 'join');
  requireRoom(rec);
  if (findLobbyPlayer(rec, player.id)) throw new ServerError('conflict', 'That player id is already taken.');
  const name = cleanName(player.name);
  const color = pickColor(rec.players, player.color);
  const seat = rec.players.length;
  return bump(rec, now, { players: [...rec.players, { id: player.id, name, color, seat, isBot: false }] });
}

export function updateLobby(rec: GameRecord, actorId: PlayerId, patch: LobbyPatch, now: string): GameRecord {
  requireMember(rec, actorId);
  requireStatus(rec, 'lobby', 'change the lobby');
  if (!patch || typeof patch !== 'object') throw new ServerError('bad_request', 'Nothing to change.');
  let config = rec.config;
  if (patch.config !== undefined) {
    requireHost(rec, actorId, 'change the rules');
    if (!patch.config || typeof patch.config !== 'object') throw new ServerError('bad_request', 'Invalid rules.');
    const defined = Object.entries(patch.config).filter(([, v]) => v !== undefined);
    config = resolveConfig({ ...rec.config, ...Object.fromEntries(defined) });
    const errors = validateConfig(config);
    if (errors.length > 0) throw new ServerError('bad_request', errors.join(' '));
  }
  const name = patch.name !== undefined ? cleanName(patch.name) : undefined;
  const color = patch.color !== undefined ? pickColor(rec.players, patch.color, actorId) : undefined;
  const players = rec.players.map((p) =>
    p.id === actorId ? { ...p, name: name ?? p.name, color: color ?? p.color } : p,
  );
  return bump(rec, now, { config, players });
}

export function addBot(rec: GameRecord, actorId: PlayerId, botId: PlayerId, now: string): GameRecord {
  requireHost(rec, actorId, 'add bots');
  requireStatus(rec, 'lobby', 'add a bot');
  requireRoom(rec);
  if (findLobbyPlayer(rec, botId)) throw new ServerError('conflict', 'That player id is already taken.');
  const used = new Set(rec.players.map((p) => p.name.toLowerCase()));
  const name =
    BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ??
    `Bot ${rec.players.length + 1}`;
  const bot: LobbyPlayer = { id: botId, name, color: freeColor(rec.players), seat: rec.players.length, isBot: true };
  return bump(rec, now, { players: [...rec.players, bot] });
}

export function removePlayer(rec: GameRecord, actorId: PlayerId, targetId: PlayerId, now: string): GameRecord {
  requireHost(rec, actorId, 'remove players');
  requireStatus(rec, 'lobby', 'remove a player');
  if (targetId === actorId) throw new ServerError('bad_request', "The host can't remove themselves. Leave instead.");
  if (!findLobbyPlayer(rec, targetId)) throw new ServerError('not_found', 'That player is not in this game.');
  return bump(rec, now, { players: reseat(rec.players.filter((p) => p.id !== targetId)) });
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export function startGame(rec: GameRecord, actorId: PlayerId, seed: number, now: string): GameRecord {
  requireHost(rec, actorId, 'start the game');
  requireStatus(rec, 'lobby', 'start');
  const n = rec.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new ServerError('bad_request', `You need ${MIN_PLAYERS} to ${MAX_PLAYERS} players to start (you have ${n}).`);
  }
  const seats = [...rec.players].sort((a, b) => a.seat - b.seat);
  const state = engineCall(() =>
    createGame(
      seats.map(({ id, name, color, isBot }) => ({ id, name, color, isBot })),
      rec.config,
      seed >>> 0,
    ),
  );
  return withState(rec, state, now, reseat(seats));
}

export function act(rec: GameRecord, actorId: PlayerId, action: Action, now: string): GameRecord {
  requireMember(rec, actorId);
  requireStatus(rec, 'playing', 'play');
  if (action?.type === 'FORCE_CONTINUE' && rec.hostId !== actorId) {
    throw new ServerError('forbidden', 'Only the host can continue before everyone is ready.');
  }
  const result = applyAction(rec.state!, actorId, action);
  if (!result.ok) throw new ServerError('illegal_action', result.error);
  return withState(rec, result.state, now);
}

/**
 * The host may hand anyone's seat to a bot; a player may hand their own seat to
 * a bot and take it back. Only the player can take a seat back (a bot seat has
 * no token holder, so un-botting someone else would stall the game).
 */
export function setBot(rec: GameRecord, actorId: PlayerId, targetId: PlayerId, isBot: boolean, now: string): GameRecord {
  requireMember(rec, actorId);
  if (typeof isBot !== 'boolean') throw new ServerError('bad_request', 'isBot must be true or false.');
  if (!findLobbyPlayer(rec, targetId)) throw new ServerError('not_found', 'That player is not in this game.');
  if (targetId !== actorId && (!isBot || rec.hostId !== actorId)) {
    throw new ServerError('forbidden', isBot ? 'Only the host can replace players with bots.' : 'Only that player can take their seat back.');
  }
  if (rec.status === 'finished') throw new ServerError('wrong_status', "Can't change seats: the game is over.");
  const players = rec.players.map((p) => (p.id === targetId ? { ...p, isBot } : p));
  if (rec.status === 'lobby') return bump(rec, now, { players });
  return withState(rec, engineSetBot(rec.state!, targetId, isBot), now, players);
}

export function rematch(rec: GameRecord, actorId: PlayerId, now: string): GameRecord {
  requireHost(rec, actorId, 'start a rematch');
  requireStatus(rec, 'finished', 'rematch');
  return bump(rec, now, { status: 'lobby', state: null, players: reseat(rec.players) });
}

/**
 * Lobby: the player is removed. Playing/finished: their seat becomes a bot.
 * A leaving host hands over to the next human. Returns null when no human is
 * left, meaning the wrapper should delete the game.
 */
export function leave(rec: GameRecord, actorId: PlayerId, now: string): GameRecord | null {
  requireMember(rec, actorId);
  const heir = nextHuman(rec.players, actorId);
  if (!heir) return null;
  const hostId = rec.hostId === actorId ? heir.id : rec.hostId;
  if (rec.status === 'lobby') {
    return bump(rec, now, { hostId, players: reseat(rec.players.filter((p) => p.id !== actorId)) });
  }
  const players = rec.players.map((p) => (p.id === actorId ? { ...p, isBot: true } : p));
  const state = engineSetBot(rec.state!, actorId, true);
  if (rec.status === 'finished') return bump(rec, now, { hostId, players, state });
  return withState({ ...rec, hostId }, state, now, players);
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** What `playerId` may see. The raw GameState never leaves through here. */
export function snapshot(rec: GameRecord, playerId: PlayerId): Snapshot {
  requireMember(rec, playerId);
  const view = rec.state ? projectView(rec.state, playerId) : null;
  // The engine allows FORCE_CONTINUE from anyone; the server only from the host.
  if (view && rec.hostId !== playerId) view.legal.forceContinue = false;
  return {
    code: rec.code,
    status: rec.status,
    hostId: rec.hostId,
    version: rec.version,
    config: { ...rec.config },
    players: rec.players.map((p) => ({ ...p })),
    youId: playerId,
    view,
  };
}
