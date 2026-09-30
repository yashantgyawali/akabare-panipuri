/**
 * Card text & art references (rules v0.6). Framework-free.
 *
 * Titles and index numerals are exactly as printed on the v0.6 print sheets.
 * `rule` is the power-table wording from the rules PDF, shortened to fit the
 * empty lower third of the card; `short` is a one-line version for tooltips,
 * chips and the 44px-wide in-game cards' aria labels.
 */

import type { PowerKind, PuriKind } from '../engine/types.ts';

export type CardKind = PuriKind | PowerKind;

export interface CardInfo {
  /** All-caps title as printed on the card. */
  title: string;
  /** Devanagari subtitle. */
  devanagari: string;
  /** Public URL of the extracted illustration (620×620 webp). */
  art: string;
  /** When the card may be flipped (powers), or null for puri cards. */
  timing: string | null;
  /** Rule text (PDF power-table wording, shortened), timing sentence included. */
  rule: string;
  /**
   * Small-caps line above the rule on the card front ("Flip before a puri").
   * Together with `body` this is how <CardFront> prints the rule: the timing
   * lives in the label, so the body never repeats it.
   */
  label: string;
  /** The rule without its timing sentence (printed under `label`). */
  body: string;
  /** One-line summary. */
  short: string;
  /**
   * Index numeral printed in the bottom-right circle. The five Panipuri cards
   * are printed 1–5 (this is the first; see PANIPURI_INDICES / cardIndex()).
   */
  index: number;
  /** Puri (bluff surface, shares the puri back) or power (power back). */
  family: 'puri' | 'power';
}

export const CARD_INFO: Record<CardKind, CardInfo> = {
  panipuri: {
    title: 'PANIPURI',
    devanagari: 'पानीपुरी',
    art: '/art/panipuri.webp',
    timing: null,
    rule: 'Counts as 1 eaten.',
    short: 'Counts as 1 eaten.',
    label: 'Puri · safe to eat',
    body: 'Counts as 1 eaten.',
    index: 1,
    family: 'puri',
  },
  akabare: {
    title: 'AKABARE',
    devanagari: 'अकबरे',
    art: '/art/akabare.webp',
    timing: null,
    rule: 'Bite it without Vinegar or Dahi and you bust. If it busts someone else, its owner gets +2.',
    short: 'The chili trap: bite it unprotected and you bust.',
    label: 'Puri · the chili trap',
    body: 'Bite it without Vinegar or Dahi and you bust. If it busts someone else, its owner gets +2.',
    index: 6,
    family: 'puri',
  },
  vinegar: {
    title: 'VINEGAR',
    devanagari: 'सिर्का',
    art: '/art/vinegar.webp',
    timing: 'Before a puri',
    rule: "Flip before a puri. The next card you eat is cancelled: an Akabare can't hurt you, a Panipuri doesn't count.",
    short: 'Cancels the next card you eat.',
    label: 'Flip before a puri',
    body: 'The next card you eat is cancelled: an Akabare can’t hurt you, a Panipuri doesn’t count.',
    index: 7,
    family: 'power',
  },
  dahi: {
    title: 'DAHI',
    devanagari: 'दही',
    art: '/art/dahi.webp',
    timing: 'Right after an Akabare bite',
    rule: "Flip right after biting an Akabare: you're saved and keep eating. Any other time: nothing.",
    short: 'Saves you from a bitten Akabare.',
    label: 'Flip right after an Akabare bite',
    body: 'You’re saved and keep eating. Any other time it does nothing.',
    index: 8,
    family: 'power',
  },
  khali: {
    title: 'KHALI PURI',
    devanagari: 'खाली पुरी',
    art: '/art/khali.webp',
    timing: 'Any time',
    rule: 'Any time. An empty shell: your bid goes up by 1.',
    short: 'Your bid goes up by 1.',
    label: 'Flip any time',
    body: 'An empty shell: your bid goes up by 1.',
    index: 9,
    family: 'power',
  },
  chaat: {
    title: 'CHAAT',
    devanagari: 'चाट',
    art: '/art/chaat.webp',
    timing: 'Any time',
    rule: 'Any time. Counts as 2 Panipuri eaten.',
    short: 'Counts as 2 eaten.',
    label: 'Flip any time',
    body: 'Counts as 2 Panipuri eaten.',
    index: 10,
    family: 'power',
  },
};

/**
 * Art URL honouring a deploy base path (e.g. `artUrl('dahi', import.meta.env.BASE_URL)`).
 * CARD_INFO[kind].art is root-relative ('/art/dahi.webp').
 */
export function artUrl(kind: CardKind, base = '/'): string {
  return base.replace(/\/?$/, '/') + CARD_INFO[kind].art.replace(/^\//, '');
}

/** Index numerals printed on the five Panipuri cards of a set. */
export const PANIPURI_INDICES = [1, 2, 3, 4, 5] as const;

/** The printed index for a card; `instance` (1–5) picks which Panipuri. */
export function cardIndex(kind: CardKind, instance = 1): number {
  return kind === 'panipuri' ? Math.min(5, Math.max(1, Math.round(instance))) : CARD_INFO[kind].index;
}

export interface BackCopy {
  title: string;
  devanagari: string;
}

/** Wordmarks on the two card backs. */
export const BACK_COPY: { puri: BackCopy; power: BackCopy } = {
  puri: { title: 'AKABARE PANIPURI', devanagari: 'अकबरे पानीपुरी' },
  power: { title: 'POWER', devanagari: 'शक्ति' },
};
