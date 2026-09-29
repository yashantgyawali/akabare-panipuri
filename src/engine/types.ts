/**
 * Akabare Panipuri — shared engine contract (rules v0.6).
 *
 * This file is the single source of truth for the shapes that flow between the
 * pure game engine, the server (Supabase Edge Function + in-browser local
 * server), and the React UI. It must stay dependency-free and Deno-compatible:
 * relative imports inside src/engine use explicit `.ts` extensions.
 *
 * Hidden-information rule of thumb: `GameState` is SECRET (server only).
 * Clients only ever receive a `PlayerView` produced by `projectView`.
 */

export const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'] as const;
export type ColorId = (typeof COLORS)[number];

export const PURI_KINDS = ['panipuri', 'akabare'] as const;
export type PuriKind = (typeof PURI_KINDS)[number];

export const POWER_KINDS = ['vinegar', 'dahi', 'khali', 'chaat'] as const;
export type PowerKind = (typeof POWER_KINDS)[number];

/** Opaque, public player identifier (uuid-like). Never a secret. */
export type PlayerId = string;

export type Phase = 'setup' | 'serving' | 'bidding' | 'eating' | 'roundEnd' | 'gameOver';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GameConfig {
  /** First to reach this at the end of a round triggers the win. null = no target (play all rounds). Default 30. */
  targetScore: number | null;
  /** Game ends after this round. null = no round limit (targetScore must then be set). Default 5. */
  maxRounds: number | null;
  /** Points to the owner of the Akabare that busts the eater. Default 2. */
  trapReward: number;
  /** Puri cards each player places face down on their own stack during setup. Default 2. */
  startingStack: number;
  /** Panipuri cards per player set (plus exactly 1 Akabare). Default 5. */
  panipuriPerPlayer: number;
  /** Max power cards the eater may flip per round. Default 2. */
  powerFlipsMax: number;
  /**
   * Round in which all 4 powers come back. Default 4. Generalised as a cycle:
   * the used-power set is cleared at the start of rounds 1, R, 2R-1, 3R-2, …
   * i.e. whenever (round - 1) % (R - 1) === 0.
   */
  powerResetRound: number;
  /** Minimum opening bid. Default 1. */
  minBid: number;
  /** If true, every leftover face-down card and power is revealed to everyone during roundEnd. Default false. */
  revealOnRoundEnd: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  targetScore: 30,
  maxRounds: 5,
  trapReward: 2,
  startingStack: 2,
  panipuriPerPlayer: 5,
  powerFlipsMax: 2,
  powerResetRound: 4,
  minBid: 1,
  revealOnRoundEnd: false,
};

// ---------------------------------------------------------------------------
// Secret state (server only)
// ---------------------------------------------------------------------------

export interface PlayerSeed {
  id: PlayerId;
  name: string;
  color: ColorId;
  isBot: boolean;
}

export interface PuriCard {
  /** Stable id, e.g. `${ownerId}:p3` / `${ownerId}:a`. SECRET — never sent for face-down cards of other owners. */
  id: string;
  /** The player whose set (color) this card belongs to. Drives the trap reward. */
  owner: PlayerId;
  kind: PuriKind;
}

export interface PowerSlot {
  kind: PowerKind;
  revealed: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: ColorId;
  isBot: boolean;
  /** 0-based clockwise seat index; equals index in GameState.players. */
  seat: number;
  score: number;
  busts: number;
  /** Puri cards in hand. */
  hand: PuriCard[];
  /** This player's stack on the table. index 0 = bottom, last = top. May hold other owners' cards. */
  stack: PuriCard[];
  /** Power card placed face down beside this player's stack this round (null until setup submitted). */
  power: PowerSlot | null;
  /** Powers used since the last reset — drives availability. */
  usedPowers: PowerKind[];
  /** Power picked each round (index = round - 1). Private to the player. */
  powerPicks: PowerKind[];
  /** Setup submitted for the current round. */
  setupDone: boolean;
  /** Ready to continue from roundEnd. */
  ready: boolean;
}

export interface ServingState {
  turnId: PlayerId;
}

export interface BidEntry {
  playerId: PlayerId;
  action: 'start' | 'raise' | 'pass';
  amount?: number;
}

export interface BiddingState {
  starterId: PlayerId;
  highBid: number;
  highBidderId: PlayerId;
  turnId: PlayerId;
  passed: PlayerId[];
  history: BidEntry[];
}

export interface EatenCard {
  card: PuriCard;
  fromStackOf: PlayerId;
  /** Cancelled by Vinegar (counts for nothing, harms nothing). */
  cancelled: boolean;
  /** An Akabare neutralised by Dahi. */
  saved: boolean;
}

