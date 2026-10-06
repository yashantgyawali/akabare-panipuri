/**
 * Pure rule helpers: config, power availability, seeded PRNG, small lookups.
 * No state transitions live here (see engine.ts).
 */
import {
  DEFAULT_CONFIG,
  MAX_PLAYERS,
  POWER_KINDS,
  type GameConfig,
  type GameState,
  type PlayerId,
  type PlayerState,
  type PowerKind,
  type PuriCard,
  type PuriKind,
} from './types.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** DEFAULT_CONFIG overlaid with the known, defined keys of `partial`. Unknown keys are dropped. */
export function resolveConfig(partial?: Partial<GameConfig> | null): GameConfig {
  const out: GameConfig = { ...DEFAULT_CONFIG };
  if (!partial || typeof partial !== 'object') return out;
  const target = out as unknown as Record<string, unknown>;
  const source = partial as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return out;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function intError(name: string, v: unknown, min: number, max: number, nullable = false): string | null {
  if (nullable && v === null) return null;
  if (isInt(v) && v >= min && v <= max) return null;
  return `${name} must be a whole number from ${min} to ${max}${nullable ? ' (or null)' : ''}.`;
}

/** Human-readable problems with a config; empty = valid. */
export function validateConfig(config: GameConfig): string[] {
  if (!config || typeof config !== 'object') return ['Config must be an object.'];
  const c = config;
  const errors = [
    intError('targetScore', c.targetScore, 1, 1000, true),
    intError('maxRounds', c.maxRounds, 1, 100, true),
    intError('trapReward', c.trapReward, 0, 100),
    intError('panipuriPerPlayer', c.panipuriPerPlayer, 1, 20),
    intError('powerFlipsMax', c.powerFlipsMax, 1, MAX_PLAYERS),
    // A reset cycle longer than the number of powers would leave a round with nothing to pick.
    intError('powerResetRound', c.powerResetRound, 2, POWER_KINDS.length + 1),
    intError('minBid', c.minBid, 1, 100),
  ].filter((e): e is string => e !== null);
  const setSize = isInt(c.panipuriPerPlayer) ? c.panipuriPerPlayer + 1 : 21;
  const stackError = intError('startingStack', c.startingStack, 1, setSize);
  if (stackError) {
    errors.push(`${stackError.slice(0, -1)} (at most the ${setSize} cards in a set).`);
  }
  if (c.targetScore === null && c.maxRounds === null) {
    errors.push('targetScore and maxRounds cannot both be null: the game would never end.');
  }
  if (typeof c.revealOnRoundEnd !== 'boolean') errors.push('revealOnRoundEnd must be true or false.');
  return errors;
}

// ---------------------------------------------------------------------------
// Powers
// ---------------------------------------------------------------------------

/** True when the used-power set is cleared at the start of `round` (rounds 1, R, 2R-1, …). */
export function isPowerResetRound(round: number, powerResetRound: number): boolean {
  return (round - 1) % (powerResetRound - 1) === 0;
}

/** Powers `playerId` may pick in the current round's setup: all 4 minus the used set. */
export function availablePowers(state: GameState, playerId: PlayerId): PowerKind[] {
  const player = findPlayer(state, playerId);
  if (!player) return [];
  return POWER_KINDS.filter((k) => !player.usedPowers.includes(k));
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) as pure functions over a uint32 state
// ---------------------------------------------------------------------------

export type Rand = () => number;

/** One mulberry32 step: returns [value in [0, 1), next state]. */
export function mulberry32(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Uniform integer in [0, n): returns [value, next state]. */
export function randomInt(state: number, n: number): [number, number] {
  const [v, next] = mulberry32(state);
  return [Math.floor(v * n), next];
}

/** A stateful Rand closure over a seed, for code that needs several draws; read the final state back. */
export function randStream(seed: number): { rand: Rand; state: () => number } {
  let s = seed >>> 0;
  return {
    rand: () => {
      const [v, next] = mulberry32(s);
      s = next;
      return v;
    },
    state: () => s,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function playerName(state: GameState, id: PlayerId): string {
  return findPlayer(state, id)?.name ?? id;
}

/** Id of the next seat clockwise from `id`, skipping ids in `skip`. Returns `id` if all others are skipped. */
export function nextSeatId(state: GameState, id: PlayerId, skip: readonly PlayerId[] = []): PlayerId {
  const n = state.players.length;
  const from = state.players.findIndex((p) => p.id === id);
  for (let step = 1; step <= n; step++) {
    const candidate = state.players[(from + step) % n].id;
    if (!skip.includes(candidate)) return candidate;
  }
  return id;
}

/** A player's full puri set, in canonical order: `${id}:p1..pN`, then `${id}:a`. */
export function fullSet(ownerId: PlayerId, config: GameConfig): PuriCard[] {
  const cards: PuriCard[] = [];
  for (let i = 1; i <= config.panipuriPerPlayer; i++) {
    cards.push({ id: `${ownerId}:p${i}`, owner: ownerId, kind: 'panipuri' });
  }
  cards.push({ id: `${ownerId}:a`, owner: ownerId, kind: 'akabare' });
  return cards;
}

export function countKinds(cards: readonly { kind: PuriKind }[]): { panipuri: number; akabare: number } {
  let akabare = 0;
  for (const c of cards) if (c.kind === 'akabare') akabare++;
  return { panipuri: cards.length - akabare, akabare };
}

/** Removes and returns the first card of `kind` from `cards` (mutates), or null. */
export function takeCard(cards: PuriCard[], kind: PuriKind): PuriCard | null {
  const i = cards.findIndex((c) => c.kind === kind);
  return i < 0 ? null : cards.splice(i, 1)[0];
}

export function isTableEmpty(state: GameState): boolean {
  return state.players.every((p) => p.stack.length === 0);
}

export function faceDownPuriCount(state: GameState): number {
  return state.players.reduce((n, p) => n + p.stack.length, 0);
}

/** Public soft-bid bound (decision 14): face-down puri cards on the table + 2 × powerFlipsMax. */
export function tableMax(state: GameState): number {
  return faceDownPuriCount(state) + 2 * state.config.powerFlipsMax;
}

/** The eater may still flip a power: flips remain and some power is face down. */
export function canFlipPower(state: GameState): boolean {
  const e = state.eating;
  if (!e || e.powersFlipped >= state.config.powerFlipsMax) return false;
  return state.players.some((p) => p.power !== null && !p.power.revealed);
}

export const POWER_LABELS: Record<PowerKind, string> = {
  vinegar: 'Vinegar',
  dahi: 'Dahi',
  nayaplate: 'Naya Plate',
  chaat: 'Chaat',
};

export const PURI_LABELS: Record<PuriKind, string> = {
  panipuri: 'Panipuri',
  akabare: 'Akabare',
};
