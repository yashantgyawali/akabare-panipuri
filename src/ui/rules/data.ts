/**
 * Rules copy, worked out from the game config so the numbers always match the
 * engine (src/engine/engine.ts): bowls per player, power flips, the +2 trap
 * reward, when used powers come back, and how the game ends. Shared by the
 * #/rules page and the compact in-game drawer.
 */
import type { ColorId, GameConfig, PowerKind } from '../../engine/types.ts';
import { POWER_KINDS } from '../../engine/types.ts';
import { PRESETS } from '../game/LobbyRules.tsx';

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Rounds in which all four powers come back: 1, R, 2R-1, ... (engine: isPowerResetRound). */
export function powerReturnRounds(c: GameConfig, count = 3): number[] {
  const step = c.powerResetRound - 1;
  const out: number[] = [];
  for (let r = 2; out.length < count && step > 0; r++) if ((r - 1) % step === 0) out.push(r);
  return out;
}

/** "All four come back in round 4, then every 3 rounds." (or "every round" for a reset every round). */
export function powerReturnText(c: GameConfig): string {
  const step = c.powerResetRound - 1;
  if (step <= 1) return 'All four come back every round, so you can pick any of them.';
  return `Each one can be picked once. All four come back in round ${c.powerResetRound}, then every ${step} rounds.`;
}

/** One-line summary of how this game is won. */
export function goalLine(c: GameConfig): string {
  const { targetScore: t, maxRounds: m } = c;
  if (t !== null && m !== null) return `First to ${t} points wins. If nobody gets there, the most points after ${plural(m, 'round')} wins.`;
  if (t !== null) return `First to ${t} points wins.`;
  return `The most points after ${plural(m ?? 0, 'round')} wins.`;
}

export interface PowerCopy {
  kind: PowerKind;
  name: string;
  /** Card colour used for the picture (any owner colour works). */
  color: ColorId;
  when: string;
  text: string;
}

const POWER_COPY: Record<PowerKind, Omit<PowerCopy, 'kind'>> = {
    vinegar: {
      name: 'Vinegar',
      color: 'orange',
      when: 'Before a bowl',
      text: "The next bowl you eat doesn't count. A Panipuri gives 0, and an Akabare can't bite.",
    },
    dahi: {
      name: 'Dahi',
      color: 'blue',
      when: 'Right after a bite',
      text: 'Saves you from the Akabare you just bit. Keep eating. At any other time it does nothing.',
    },
    nayaplate: {
      name: 'Naya Plate',
      color: 'purple',
      when: 'While eating, not after a bite',
      text: 'From now on, eat from any stack in any order, your own included. The only way to skip your own stack.',
    },
    chaat: {
      name: 'Chaat',
      color: 'green',
      when: 'While eating, not after a bite',
      text: 'Counts as 2 bowls eaten.',
    },
};

/** The four powers, in the engine's order. */
export const POWERS: PowerCopy[] = POWER_KINDS.map((kind) => ({ kind, ...POWER_COPY[kind] }));

/** The modes the lobby offers, for the "Winning" section. */
export const MODES = PRESETS.map((p) => ({ id: p.id, label: p.label, rule: p.rule }));

// ---------------------------------------------------------------------------
// The worked example (a comic strip). Three players, bottom -> top stacks.
// ---------------------------------------------------------------------------

export type Who = 'asha' | 'bikash' | 'maya';

export const CAST: Record<Who, { name: string; color: ColorId }> = {
  asha: { name: 'Asha', color: 'red' },
  bikash: { name: 'Bikash', color: 'blue' },
  maya: { name: 'Maya', color: 'yellow' },
};

export const SEATS: Who[] = ['asha', 'bikash', 'maya'];

/** A bowl in the example: whose it is and (for the reader only) what's inside. */
export interface ExBowl {
  owner: Who;
  kind: 'panipuri' | 'akabare';
  /** Just served this panel: drawn with a glow. */
  fresh?: boolean;
}

