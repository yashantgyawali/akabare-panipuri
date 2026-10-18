import { describe, expect, it } from 'vitest';
import { handCards } from './Hand.tsx';
import { slotOrders } from './SetupPanel.tsx';

const hand = handCards({ panipuri: 5, akabare: 1 }); // P P P P P A

describe('slotOrders (which held card fills which stack slot)', () => {
  it('lifts the exact card that was tapped', () => {
    expect(slotOrders(hand, ['panipuri', null], [3, null])).toEqual([null, null, null, 1, null, null]);
  });

  it('numbers picks by slot, bottom first', () => {
    expect(slotOrders(hand, ['akabare', 'panipuri'], [5, 2])).toEqual([null, null, 2, null, null, 1]);
  });

  it('falls back to the first free card of the kind when the tapped card is unknown', () => {
    expect(slotOrders(hand, ['panipuri', 'akabare'])).toEqual([1, null, null, null, null, 2]);
  });

  it('ignores a remembered card of the wrong kind', () => {
    expect(slotOrders(hand, ['akabare', null], [0, null])).toEqual([null, null, null, null, null, 1]);
  });

  it('never gives one card two slots', () => {
    const o = slotOrders(hand, ['panipuri', 'panipuri'], [2, 2]);
    expect(o.filter((x) => x !== null).sort()).toEqual([1, 2]);
    expect(o[2]).toBe(1);
  });
});