/**
 * What a flipped power did:
 * - numb: Vinegar armed (next puri flip is cancelled)
 * - saved: Dahi flipped while an Akabare was pending → saved
 * - failedSave: non-Dahi flipped while an Akabare was pending → bust
 * - wasted: flipped with no effect (Dahi without a pending Akabare, or Vinegar while already numb)
 * - targetUp: Khali Puri, target +1
 * - plusTwo: Chaat, eaten +2
 */
export type PowerEffect = 'numb' | 'saved' | 'failedSave' | 'wasted' | 'targetUp' | 'plusTwo';

export interface FlippedPower {
  kind: PowerKind;
  owner: PlayerId;
  fromStackOf: PlayerId;
  effect: PowerEffect;
}

export interface PendingAkabare {
  card: PuriCard;
  fromStackOf: PlayerId;
}

export interface EatingState {
  eaterId: PlayerId;
  /** Winning bid as bid. */
  bid: number;
  /** bid + 1 per Khali Puri flipped. */
  target: number;
  /** Panipuri eaten + 2 per Chaat. */
  eaten: number;
  powersFlipped: number;
  /** Set by Vinegar, cleared by the next puri flip. */
  skipNext: boolean;
  /** Bitten Akabare awaiting FLIP_POWER (Dahi hope) or ACCEPT_BUST. */
  pendingAkabare: PendingAkabare | null;
  /** Puri cards flipped this round, in order. */
  plate: EatenCard[];
  /** Powers flipped this round, in order. */
  powers: FlippedPower[];
}

export type RoundOutcome = 'success' | 'bust';
export type BustReason = 'akabare' | 'emptyTable';

export interface RoundResult {
  round: number;
  eaterId: PlayerId;
  bid: number;
  /** Final bid incl. Khali Puri increases — the amount won or lost. */
  target: number;
  eaten: number;
  outcome: RoundOutcome;
  bustReason: BustReason | null;
  /** Owner of the Akabare that caused the bust (may equal eaterId). */
  akabareOwnerId: PlayerId | null;
  /** Receives trapReward (null if none: own Akabare, empty table, success). */
  trapRewardTo: PlayerId | null;
  scoreDeltas: Record<PlayerId, number>;
  scoresAfter: Record<PlayerId, number>;
}

/** Public, append-only game log. Events never contain hidden information. */
export type GameEventBody =
  | { type: 'roundStart'; firstPlayerId: PlayerId; availablePowersReset: boolean }
  | { type: 'setupDone'; playerId: PlayerId }
  | { type: 'servingStart'; turnId: PlayerId }
  | { type: 'place'; playerId: PlayerId; onStackOf: PlayerId }
  | { type: 'bidStart'; playerId: PlayerId; amount: number }
  | { type: 'raise'; playerId: PlayerId; amount: number }
  | { type: 'pass'; playerId: PlayerId }
  | { type: 'eater'; playerId: PlayerId; bid: number }
  | {
      type: 'flipPuri';
      eaterId: PlayerId;
      fromStackOf: PlayerId;
      owner: PlayerId;
      kind: PuriKind;
      cancelled: boolean;
      eaten: number;
      target: number;
    }
  | { type: 'bite'; eaterId: PlayerId; fromStackOf: PlayerId; owner: PlayerId }
  | {
      type: 'flipPower';
      eaterId: PlayerId;
      fromStackOf: PlayerId;
      owner: PlayerId;
      kind: PowerKind;
      effect: PowerEffect;
      eaten: number;
      target: number;
    }
  | { type: 'success'; eaterId: PlayerId; target: number; eaten: number }
  | {
      type: 'bust';
      eaterId: PlayerId;
      reason: BustReason;
      target: number;
      eaten: number;
      akabareOwnerId: PlayerId | null;
      trapRewardTo: PlayerId | null;
    }
  | { type: 'roundEnd'; result: RoundResult }
  | { type: 'ready'; playerId: PlayerId }
  | { type: 'gameOver'; winners: PlayerId[]; scores: Record<PlayerId, number> }
  | { type: 'botSet'; playerId: PlayerId; isBot: boolean };

export type GameEvent = GameEventBody & { seq: number; round: number };

export interface GameState {
  config: GameConfig;
  /** Seat order = clockwise order. */
  players: PlayerState[];
  /** 1-based. */
  round: number;
  phase: Phase;
  firstPlayerId: PlayerId;
  serving: ServingState | null;
  bidding: BiddingState | null;
  eating: EatingState | null;
  results: RoundResult[];
  winners: PlayerId[] | null;
  /** Full public log (append-only). Views include only the tail. */
  log: GameEvent[];
  nextSeq: number;
  /** Deterministic PRNG state (mulberry32). Used for round-1 first player and bot decisions. */
  rng: number;
}

// ---------------------------------------------------------------------------
// Actions (client → server)
// ---------------------------------------------------------------------------