export interface ExSeat {
  stack: ExBowl[];
  /** A bowl hovering over this stack, about to land (arrow down). */
  incoming?: ExBowl;
  /** What this player says this panel. */
  says?: string;
  /** Their power card, face up once flipped. */
  power?: PowerKind;
  /** Score change shown on the last panel. */
  delta?: string;
}

export interface ExPanel {
  title: string;
  text: string;
  seats: Record<Who, ExSeat>;
  /** The eater's plate: the bowls flipped so far, in order. */
  plate?: ExBowl[];
  /** "3 of 4" under the plate. */
  tally?: string;
  /** Picture description for screen readers. */
  alt: string;
}

const P = (owner: Who, fresh = false): ExBowl => ({ owner, kind: 'panipuri', fresh });
const A = (owner: Who, fresh = false): ExBowl => ({ owner, kind: 'akabare', fresh });

export const EXAMPLE: ExPanel[] = [
  {
    title: 'Setup',
    text: 'Everyone hides 2 bowls and 1 power card. Maya hides her Akabare on top of her own stack.',
    seats: {
      asha: { stack: [P('asha'), P('asha')] },
      bikash: { stack: [P('bikash'), P('bikash')] },
      maya: { stack: [P('maya'), A('maya')] },
    },
    alt: "Three stacks of 2 upside-down bowls, each with a face-down power card. Maya's top bowl hides her Akabare.",
  },
  {
    title: 'Serve',
    text: "Asha goes first. She sneaks her Akabare onto Bikash's stack.",
    seats: {
      asha: { stack: [P('asha'), P('asha')] },
      bikash: { stack: [P('bikash'), P('bikash')], incoming: A('asha') },
      maya: { stack: [P('maya'), A('maya')] },
    },
    alt: "Asha's red Akabare bowl lands upside down on top of Bikash's stack.",
  },
  {
    title: 'Serve, then bid',
    text: 'Bikash serves a bowl onto his own stack. Maya opens the bidding at 3.',
    seats: {
      asha: { stack: [P('asha'), P('asha')] },
      bikash: { stack: [P('bikash'), P('bikash'), A('asha')], incoming: P('bikash') },
      maya: { stack: [P('maya'), A('maya')], says: '3' },
    },
    alt: 'Bikash adds a blue bowl to his own stack, which now holds 4 bowls. Maya says 3.',
  },
  {
    title: 'Bid',
    text: 'Asha raises to 4. Bikash and Maya pass. Asha is the eater: she must eat 4.',
    seats: {
      asha: { stack: [P('asha'), P('asha')], says: '4' },
      bikash: { stack: [P('bikash'), P('bikash'), A('asha'), P('bikash')], says: 'Pass' },
      maya: { stack: [P('maya'), A('maya')], says: 'Pass' },
    },
    alt: 'Asha says 4. Bikash and Maya both say pass.',
  },
  {
    title: 'Eat',
    text: "Her own stack first: 2 Panipuri. Then Bikash's top bowl: 3 of 4. She knows her chili is next there, so she switches stacks.",
    seats: {
      asha: { stack: [] },
      bikash: { stack: [P('bikash'), P('bikash'), A('asha')] },
      maya: { stack: [P('maya'), A('maya')] },
    },
    plate: [P('asha'), P('asha'), P('bikash')],
    tally: '3 of 4',
    alt: "Asha's stack is empty. Asha has eaten 3 open Panipuri bowls: 2 of hers and 1 of Bikash's.",
  },
  {
    title: 'Bite',
    text: "Maya's top bowl is her Akabare. Asha gambles on Maya's power card: Vinegar, not Dahi. Asha busts.",
    seats: {
      asha: { stack: [], delta: '−4' },
      bikash: { stack: [P('bikash'), P('bikash'), A('asha')] },
      maya: { stack: [P('maya')], power: 'vinegar', delta: '+2' },
    },
    plate: [P('asha'), P('asha'), P('bikash'), A('maya')],
    tally: 'Bitten',
    alt: "Asha's last bowl is Maya's open Akabare. Maya's power card is face up: Vinegar. Asha scores minus 4, Maya scores plus 2.",
  },
];
