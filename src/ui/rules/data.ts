/** Short copy for the rules page: three steps and the six cards. */
import type { ColorId } from '../../engine/types.ts';
import type { FaceKind } from '../../cards/index.ts';

export const STEPS = [
  { n: '1', title: 'Stack', text: 'Hide cards, then slip puri onto stacks.' },
  { n: '2', title: 'Bid', text: 'Raise or pass. The last one in eats.' },
  { n: '3', title: 'Eat', text: 'Flip your stack first. Akabare busts you.' },
];

export const GALLERY: { face: FaceKind; back: 'puri' | 'power'; color: ColorId; note: string }[] = [
  { face: 'panipuri', back: 'puri', color: 'yellow', note: 'Counts 1.' },
  { face: 'akabare', back: 'puri', color: 'red', note: 'Bust, unless Dahi.' },
  { face: 'chaat', back: 'power', color: 'green', note: 'Counts 2.' },
  { face: 'vinegar', back: 'power', color: 'orange', note: 'Cancels next card.' },
  { face: 'dahi', back: 'power', color: 'blue', note: 'Saves from Akabare.' },
  { face: 'nayaplate', back: 'power', color: 'purple', note: 'Flip any stack first.' },
];