export type Action =
  /** Setup: choose `startingStack` puri kinds for your stack, listed bottom → top, and one available power. Re-submittable until the phase advances. */
  | { type: 'SUBMIT_SETUP'; stack: PuriKind[]; power: PowerKind }
  /** Serving (your turn): put one puri card of this kind from your hand on top of any stack. */
  | { type: 'PLACE_PURI'; kind: PuriKind; targetPlayerId: PlayerId }
  /** Serving (your turn): end serving and open the bidding. amount >= minBid. */
  | { type: 'START_BID'; amount: number }
  /** Bidding (your turn): amount > current high bid. */
  | { type: 'RAISE'; amount: number }
  /** Bidding (your turn): drop out for the round. */
  | { type: 'PASS' }
  /** Eating (eater): flip top card of a stack (own stack until empty, then any non-empty other stack). */
  | { type: 'FLIP_PURI'; targetPlayerId: PlayerId }
  /** Eating (eater): flip the face-down power beside this player's stack. */
  | { type: 'FLIP_POWER'; targetPlayerId: PlayerId }
  /** Eating (eater): give up when an Akabare is pending, or the table is empty and you're short. */
  | { type: 'ACCEPT_BUST' }
  /** roundEnd: ready for the next round. Next round starts when every human is ready. */
  | { type: 'READY' }
  /** roundEnd: advance now regardless of readiness. The engine accepts it from anyone; the server restricts it to the host. */
  | { type: 'FORCE_CONTINUE' };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Views (server → one client). Safe to send to that player.
// ---------------------------------------------------------------------------

export interface StackCardView {
  owner: PlayerId;
  /** Known only to the card's owner (or to everyone after a reveal). */
  kind: PuriKind | null;
}

export interface PowerView {
  owner: PlayerId;
  revealed: boolean;
  /** Known if revealed, or if it's yours, or after a reveal. */
  kind: PowerKind | null;
}

export interface PublicPlayerView {
  id: PlayerId;
  name: string;
  color: ColorId;
  isBot: boolean;
  seat: number;
  score: number;
  busts: number;
  handCount: number;
  setupDone: boolean;
  ready: boolean;
  /** bottom → top. */
  stack: StackCardView[];
  power: PowerView | null;
}

export interface PrivateView {
  hand: { panipuri: number; akabare: number };
  /** Powers you may choose this round (setup). */
  availablePowers: PowerKind[];
  usedPowers: PowerKind[];
  powerPicks: PowerKind[];
  /** Your submitted setup this round (null until submitted). stack is bottom → top. */
  setup: { stack: PuriKind[]; power: PowerKind } | null;
}

export interface PlateCardView {
  owner: PlayerId;
  kind: PuriKind;
  fromStackOf: PlayerId;
  cancelled: boolean;
  saved: boolean;
}

export interface EatingView {
  eaterId: PlayerId;
  bid: number;
  target: number;
  eaten: number;
  powersFlipped: number;
  skipNext: boolean;
  pendingAkabare: { owner: PlayerId; fromStackOf: PlayerId } | null;
  plate: PlateCardView[];
  powers: FlippedPower[];
  /** True once the eater's own stack is empty (they may dig into others). */
  ownStackEmpty: boolean;
}

export interface LegalActions {
  setup: {
    hand: { panipuri: number; akabare: number };
    stackSize: number;
    availablePowers: PowerKind[];
    submitted: boolean;
  } | null;
  place: { kinds: PuriKind[]; targets: PlayerId[] } | null;
  startBid: { min: number } | null;
  raise: { min: number } | null;
  pass: boolean;
  /** Stacks you may FLIP_PURI from (empty = none). */
  flipPuri: PlayerId[];
  /** Stacks whose power you may FLIP_POWER (empty = none). */
  flipPower: PlayerId[];
  acceptBust: boolean;
  ready: boolean;
  forceContinue: boolean;
}

export interface PlayerView {
  /** Viewer (null = spectator). */
  youId: PlayerId | null;
  round: number;
  phase: Phase;
  config: GameConfig;
  firstPlayerId: PlayerId;
  players: PublicPlayerView[];
  me: PrivateView | null;
  serving: ServingState | null;
  bidding: BiddingState | null;
  eating: EatingView | null;
  results: RoundResult[];
  winners: PlayerId[] | null;
  /** Tail of the public log (last VIEW_LOG_LIMIT events). */
  log: GameEvent[];
  /** Seq of the newest event (for animation diffing). */
  lastSeq: number;
  legal: LegalActions;
  pendingActors: PlayerId[];
  /** Public upper bound for the soft bid warning: face-down puri cards on the table + 2 × powerFlipsMax. */
  tableMax: number;
  /** True during roundEnd/gameOver when leftovers are revealed (config.revealOnRoundEnd, or always at gameOver). */
  revealed: boolean;
}

export const VIEW_LOG_LIMIT = 80;
