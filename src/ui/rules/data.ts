/** Short copy for the rules page: three bites, the card gallery notes, the quick details. */
import type { ColorId } from '../../engine/types.ts';
import type { FaceKind } from '../../cards/index.ts';

export const STEPS = [
  { n: '1', title: 'Stack', text: 'Hide 2 puri face down on your own stack and put one power beside it. Then take turns slipping cards onto anyone’s stack. One of yours is the Akabare chili.' },
  { n: '2', title: 'Bid', text: 'Say how many Panipuri you’ll eat. Raise or pass. Only the last one standing eats.' },
  { n: '3', title: 'Eat', text: 'Flip your own stack first, then dig into others’. Bite an Akabare without Dahi and you bust.' },
];

export const GALLERY: { face: FaceKind; back: 'puri' | 'power'; color: ColorId; note: string }[] = [
  { face: 'panipuri', back: 'puri', color: 'yellow', note: 'Counts as 1 eaten. 5 per player.' },
  { face: 'akabare', back: 'puri', color: 'red', note: 'The chili trap: bite it unprotected and you bust.' },
  { face: 'chaat', back: 'power', color: 'green', note: 'Any time. Counts as 2 eaten.' },
  { face: 'vinegar', back: 'power', color: 'orange', note: 'Before a puri. Cancels the next card you eat.' },
  { face: 'dahi', back: 'power', color: 'blue', note: 'Right after a bite. Saves you from the Akabare.' },
  { face: 'nayaplate', back: 'power', color: 'purple', note: 'Any time. Flip any stack first, your own included.' },
];

export const DETAILS = [
  { k: 'Setup', v: 'Each round everyone gets 5 Panipuri and 1 Akabare. Hide 2 face down on your own stack (bottom → top) and put one power face down beside it.' },
  { k: 'Serving', v: 'On your turn, slip one puri from your hand onto any stack, yours included. Or stop serving and open the bid.' },
  { k: 'Bidding', v: 'Raise or pass, clockwise. Passing takes you out for the round. The last one standing eats their bid.' },
  { k: 'Eating', v: 'Flip your own stack first, then any other stack, top card first. Each Panipuri counts 1. You may flip up to 2 powers, anyone’s, at any time.' },
  { k: 'The chili', v: 'Bite an Akabare and only Dahi can save you, flipped right away. Otherwise you bust. If it was someone else’s Akabare, they get +2.' },
  { k: 'Scoring', v: 'Eat your bid: + the bid. Bust: − the bid. Each power you pick is used up until round 4, when all four come back.' },
];
