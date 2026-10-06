/** Your hand as real card fronts (you know your own cards), in a flat row. */
import type { ColorId, PuriKind } from '../../engine/types.ts';
import { Card, type CardState } from '../../cards/index.ts';
import { cx } from '../common/hooks.ts';

export interface HandCard {
  kind: PuriKind;
  /** Which Panipuri numeral to print (1–5). */
  instance: number;
}

export function handCards(hand: { panipuri: number; akabare: number }): HandCard[] {
  return [
    ...Array.from({ length: hand.panipuri }, (_, i) => ({ kind: 'panipuri' as const, instance: i + 1 })),
    ...Array.from({ length: hand.akabare }, () => ({ kind: 'akabare' as const, instance: 1 })),
  ];
}

export function Hand({
  cards,
  color,
  width,
  selected,
  onPick,
  pickable,
  label = 'Your hand',
  emptyText = 'Your hand is empty.',
  className,
}: {
  cards: HandCard[];
  color: ColorId;
  width: number;
  /** Selected index, or null. */
  selected: number | null;
  onPick?: (index: number, card: HandCard) => void;
  /** Kinds that may be picked (others are dimmed). null = none pickable. */
  pickable: readonly PuriKind[] | null;
  label?: string;
  emptyText?: string;
  className?: string;
}) {
  const n = cards.length;
  return (
    <div className={cx('tp-hand-row', className)} role="group" aria-label={`${label}: ${n} card${n === 1 ? '' : 's'}`}>
      {n === 0 ? <p className="tp-hand-row__empty">{emptyText}</p> : null}
      {cards.map((c, i) => {
        const can = !!pickable && pickable.includes(c.kind) && !!onPick;
        const state: CardState = selected === i ? 'selected' : can ? 'selectable' : pickable ? 'dim' : 'idle';
        return (
          <div key={`${c.kind}-${c.instance}-${i}`} className="tp-hand-row__card">
            <Card
              back="puri"
              color={color}
              face={c.kind}
              instance={c.instance}
              width={width}
              state={state}
              onClick={can ? () => onPick!(i, c) : undefined}
              ariaLabel={`${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} in your hand${selected === i ? ', selected' : ''}`}
            />
          </div>
        );
      })}
    </div>
  );
}
